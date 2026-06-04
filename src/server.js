/**
 * src/server.js
 *
 * Lightweight HTTP health endpoint for Uptime Kuma monitoring.
 * Uses Node's built-in http module — no Express dependency.
 */

const http = require('http');
const logger = require('./utils/logger');

let startTime = null; // set when the bot comes online
let clientRef = null; // reference to Discord client for guild count

const PORT = parseInt(process.env.HEALTH_PORT, 10) || 3000;

function start(client) {
  clientRef = client;
  startTime = Date.now();

  const server = http.createServer((req, res) => {
    if (req.url === '/api/status' || req.url === '/') {
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      const body = JSON.stringify({
        status: 'online',
        uptimeSeconds: uptime,
        guilds: clientRef?.guilds?.cache?.size ?? 0,
        discordConnected: clientRef?.isReady?.() ?? false,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });

  server.listen(PORT, () => {
    logger.info(`🩺 Health endpoint listening on port ${PORT}`);
  });

  server.on('error', (err) => {
    logger.warn(`Health server error: ${err.message}`);
  });
}

module.exports = { start };
