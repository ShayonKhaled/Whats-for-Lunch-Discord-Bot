const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check the menu bot subscription status for this server'),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const guildId = interaction.guildId;
      const subscription = await db.getSubscriptionByGuildId(guildId);

      if (!subscription || !subscription.is_active) {
        return interaction.editReply({
          content:
            '❌ **Not Subscribed**\nRun `/subscribe` in a channel to enable menu updates.',
        });
      }

      const subscribedDate = new Date(subscription.subscribed_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });

      const statusMessage = `✅ **Menu Bot Status**
Channel: <#${subscription.channel_id}>
Subscribed: ${subscribedDate}
Next update: 9:00 AM JST (Mon-Fri)`;

      return interaction.editReply({
        content: statusMessage,
      });
    } catch (error) {
      logger.error(`Error in status command: ${error.message}`);
      return interaction.editReply({
        content: '❌ Database error. Please try again later.',
      });
    }
  },
};
