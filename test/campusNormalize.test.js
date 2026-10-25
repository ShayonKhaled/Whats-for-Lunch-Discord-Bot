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

// ── Slot-level evidence ─────────────────────────────────────────────────────
// The category can be shared while the slot is not: Kameoka's curry slots are A,
// B and C while Uzumasa's are 'Curry' and 'Curry Set'. A week that lands under
// 'Unknown' with a curry-and-ramen-only menu therefore has no Kameoka-only
// category to prove it, and the slot name is the only evidence there is.

test('a shared-category week is proven by its slots', () => {
  const verdict = classifyUnknownRows([
    row('Curry', { subcategory: 'A' }),
    row('Curry', { subcategory: 'B' }),
    row('Ramen', { subcategory: 'Ramen' }),
  ]);

  assert.strictEqual(verdict.campus, 'Kameoka');
  assert.deepStrictEqual(verdict.kameokaSlots, ['Curry|||A', 'Curry|||B']);
});

test("Uzumasa's own curry slot vetoes a group, whatever else it holds", () => {
  // 'Curry|||Curry' is Uzumasa's; a batch mixing it with Kameoka curry slots is
  // a batch nobody can attribute, so it must be left alone.
  const verdict = classifyUnknownRows([
    row('Curry', { subcategory: 'Curry' }),
    row('Curry', { subcategory: 'A' }),
  ]);

  assert.strictEqual(verdict.campus, null);
  assert.match(verdict.reason, /Uzumasa-only/);
  assert.deepStrictEqual(verdict.uzumasaSlots, ['Curry|||Curry']);
});

test('shared slots alone still prove nothing', () => {
  // "Ramen|||Ramen" is not listed as a Kameoka marker: a stray Uzumasa ramen row
  // must never vouch for a group on its own.
  const verdict = classifyUnknownRows([row('Ramen', { subcategory: 'Ramen' })]);

  assert.strictEqual(verdict.campus, null);
  assert.match(verdict.reason, /no positive Kameoka evidence/);
});

test('a row with no subcategory falls back to the category evidence', () => {
  assert.strictEqual(classifyUnknownRows([row('Side Dish')]).campus, 'Kameoka');
  assert.strictEqual(classifyUnknownRows([row('Curry')]).campus, null);
});
