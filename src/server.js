/**
 * src/server.js
 *
 * The bot's HTTP surface: the Uptime Kuma health endpoint, and the local admin
 * dashboard. Uses Node's built-in http module — no Express dependency.
 *
 * Health returns 503 only for unambiguous failures: the database being
 * unreachable, or Discord being disconnected. Delivery staleness is reported as
 * data rather than failed on, because zero deliveries is legitimate while the
 * cafeteria is closed — that judgement needs menu-availability context the
 * publisher has and this endpoint does not.
 *
 * `/` and `/api/status` are load-bearing for monitoring and their responses are
 * unchanged by the dashboard. Everything the dashboard added lives under
 * /dashboard and the other /api/* paths.
 *
 * Access control: the read endpoints are open when DASHBOARD_TOKEN is unset,
 * which suits a bot reachable only on a home LAN. Setting DASHBOARD_TOKEN locks
 * every dashboard endpoint behind it. Re-publishing always requires the token
 * and is disabled entirely without one — an unset token must never authorise a
 * write.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const logger = require('./utils/logger');
const { todayCampus, datesBetween, shiftDate } = require('./utils/campusDate');
const { buildOverview } = require('./dashboard/overview');
const logTail = require('./dashboard/logTail');
const publishRunner = require('./dashboard/publishRunner');

let startTime = null; // set when the bot comes online
let clientRef = null; // reference to Discord client for guild count

const PORT = parseInt(process.env.HEALTH_PORT, 10) || 3000;

const DASHBOARD_HTML = path.join(__dirname, 'dashboard', 'index.html');

/** Clamped so a stray ?days=100000 cannot ask Postgres for the whole table. */
const DEFAULT_WINDOW_DAYS = 14;
const MAX_WINDOW_DAYS = 120;

