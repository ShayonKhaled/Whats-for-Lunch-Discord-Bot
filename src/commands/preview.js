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

      for (const chunk of chunks) {
        await interaction.followUp({
          content: chunk,
          ephemeral: true,
        });
      }

      if (chunks.length === 0) {
        return interaction.editReply({
          content: '⚠️ No menu available for today.',
        });
      }

      return interaction.editReply({
        content: '📋 **Menu Preview** (scroll up to see)',
      });
    } catch (error) {
      logger.error(`Error in preview command: ${error.message}`);
      return interaction.editReply({
        content: '❌ Error fetching menu. Please try again later.',
      });
    }
  },
};
