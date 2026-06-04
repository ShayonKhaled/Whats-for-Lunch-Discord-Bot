/**
 * src/interactions/rateMenu.js
 *
 * Handles the full rating flow:
 *   1. Button  "rate_menu_open:<menuDate>"
 *      → ephemeral message with a dish select + star select
 *   2. Select  "rate_dish_select:<menuDate>"
 *      → updates the ephemeral to show the star select pre-labelled with the chosen dish
 *   3. Select  "rate_stars_select:<menuDate>:<dishName>"
 *      → upserts the rating, updates the ephemeral with confirmation
 *
 * Custom ID format uses ":" as separator. Dish names may contain spaces but
 * not ":" so splitting on ":" is safe.
 */

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');

// ── Helpers ──────────────────────────────────────────────────────────────────

function starLabel(n) {
  return '⭐'.repeat(n) + '☆'.repeat(5 - n);
}

/**
 * Build the dish-picker select from today's menu items.
 * Groups them as "Category — Dish Name" so users know what they're rating.
 */
function buildDishSelect(menuDate, dishes) {
  const options = dishes.map((d) => ({
    label: d.dish_name.length > 100 ? d.dish_name.slice(0, 97) + '…' : d.dish_name,
    description: `${d.category}${d.subcategory !== d.category ? ' · ' + d.subcategory : ''}`,
    value: d.dish_name.slice(0, 100), // select option values max 100 chars
  }));

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`rate_dish_select:${menuDate}`)
      .setPlaceholder('Choose a dish to rate…')
      .addOptions(options)
  );
}

function buildStarSelect(menuDate, dishName, existingRating = null) {
  const options = [1, 2, 3, 4, 5].map((n) => ({
    label: `${n} — ${starLabel(n)}`,
    value: String(n),
    default: existingRating === n,
  }));

  // Truncate dish name for the custom ID safely
  const safeId = `rate_stars_select:${menuDate}:${dishName}`;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(safeId.slice(0, 100))
      .setPlaceholder(existingRating ? `Your rating: ${starLabel(existingRating)}` : 'Pick a star rating…')
      .addOptions(options)
  );
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/**
 * "Rate Menu" button pressed → show dish picker.
 * customId: "rate_menu_open:<menuDate>"
 */
async function handleRateMenuOpen(interaction) {
  const menuDate = interaction.customId.split(':')[1];

  try {
    const items = await db.getMenuByDate(menuDate);
    if (!items || items.length === 0) {
      return interaction.reply({
        content: '⚠️ No menu found for that date.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Deduplicate dishes (same dish can appear in multiple rows if DB has dupes)
    const seen = new Set();
    const uniqueDishes = items.filter((d) => {
      if (seen.has(d.dish_name)) return false;
      seen.add(d.dish_name);
      return true;
    });

    const dishRow = buildDishSelect(menuDate, uniqueDishes);

    return interaction.reply({
      content: `### ⭐ Rate today's dishes\nSelect a dish below, then pick your star rating.`,
      components: [dishRow],
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    logger.error(`handleRateMenuOpen error: ${err.message}`);
    return interaction.reply({
      content: '❌ Something went wrong. Please try again.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Dish selected → show star picker for that dish.
 * customId: "rate_dish_select:<menuDate>"
 */
async function handleDishSelect(interaction) {
  const menuDate = interaction.customId.split(':')[1];
  const dishName = interaction.values[0];

  try {
    // Check if user already rated this dish today
    const existing = await db.getUserRatingsForDate(
      interaction.guildId,
      interaction.user.id,
      menuDate
    );
    const existingRating = existing.get(dishName) || null;

    const starRow = buildStarSelect(menuDate, dishName, existingRating);

    const alreadyNote = existingRating
      ? `\nYou previously rated this **${starLabel(existingRating)}** — selecting again will update it.`
      : '';

    return interaction.update({
      content: `### ⭐ Rate today's dishes\n**${dishName}**${alreadyNote}\n\nPick your rating:`,
      components: [starRow],
    });
  } catch (err) {
    logger.error(`handleDishSelect error: ${err.message}`);
    return interaction.update({
      content: '❌ Something went wrong. Please try again.',
      components: [],
    });
  }
}

/**
 * Star rating selected → save it, confirm to user.
 * customId: "rate_stars_select:<menuDate>:<dishName>"
 */
async function handleStarSelect(interaction) {
  // Split on ":" — menuDate is YYYY-MM-DD (contains "-" not ":"), dishName has no ":"
  const parts = interaction.customId.split(':');
  // parts[0] = "rate_stars_select", parts[1] = menuDate, parts[2..] = dishName
  const menuDate = parts[1];
  const dishName = parts.slice(2).join(':'); // safe re-join in case dish name ever has colons
  const rating = parseInt(interaction.values[0], 10);

  try {
    await db.upsertRating(
      interaction.guildId,
      interaction.user.id,
      menuDate,
      dishName,
      rating
    );

    logger.info(
      `⭐ Rating saved: "${dishName}" ${rating}/5 by ${interaction.user.tag} in ${interaction.guild?.name}`
    );

    return interaction.update({
      content:
        `### ✅ Rating saved!\n` +
        `**${dishName}** — ${starLabel(rating)} (${rating}/5)\n\n` +
        `_Rate another dish by running the interaction again from today's menu post._`,
      components: [],
    });
  } catch (err) {
    logger.error(`handleStarSelect error: ${err.message}`);
    return interaction.update({
      content: '❌ Failed to save your rating. Please try again.',
      components: [],
    });
  }
}

// ── Router ───────────────────────────────────────────────────────────────────

/**
 * Called from bot.js interactionCreate handler.
 * Returns true if the interaction was handled here, false otherwise.
 */
async function handleRatingInteraction(interaction) {
  const id = interaction.customId;

  if (interaction.isButton() && id.startsWith('rate_menu_open:')) {
    await handleRateMenuOpen(interaction);
    return true;
  }

  if (interaction.isStringSelectMenu()) {
    if (id.startsWith('rate_dish_select:')) {
      await handleDishSelect(interaction);
      return true;
    }
    if (id.startsWith('rate_stars_select:')) {
      await handleStarSelect(interaction);
      return true;
    }
  }

  return false;
}

module.exports = { handleRatingInteraction };
