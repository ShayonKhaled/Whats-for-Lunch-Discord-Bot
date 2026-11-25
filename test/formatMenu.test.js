const test = require('node:test');
const assert = require('node:assert');

const { formatMenuMessage, getMenuOrderIndex } = require('../src/utils/formatMenu');

const DISCORD_MAX = 2000;
// The rate prompt nextmenu/menuPublisher append to the first chunk.
const RATE_PROMPT = '\n\n## **Tap below to rate the menu**';

function dish(overrides = {}) {
  return {
    campus: 'Uzumasa',
    menu_date: '2026-08-18',
    day_name: 'Tuesday',
    category: 'Set Meals',
    subcategory: 'Campus Lunch (1)',
    dish_name: 'Beef Cutlet',
    allergens: null,
    calories: 498,
    protein: 15.0,
    fat: 23.7,
    sodium: 2.7,
    price: null,
    ...overrides,
  };
}

test('returns a placeholder when there are no items', () => {
  assert.deepStrictEqual(formatMenuMessage([]), ['⚠️ No menu found for today.']);
  assert.deepStrictEqual(formatMenuMessage(null), ['⚠️ No menu found for today.']);
});

// ── Prices the scraper dropped ───────────────────────────────────────────────
// The Kameoka parser lost the price field from 2026-10-05, so whole weeks posted
// with no ¥ figures. For categories whose prices still come from the scraper
// (such as Side Dish), the formatter stands in the last price actually scraped
// for that menu slot — never an invented one.

