/**
 * Formats an array of menu items into Discord message chunks.
 *
 * @param {object[]} items        - Menu rows from the DB.
 * @param {Map}      [ratingsMap] - Optional Map from getRatingsForDishes().
 *                                  Key: dish_name, Value: { avg, count }
 *                                  When provided, dishes with ratings show
 *                                  ⭐ avg (n) inline.
 */
function formatMenuMessage(items, ratingsMap = new Map()) {
  if (!items || items.length === 0) {
    return ['⚠️ No menu found for today.'];
  }

  const firstItem = items[0];
  const menuDate = firstItem.menu_date;
  const dayName = (firstItem.day_name || '').trim();

  // Group items by category and subcategory
  const grouped = {};
  for (const item of items) {
    const key = `${item.category}|||${item.subcategory}`;
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(item);
  }

  // Define category order and emojis
  const order = [
    { key: 'Set Meals|||Campus Lunch (1)', emoji: '🥘' },
    { key: 'Set Meals|||Campus Lunch (2)', emoji: '🍲' },
    { key: 'A La Carte|||A La Carte', emoji: '🍛' },
    { key: 'A La Carte|||Curry Set', emoji: '🍛' },
    { key: 'Noodles|||Ramen', emoji: '🍜' },
    { key: 'Noodles|||Udon and Soba', emoji: '🍝' },
    { key: 'Sides|||Side Dish A', emoji: '🥗' },
    { key: 'Sides|||Side Dish B', emoji: '🥗' },
    { key: 'Sides|||Side Dish C', emoji: '🥗' },
    { key: 'Sides|||Salad', emoji: '🥬' },
  ];

  const categoryEmojis = {
    'Set Meals': '🍱',
    'A La Carte': '🍛',
    'Noodles': '🍜',
    'Sides': '🥗',
  };

  let message = `# Uzumasa Campus — ${dayName}, ${menuDate}\n\n`;
  let lastCategory = null;

  for (const { key, emoji } of order) {
    if (!grouped[key]) {
      continue;
    }

    const [category, subcategory] = key.split('|||');
    const dishes = grouped[key];

    // Category header
    if (category !== lastCategory) {
      if (lastCategory !== null) {
        message += '\n';
      }
      const catEmoji = categoryEmojis[category] || '🍴';
      message += `## ${catEmoji} ${category}\n`;
      lastCategory = category;
    }

    // Subcategory label (skip if same as category)
    if (subcategory.toLowerCase() !== category.toLowerCase()) {
      message += `**— ${subcategory} —**\n`;
    }

    for (const dish of dishes) {
      // ── Rating badge (only when the dish has been rated before) ──────────
      const ratingInfo = ratingsMap.get(dish.dish_name);
      const ratingBadge = ratingInfo
        ? ` ⭐ ${ratingInfo.avg.toFixed(1)} *(${ratingInfo.count})*`
        : '';

      message += `> ${emoji} **${dish.dish_name}**${ratingBadge}\n`;

      const nutrition = [];
      if (dish.calories) nutrition.push(`${dish.calories} kcal`);
      if (dish.protein)  nutrition.push(`Protein ${dish.protein}g`);
      if (dish.fat)      nutrition.push(`Fat ${dish.fat}g`);

      if (nutrition.length > 0) {
        message += `> 📊 ${nutrition.join('  ·  ')}\n`;
      }

      if (dish.allergens) {
        message += `> ⚠️ *${dish.allergens}*\n`;
      }

      message += '\n';
    }
  }

  message += '\n━━━━━━━━━━━━━━━━━━━━━━\n';
  message += '🎫 Tickets from **10:30 AM**  ·  🕚 Open **11:00 AM – 2:00 PM**';

  // Split into chunks under 2000 chars (Discord limit)
  const chunks = [];
  let remaining = message;
  while (remaining.length > 1900) {
    let splitAt = remaining.lastIndexOf('\n', 1900);
    if (splitAt === -1) splitAt = 1900;
    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trim();
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

module.exports = { formatMenuMessage };
