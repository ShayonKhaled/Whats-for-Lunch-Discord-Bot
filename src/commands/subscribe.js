const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');

const ROLE_NAME = 'notify-menu';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('subscribe')
    .setDescription('Subscribe this channel to daily lunch menu updates')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    try {
      if (!interaction.guildId) {
        return interaction.reply({
          content: '⛔ This command can only be used in a server.',
          ephemeral: true,
        });
      }

      if (!interaction.channel.permissionsFor(interaction.client.user).has('SendMessages')) {
        return interaction.reply({
          content: '⛔ I don\'t have permission to send messages in this channel.',
          ephemeral: true,
        });
      }

      if (!interaction.guild.members.me.permissions.has('ManageRoles')) {
        return interaction.reply({
          content: '⛔ I need the **Manage Roles** permission to create the notification role.',
          ephemeral: true,
        });
      }

      await interaction.deferReply();

      const guild = interaction.guild;
      const guildId = guild.id;
      const guildName = guild.name;
      const channelId = interaction.channelId;
      const channelName = interaction.channel.name;

      // Find existing notify-menu role or create it
      let role = guild.roles.cache.find((r) => r.name === ROLE_NAME);

      if (role) {
        logger.info(`ℹ️ Role "${ROLE_NAME}" already exists in ${guildName} (${role.id})`);
      } else {
        role = await guild.roles.create({
          name: ROLE_NAME,
          mentionable: true,
          reason: 'Created by Cafeteria Menu bot for daily menu notifications',
        });
        logger.info(`✅ Created role "${ROLE_NAME}" in ${guildName} (${role.id})`);
      }

      // Save subscription with role ID
      await db.addSubscription(guildId, guildName, channelId, channelName, role.id);

      logger.info(
        `✅ Subscription added: ${guildName} (${guildId}) -> #${channelName} (${channelId}), role=${role.id}`
      );

      return interaction.editReply({
        content:
          `✅ **Menu Bot Subscribed**\n` +
          `Menu updates will be posted in <#${channelId}> every weekday at **9:00 AM JST**.\n\n` +
          `📣 Members can use \`/notify\` to opt in or out of the <@&${role.id}> ping.`,
      });
    } catch (error) {
      logger.error(`Error in subscribe command: ${error.message}`);
      return interaction.editReply({
        content: '❌ Something went wrong. Please try again later.',
      });
    }
  },
};
