const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('subscribe')
    .setDescription('Subscribe this channel to daily lunch menu updates')
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

      // Check if bot has permission to send messages
      if (!interaction.channel.permissionsFor(interaction.client.user).has('SendMessages')) {
        return interaction.reply({
          content: '⛔ I don\'t have permission to send messages in this channel.',
          ephemeral: true,
        });
      }

      await interaction.deferReply();

      const guildId = interaction.guildId;
      const guildName = interaction.guild.name;
      const channelId = interaction.channelId;
      const channelName = interaction.channel.name;

      await db.addSubscription(guildId, guildName, channelId, channelName);

      logger.info(
        `✅ Subscription added: ${guildName} (${guildId}) -> #${channelName} (${channelId})`
      );

      return interaction.editReply({
        content: `✅ **Menu Bot Subscribed**\nMenu updates will be posted in <#${channelId}> every weekday at 9:00 AM JST`,
      });
    } catch (error) {
      logger.error(`Error in subscribe command: ${error.message}`);
      return interaction.editReply({
        content: '❌ Database error. Please try again later.',
      });
    }
  },
};
