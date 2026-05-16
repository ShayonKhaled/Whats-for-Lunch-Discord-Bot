const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('notify')
    .setDescription('Toggle daily menu notifications for yourself'),

  async execute(interaction) {
    try {
      if (!interaction.guildId) {
        return interaction.reply({
          content: '⛔ This command can only be used in a server.',
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });

      // Check this guild is actually subscribed and has a role set up
      const subscription = await db.getSubscriptionByGuildId(interaction.guildId);

      if (!subscription || !subscription.is_active || !subscription.role_id) {
        return interaction.editReply({
          content:
            '⚠️ This server isn\'t set up yet. An admin needs to run `/subscribe` first.',
        });
      }

      const role = interaction.guild.roles.cache.get(subscription.role_id);

      if (!role) {
        return interaction.editReply({
          content:
            '⚠️ The notification role seems to have been deleted. Ask an admin to run `/subscribe` again to recreate it.',
        });
      }

      const member = interaction.member;
      const hasRole = member.roles.cache.has(role.id);

      if (hasRole) {
        await member.roles.remove(role);
        logger.info(`🔕 Removed notify-menu role from ${member.user.tag} in ${interaction.guild.name}`);
        return interaction.editReply({
          content: `🔕 Removed — you won't be pinged for daily menu posts anymore.`,
        });
      } else {
        await member.roles.add(role);
        logger.info(`🔔 Added notify-menu role to ${member.user.tag} in ${interaction.guild.name}`);
        return interaction.editReply({
          content: `🔔 You're in — you'll be pinged every weekday at 9:00 AM JST when the menu is posted.`,
        });
      }
    } catch (error) {
      logger.error(`Error in notify command: ${error.message}`);
      return interaction.editReply({
        content: '❌ Something went wrong. Please try again later.',
      });
    }
  },
};