test('a price missing from the scrape falls back to the last published one', () => {
  const [first] = formatMenuMessage(
    [dish({ campus: 'Kameoka', category: 'Side Dish', subcategory: 'A', dish_name: 'Spinach Gomaae', price: null })],
    new Map(),
    'Kameoka',
    new Map([['Side Dish|||A', 70]])
  );

  assert.match(first, /## 🥗 Sides\s+·\s+¥70/, 'a priceless week must still show prices');
});

test('a scraped price always wins over the fallback', () => {
  const [first] = formatMenuMessage(
    [dish({ campus: 'Kameoka', category: 'Side Dish', subcategory: 'A', dish_name: 'Spinach Gomaae', price: 90 })],
    new Map(),
    'Kameoka',
    new Map([['Side Dish|||A', 70]])
  );

  assert.match(first, /## 🥗 Sides\s+·\s+¥90/);
  assert.doesNotMatch(first, /## 🥗 Sides\s+·\s+¥70/, 'the fallback must not override fresh data');
});

test('nothing is invented for a slot that was never priced', () => {
  const [first] = formatMenuMessage(
    [
      dish({
        campus: 'Kameoka',
        category: 'Side Dish',
        subcategory: 'B',
        dish_name: 'Cold Tofu',
        price: null,
      }),
    ],
    new Map(),
    'Kameoka',
    new Map([['Side Dish|||A', 70]])
  );

  assert.match(first, /## 🥗 Sides\n/, 'another slot\u2019s price is not this slot\u2019s price');
});

test('callers that pass no fallback still render', () => {
  const [first] = formatMenuMessage(
    [dish({ campus: 'Kameoka', category: 'Curry', subcategory: 'A', price: null })],
    new Map(),
    'Kameoka'
  );

  assert.match(first, /^# Kameoka Campus/);
});

test('header carries the campus, day and date', () => {
  const [first] = formatMenuMessage([dish()]);
  assert.match(first, /^# Uzumasa Campus — Tuesday, 2026-08-18/);
});

test('Kameoka renders updated category prices and includes standing Udon and Soba under Noodles with Ramen', () => {
  const fullMessage = formatMenuMessage(
    [
      dish({ campus: 'Kameoka', category: 'Set', subcategory: 'A', dish_name: 'Pork Tonkatsu', price: 500 }),
      dish({ campus: 'Kameoka', category: 'Set', subcategory: 'B', dish_name: 'Grilled Salmon', price: 500 }),
      dish({ campus: 'Kameoka', category: 'Live Kitchen', subcategory: 'Live Kitchen', dish_name: 'Beef Bowl', price: 480 }),
      dish({ campus: 'Kameoka', category: 'Curry', subcategory: 'A', dish_name: 'Original Curry', price: 350 }),
      dish({ campus: 'Kameoka', category: 'Ramen', subcategory: 'Ramen', dish_name: 'Shoyu Ramen', price: 380 }),
      dish({ campus: 'Kameoka', category: 'Side Dish', subcategory: 'A', dish_name: 'Spinach Salad', price: 70 }),
    ],
    new Map(),
    'Kameoka'
  ).join('\n');

  assert.match(fullMessage, /^# Kameoka Campus/);
  assert.match(fullMessage, /## 🍱 Set Meals\s+·\s+¥330/);
  assert.match(fullMessage, /## 🍳 Live Kitchen\s+·\s+¥280/);
  assert.match(fullMessage, /## 🍛 Curry\s+·\s+¥230/);
  assert.match(fullMessage, /## 🍜 Noodles\n/);
  assert.match(fullMessage, /\*\*— Ramen\s+·\s+¥230 —\*\*/);
  assert.match(fullMessage, /\*\*— Udon and Soba\s+·\s+¥130 —\*\*/);
  assert.match(fullMessage, /🍝 \*\*Wakame \(seaweed\) udon\*\*\n> ⚠️ \*Wheat\*/);
  assert.match(fullMessage, /🍝 \*\*Wakame \(seaweed\) soba noodles\*\*\n> ⚠️ \*Eggs, Wheat, Soba\*/);
  assert.match(fullMessage, /🍝 \*\*Kitsune \(fried tofu\) udon\*\*\n> ⚠️ \*Wheat\*/);
  assert.match(fullMessage, /🍝 \*\*Kitsune \(fried tofu\) soba noodles\*\*\n> ⚠️ \*Eggs, Wheat, Soba\*/);
  assert.match(fullMessage, /## 🥗 Sides\s+·\s+¥70/);
});

test('Kameoka shows Noodles · ¥130 when no Ramen is scraped that day and does not duplicate scraped Udon and Soba', () => {
  const [withoutRamen] = formatMenuMessage(
    [dish({ campus: 'Kameoka', category: 'Curry', subcategory: 'A', dish_name: 'Original Curry', price: 350 })],
    new Map(),
    'Kameoka'
  );
  assert.match(withoutRamen, /## 🍜 Noodles\s+·\s+¥130/);
  assert.match(withoutRamen, /\*\*— Udon and Soba —\*\*/);

  // If the scraper already provides Udon and Soba rows, standing ones must not duplicate them.
  const [withScrapedUdon] = formatMenuMessage(
    [
      dish({
        campus: 'Kameoka',
        category: 'Noodles',
        subcategory: 'Udon and Soba',
        dish_name: 'Wakame (seaweed) udon',
        allergens: 'Wheat',
        price: 130,
      }),
    ],
    new Map(),
    'Kameoka'
  );
  const matches = withScrapedUdon.match(/Wakame \(seaweed\) udon/g) || [];
  assert.strictEqual(matches.length, 1);
});

test('an unknown campus falls back to Uzumasa rather than throwing', () => {
  const [first] = formatMenuMessage([dish()], new Map(), 'Atlantis');
  assert.match(first, /^# Uzumasa Campus/);
});

test('every chunk stays within Discord limits, including the rate prompt', () => {
  // 60 dishes with long names and allergens — comfortably past one message.
  const items = [];
  for (let i = 0; i < 60; i++) {
    items.push(
      dish({
        dish_name: `Teppan Panko Pork Loin with BBQ Sauce and Assorted Seasonal Vegetables #${i}`,
        allergens: 'Milk, Wheat, Egg, Soy, Shrimp, Crab, Peanut',
        subcategory: i % 2 === 0 ? 'Campus Lunch (1)' : 'Campus Lunch (2)',
      })
    );
  }

  const chunks = formatMenuMessage(items);
  assert.ok(chunks.length > 1, 'expected the menu to split across chunks');

  chunks.forEach((chunk, i) => {
    assert.ok(chunk.length <= 1900, `chunk ${i} is ${chunk.length} chars, over the 1900 cap`);
  });

  // The first chunk is the one callers decorate — it must still fit after that.
  assert.ok(
    chunks[0].length + RATE_PROMPT.length <= DISCORD_MAX,
    `first chunk + rate prompt is ${chunks[0].length + RATE_PROMPT.length}, over Discord's ${DISCORD_MAX}`
  );
});

test('a single small menu produces exactly one chunk', () => {
  const chunks = formatMenuMessage([dish()]);
  assert.strictEqual(chunks.length, 1);
});

test('ratings decorate the dish they belong to', () => {
  const ratings = new Map([['Beef Cutlet', { avg: 3.3, count: 3 }]]);
  const [first] = formatMenuMessage([dish()], ratings);
  assert.match(first, /⭐ 3\.3 \*\(3\)\*/);
});

test('dishes without ratings carry no rating badge', () => {
  const [first] = formatMenuMessage([dish()], new Map());
  assert.doesNotMatch(first, /⭐ \d/);
});

test('nutrition and allergens are omitted when absent', () => {
  const [first] = formatMenuMessage([
    dish({ calories: null, protein: null, fat: null, sodium: null, allergens: null }),
  ]);
  assert.doesNotMatch(first, /📊/);
  // Scoped to the quoted per-dish line — the standing allergy disclaimer at the
  // top of every menu also starts with ⚠️ and must not be mistaken for it.
  assert.doesNotMatch(first, /^> ⚠️ \*/m);
});

test('allergens are rendered when present', () => {
  const [first] = formatMenuMessage([dish({ allergens: 'Milk, Wheat' })]);
  assert.match(first, /^> ⚠️ \*Milk, Wheat\*/m);
});

test('the allergy disclaimer is always present', () => {
  const [first] = formatMenuMessage([dish()]);
  assert.match(first, /food allergies/);
  assert.match(first, /食物アレルギー/);
});

test('getMenuOrderIndex orders known sections and rejects unknown ones', () => {
  const setMeals = getMenuOrderIndex('Set Meals', 'Campus Lunch (1)', 'Uzumasa');
  const sides = getMenuOrderIndex('Sides', 'Salad', 'Uzumasa');

  assert.ok(setMeals >= 0, 'set meals should be a known section');
  assert.ok(sides > setMeals, 'sides should sort after set meals');
  assert.strictEqual(getMenuOrderIndex('Nonsense', 'Nope', 'Uzumasa'), -1);
});

test('getMenuOrderIndex is campus-aware', () => {
  // Kameoka has its own ordering and no 'Campus Lunch (1)' subcategory.
  assert.strictEqual(getMenuOrderIndex('Set Meals', 'Campus Lunch (1)', 'Kameoka'), -1);
  assert.ok(getMenuOrderIndex('Curry', 'A', 'Kameoka') >= 0);
});
