const logger = require('../utils/logger');
const menuPublisher = require('../publishers/menuPublisher');
const db = require('../db');

module.exports = {
  name: 'ready',
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
      logger.info('📅 Menu publisher scheduled (9:00 AM JST, Mon-Fri)');
    } catch (error) {
      logger.error(`Failed to start menu publisher: ${error.message}`);
    }
  },
};
