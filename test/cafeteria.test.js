const test = require('node:test');
const assert = require('node:assert');

const {
  POSTING_TIME,
  HOURS,
  hoursLine,
  buildFooter,
  studentPrice,
  hasStudentDiscount,
} = require('../src/config/cafeteria');
const { formatMenuMessage } = require('../src/utils/formatMenu');

test('the hours line is built from config, not hardcoded', () => {
  const line = hoursLine();
  assert.ok(line.includes(HOURS.ticketsFrom), 'ticket time should come from config');
  assert.ok(line.includes(HOURS.opens));
  assert.ok(line.includes(HOURS.closes));
});

test('ticket time matches opening time during reduced hours', () => {
  // The cafeteria notice states ticket sales and service both begin at 11:30;
  // advertising an earlier ticket time sent students an hour early.
  assert.strictEqual(HOURS.ticketsFrom, HOURS.opens);
});

test('buildFooter appends campus-specific notes after the shared ones', () => {
  const footer = buildFooter(['Campus specific note.']);
  assert.ok(footer.startsWith(hoursLine()), 'hours come first');
  assert.ok(footer.includes('*Campus specific note.*'), 'campus note is italicised');
  assert.ok(
    footer.indexOf('Campus specific note.') > footer.indexOf(hoursLine()),
    'campus notes come last'
  );
});

test('buildFooter works with no campus notes', () => {
  const footer = buildFooter();
  assert.ok(footer.startsWith(hoursLine()));
  assert.ok(!footer.includes('undefined'));
});

test('POSTING_TIME is a JST time, matching the scheduler', () => {
  assert.match(POSTING_TIME, /JST/);
});

test('rendered menus pick up the configured hours', () => {
  const [chunk] = formatMenuMessage([
    {
      campus: 'Uzumasa',
      menu_date: '2026-08-18',
      day_name: 'Tuesday',
      category: 'Set Meals',
      subcategory: 'Campus Lunch (1)',
      dish_name: 'Beef Cutlet',
      calories: 498,
    },
  ]);

  // Guards the regression where the footer advertised 10:30 while config said 11:30.
  assert.ok(
    chunk.includes(`Tickets from **${HOURS.ticketsFrom}**`),
    'the footer must reflect config, not a stale literal'
  );
});

// ── Student discount ─────────────────────────────────────────────────────────
// The menu PDFs print the visitor/faculty price. Uzumasa students pay that
// minus the campaign discount; Kameoka runs no campaign. These cases reproduce
// the prices that were previously hardcoded, from the real PDF listed prices.

test('Uzumasa listed prices convert to the previously hardcoded student prices', () => {
  const cases = [
    // The PDF prints two prices for these two sections (430 above 500); the
    // scraper is instructed to take the lower, which is the base price.
    ['Set Meals', 430, 330, 'Campus Lunch — 100 off'],
    ['A La Carte', 430, 330, 'à la carte — 100 off'],
    ['Curry', 380, 330, 'curry — 50 off'],
    ['Noodles', 300, 250, 'ramen — 50 off'],
    ['Noodles', 250, 200, 'udon/soba — 50 off'],
    ['Sides', 70, 70, 'sides — no discount'],
  ];
  for (const [category, listed, expected, label] of cases) {
    assert.strictEqual(studentPrice('Uzumasa', category, listed), expected, label);
  }
});

test('Kameoka has no student discount, so listed price passes through', () => {
  assert.strictEqual(studentPrice('Kameoka', 'Set', 500), 500);
  assert.strictEqual(studentPrice('Kameoka', 'Curry', 350), 350);
  assert.strictEqual(studentPrice('Kameoka', 'Side Dish', 70), 70);
});

test('Live Kitchen is its own tier and is undiscounted', () => {
  // Counter service at Kameoka; kept as a distinct tier so it can be changed
  // independently of the Set Meals rate.
  assert.strictEqual(studentPrice('Kameoka', 'Live Kitchen', 450), 450);
  assert.strictEqual(studentPrice('Kameoka', 'Live Kitchen', 500), 500);
});

test('a missing listed price yields null rather than a bogus discount', () => {
  assert.strictEqual(studentPrice('Uzumasa', 'Set Meals', null), null);
  assert.strictEqual(studentPrice('Uzumasa', 'Set Meals', undefined), null);
  assert.strictEqual(studentPrice('Kameoka', 'Set', null), null);
});

test('an unknown category is treated as undiscounted, not dropped', () => {
  assert.strictEqual(studentPrice('Uzumasa', 'Mystery Section', 400), 400);
  assert.strictEqual(studentPrice('Atlantis', 'Set Meals', 400), 400);
});

test('hasStudentDiscount distinguishes the two campuses', () => {
  assert.strictEqual(hasStudentDiscount('Uzumasa'), true);
  assert.strictEqual(hasStudentDiscount('Kameoka'), false);
});

test('Uzumasa falls back to the hardcoded table while its scraper has no prices', () => {
  // Until the Uzumasa workflow extracts price, rows arrive with price = null.
  const [chunk] = formatMenuMessage([
    {
      campus: 'Uzumasa', menu_date: '2026-08-18', day_name: 'Tuesday',
      category: 'Set Meals', subcategory: 'Campus Lunch (1)',
      dish_name: 'Beef Cutlet', calories: 498, price: null,
    },
  ]);
  assert.match(chunk, /¥330/, 'should fall back rather than show no price');
});

test('a scraped Uzumasa listed price wins over the fallback table', () => {
  const [chunk] = formatMenuMessage([
    {
      campus: 'Uzumasa', menu_date: '2026-08-18', day_name: 'Tuesday',
      category: 'Set Meals', subcategory: 'Campus Lunch (1)',
      dish_name: 'Beef Cutlet', calories: 498, price: 450,
    },
  ]);
  // 450 listed - 100 student discount = 350, not the hardcoded 330.
  assert.match(chunk, /¥350/);
  assert.doesNotMatch(chunk, /¥330/);
});

test('Kameoka renders its listed price unchanged', () => {
  const [chunk] = formatMenuMessage(
    [
      {
        campus: 'Kameoka', menu_date: '2026-08-18', day_name: 'Tuesday',
        category: 'Curry', subcategory: 'A',
        dish_name: 'Original Curry', calories: 658, price: 350,
      },
    ],
    new Map(),
    'Kameoka'
  );
  assert.match(chunk, /¥350/);
});

test('halal is a flat 400 whatever the scraper reports', () => {
  // Confirmed at the Uzumasa payment machine: halal is ¥400 always, campaign or
  // not. Deriving it would be fragile — halal returns in September and nobody
  // has seen what the PDF prints for it. These cases pin the price against any
  // listed value the scraper might produce.
  for (const listed of [null, 400, 500, 570]) {
    assert.strictEqual(
      studentPrice('Uzumasa', 'Halal', listed),
      400,
      `halal must be 400 even when the scraper reports ${listed}`
    );
  }
});

test('halal renders as 400 on the menu', () => {
  const [chunk] = formatMenuMessage([
    {
      campus: 'Uzumasa', menu_date: '2026-09-01', day_name: 'Tuesday',
      category: 'Halal', subcategory: 'Halal',
      dish_name: 'Halal Chicken Curry', calories: 520, price: 500,
    },
  ]);
  assert.match(chunk, /¥400/);
  assert.doesNotMatch(chunk, /¥500/, 'the listed price must not leak through');
});
