/**
 * src/server.js
 *
 * Lightweight HTTP health endpoint for Uptime Kuma monitoring.
 * Uses Node's built-in http module — no Express dependency.
 *
 * Returns 503 only for unambiguous failures: the database being unreachable,
 * or Discord being disconnected. Delivery staleness is reported as data rather
 * than failed on, because zero deliveries is legitimate while the cafeteria is
 * closed — that judgement needs menu-availability context the publisher has
 * and this endpoint does not.
 */

const http = require('http');
const db = require('./db');
const logger = require('./utils/logger');
const { todayCampus } = require('./utils/campusDate');

let startTime = null; // set when the bot comes online
let clientRef = null; // reference to Discord client for guild count

const PORT = parseInt(process.env.HEALTH_PORT, 10) || 3000;

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

function start(client) {
  clientRef = client;
  startTime = Date.now();

  const server = http.createServer((req, res) => {
    const path = (req.url || '').split('?')[0];

    if (path !== '/api/status' && path !== '/') {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    buildStatus()
      .then((body) => {
        res.writeHead(body.healthy ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      })
      .catch((err) => {
        logger.error(`Health check failed: ${err.message}`);
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', healthy: false, error: err.message }));
      });
  });

  server.listen(PORT, () => {
    logger.info(`🩺 Health endpoint listening on port ${PORT}`);
  });

  server.on('error', (err) => {
    logger.warn(`Health server error: ${err.message}`);
  });
}

module.exports = { start, buildStatus };
