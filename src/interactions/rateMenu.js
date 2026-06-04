/**
 * src/interactions/rateMenu.js
 *
 * Handles the full rating flow:
 *   1. Button  "rate_menu_open:<menuDate>"
 *      → ephemeral message with dish select(s) + star select
 *   2. Select  "rate_dish_select:<menuDate>"
 *      → updates the ephemeral to show the star select pre-labelled with the chosen dish
 *   3. Select  "rate_stars_select:<menuDate>:<dishKey>"
 *      → upserts the rating, updates the ephemeral with confirmation
 *
 * Custom ID format uses ":" as separator.
 *
 * Dish names are NOT embedded directly in custom IDs because Discord limits
 * custom IDs to 100 characters and some dish names are too long. Instead, dish
 * names are stored in an in-memory cache keyed by a short integer that is
 * placed in the custom ID. Entries auto-expire after 15 minutes (matching
 * Discord's interaction token lifetime).
 */

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const db = require('../db');
const logger = require('../utils/logger');
const { getMenuOrderIndex } = require('../utils/formatMenu');

// ── Dish name cache (avoids custom ID truncation for long names) ──────────────

const DISH_SELECT_MAX = 25; // Discord hard limit per select menu

const dishNameCache = new Map();
let nextDishKey = 0;

/** Store a dish name and return a short key for use in custom IDs. */
function cacheDishName(dishName) {
  const key = String(nextDishKey++);
  dishNameCache.set(key, dishName);
  // Discord interaction tokens expire after 15 min; clean up then
  setTimeout(() => dishNameCache.delete(key), 15 * 60_000);
  return key;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function starLabel(n) {
  return '⭐'.repeat(n) + '☆'.repeat(5 - n);
}

/**
 * Build one or more dish-picker selects from today's menu items.
 * If there are >25 dishes the list is paginated across multiple select menus
 * (Discord allows up to 5 ActionRows, so up to 125 dishes).
 */
function buildDishSelects(menuDate, dishes) {
  const sorted = [...dishes]
    .sort((a, b) => {
      const aIndex = getMenuOrderIndex(a.category, a.subcategory);
      const bIndex = getMenuOrderIndex(b.category, b.subcategory);

      if (aIndex !== bIndex) {
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      }

      return a.dish_name.localeCompare(b.dish_name);
    });

  const totalPages = Math.ceil(sorted.length / DISH_SELECT_MAX);
  const rows = [];

  for (let i = 0; i < sorted.length && rows.length < 5; i += DISH_SELECT_MAX) {
    const chunk = sorted.slice(i, i + DISH_SELECT_MAX);
    const pageNum = rows.length + 1;

    const options = chunk.map((d) => ({
      label: d.dish_name.length > 100 ? d.dish_name.slice(0, 97) + '…' : d.dish_name,
      description: `${d.category}${d.subcategory !== d.category ? ' · ' + d.subcategory : ''}`,
      value: d.dish_name.slice(0, 100), // select option values max 100 chars
    }));

    const placeholder =
      totalPages > 1
        ? `Choose a dish… (page ${pageNum}/${totalPages})`
        : 'Choose a dish to rate…';

    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`rate_dish_select:${menuDate}`)
          .setPlaceholder(placeholder)
          .addOptions(options)
      )
    );
  }

  return rows;
}

function buildStarSelect(menuDate, dishKey, existingRating = null) {
  const options = [1, 2, 3, 4, 5].map((n) => ({
    label: `${n} — ${starLabel(n)}`,
    value: String(n),
    default: existingRating === n,
  }));

  // dishKey is a short integer — no risk of exceeding Discord's 100-char limit
  const customId = `rate_stars_select:${menuDate}:${dishKey}`;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
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

    const dishRows = buildDishSelects(menuDate, uniqueDishes);

    const content =
      dishRows.length > 1
        ? `### ⭐ Rate today's dishes\nThere are many dishes today! Use the dropdowns below to pick one, then rate it.`
        : `### ⭐ Rate today's dishes\nSelect a dish below, then pick your star rating.`;

    return interaction.reply({
      content,
      components: dishRows,
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

    // Store dish name in cache, use the short key in the star select's custom ID
    const dishKey = cacheDishName(dishName);
    const starRow = buildStarSelect(menuDate, dishKey, existingRating);

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
 * customId: "rate_stars_select:<menuDate>:<dishKey>"
 */
async function handleStarSelect(interaction) {
  const parts = interaction.customId.split(':');
  // parts[0] = "rate_stars_select", parts[1] = menuDate, parts[2] = dishKey
  const menuDate = parts[1];
  const dishKey = parts[2];
  const dishName = dishNameCache.get(dishKey);

  if (!dishName) {
    return interaction.update({
      content: '⌛ This rating session has expired. Please start again from the menu post.',
      components: [],
    });
  }

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
