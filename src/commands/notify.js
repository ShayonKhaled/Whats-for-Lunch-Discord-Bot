const { SlashCommandBuilder } = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');
const { buildCampusSelector } = require('../interactions/campusSelector');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('notify')
    .setDescription('Toggle daily menu notifications for yourself'),

  async execute(interaction) {
    if (!interaction.guildId) {
      return interaction.reply({
        content: '⛔ This command can only be used in a server.',
        ephemeral: true,
      });
    }

    return interaction.reply({
      content: 'Which campus would you like to toggle notifications for?',
      components: [buildCampusSelector('notify')],
      ephemeral: true,
    });
  },

  async executeForCampus(interaction, campus) {
    await interaction.deferUpdate();

    try {
      // Check this guild is subscribed for this campus and has a role set up
      const subscription = await db.getSubscriptionByGuildId(interaction.guildId, campus);

      if (!subscription || !subscription.is_active || !subscription.role_id) {
        return interaction.editReply({
          content: `⚠️ ${campus} Campus isn't set up yet. An admin needs to run \`/subscribe\` for ${campus} first.`,
        });
      }

      const role = await interaction.guild.roles.fetch(subscription.role_id).catch(() => null);

      if (!role) {
        return interaction.editReply({
          content: `⚠️ The notification role for ${campus} Campus seems to have been deleted. Ask an admin to run \`/subscribe\` again to recreate it.`,
        });
      }

      const member = interaction.member;
      const hasRole = member.roles.cache.has(role.id);

      if (hasRole) {
        await member.roles.remove(role);
        logger.info(`🔕 Removed ${role.name} role from ${member.user.tag} in ${interaction.guild.name}`);
        return interaction.editReply({
          content: `🔕 Removed **${role.name}** — you won't be pinged for ${campus} Campus menu posts anymore.`,
        });
      } else {
        await member.roles.add(role);
        logger.info(`🔔 Added ${role.name} role to ${member.user.tag} in ${interaction.guild.name}`);
        return interaction.editReply({
          content: `🔔 You're in — you'll be pinged every weekday at 9:00 AM JST when the ${campus} Campus menu is posted.`,
        });
      }
    } catch (error) {
      logger.error(`Error in notify command (${campus}): ${error.message}`);
      return interaction.editReply({
        content: '❌ Something went wrong. Please try again later.',
      });
    }
  },
};
