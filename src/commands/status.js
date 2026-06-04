const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');
const { buildCampusSelector } = require('../interactions/campusSelector');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check the menu bot subscription status for this server'),

  async execute(interaction) {
    return interaction.reply({
      content: 'Which campus would you like to check?',
      components: [buildCampusSelector('status')],
      ephemeral: true,
    });
  },

  async executeForCampus(interaction, campus) {
    await interaction.deferUpdate();

    try {
      const guildId = interaction.guildId;
      const subscription = await db.getSubscriptionByGuildId(guildId, campus);

      if (!subscription || !subscription.is_active) {
        return interaction.editReply({
          content: `❌ **Not Subscribed to ${campus}**\nRun \`/subscribe\` in a channel to enable ${campus} Campus menu updates.`,
        });
      }

      const subscribedDate = new Date(subscription.subscribed_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });

      let statusMessage = `✅ **${campus} Campus Status**
Channel: <#${subscription.channel_id}>
Subscribed: ${subscribedDate}
Next update: 9:00 AM JST (Mon-Fri)`;

      // Show other campus subscription info if it exists
      const allSubs = await db.getSubscriptionsByGuildId(guildId);
      const otherCampus = campus === 'Uzumasa' ? 'Kameoka' : 'Uzumasa';
      const otherSub = allSubs.find(s => s.campus === otherCampus);
      if (otherSub && otherSub.is_active) {
        statusMessage += `\n\n📋 This server is also subscribed to **${otherCampus} Campus** in <#${otherSub.channel_id}>.`;
      }

      return interaction.editReply({ content: statusMessage });
    } catch (error) {
      logger.error(`Error in status command (${campus}): ${error.message}`);
      return interaction.editReply({
        content: '❌ Database error. Please try again later.',
      });
    }
  },
};
