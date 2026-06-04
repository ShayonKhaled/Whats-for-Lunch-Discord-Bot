const schedule = require('node-schedule');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');
const { formatMenuMessage } = require('../utils/formatMenu');

let scheduledJob = null;

async function publishMenu(client) {
  const now = new Date();
  logger.info(`🔄 Menu publisher job started at ${now.toISOString()}`);

  try {
    const menuItems = await db.getTodayMenu();

    if (!menuItems || menuItems.length === 0) {
      logger.warn('⚠️ No menu items found for today');
      return;
    }

    logger.info(`📋 Found ${menuItems.length} menu items for today`);

    // ── Fetch aggregate ratings for all dishes in today's menu ──────────────
    const dishNames = [...new Set(menuItems.map((d) => d.dish_name))];
    const ratingsMap = await db.getRatingsForDishes(dishNames);
    const ratedCount = ratingsMap.size;
    if (ratedCount > 0) {
      logger.info(`⭐ Loaded ratings for ${ratedCount} previously-rated dish(es)`);
    }

    // ── Format menu (ratings injected inline where available) ────────────────
    const messageChunks = formatMenuMessage(menuItems, ratingsMap);
    logger.info(`📝 Formatted menu into ${messageChunks.length} Discord message chunk(s)`);

    // ── Build the "Rate Menu" button ─────────────────────────────────────────
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const rateButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rate_menu_open:${today}`)
        .setLabel('⭐ Rate today\'s dishes')
        .setStyle(ButtonStyle.Secondary)
    );

    const subscriptions = await db.getActiveSubscriptions();
    logger.info(`📤 Sending menu to ${subscriptions.length} subscribed guild(s)`);

    if (subscriptions.length === 0) {
      logger.info('ℹ️ No active subscriptions, skipping delivery');
      return;
    }

    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (const subscription of subscriptions) {
      try {
        const { guild_id: guildId, channel_id: channelId, guild_name: guildName } = subscription;

        const alreadySent = await db.hasSuccessfulDelivery(guildId, today);
        if (alreadySent) {
          logger.info(`⏭️  Skipped ${guildName}: already sent today`);
          skipCount++;
          continue;
        }

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
          logger.warn(`❌ Channel not found for ${guildName} (${channelId})`);
          await db.logDelivery(guildId, channelId, today, 'failed', 'Channel not found');
          failCount++;
          continue;
        }

        const me = channel.guild.members.me;
        if (!me || !channel.permissionsFor(me).has('SendMessages')) {
          logger.warn(`❌ No permission to send in ${guildName}/#${channel.name}`);
          await db.logDelivery(guildId, channelId, today, 'failed', 'Missing SendMessages permission');
          failCount++;
          continue;
        }

        const roleId = subscription.role_id;
        const lastChunkIndex = messageChunks.length - 1;

        await channel.send({
          content: 'Tap below to rate the menu',
          components: [rateButton],
        });

        for (let i = 0; i < messageChunks.length; i++) {
          const isFirst = i === 0;

          const content = isFirst && roleId
            ? `<@&${roleId}>\n${messageChunks[i]}`
            : messageChunks[i];

          await channel.send({ content });
        }

        await db.logDelivery(guildId, channelId, today, 'success', null);
        logger.info(`✅ Sent menu to ${guildName}/#${channel.name}`);
        successCount++;
      } catch (error) {
        logger.error(`❌ Error sending to guild ${subscription.guild_name}: ${error.message}`);
        await db
          .logDelivery(subscription.guild_id, subscription.channel_id, today, 'failed', error.message)
          .catch((err) => logger.error(`Failed to log delivery error: ${err.message}`));
        failCount++;
      }
    }

    logger.info(`📊 Publisher summary: ${successCount} sent, ${skipCount} skipped, ${failCount} failed`);

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

    if (process.env.BOT_ADMIN_ID && client) {
      try {
        const admin = await client.users.fetch(process.env.BOT_ADMIN_ID);
        if (admin) {
          await admin.send({ content: `🚨 **Menu Publisher Critical Error**\n${error.message}` });
        }
      } catch (alertErr) {
        logger.error(`Could not send critical error alert: ${alertErr.message}`);
      }
    }
  }
}

function start(client) {
  if (scheduledJob) {
    logger.warn('Menu publisher already running, skipping restart');
    return;
  }

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
