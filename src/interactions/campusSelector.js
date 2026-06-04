/**
 * src/interactions/campusSelector.js
 *
 * Provides a two-button campus picker for slash commands that need to know
 * which campus the user wants (Uzumasa or Kameoka).
 *
 * Commands opting into this pattern must expose an `executeForCampus` method
 * that receives the ButtonInteraction and the canonical campus string.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const logger = require('../utils/logger');

/**
 * Build an ActionRow with two campus buttons.
 * @param {string} commandName - e.g. 'preview', 'subscribe'
 * @returns {ActionRowBuilder}
 */
function buildCampusSelector(commandName) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`campus_select:${commandName}:Uzumasa`)
      .setLabel('Uzumasa Campus')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🏫'),
    new ButtonBuilder()
      .setCustomId(`campus_select:${commandName}:Kameoka`)
      .setLabel('Kameoka Campus')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🏛️'),
  );
}

/**
 * Route a campus selection button click to the correct command.
 * @param {ButtonInteraction} interaction
 */
async function handleCampusSelection(interaction) {
  const parts = interaction.customId.split(':');
  // parts[0] = 'campus_select', parts[1] = commandName, parts[2] = campus
  const commandName = parts[1];
  const campus = parts[2]; // 'Uzumasa' or 'Kameoka' — already canonical case

  const command = interaction.client.commands.get(commandName);

  if (!command || typeof command.executeForCampus !== 'function') {
    logger.warn(`⚠️ Campus selection for unknown/unsupported command: ${commandName}`);
    return interaction.reply({
      content: '⚠️ This selection has expired or is not supported. Please run the command again.',
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    await command.executeForCampus(interaction, campus);
  } catch (err) {
    logger.error(`Error in executeForCampus (${commandName}, ${campus}): ${err.message}`);
    // Try to update the button message if we can, otherwise reply fresh
    try {
      await interaction.update({
        content: '❌ Something went wrong. Please try again.',
        components: [],
      });
    } catch {
      await interaction.reply({
        content: '❌ Something went wrong. Please try again.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

module.exports = { buildCampusSelector, handleCampusSelection };
