/**
 * src/utils/uptimeKuma.js
 *
 * Pings Uptime Kuma push monitors. No new dependencies — built-in https/http.
 *
 * Configure in .env:
 *   UPTIME_KUMA_HEARTBEAT_URL  — push monitor for bot liveness (ping every 5 min)
 *   UPTIME_KUMA_MENU_PUSH_URL  — push monitor for daily menu delivery
 *
 * Two things this module learned the hard way (2026-10-12):
 *
 * Uptime Kuma's UI shows a push URL with its query string already attached —
 * `.../api/push/TOKEN?status=up&msg=OK&ping=`. Callers used to append their own
 * `?status=…`, producing a URL with two question marks, which Node rejects as
 * malformed. The push failed, the reason went to the debug log, and every
 * monitor stayed green while nothing was ever reported: the August outage, the
 * vacation gap and the mislabelled Kameoka weeks all went unpaged. Use
 * `resolvePushUrl()` — it *replaces* the query rather than appending to it, so
 * either form in .env works.
 *
 * A monitor that cannot be reached is worth saying out loud, so failures are
 * logged at warn level — rate-limited per label, because an Uptime Kuma outage
 * should not flood the log every five minutes.
 */

const https = require('https');
const http = require('http');
const logger = require('./logger');

const WARN_INTERVAL_MS = 60 * 60 * 1000;
const lastWarnAt = new Map();

/**
 * Build a push URL from a configured base, discarding whatever query string it
 * came with and setting the status and message this push carries.
 *
 * @param {string} baseUrl bare `.../api/push/TOKEN` or the UI's example form
 * @param {{status?: 'up'|'down', msg?: string}} [params] `msg` is passed raw; it
 *        is encoded here, so callers must not pre-encode it.
 * @returns {string|null} null when there is nothing usable to push to
 */
function resolvePushUrl(baseUrl, params = {}) {
  if (!baseUrl) return null;

  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    // Never echo the whole thing — it carries the push token.
    logger.error(`Uptime Kuma push URL is not a valid URL: ${String(baseUrl).slice(0, 30)}…`);
    return null;
  }

  parsed.search = '';
  parsed.searchParams.set('status', params.status || 'up');
  if (params.msg !== undefined) parsed.searchParams.set('msg', params.msg);

  return parsed.toString();
}

/**
 * GET a Uptime Kuma push URL and log the result.
 * Never throws — a dead Uptime Kuma must not take down the bot.
 */
async function push(url, label = 'uptime-kuma') {
  if (!url) return;

  try {
    const client = url.startsWith('https://') ? https : http;
    await new Promise((resolve, reject) => {
      const req = client.request(url, { method: 'GET', timeout: 10_000 }, (res) => {
        res.resume(); // consume response
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    });
    logger.debug(`📡 Pinged ${label}`);
  } catch (err) {
    const message = `Uptime Kuma ping failed (${label}): ${err.message}`;
    const now = Date.now();
    if (now - (lastWarnAt.get(label) || 0) > WARN_INTERVAL_MS) {
      lastWarnAt.set(label, now);
      logger.warn(message);
    } else {
      logger.debug(message);
    }
  }
}

module.exports = { push, resolvePushUrl };
