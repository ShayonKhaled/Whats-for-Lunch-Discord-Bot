const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');
const { buildCampusSelector } = require('../interactions/campusSelector');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unsubscribe')
    .setDescription('Unsubscribe this server from lunch menu updates')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!interaction.guildId) {
      return interaction.reply({
        content: '⛔ This command can only be used in a server.',
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: 'Which campus would you like to unsubscribe from?',
      components: [buildCampusSelector('unsubscribe')],
      ephemeral: true,
    });
  },

  async executeForCampus(interaction, campus) {
    await interaction.deferUpdate();

    try {
      const guildId = interaction.guildId;
      const result = await db.removeSubscription(guildId, campus);

      if (!result) {
        return interaction.editReply({
          content: `⚠️ This server was not subscribed to ${campus} Campus.`,
        });
      }

      logger.info(`✅ Subscription removed: ${interaction.guild.name} (${guildId}) — ${campus}`);

      await interaction.editReply({
        content: `✅ **Unsubscribed from ${campus} Campus**`,
      });

      // Public confirmation for the channel
      await interaction.followUp({
        content: `✅ ${campus} Campus menu updates will no longer be posted here.`,
        ephemeral: false,
      });
    } catch (error) {
      logger.error(`Error in unsubscribe command (${campus}): ${error.message}`);
      return interaction.editReply({
        content: '❌ Database error. Please try again later.',
      });
    }
  },
};
