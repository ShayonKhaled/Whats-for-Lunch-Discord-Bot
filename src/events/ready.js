const { Events } = require('discord.js');
const { POSTING_TIME } = require('../config/cafeteria');
const logger = require('../utils/logger');
const menuPublisher = require('../publishers/menuPublisher');
const db = require('../db');

module.exports = {
  // discord.js v14 renamed this to 'clientReady'; 'ready' stops firing in v15.
  // Events.ClientReady resolves to whichever name the installed version uses.
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    logger.info(`✅ Bot is online and ready!`);
    logger.info(`📋 Logged in as ${client.user.tag}`);

    // Set bot activity/presence
    client.user.setActivity('🍱 /subscribe for menus', { type: 'PLAYING' });
    logger.info('🎮 Bot activity set');

    // Get subscription count
    try {
      const subscriptions = await db.getActiveSubscriptions();
      logger.info(`📊 Currently serving ${subscriptions.length} guild(s)`);
    } catch (error) {
      logger.warn(`Could not fetch subscription count: ${error.message}`);
    }

    // Start the menu publisher job
    try {
      menuPublisher.start(client);
      logger.info(`📅 Menu publisher scheduled (${POSTING_TIME}, Mon-Fri)`);
    } catch (error) {
      logger.error(`Failed to start menu publisher: ${error.message}`);
    }
  },
};
