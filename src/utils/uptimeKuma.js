/**
 * src/utils/uptimeKuma.js
 *
 * Pings Uptime Kuma push monitors. No new dependencies — uses built-in https/http.
 *
 * Configure in .env:
 *   UPTIME_KUMA_HEARTBEAT_URL  — push monitor for bot liveness (ping every 5 min)
 *   UPTIME_KUMA_MENU_PUSH_URL  — push monitor for daily menu delivery
 */

const https = require('https');
const http = require('http');
const logger = require('./logger');

/**
 * POST to a Uptime Kuma push URL and log the result.
 * Silently ignores failures — a dead Uptime Kuma shouldn't take down the bot.
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
    logger.debug(`Uptime Kuma ping failed (${label}): ${err.message}`);
  }
}

module.exports = { push };
