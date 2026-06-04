const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
        return interaction.editReply({ content: '⚠️ No menu available for today.' });
      }

      // Fetch aggregate ratings for all dishes in today's menu
      const dishNames = [...new Set(menuItems.map((d) => d.dish_name))];
      const ratingsMap = await db.getRatingsForDishes(dishNames);

      const chunks = formatMenuMessage(menuItems, ratingsMap);

      if (!chunks || chunks.length === 0) {
        return interaction.editReply({ content: '⚠️ No menu available for today.' });
      }

      // Rate button keyed to today's date
      const today = new Date().toISOString().split('T')[0];
      const rateButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rate_menu_open:${today}`)
          .setLabel('⭐ Rate today\'s dishes')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        content: `${chunks[0]}\n\nTap below to rate the menu`,
        components: [rateButton],
      });

      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({
          content: chunks[i],
          ephemeral: true,
        });
      }
    } catch (error) {
      logger.error(`Error in preview command: ${error.message}`);
      return interaction.editReply({ content: '❌ Error fetching menu. Please try again later.' });
    }
  },
};
