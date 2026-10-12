const test = require('node:test');
const assert = require('node:assert');

const { classifyUnknownRows } = require('../src/utils/campusNormalize');

const row = (category, extra = {}) => ({ category, menu_date: '2026-10-12', ...extra });

test('a Kameoka-shaped group is recognised', () => {
  // The 2026-10-12 batch exactly: 11 dishes across these five categories.
  const verdict = classifyUnknownRows([
    row('Set'), row('Set'), row('Live Kitchen'), row('Curry'), row('Curry'),
    row('Curry'), row('Ramen'), row('Side Dish'), row('Side Dish'),
    row('Side Dish'), row('Side Dish'),
  ]);

  assert.strictEqual(verdict.campus, 'Kameoka');
  assert.deepStrictEqual(verdict.kameokaMarkers, ['Live Kitchen', 'Set', 'Side Dish']);
});

test('a group carrying an Uzumasa-only category is refused', () => {
  // 'Set Meals' is Uzumasa's plural form; 'Set' is Kameoka's. A batch mixing in
  // the former is not Kameoka, whatever else it holds.
  const verdict = classifyUnknownRows([row('Set Meals'), row('Live Kitchen')]);

  assert.strictEqual(verdict.campus, null);
  assert.match(verdict.reason, /Uzumasa-only/);
});

test('shared categories alone prove nothing', () => {
  // Curry and Ramen exist on both campuses, so a batch of only those cannot be
  // attributed — the repair must decline rather than flip a coin.
  const verdict = classifyUnknownRows([row('Curry'), row('Ramen')]);

  assert.strictEqual(verdict.campus, null);
  assert.match(verdict.reason, /no positive Kameoka evidence/);
});

test('an empty or category-less group is refused', () => {
  assert.strictEqual(classifyUnknownRows([]).campus, null);
  assert.strictEqual(classifyUnknownRows([row(null), row('')]).campus, null);
  assert.match(classifyUnknownRows([]).reason, /no categories/);
});

test('Uzumasa-only categories are never treated as Kameoka markers', () => {
  for (const category of ['Set Meals', 'A La Carte', 'Noodles', 'Sides', 'Halal']) {
    const verdict = classifyUnknownRows([row(category)]);
    assert.strictEqual(verdict.campus, null, `${category} must not be relabelled`);
  }
});
