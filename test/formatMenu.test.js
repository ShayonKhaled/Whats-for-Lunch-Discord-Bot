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

test('header carries the campus, day and date', () => {
  const [first] = formatMenuMessage([dish()]);
  assert.match(first, /^# Uzumasa Campus — Tuesday, 2026-08-18/);
});

test('renders the Kameoka header and its DB-sourced price', () => {
  const [first] = formatMenuMessage(
    [dish({ campus: 'Kameoka', category: 'Curry', subcategory: 'A', dish_name: 'Original Curry', price: 350 })],
    new Map(),
    'Kameoka'
  );
  assert.match(first, /^# Kameoka Campus/);
  assert.match(first, /¥350/);
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
