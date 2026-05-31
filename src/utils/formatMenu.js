/**
 * Formats an array of menu items into Discord message chunks
 * Reuses logic from the n8n workflow-2 formatting node
 */

// Hardcoded prices by subcategory (in yen)
const PRICES = {
  'Campus Lunch (1)': 330,
  'Campus Lunch (2)': 330,
  'A La Carte':       330,
  'Curry Set':        330,
  'Ramen':            250,
  'Udon and Soba':    200,
  'Side Dish A':       70,
  'Side Dish B':       70,
  'Side Dish C':       70,
  'Salad':             70,
};

// Subcategories where the price includes one free side dish or salad
const SET_MEAL_SUBCATEGORIES = new Set(['Campus Lunch (1)', 'Campus Lunch (2)']);

function formatMenuMessage(items) {
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
    'Curry Set': '🍛',
    'Noodles': '🍜',
    'Sides': '🥗',
  };

  const sections = new Map();
  for (const { key, emoji } of order) {
    if (!grouped[key]) {
      continue;
    }

    const [category, subcategory] = key.split('|||');
    const categoryName = category.trim();
    const subcategoryName = subcategory.trim();
    const displayCategoryName = subcategoryName === 'Curry Set' ? 'Curry Set' : categoryName;

    if (!sections.has(displayCategoryName)) {
      sections.set(displayCategoryName, {
        emoji: categoryEmojis[displayCategoryName] || emoji || '🍴',
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

  let message = `# Uzumasa Campus — ${dayName}, ${menuDate}\n\n`;
  let lastCategory = null;

  for (const [displayCategoryName, section] of sections) {
    const sectionPrices = new Set(
      section.items
        .map((item) => PRICES[item.subcategoryName])
        .filter((price) => typeof price === 'number')
    );
    const sharedSectionPrice = sectionPrices.size === 1 ? [...sectionPrices][0] : null;
    const sectionPriceStr = sharedSectionPrice
      ? `  ·  ¥${sharedSectionPrice}${SET_MEAL_SUBCATEGORIES.has(section.items[0].subcategoryName) ? ' (+ 1 side/salad)' : ''}`
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
        displayCategoryName !== 'Curry Set' && item.subcategoryName.toLowerCase() !== displayCategoryName.toLowerCase();
      const subcategoryPriceStr = sharedSectionPrice
        ? ''
        : (() => {
            const price = PRICES[item.subcategoryName];
            const isSetMeal = SET_MEAL_SUBCATEGORIES.has(item.subcategoryName);
            return price ? `  ·  ¥${price}${isSetMeal ? ' (+ 1 side/salad)' : ''}` : '';
          })();

      if (showSubcategoryName) {
        message += `**— ${item.subcategoryName}${subcategoryPriceStr} —**\n`;
      }

      for (const dish of item.dishes) {
        message += `> ${item.emoji} **${dish.dish_name}**\n`;

        const nutrition = [];
        if (dish.calories) {
          nutrition.push(`${dish.calories} kcal`);
        }
        if (dish.protein) {
          nutrition.push(`Protein ${dish.protein}g`);
        }
        if (dish.fat) {
          nutrition.push(`Fat ${dish.fat}g`);
        }

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
  message += '🎫 Tickets from **10:30 AM**  ·  🕚 Open **11:00 AM – 2:00 PM** ';
  message += '\n*Prices are part of a cafeteria discount campaign sponsored by the Student Guardian Association and are available to students only. Faculty and staff members are not eligible for this discounted price.*';

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

module.exports = { formatMenuMessage };