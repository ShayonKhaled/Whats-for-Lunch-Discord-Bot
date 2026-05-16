const { SlashCommandBuilder } = require('discord.js');
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

      const chunks = formatMenuMessage(items);

      if (!chunks || chunks.length === 0) {
        return interaction.editReply({ content: '⚠️ No upcoming weekday menu found.' });
      }

      await interaction.editReply({ content: chunks[0] });

      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({ content: chunks[i], ephemeral: true });
      }

      return;
    } catch (error) {
      logger.error(`Error in nextmenu command: ${error.message}`);
      return interaction.editReply({ content: '❌ Error fetching upcoming menu. Please try again later.' });
    }
  },
};
