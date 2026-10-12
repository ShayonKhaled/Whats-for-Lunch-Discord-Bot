/**
 * src/utils/adminAlert.js
 *
 * A best-effort DM to BOT_ADMIN_ID for scripts that run outside the bot process
 * — the data check, publishNow — where there is no long-lived client to reuse.
 *
 * Alerting must never change the outcome of the thing it reports on, so this
 * resolves false instead of throwing, and gives up after a timeout rather than
 * leaving a cron job hanging on a Discord outage.
 */

const { Client, GatewayIntentBits } = require('discord.js');
const logger = require('./logger');

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * @param {string} content message body
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<boolean>} true when the DM was sent
 */
async function sendAdminDm(content, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const adminId = process.env.BOT_ADMIN_ID;
  const token = process.env.DISCORD_BOT_TOKEN;

  // Silently nothing to do — an unconfigured alert is not a failure.
  if (!adminId || !token) return false;

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const deliver = (async () => {
    await client.login(token);
    const admin = await client.users.fetch(adminId);
    await admin.send({ content });
    return true;
  })();

  let timer;
  try {
    return await Promise.race([
      deliver,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
  } catch (err) {
    logger.warn(`Could not send admin DM: ${err.message}`);
    return false;
  } finally {
    clearTimeout(timer);
    client.destroy();
    // The losing branch of the race may still reject later; nothing to do with it.
    deliver.catch(() => {});
  }
}

module.exports = { sendAdminDm };
