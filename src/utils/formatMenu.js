/**
 * Formats an array of menu items into Discord message chunks.
 *
 * @param {object[]} items        - Menu rows from the DB.
 * @param {Map}      [ratingsMap] - Optional Map from getRatingsForDishes().
 *                                   Key: dish_name, Value: { avg, count }
 *                                   When provided, dishes with ratings show
 *                                   ⭐ avg (n) inline.
 * @param {string}   [campus]     - 'Uzumasa' (default) or 'Kameoka'.
 */

// ── Uzumasa menu config ─────────────────────────────────────────────────────

const UZUMASA_PRICES = {
  'Campus Lunch (1)': 330,
  'Campus Lunch (2)': 330,
  'Halal':            400,
  'A La Carte':       330,
  'Curry Set':        330,
  'Ramen':            250,
  'Udon and Soba':    200,
  'Side Dish A':       70,
  'Side Dish B':       70,
  'Side Dish C':       70,
  'Salad':             70,
};

const UZUMASA_SET_MEAL_SUBCATEGORIES = new Set(['Campus Lunch (1)', 'Campus Lunch (2)']);

const UZUMASA_MENU_ORDER = [
  { key: 'Set Meals|||Campus Lunch (1)', emoji: '🥘' },
  { key: 'Set Meals|||Campus Lunch (2)', emoji: '🍲' },
  { key: 'Halal|||Halal',               emoji: '✅' },
  { key: 'A La Carte|||A La Carte',     emoji: '🍛' },
  { key: 'A La Carte|||Curry Set',      emoji: '🍛' },
  { key: 'Noodles|||Ramen',             emoji: '🍜' },
  { key: 'Noodles|||Udon and Soba',     emoji: '🍝' },
  { key: 'Sides|||Side Dish A',         emoji: '🥗' },
  { key: 'Sides|||Side Dish B',         emoji: '🥗' },
  { key: 'Sides|||Side Dish C',         emoji: '🥗' },
  { key: 'Sides|||Salad',              emoji: '🥬' },
];

const UZUMASA_CATEGORY_EMOJIS = {
  'Set Meals': '🍱',
  'Halal':     '🟢',
  'A La Carte':'🍛',
  'Curry Set': '🍛',
  'Noodles':   '🍜',
  'Sides':     '🥗',
};

// ── Kameoka menu config ─────────────────────────────────────────────────────

const KAMEOKA_MENU_ORDER = [
  { key: 'Set|||A',                   emoji: '🍱' },
  { key: 'Set|||B',                   emoji: '🍱' },
  { key: 'Live Kitchen|||Live Kitchen', emoji: '🍳' },
  { key: 'Curry|||A',                 emoji: '🍛' },
  { key: 'Curry|||B',                 emoji: '🍛' },
  { key: 'Curry|||C',                 emoji: '🍛' },
  { key: 'Ramen|||Ramen',             emoji: '🍜' },
  { key: 'Side Dish|||A',             emoji: '🥗' },
  { key: 'Side Dish|||B',             emoji: '🥗' },
  { key: 'Side Dish|||C',             emoji: '🥗' },
  { key: 'Side Dish|||Salad',         emoji: '🥬' },
];

const KAMEOKA_CATEGORY_EMOJIS = {
  'Set':          '🍱',
  'Live Kitchen': '🍳',
  'Curry':        '🍛',
  'Ramen':        '🍜',
  'Side Dish':    '🥗',
};

// ── Campus config lookup ────────────────────────────────────────────────────

const CAMPUS_CONFIG = {
  Uzumasa: {
    menuOrder: UZUMASA_MENU_ORDER,
    categoryEmojis: UZUMASA_CATEGORY_EMOJIS,
    setMealSubcategories: UZUMASA_SET_MEAL_SUBCATEGORIES,
    headerTitle: 'Uzumasa Campus',
    priceLookup(item) { return UZUMASA_PRICES[item.subcategory] ?? null; },
    showSetMealNote: true,
    footerText: '🎫 Tickets from **10:30 AM**  ·  🕚 Open **11:00 AM – 2:00 PM**\n\n*Prices are part of a cafeteria discount campaign sponsored by the Student Guardian Association and are available to students only. Faculty and staff members are not eligible for this discounted price.*',
  },
  Kameoka: {
    menuOrder: KAMEOKA_MENU_ORDER,
    categoryEmojis: KAMEOKA_CATEGORY_EMOJIS,
    setMealSubcategories: new Set(), // Kameoka doesn't have free-side-dish set meals
    headerTitle: 'Kameoka Campus',
    priceLookup(item) { return item.price ?? null; },  // from DB `price` column
    showSetMealNote: false,
    footerText: '🎫 Tickets from **10:30 AM**  ·  🕚 Open **11:00 AM – 2:00 PM**',
  },
};

