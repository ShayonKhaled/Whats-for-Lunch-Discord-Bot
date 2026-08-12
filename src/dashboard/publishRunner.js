/**
 * src/dashboard/publishRunner.js
 *
 * The one thing on the dashboard that changes state: re-running the menu
 * publisher on demand.
 *
 * Two deliberate choices here.
 *
 * It does not await the publish. Posting to eight guilds takes long enough
 * that holding the HTTP request open invites a proxy or browser timeout to
 * report a failure for a run that actually succeeded. The request starts the
 * run and returns; the dashboard polls /api/overview, which carries the run
 * state, to see how it went.
 *
 * It reuses publishMenu() rather than reimplementing delivery. That means the
 * existing `hasSuccessfulDelivery` guard applies, so pressing the button twice
 * does not double-post: guilds already delivered to today are skipped and only
 * the failed ones are retried. "Re-publish" is therefore always a retry, never
 * a duplicate.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');
const menuPublisher = require('../publishers/menuPublisher');

const state = {
  running: false,
  startedAt: null,
  finishedAt: null,
  error: null,
  triggeredBy: null,
};

/** Whether the trigger is configured at all. Without a token it stays off. */
function isEnabled() {
  return Boolean(process.env.DASHBOARD_TOKEN);
}

/**
 * Constant-time comparison of the supplied token against DASHBOARD_TOKEN.
 *
 * Returns false when no token is configured — the endpoint is opt-in, so an
 * unset DASHBOARD_TOKEN must never authorise anything. Length is compared
 * first because timingSafeEqual throws on a length mismatch.
 */
function isAuthorised(supplied) {
  const expected = process.env.DASHBOARD_TOKEN;
  if (!expected || typeof supplied !== 'string' || supplied.length === 0) return false;

  const a = Buffer.from(supplied, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

/** A snapshot of the last/current run, for the overview payload. */
function getState() {
  return { enabled: isEnabled(), ...state };
}

/**
 * Kick off a publisher run.
 * @returns {{started: boolean, reason?: string}}
 */
function trigger(client, triggeredBy = 'dashboard') {
  if (state.running) {
    return { started: false, reason: 'A publish run is already in progress' };
  }
  if (!client?.isReady?.()) {
    return { started: false, reason: 'Discord client is not connected' };
  }

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.error = null;
  state.triggeredBy = triggeredBy;

  logger.info(`🖥️  Manual publish triggered from ${triggeredBy}`);

  // Detached on purpose — see the module comment. publishMenu already handles
  // and logs its own errors, so the catch here is for anything it rethrows.
  menuPublisher
    .publishMenu(client)
    .catch((err) => {
      state.error = err.message;
      logger.error(`Manual publish failed: ${err.message}`);
    })
    .finally(() => {
      state.running = false;
      state.finishedAt = new Date().toISOString();
    });

  return { started: true };
}

module.exports = { trigger, getState, isAuthorised, isEnabled };
