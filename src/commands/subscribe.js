const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');
const { buildCampusSelector } = require('../interactions/campusSelector');

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

      return interaction.reply({
        content: 'Which campus would you like to subscribe to?',
        components: [buildCampusSelector('subscribe')],
        ephemeral: true,
      });
    } catch (error) {
      logger.error(`Error in subscribe command: ${error.message}`);
      return interaction.reply({
        content: '❌ Something went wrong. Please try again later.',
        ephemeral: true,
      });
    }
  },

  async executeForCampus(interaction, campus) {
    await interaction.deferUpdate();

    try {
      const guild = interaction.guild;
      const guildId = guild.id;
      const guildName = guild.name;
      const channelId = interaction.channelId;
      const channel = interaction.channel;
      const channelName = channel ? channel.name : 'unknown';
      const roleName = `notify-menu-${campus.toLowerCase()}`;

      // Find existing role or create it
      let role = guild.roles.cache.find((r) => r.name === roleName);

      if (role) {
        logger.info(`ℹ️ Role "${roleName}" already exists in ${guildName} (${role.id})`);
      } else {
        role = await guild.roles.create({
          name: roleName,
          mentionable: true,
          reason: `Created by Cafeteria Menu bot for ${campus} Campus daily menu notifications`,
        });
        logger.info(`✅ Created role "${roleName}" in ${guildName} (${role.id})`);
      }

      // Save subscription with role ID and campus
      await db.addSubscription(guildId, guildName, channelId, channelName, role.id, campus);

      logger.info(
        `✅ Subscription added: ${guildName} (${guildId}) -> #${channelName} (${channelId}), campus=${campus}, role=${role.id}`
      );

      // Ephemeral confirmation
      await interaction.editReply({
        content: `✅ **Subscribed to ${campus} Campus!**`,
      });

      // Public confirmation visible to the channel
      await interaction.followUp({
        content:
          `✅ **${campus} Campus Menu Bot Subscribed**\n` +
          `Menu updates will be posted in <#${channelId}> every weekday at **9:00 AM JST**.\n\n` +
          `📣 Members can use \`/notify\` to opt in or out of the <@&${role.id}> ping.`,
        ephemeral: false,
      });
    } catch (error) {
      logger.error(`Error in subscribe command (${campus}): ${error.message}`);
      try {
        await interaction.editReply({
          content: '❌ Something went wrong. Please try again later.',
        });
      } catch {
        // If editReply fails, the deferUpdate already handled the timeout
      }
    }
  },
};
