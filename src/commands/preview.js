const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');
const { formatMenuMessage } = require('../utils/formatMenu');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('preview')
    .setDescription('Preview today\'s lunch menu'),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const menuItems = await db.getTodayMenu();

      if (!menuItems || menuItems.length === 0) {
        return interaction.editReply({
          content: '⚠️ No menu available for today.',
        });
      }

      const chunks = formatMenuMessage(menuItems);

      if (!chunks || chunks.length === 0) {
        return interaction.editReply({ content: '⚠️ No menu available for today.' });
      }

      // Put first chunk into the original reply so it stays visible,
      // then send remaining chunks as follow-ups.
      await interaction.editReply({ content: chunks[0] });

      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({ content: chunks[i], ephemeral: true });
      }

      return;
    } catch (error) {
      logger.error(`Error in preview command: ${error.message}`);
      return interaction.editReply({
        content: '❌ Error fetching menu. Please try again later.',
      });
    }
  },
};
