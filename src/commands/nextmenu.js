const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');
const { formatMenuMessage } = require('../utils/formatMenu');
const { buildCampusSelector } = require('../interactions/campusSelector');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nextmenu')
    .setDescription('Show the menu for the next available weekday'),

  async execute(interaction) {
    return interaction.reply({
      content: 'Which campus would you like to see the next menu for?',
      components: [buildCampusSelector('nextmenu')],
      ephemeral: true,
    });
  },

  async executeForCampus(interaction, campus) {
    await interaction.deferUpdate();

    try {
      const { menuDate, items } = await db.getNextMenu(campus);

      if (!menuDate || !items || items.length === 0) {
        return interaction.editReply({
          content: `⚠️ No upcoming weekday menu found for ${campus} Campus.`,
        });
      }

      // Fetch aggregate ratings for all dishes in the next menu
      const dishNames = [...new Set(items.map((d) => d.dish_name))];
      const ratingsMap = await db.getRatingsForDishes(dishNames);

      const chunks = formatMenuMessage(items, ratingsMap, campus);

      if (!chunks || chunks.length === 0) {
        return interaction.editReply({
          content: `⚠️ No menu available for ${campus} Campus.`,
        });
      }

      // Rate button keyed to that menu's date (not today)
      const rateButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rate_menu_open:${campus}:${menuDate}`)
          .setLabel('⭐ Rate these dishes')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        content: `${chunks[0]}\n\n## **Tap below to rate the menu**`,
        components: [rateButton],
      });

      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({
          content: chunks[i],
          ephemeral: true,
        });
      }
    } catch (error) {
      logger.error(`Error in nextmenu command (${campus}): ${error.message}`);
      return interaction.editReply({
        content: '❌ Error fetching upcoming menu. Please try again later.',
      });
    }
  },
};
