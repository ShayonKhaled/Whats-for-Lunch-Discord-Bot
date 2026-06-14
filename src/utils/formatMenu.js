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
  'Curry':            330,
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
  { key: 'Curry|||Curry Set',           emoji: '🍛' },
  { key: 'Noodles|||Ramen',             emoji: '🍜' },
  { key: 'Noodles|||Udon and Soba',     emoji: '🍝' },
  { key: 'Curry|||Curry',               emoji: '🍛' },
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
  'Curry':     '🍛',
  'Noodles':   '🍜',
  'Sides':     '🥗',
};

// ── Kameoka menu config ─────────────────────────────────────────────────────

const KAMEOKA_MENU_ORDER = [
  { key: 'Set|||A',                     emoji: '🍱', label: 'Set A' },
  { key: 'Set|||B',                     emoji: '🍱', label: 'Set B' },
  { key: 'Live Kitchen|||Live Kitchen', emoji: '🍳', label: 'Live Kitchen' },
  { key: 'Curry|||A',                   emoji: '🍛', label: 'Curry A' },
  { key: 'Curry|||B',                   emoji: '🍛', label: 'Curry B' },
  { key: 'Curry|||C',                   emoji: '🍛', label: 'Curry C' },
  { key: 'Ramen|||Ramen',               emoji: '🍜', label: 'Ramen' },
  { key: 'Side Dish|||A',               emoji: '🥗', label: 'Side A' },
  { key: 'Side Dish|||B',               emoji: '🥗', label: 'Side B' },
  { key: 'Side Dish|||C',               emoji: '🥗', label: 'Side C' },
  { key: 'Side Dish|||Salad',           emoji: '🥬', label: 'Salad' },
];

const KAMEOKA_CATEGORY_EMOJIS = {
  'Set Meals':    '🍱',
  'Live Kitchen': '🍳',
  'Curry':        '🍛',
  'Ramen':        '🍜',
  'Sides':        '🥗',
};

/** Maps Kameoka DB category names to Uzumasa-style display names. */
const KAMEOKA_CATEGORY_LABELS = {
  'Set':       'Set Meals',
  'Side Dish': 'Sides',
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
    categoryLabels: null,
    menuOrderHasLabels: false,
  },
  Kameoka: {
    menuOrder: KAMEOKA_MENU_ORDER,
    categoryEmojis: KAMEOKA_CATEGORY_EMOJIS,
    setMealSubcategories: new Set(), // Kameoka doesn't have free-side-dish set meals
    headerTitle: 'Kameoka Campus',
    priceLookup(item) { return item.price ?? null; },  // from DB `price` column
    showSetMealNote: false,
    footerText: '🎫 Tickets from **10:30 AM**  ·  🕚 Open **11:00 AM – 2:00 PM**',
    categoryLabels: KAMEOKA_CATEGORY_LABELS,
    menuOrderHasLabels: true,
  },
};

const ALLERGY_DISCLAIMER =
  '⚠️ *If you have any food allergies, please cross-check the allergens from the menu inside the cafeteria, as there may be unintended discrepancies here.*\n' +
  '*食物アレルギーをお持ちの方は、誤記載の可能性もあるため、食堂の掲示メニューでもアレルゲンをご確認ください。*';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve a DB category name to its display name using campus config overrides. */
function displayCategoryName(config, dbCategory, dbSubcategory) {
  // Uzumasa special case: Curry Set subcategory under A La Carte
  // is displayed as its own top-level category
  if (dbSubcategory === 'Curry Set') return 'Curry Set';

  // Check campus category label overrides
  if (config.categoryLabels?.[dbCategory]) {
    return config.categoryLabels[dbCategory];
  }
  return dbCategory;
}

/** Resolve the subcategory display name from the menuOrder entry. */
function displaySubcategoryName(entry, config) {
  if (config.menuOrderHasLabels && entry.label) {
    return entry.label;
  }
  return entry.subcategoryName;
}

// ── Core formatter ──────────────────────────────────────────────────────────