// ── Core formatter ──────────────────────────────────────────────────────────

function formatMenuMessage(items, ratingsMap = new Map(), campus = 'Uzumasa') {
  if (!items || items.length === 0) {
    return ['⚠️ No menu found for today.'];
  }

  const config = CAMPUS_CONFIG[campus] || CAMPUS_CONFIG.Uzumasa;

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

  const sections = new Map();
  for (const { key, emoji } of config.menuOrder) {
    if (!grouped[key]) {
      continue;
    }

    const [category, subcategory] = key.split('|||');
    const categoryName = category.trim();
    const subcategoryName = subcategory.trim();
    const displayCategoryName = subcategoryName === 'Curry Set' ? 'Curry Set' : categoryName;

    if (!sections.has(displayCategoryName)) {
      sections.set(displayCategoryName, {
        emoji: config.categoryEmojis[displayCategoryName] || emoji || '🍴',
        items: [],
      });
    }

    sections.get(displayCategoryName).items.push({
      key,
      emoji,
      categoryName,
      subcategoryName,
      dishes: grouped[key],
    });
  }

  let message = `# ${config.headerTitle} — ${dayName}, ${menuDate}\n\n`;
  let lastCategory = null;

  for (const [displayCategoryName, section] of sections) {
    const sectionPrices = new Set(
      section.items
        .map((item) => config.priceLookup({ subcategory: item.subcategoryName, price: item.dishes[0].price }))
        .filter((price) => typeof price === 'number')
    );
    const sharedSectionPrice = sectionPrices.size === 1 ? [...sectionPrices][0] : null;
    const sectionPriceStr = sharedSectionPrice
      ? `  ·  ¥${sharedSectionPrice}${config.showSetMealNote && config.setMealSubcategories.has(section.items[0].subcategoryName) ? ' (+ 1 side/salad)' : ''}`
      : '';

    // Category header
    if (displayCategoryName !== lastCategory) {
      if (lastCategory !== null) {
        message += '\n';
      }
      message += `## ${section.emoji} ${displayCategoryName}${sectionPriceStr}\n`;
      lastCategory = displayCategoryName;
    }

    for (const item of section.items) {
      const showSubcategoryName =
        displayCategoryName !== 'Curry Set' &&
        displayCategoryName !== 'Halal' &&
        item.subcategoryName.toLowerCase() !== displayCategoryName.toLowerCase();

      const subcategoryPriceStr = sharedSectionPrice
        ? ''
        : (() => {
            const price = config.priceLookup({ subcategory: item.subcategoryName, price: item.dishes[0].price });
            const isSetMeal = config.setMealSubcategories.has(item.subcategoryName);
            return price ? `  ·  ¥${price}${config.showSetMealNote && isSetMeal ? ' (+ 1 side/salad)' : ''}` : '';
          })();

      if (showSubcategoryName) {
        message += `**— ${item.subcategoryName}${subcategoryPriceStr} —**\n`;
      }

      for (const dish of item.dishes) {
        // ── Rating badge (only when the dish has prior ratings) ─────────────
        const ratingInfo = ratingsMap.get(dish.dish_name);
        const ratingBadge = ratingInfo
          ? ` ⭐ ${ratingInfo.avg.toFixed(1)} *(${ratingInfo.count})*`
          : '';

        message += `> ${item.emoji} **${dish.dish_name}**${ratingBadge}\n`;

        const nutrition = [];
        if (dish.calories) nutrition.push(`${dish.calories} kcal`);
        if (dish.protein)  nutrition.push(`Protein ${dish.protein}g`);
        if (dish.fat)      nutrition.push(`Fat ${dish.fat}g`);
        if (dish.sodium)   nutrition.push(`Sodium ${dish.sodium}g`);

        if (nutrition.length > 0) {
          message += `> 📊 ${nutrition.join('  ·  ')}\n`;
        }

        if (dish.allergens) {
          message += `> ⚠️ *${dish.allergens}*\n`;
        }

        message += '\n';
      }
    }
  }

  message += '\n━━━━━━━━━━━━━━━━━━━━━━\n';
  message += config.footerText;

  // Split into chunks under 2000 chars (Discord limit)
  const chunks = [];
  let remaining = message;
  while (remaining.length > 1900) {
    let splitAt = remaining.lastIndexOf('\n', 1900);
    if (splitAt === -1) {
      splitAt = 1900;
    }
    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trim();
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function getMenuOrderIndex(category, subcategory, campus = 'Uzumasa') {
  const config = CAMPUS_CONFIG[campus] || CAMPUS_CONFIG.Uzumasa;
  return config.menuOrder.findIndex((entry) => {
    const [entryCategory, entrySubcategory] = entry.key.split('|||');
    return entryCategory === category && entrySubcategory === subcategory;
  });
}

module.exports = { formatMenuMessage, getMenuOrderIndex };
