const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unsubscribe')
    .setDescription('Unsubscribe this server from lunch menu updates')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    try {
      // Check if command is run in a guild
      if (!interaction.guildId) {
        return interaction.reply({
          content: '⛔ This command can only be used in a server.',
          ephemeral: true,
        });
      }

      await interaction.deferReply();

      const guildId = interaction.guildId;
      const result = await db.removeSubscription(guildId);

      if (!result) {
        return interaction.editReply({
          content: '⚠️ This server was not subscribed.',
        });
      }

      logger.info(`✅ Subscription removed: ${interaction.guild.name} (${guildId})`);

      return interaction.editReply({
        content: '✅ **Unsubscribed**\nMenu updates will no longer be posted here.',
      });
    } catch (error) {
      logger.error(`Error in unsubscribe command: ${error.message}`);
      return interaction.editReply({
        content: '❌ Database error. Please try again later.',
      });
    }
  },
};
