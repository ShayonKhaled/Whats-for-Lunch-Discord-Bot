const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');
const { formatMenuMessage } = require('../utils/formatMenu');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nextmenu')
    .setDescription('Show the menu for the next available weekday'),

  async execute(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const { menuDate, items } = await db.getNextMenu();

      if (!menuDate || !items || items.length === 0) {
        return interaction.editReply({ content: '⚠️ No upcoming weekday menu found.' });
      }

      // Fetch aggregate ratings for all dishes in the next menu
      const dishNames = [...new Set(items.map((d) => d.dish_name))];
      const ratingsMap = await db.getRatingsForDishes(dishNames);

      const chunks = formatMenuMessage(items, ratingsMap);

      if (!chunks || chunks.length === 0) {
        return interaction.editReply({ content: '⚠️ No upcoming weekday menu found.' });
      }

      // Rate button keyed to that menu's date (not today) —
      // lets users pre-rate or rate after the day arrives; the
      // interaction handler just stores the date with the rating.
      const rateButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rate_menu_open:${menuDate}`)
          .setLabel('⭐ Rate these dishes')
          .setStyle(ButtonStyle.Secondary)
      );

      const lastIndex = chunks.length - 1;
      await interaction.editReply({
        content: chunks[0],
        components: [rateButton],
      });

      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({
          content: chunks[i],
          ephemeral: true,
        });
      }
    } catch (error) {
      logger.error(`Error in nextmenu command: ${error.message}`);
      return interaction.editReply({ content: '❌ Error fetching upcoming menu. Please try again later.' });
    }
  },
};
