const schedule = require('node-schedule');
const db = require('../db');
const logger = require('../utils/logger');
const { formatMenuMessage } = require('../utils/formatMenu');

let scheduledJob = null;

async function publishMenu(client) {
  const now = new Date();
  logger.info(`🔄 Menu publisher job started at ${now.toISOString()}`);

  try {
    // Fetch today's menu
    const menuItems = await db.getTodayMenu();

    if (!menuItems || menuItems.length === 0) {
      logger.warn('⚠️ No menu items found for today');
      return;
    }

    logger.info(`📋 Found ${menuItems.length} menu items for today`);

    // Format the menu
    const messageChunks = formatMenuMessage(menuItems);
    logger.info(`📝 Formatted menu into ${messageChunks.length} Discord message chunk(s)`);

    // Get all active subscriptions
    const subscriptions = await db.getActiveSubscriptions();
    logger.info(`📤 Sending menu to ${subscriptions.length} subscribed guild(s)`);

    if (subscriptions.length === 0) {
      logger.info('ℹ️ No active subscriptions, skipping delivery');
      return;
    }

    // Get today's date for delivery log
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    // Send to each subscribed guild
    for (const subscription of subscriptions) {
      try {
        const { guild_id: guildId, channel_id: channelId, guild_name: guildName } =
          subscription;

        // Check if already successfully sent today — skipped rows do not block redelivery
        const alreadySent = await db.hasSuccessfulDelivery(guildId, today);
        if (alreadySent) {
          logger.info(`⏭️  Skipped ${guildName}: already sent today`);
          skipCount++;
          continue;
        }

        // Get the Discord channel
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
          logger.warn(`❌ Channel not found for ${guildName} (${channelId})`);
          await db.logDelivery(
            guildId,
            channelId,
            today,
            'failed',
            'Channel not found (deleted or bot removed)'
          );
          failCount++;
          continue;
        }

        // Check bot permissions using guild member object to avoid throws
        // when the bot has been removed from a guild
        const me = channel.guild.members.me;
        if (!me || !channel.permissionsFor(me).has('SendMessages')) {
          logger.warn(`❌ No permission to send messages in ${guildName}/#${channel.name}`);
          await db.logDelivery(
            guildId,
            channelId,
            today,
            'failed',
            'Missing SendMessages permission'
          );
          failCount++;
          continue;
        }

        // Send message chunks; mention the guild's notify-menu role on the first chunk only
        const roleId = subscription.role_id;
        let firstChunk = true;

        for (const chunk of messageChunks) {
          const content = firstChunk && roleId ? `<@&${roleId}>\n${chunk}` : chunk;
          await channel.send({ content });
          firstChunk = false;
        }

        // Log successful delivery
        await db.logDelivery(guildId, channelId, today, 'success', null);
        logger.info(`✅ Sent menu to ${guildName}/#${channel.name}`);
        successCount++;
      } catch (error) {
        logger.error(
          `❌ Error sending to guild ${subscription.guild_name}: ${error.message}`
        );
        await db
          .logDelivery(
            subscription.guild_id,
            subscription.channel_id,
            today,
            'failed',
            error.message
          )
          .catch((err) => {
            logger.error(`Failed to log delivery error: ${err.message}`);
          });
        failCount++;
      }
    }

    logger.info(`📊 Publisher summary: ${successCount} sent, ${skipCount} skipped, ${failCount} failed`);

    // Alert admin if there were failures
    if (failCount > 0 && process.env.BOT_ADMIN_ID) {
      try {
        const admin = await client.users.fetch(process.env.BOT_ADMIN_ID);
        if (admin) {
          await admin.send({
            content: `⚠️ **Menu Publisher Alert**\n${failCount} guild(s) failed to receive today's menu.\nCheck bot permissions and channel availability.`,
          });
        }
      } catch (error) {
        logger.warn(`Could not send admin alert: ${error.message}`);
      }
    }
  } catch (error) {
    logger.error(`❌ Publisher job error: ${error.message}`);

    // Alert admin of critical error
    if (process.env.BOT_ADMIN_ID && client) {
      try {
        const admin = await client.users.fetch(process.env.BOT_ADMIN_ID);
        if (admin) {
          await admin.send({
            content: `🚨 **Menu Publisher Critical Error**\n${error.message}`,
          });
        }
      } catch (error) {
        logger.error(`Could not send critical error alert: ${error.message}`);
      }
    }
  }
}

function start(client) {
  if (scheduledJob) {
    logger.warn('Menu publisher already running, skipping restart');
    return;
  }

  // Schedule: 9 AM JST, Monday-Friday
  // Timezone is set explicitly so the job fires correctly regardless of
  // the system TZ environment variable.
  scheduledJob = schedule.scheduleJob(
    { rule: '0 9 * * 1-5', tz: 'Asia/Tokyo' },
    async () => {
      await publishMenu(client);
    }
  );

  logger.info('✅ Menu publisher scheduled (9:00 AM JST, Mon-Fri)');
}

function stop() {
  if (scheduledJob) {
    scheduledJob.cancel();
    scheduledJob = null;
    logger.info('Menu publisher stopped');
  }
}

module.exports = { start, stop, publishMenu };