const logger = require('./logger');

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

  // ── Debug: log every item so we can see what the DB actually returned ──────
  logger.debug(`[formatMenu] campus=${campus} date=${items[0]?.menu_date} totalItems=${items.length}`);
  for (const item of items) {
    logger.debug(`[formatMenu]   item: campus=${item.campus} category="${item.category}" subcategory="${item.subcategory}" dish="${item.dish_name}"`);
  }
  const groupedKeys = Object.keys(grouped);
  const menuOrderKeys = config.menuOrder.map(e => e.key);
  const orphanedKeys = groupedKeys.filter(k => !menuOrderKeys.includes(k));
  logger.debug(`[formatMenu] grouped keys: ${JSON.stringify(groupedKeys)}`);
  logger.debug(`[formatMenu] menuOrder keys: ${JSON.stringify(menuOrderKeys)}`);
  if (orphanedKeys.length > 0) {
    logger.warn(`[formatMenu] ORPHANED (will be dropped): ${JSON.stringify(orphanedKeys)}`);
  }
  // ── End debug ──────────────────────────────────────────────────────────────

  // Build ordered sections from menuOrder
  const sections = new Map();
  for (const entry of config.menuOrder) {
    if (!grouped[entry.key]) continue;

    const [category, subcategory] = entry.key.split('|||');
    entry.categoryName = category.trim();
    entry.subcategoryName = subcategory.trim();

    const dCat = displayCategoryName(config, entry.categoryName, entry.subcategoryName);
    const dSub = displaySubcategoryName(entry, config);

    if (!sections.has(dCat)) {
      sections.set(dCat, {
        emoji: config.categoryEmojis[dCat] || entry.emoji || '🍴',
        items: [],
      });
    }

    sections.get(dCat).items.push({
      entry,
      displaySubcategoryName: dSub,
      dishes: grouped[entry.key],
    });
  }

  let message = `# ${config.headerTitle} — ${dayName}, ${menuDate}\n\n`;
  message += `${ALLERGY_DISCLAIMER}\n\n`;
  let lastCategory = null;

  for (const [dCat, section] of sections) {
    // Section-level price (when all subcategories share the same price)
    const sectionPrices = new Set(
      section.items
        .map((item) => config.priceLookup({ subcategory: item.entry.subcategoryName, price: item.dishes[0].price }))
        .filter((price) => typeof price === 'number')
    );
    const sharedSectionPrice = sectionPrices.size === 1 ? [...sectionPrices][0] : null;
    const sectionPriceStr = sharedSectionPrice
      ? `  ·  ¥${sharedSectionPrice}${config.showSetMealNote && config.setMealSubcategories.has(section.items[0].entry.subcategoryName) ? ' (+ 1 side/salad)' : ''}`
      : '';

    // Category header
    if (dCat !== lastCategory) {
      if (lastCategory !== null) message += '\n';
      message += `## ${section.emoji} ${dCat}${sectionPriceStr}\n`;
      lastCategory = dCat;
    }

    for (const item of section.items) {
      const showSubName =
        dCat !== 'Halal' &&
        dCat !== 'Curry Set' &&
        item.displaySubcategoryName.toLowerCase() !== dCat.toLowerCase();

      const subPriceStr = sharedSectionPrice
        ? ''
        : (() => {
            const price = config.priceLookup({ subcategory: item.entry.subcategoryName, price: item.dishes[0].price });
            const isSetMeal = config.setMealSubcategories.has(item.entry.subcategoryName);
            return price ? `  ·  ¥${price}${config.showSetMealNote && isSetMeal ? ' (+ 1 side/salad)' : ''}` : '';
          })();

      if (showSubName) {
        message += `**— ${item.displaySubcategoryName}${subPriceStr} —**\n`;
      }

      for (const dish of item.dishes) {
        const ratingInfo = ratingsMap.get(dish.dish_name);
        const ratingBadge = ratingInfo
          ? ` ⭐ ${ratingInfo.avg.toFixed(1)} *(${ratingInfo.count})*`
          : '';

        message += `> ${item.entry.emoji} **${dish.dish_name}**${ratingBadge}\n`;

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
    if (splitAt === -1) splitAt = 1900;
    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trim();
  }
  if (remaining.length > 0) chunks.push(remaining);

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
