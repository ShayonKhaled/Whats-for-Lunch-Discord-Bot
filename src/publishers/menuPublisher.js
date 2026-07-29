const schedule = require('node-schedule');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');
const { formatMenuMessage } = require('../utils/formatMenu');
const { push: pingUptimeKuma } = require('../utils/uptimeKuma');

let scheduledJob = null;

async function publishMenu(client) {
  const now = new Date();
  logger.info(`🔄 Menu publisher job started at ${now.toISOString()}`);

  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Get all active subscriptions (now per-campus)
    const subscriptions = await db.getActiveSubscriptions();
    logger.info(`📤 Found ${subscriptions.length} active subscription(s)`);

    if (subscriptions.length === 0) {
      logger.info('ℹ️ No active subscriptions, skipping delivery');
      return;
    }

    // Group subscriptions by campus
    const byCampus = {};
    for (const sub of subscriptions) {
      (byCampus[sub.campus] ||= []).push(sub);
    }

    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (const [campus, subs] of Object.entries(byCampus)) {
      logger.info(`🍽️ Processing ${campus} Campus — ${subs.length} subscriber(s)`);

      // Fetch this campus's menu ONCE
      const menuItems = await db.getTodayMenu(campus);

      if (!menuItems || menuItems.length === 0) {
        logger.warn(`⚠️ No menu items found for ${campus} Campus today — skipping`);
        continue;
      }

      logger.info(`📋 Found ${menuItems.length} menu items for ${campus} Campus`);

      // Fetch aggregate ratings
      const dishNames = [...new Set(menuItems.map((d) => d.dish_name))];
      const ratingsMap = await db.getRatingsForDishes(dishNames);
      if (ratingsMap.size > 0) {
        logger.info(`⭐ Loaded ratings for ${ratingsMap.size} dish(es) from ${campus} Campus`);
      }

      // Format menu with campus-specific config
      const messageChunks = formatMenuMessage(menuItems, ratingsMap, campus);
      logger.info(`📝 Formatted ${campus} Campus menu into ${messageChunks.length} chunk(s)`);

      // Campus-specific rate button
      const rateButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rate_menu_open:${campus}:${today}`)
          .setLabel('⭐ Rate today\'s dishes')
          .setStyle(ButtonStyle.Secondary)
      );

      // Deliver to each subscriber of this campus
      for (const subscription of subs) {
        try {
          const { guild_id: guildId, channel_id: channelId, guild_name: guildName } = subscription;

          const alreadySent = await db.hasSuccessfulDelivery(guildId, campus, today);
          if (alreadySent) {
            logger.info(`⏭️  Skipped ${guildName} (${campus}): already sent today`);
            skipCount++;
            continue;
          }

          const channel = await client.channels.fetch(channelId).catch(() => null);
          if (!channel) {
            logger.warn(`❌ Channel not found for ${guildName} (${channelId})`);
            await db.logDelivery(guildId, channelId, campus, today, 'failed', 'Channel not found');
            failCount++;
            continue;
          }

          const me = channel.guild.members.me;
          if (!me || !channel.permissionsFor(me).has('SendMessages')) {
            logger.warn(`❌ No permission to send in ${guildName}/#${channel.name}`);
            await db.logDelivery(guildId, channelId, campus, today, 'failed', 'Missing SendMessages permission');
            failCount++;
            continue;
          }

          const roleId = subscription.role_id;

          for (let i = 0; i < messageChunks.length; i++) {
            const isFirst = i === 0;

            const menuContent = isFirst && roleId
              ? `<@&${roleId}>\n${messageChunks[i]}`
              : messageChunks[i];

            const content = isFirst
              ? `${menuContent}\n\n## **Tap below to rate the menu**`
              : menuContent;

            await channel.send({
              content,
              components: isFirst ? [rateButton] : [],
            });
          }

          await db.logDelivery(guildId, channelId, campus, today, 'success', null);
          logger.info(`✅ Sent ${campus} Campus menu to ${guildName}/#${channel.name}`);
          successCount++;
        } catch (error) {
          logger.error(`❌ Error sending ${campus} menu to guild ${subscription.guild_name}: ${error.message}`);
          await db
            .logDelivery(subscription.guild_id, subscription.channel_id, campus, today, 'failed', error.message)
            .catch((err) => logger.error(`Failed to log delivery error: ${err.message}`));
          failCount++;
        }
      }
    }

    logger.info(`📊 Publisher summary: ${successCount} sent, ${skipCount} skipped, ${failCount} failed`);

    // Ping Uptime Kuma — tells it the menu publisher ran, with delivery counts as query params
    const menuPushUrl = process.env.UPTIME_KUMA_MENU_PUSH_URL;
    if (menuPushUrl) {
      const url = `${menuPushUrl}?status=up&msg=${successCount}%20sent%2C%20${failCount}%20failed`;
      pingUptimeKuma(url, 'menu-delivery');
    }

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
