const test = require('node:test');
const assert = require('node:assert');

const {
  POSTING_TIME,
  HOURS,
  NOTICES,
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

test('tickets go on sale before service opens on the normal schedule', () => {
  // Tickets at 10:00, doors at 11:00 — the term-time hours. Vacation mode had
  // both at 11:30 and closed at 1:30; this pins the schedule that replaced it.
  assert.strictEqual(HOURS.ticketsFrom, '10:00 AM');
  assert.strictEqual(HOURS.opens, '11:00 AM');
  assert.strictEqual(HOURS.closes, '2:00 PM');
});

test('the vacation notice is gone now that vacation is over', () => {
  // Left in place it would tell students the cafeteria is on reduced hours
  // while the footer advertises the normal ones.
  assert.deepStrictEqual(NOTICES, []);
  assert.ok(!buildFooter(['Campus note.']).includes('vacation'));
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

  // Guards the regression where the footer advertised hours that no longer
  // matched the config — 10:30 while config said 11:30.
  assert.ok(
    chunk.includes(`Tickets from **${HOURS.ticketsFrom}**`),
    'the footer must reflect config, not a stale literal'
  );
});

// ── Student discount ─────────────────────────────────────────────────────────
// The menu PDFs print the visitor/faculty price. Uzumasa students pay that minus
// two stacked campaigns — the association's 100/50 tiers and the ¥70 prefecture
// subsidy on mains. Kameoka runs neither. These cases reproduce the prices that
// were previously hardcoded, from the real PDF listed prices.

test('Uzumasa listed prices convert to the campaigned student prices', () => {
  const cases = [
    // Confirmed at the cafeteria: a set meal is ¥430 for visitors and staff,
    // and students pay ¥260 after the ¥100 association discount and the ¥70
    // subsidy. The PDF prints two prices for these sections (430 above 500);
    // the scraper takes the lower.
    ['Set Meals', 430, 260, 'Campus Lunch — 100 + 70 off'],
    ['A La Carte', 430, 260, 'à la carte — 100 + 70 off'],
    ['Curry', 380, 260, 'curry — 50 + 70 off'],
    ['Noodles', 300, 180, 'ramen — 50 + 70 off'],
    ['Noodles', 250, 130, 'udon/soba — 50 + 70 off'],
    // ¥70 sides would come out free, so the subsidy does not touch them.
    ['Sides', 70, 70, 'sides — no discount'],
  ];
  for (const [category, listed, expected, label] of cases) {
    assert.strictEqual(studentPrice('Uzumasa', category, listed), expected, label);
  }
});

test('Kameoka main categories use the updated fixed student prices while sides stay scraped', () => {
  assert.strictEqual(studentPrice('Kameoka', 'Set', 500), 330);
  assert.strictEqual(studentPrice('Kameoka', 'Set', null), 330);
  assert.strictEqual(studentPrice('Kameoka', 'Live Kitchen', 450), 280);
  assert.strictEqual(studentPrice('Kameoka', 'Live Kitchen', 500), 280);
  assert.strictEqual(studentPrice('Kameoka', 'Curry', 350), 230);
  assert.strictEqual(studentPrice('Kameoka', 'Ramen', 380), 230);
  assert.strictEqual(studentPrice('Kameoka', 'Noodles', 250), 130);
  // Side dishes keep their scraped listed price unchanged.
  assert.strictEqual(studentPrice('Kameoka', 'Side Dish', 70), 70);
  assert.strictEqual(studentPrice('Kameoka', 'Side Dish', 100), 100);
});

test('a missing listed price yields null rather than a bogus discount', () => {
  assert.strictEqual(studentPrice('Uzumasa', 'Set Meals', null), null);
  assert.strictEqual(studentPrice('Uzumasa', 'Set Meals', undefined), null);
  assert.strictEqual(studentPrice('Kameoka', 'Side Dish', null), null);
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
  assert.match(chunk, /¥260/, 'should fall back rather than show no price');
});

test('a scraped Uzumasa listed price wins over the fallback table', () => {
  const [chunk] = formatMenuMessage([
    {
      campus: 'Uzumasa', menu_date: '2026-08-18', day_name: 'Tuesday',
      category: 'Set Meals', subcategory: 'Campus Lunch (1)',
      dish_name: 'Beef Cutlet', calories: 498, price: 450,
    },
  ]);
  // 450 listed - 100 association - 70 subsidy = 280, not the hardcoded 260.
  assert.match(chunk, /¥280/);
  assert.doesNotMatch(chunk, /¥260/);
});

test('Kameoka renders its updated prices and keeps Side Dish prices unchanged', () => {
  const [chunk] = formatMenuMessage(
    [
      {
        campus: 'Kameoka', menu_date: '2026-08-18', day_name: 'Tuesday',
        category: 'Curry', subcategory: 'A',
        dish_name: 'Original Curry', calories: 658, price: 350,
      },
      {
        campus: 'Kameoka', menu_date: '2026-08-18', day_name: 'Tuesday',
        category: 'Side Dish', subcategory: 'A',
        dish_name: 'Spinach Salad', calories: 65, price: 70,
      },
    ],
    new Map(),
    'Kameoka'
  );
  assert.match(chunk, /## 🍛 Curry\s+·\s+¥230/);
  assert.match(chunk, /## 🥗 Sides\s+·\s+¥70/);
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