async function buildStatus() {
  const discordConnected = clientRef?.isReady?.() ?? false;

  let databaseConnected = true;
  try {
    await db.ping();
  } catch (err) {
    databaseConnected = false;
    logger.warn(`Health check: database unreachable — ${err.message}`);
  }

  let lastDelivery = null;
  let daysSinceLastDelivery = null;
  if (databaseConnected) {
    const row = await db.getLastSuccessfulDelivery();
    if (row) {
      lastDelivery = { menuDate: row.menu_date, deliveredAt: row.delivered_at };
      const today = todayCampus();
      const msPerDay = 24 * 60 * 60 * 1000;
      daysSinceLastDelivery = Math.round(
        (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${row.menu_date}T00:00:00Z`)) / msPerDay
      );
    }
  }

  const healthy = discordConnected && databaseConnected;

  return {
    status: healthy ? 'online' : 'degraded',
    healthy,
    uptimeSeconds: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0,
    guilds: clientRef?.guilds?.cache?.size ?? 0,
    discordConnected,
    databaseConnected,
    lastDelivery,
    daysSinceLastDelivery,
  };
}

// ─── Dashboard payloads ──────────────────────────────────────────────────────

async function buildDashboardOverview(days) {
  const today = todayCampus();
  // Inclusive of today, so `days=14` means "the last fortnight up to now".
  const from = shiftDate(today, -(days - 1));

  const [subscriptions, menuCounts, deliveries] = await Promise.all([
    db.getActiveSubscriptions(),
    db.getMenuCountsBetween(from, today),
    db.getDeliveriesBetween(from, today),
  ]);

  const overview = buildOverview({
    // Newest first — the dashboard reads top-down and today is what you came for.
    dates: datesBetween(from, today).reverse(),
    today,
    subscriptions,
    menuCounts,
    deliveries,
  });

  return {
    ...overview,
    publish: publishRunner.getState(),
    subscriptions: subscriptions.map((sub) => ({
      guildId: String(sub.guild_id),
      guildName: sub.guild_name,
      channelName: sub.channel_name,
      campus: sub.campus,
      subscribedAt: sub.subscribed_at,
    })),
  };
}

// ─── Routing ─────────────────────────────────────────────────────────────────

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

/** Header or query string — the header for the page, the query for curl. */
function suppliedToken(req, url) {
  return req.headers['x-dashboard-token'] || url.searchParams.get('token') || '';
}

/**
 * Gate for the dashboard's read endpoints. Open when no token is configured;
 * strict when one is. Returns true if the request may proceed.
 */
function guardRead(req, res, url) {
  if (!publishRunner.isEnabled()) return true;
  if (publishRunner.isAuthorised(suppliedToken(req, url))) return true;

  sendJson(res, 401, { error: 'Unauthorised', hint: 'Supply the X-Dashboard-Token header' });
  return false;
}

async function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname.replace(/\/+$/, '') || '/';

  // ── Health: unchanged contract, no auth, monitored by Uptime Kuma ─────────
  if (route === '/' || route === '/api/status') {
    const body = await buildStatus();
    sendJson(res, body.healthy ? 200 : 503, body);
    return;
  }

  // ── The dashboard page itself ─────────────────────────────────────────────
  // Served unauthenticated even when a token is set: it is a static shell with
  // no data in it, and it needs to load in order to prompt for the token.
  if (route === '/dashboard') {
    const html = await fs.promises.readFile(DASHBOARD_HTML);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': html.length,
      'Cache-Control': 'no-store',
    });
    res.end(html);
    return;
  }

  if (route === '/api/overview') {
    if (!guardRead(req, res, url)) return;
    const requested = parseInt(url.searchParams.get('days'), 10);
    const days = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), MAX_WINDOW_DAYS)
      : DEFAULT_WINDOW_DAYS;
    sendJson(res, 200, await buildDashboardOverview(days));
    return;
  }

  if (route === '/api/menu') {
    if (!guardRead(req, res, url)) return;
    const date = url.searchParams.get('date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
      sendJson(res, 400, { error: 'A ?date=YYYY-MM-DD parameter is required' });
      return;
    }
    sendJson(res, 200, { date, items: await db.getMenuItemsForDate(date) });
    return;
  }

  if (route === '/api/logs') {
    if (!guardRead(req, res, url)) return;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 100, 1), 500);
    const level = url.searchParams.get('level') || 'WARN';
    sendJson(res, 200, await logTail.readRecent({ minLevel: level, limit }));
    return;
  }

  // ── The only write endpoint ───────────────────────────────────────────────
  if (route === '/api/publish') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Use POST' });
      return;
    }
    if (!publishRunner.isEnabled()) {
      sendJson(res, 503, {
        error: 'Re-publishing is disabled',
        hint: 'Set DASHBOARD_TOKEN in .env and restart the bot to enable it',
      });
      return;
    }
    if (!publishRunner.isAuthorised(suppliedToken(req, url))) {
      logger.warn(`🔒 Rejected unauthorised publish attempt from ${req.socket.remoteAddress}`);
      sendJson(res, 401, { error: 'Unauthorised' });
      return;
    }

    const result = publishRunner.trigger(clientRef, `dashboard (${req.socket.remoteAddress})`);
    sendJson(res, result.started ? 202 : 409, { ...result, publish: publishRunner.getState() });
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
}

function start(client) {
  clientRef = client;
  startTime = Date.now();

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      logger.error(`HTTP ${req.method} ${req.url} failed: ${err.message}`);
      if (!res.headersSent) {
        // The health paths must still fail closed with 503 so Uptime Kuma sees
        // the same hard failure it saw before the dashboard existed, rather
        // than a 500 it might be configured to treat differently.
        const route = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
        const isHealth = route === '/' || route === '/api/status';
        sendJson(res, isHealth ? 503 : 500, { status: 'error', healthy: false, error: err.message });
      } else {
        res.end();
      }
    });
  });

  server.listen(PORT, () => {
    logger.info(`🩺 Health endpoint listening on port ${PORT}`);
    logger.info(`🖥️  Admin dashboard at http://<host>:${PORT}/dashboard`);
    if (!publishRunner.isEnabled()) {
      logger.info('ℹ️  DASHBOARD_TOKEN unset — dashboard is read-only');
    }
  });

  server.on('error', (err) => {
    logger.warn(`Health server error: ${err.message}`);
  });
}

module.exports = { start, buildStatus, buildDashboardOverview };
