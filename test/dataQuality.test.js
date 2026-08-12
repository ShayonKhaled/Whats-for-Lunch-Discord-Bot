const test = require('node:test');
const assert = require('node:assert');

const { checkMenuData } = require('../src/utils/dataQuality');

const WEEK = ['2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'];

function row(campus, menu_date, overrides = {}) {
  return {
    campus,
    menu_date,
    category: 'Set Meals',
    subcategory: 'A',
    dish_name: 'Beef Cutlet',
    price: campus === 'Kameoka' ? 500 : null,
    ...overrides,
  };
}

/** A healthy week: both campuses, enough items, Kameoka priced. */
function healthyRows(days = WEEK) {
  const rows = [];
  for (const day of days) {
    for (const campus of ['Uzumasa', 'Kameoka']) {
      for (let i = 0; i < 5; i++) {
        rows.push(row(campus, day, { dish_name: `Dish ${campus} ${day} ${i}` }));
      }
    }
  }
  return rows;
}

test('a healthy week passes', () => {
  const result = checkMenuData(healthyRows(), WEEK);
  assert.strictEqual(result.ok, true, result.problems.join('; '));
  assert.deepStrictEqual(result.problems, []);
});

test('catches the Unknown campus regression', () => {
  const rows = healthyRows();
  rows.push(row('Unknown', '2026-08-18', { dish_name: 'Mystery Curry' }));

  const result = checkMenuData(rows, WEEK);

  assert.strictEqual(result.ok, false);
  assert.ok(
    result.problems.some((p) => p.includes('unexpected campus "Unknown"')),
    `expected an Unknown-campus problem, got: ${result.problems.join('; ')}`
  );
});

test('catches one campus missing a week the other has', () => {
  // The August failure: Uzumasa was re-run after the fetcher error, Kameoka was not.
  const rows = healthyRows().filter((r) => r.campus !== 'Kameoka');

  const result = checkMenuData(rows, WEEK);

  assert.strictEqual(result.ok, false);
  for (const day of WEEK) {
    assert.ok(
      result.problems.some((p) => p === `Kameoka has no menu for ${day}`),
      `expected a missing-Kameoka problem for ${day}`
    );
  }
});

test('catches missing Kameoka prices', () => {
  const rows = healthyRows().map((r) => (r.campus === 'Kameoka' ? { ...r, price: null } : r));

  const result = checkMenuData(rows, WEEK);

  assert.strictEqual(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('no prices')));
});

test('does not demand prices from Uzumasa, whose prices are hardcoded', () => {
  const result = checkMenuData(healthyRows(), WEEK);
  assert.ok(!result.problems.some((p) => p.includes('Uzumasa') && p.includes('price')));
});

test('catches a suspiciously thin day', () => {
  const rows = healthyRows().filter(
    (r) => !(r.campus === 'Kameoka' && r.menu_date === '2026-08-19') || r.dish_name.endsWith('0')
  );

  const result = checkMenuData(rows, WEEK);

  assert.strictEqual(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('only 1 item(s) for 2026-08-19')));
});

test('catches rows the formatter could not place', () => {
  const rows = healthyRows();
  rows.push(row('Uzumasa', '2026-08-18', { dish_name: null }));
  rows.push(row('Uzumasa', '2026-08-19', { category: null }));

  const result = checkMenuData(rows, WEEK);

  assert.strictEqual(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('2 row(s) missing')));
});

test('an empty window is reported rather than silently passing', () => {
  const result = checkMenuData([], []);
  assert.strictEqual(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('no menu published for any campus')));
});

test('a closure produces no per-day noise', () => {
  // Nothing published for the closed stretch, so those days are never asserted
  // on — only the days a campus actually published are checked.
  const openDays = ['2026-08-18'];
  const rows = healthyRows(openDays);

  const result = checkMenuData(rows, openDays);

  assert.strictEqual(result.ok, true, result.problems.join('; '));
});

test('the report states what was actually checked', () => {
  const result = checkMenuData(healthyRows(), WEEK);
  assert.strictEqual(result.checked.rows, 40);
  assert.deepStrictEqual(result.checked.weekdays, WEEK);
  assert.deepStrictEqual(result.checked.campuses.sort(), ['Kameoka', 'Uzumasa']);
});
