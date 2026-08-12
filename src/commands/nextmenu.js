const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');
const { formatMenuMessage } = require('../utils/formatMenu');
const { buildCampusSelector } = require('../interactions/campusSelector');
const { todayCampus, isWeekday, weekdaysBetween } = require('../utils/campusDate');

/**
 * Work out whether the cafeteria is shut between now and the next published menu.
 * getNextMenu returns the earliest date *after* today that has items, so every
 * weekday in between is closed by definition — we only need to check today.
 */
async function buildClosureNotice(campus, menuDate, dayName) {
  const today = todayCampus();

  const closedAhead = weekdaysBetween(today, menuDate);
  const closedToday = isWeekday(today) && (await db.getTodayMenu(campus)).length === 0;

  if (!closedToday && closedAhead.length === 0) return null;

  const closedCount = closedAhead.length + (closedToday ? 1 : 0);
  const reopens = dayName ? `**${dayName}, ${menuDate}**` : `**${menuDate}**`;

  return (
    `🚪 **The ${campus} Campus cafeteria is closed right now.**\n` +
    `No lunch is being served${closedCount > 1 ? ` for ${closedCount} weekdays` : ' today'}. ` +
    `It reopens on ${reopens} — here's that menu:`
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nextmenu')
    .setDescription('Show the menu for the next available weekday'),

  async execute(interaction) {
    return interaction.reply({
      content: 'Which campus would you like to see the next menu for?',
      components: [buildCampusSelector('nextmenu')],
      flags: MessageFlags.Ephemeral,
    });
  },

  async executeForCampus(interaction, campus) {
    await interaction.deferUpdate();

    try {
      const { menuDate, items } = await db.getNextMenu(campus);

      if (!menuDate || !items || items.length === 0) {
        return interaction.editReply({
          content:
            `🚪 **The ${campus} Campus cafeteria is closed.**\n` +
            'No upcoming menu has been published yet — check back once the next one is announced.',
        });
      }

      // Fetch aggregate ratings for all dishes in the next menu
      const dishNames = [...new Set(items.map((d) => d.dish_name))];
      const ratingsMap = await db.getRatingsForDishes(dishNames, campus);

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

      const menuMessage = {
        content: `${chunks[0]}\n\n## **Tap below to rate the menu**`,
        components: [rateButton],
      };

      // Sent as its own message rather than prepended — chunks are already
      // packed to 1900 chars, so inlining the notice could breach Discord's 2000 limit.
      const closureNotice = await buildClosureNotice(campus, menuDate, items[0]?.day_name);
      if (closureNotice) {
        await interaction.editReply({ content: closureNotice });
        await interaction.followUp({ ...menuMessage, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.editReply(menuMessage);
      }

      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({
          content: chunks[i],
          flags: MessageFlags.Ephemeral,
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
