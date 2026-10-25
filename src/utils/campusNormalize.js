/**
 * src/utils/campusNormalize.js
 *
 * Recognising Kameoka menus that the scraper filed under campus 'Unknown'.
 *
 * The n8n parser resolves campus as `... || 'Unknown'`. When the Kameoka branch
 * loses that value somewhere in its node chain the workflow still reports
 * success, and the dishes land under a campus the bot — which matches campus
 * exactly — can never see. It happened on 2026-10-05 and 2026-10-12: both times
 * the 6 AM post skipped every Kameoka subscriber while Uzumasa went out as
 * normal, and nothing failed. The 2026-10-19 week arrived the same way and was
 * caught in the table before its Monday post.
 *
 * The repair must never guess, so it demands positive evidence. A group of rows
 * is called Kameoka only when it carries a marker only Kameoka uses *and* none
 * that only Uzumasa uses. Categories both campuses share — Curry and Ramen
 * appear on either side — prove nothing on their own and are refused.
 *
 * Evidence comes at two levels, because the category alone is not always enough:
 *
 *   - Category: 'Set', 'Live Kitchen' and 'Side Dish' are Kameoka-only names;
 *     'Set Meals', 'A La Carte', 'Noodles', 'Sides' and 'Halal' are Uzumasa's.
 *   - Slot (category + subcategory): the category can be shared while the slot
 *     is not. Uzumasa's curry slots are 'Curry Set' and 'Curry'; Kameoka's are
 *     A, B and C. A week whose menu is curry and ramen only — no 'Set', no
 *     'Live Kitchen', no 'Side Dish' — therefore carries no Kameoka-only
 *     category at all and would be refused, even though the batch is
 *     unmistakably Kameoka. The slot markers prove it.
 *
 * Pure function of the rows: no database, no clock, so it is testable.
 */

const { KNOWN_CAMPUSES } = require('./dataQuality');

// Category names unique to one campus. Uzumasa's side of the overlap is the
// plural 'Sides'; Kameoka's is the singular 'Side Dish'.
const UZUMASA_ONLY_CATEGORIES = new Set(['Set Meals', 'A La Carte', 'Noodles', 'Sides', 'Halal']);
const KAMEOKA_ONLY_CATEGORIES = new Set(['Set', 'Live Kitchen', 'Side Dish']);

// Slots (category|||subcategory) unique to one campus, for the categories the
// two share. These are the slot names formatMenu.js can actually place, so a
// row carrying one of them came from that campus.
const UZUMASA_ONLY_SLOTS = new Set([
  'Set Meals|||Campus Lunch (1)',
  'Set Meals|||Campus Lunch (2)',
  'A La Carte|||A La Carte',
  'A La Carte|||Curry Set',
  'Curry|||Curry Set',
  'Curry|||Curry',
  'Noodles|||Ramen',
  'Noodles|||Udon and Soba',
  'Sides|||Side Dish A',
  'Sides|||Side Dish B',
  'Sides|||Side Dish C',
  'Sides|||Salad',
  'Halal|||Halal',
]);

const KAMEOKA_ONLY_SLOTS = new Set([
  'Set|||A',
  'Set|||B',
  'Live Kitchen|||Live Kitchen',
  'Curry|||A',
  'Curry|||B',
  'Curry|||C',
  'Side Dish|||A',
  'Side Dish|||B',
  'Side Dish|||C',
  'Side Dish|||Salad',
  // 'Ramen|||Ramen' is deliberately absent: a Kameoka menu of only curry and
  // ramen is already proven by its curry slots, and listing it would let a
  // stray Uzumasa ramen row vouch for a group on its own.
]);

/**
 * Decide which campus a group of mislabelled rows belongs to.
 *
 * @param {object[]} rows rows sharing one menu_date, all with an unknown campus
 * @returns {{campus: string|null, reason: string, uzumasaMarkers: string[], kameokaMarkers: string[], uzumasaSlots: string[], kameokaSlots: string[]}}
 *          `campus` is null when the evidence is not conclusive — the caller
 *          must leave those rows alone rather than guess.
 */
function classifyUnknownRows(rows) {
  const rowsOrEmpty = rows || [];
  const categories = [...new Set(rowsOrEmpty.map((r) => r && r.category).filter(Boolean))].sort();
  const slots = [
    ...new Set(
      rowsOrEmpty
        .filter((r) => r && r.category && r.subcategory)
        .map((r) => `${r.category}|||${r.subcategory}`)
    ),
  ].sort();

  const uzumasaMarkers = categories.filter((c) => UZUMASA_ONLY_CATEGORIES.has(c));
  const kameokaMarkers = categories.filter((c) => KAMEOKA_ONLY_CATEGORIES.has(c));
  const uzumasaSlots = slots.filter((s) => UZUMASA_ONLY_SLOTS.has(s));
  const kameokaSlots = slots.filter((s) => KAMEOKA_ONLY_SLOTS.has(s));

  // Any Uzumasa-only evidence at all disqualifies the group, whatever else it
  // holds: discovering one Uzumasa marker and relabelling anyway is how a batch
  // of Uzumasa rows ends up on Kameoka's menu.
  if (uzumasaMarkers.length > 0 || uzumasaSlots.length > 0) {
    const evidence = [...uzumasaMarkers, ...uzumasaSlots].join(', ');
    return {
      campus: null,
      reason: `carries Uzumasa-only categor${uzumasaMarkers.length === 1 ? 'y' : 'ies'}/slot(s) ${evidence}`,
      uzumasaMarkers,
      kameokaMarkers,
      uzumasaSlots,
      kameokaSlots,
    };
  }

  if (kameokaMarkers.length === 0 && kameokaSlots.length === 0) {
    return {
      campus: null,
      reason:
        categories.length === 0
          ? 'no categories to judge by'
          : `only shared categories (${categories.join(', ')}) and slot(s) (${slots.join(', ')}) — no positive Kameoka evidence`,
      uzumasaMarkers,
      kameokaMarkers,
      uzumasaSlots,
      kameokaSlots,
    };
  }

  const evidence = [...kameokaMarkers, ...kameokaSlots].join(', ');
  return {
    campus: 'Kameoka',
    reason: `Kameoka-only evidence (${evidence}) and no Uzumasa-only marker`,
    uzumasaMarkers,
    kameokaMarkers,
    uzumasaSlots,
    kameokaSlots,
  };
}

module.exports = {
  classifyUnknownRows,
  UZUMASA_ONLY_CATEGORIES,
  KAMEOKA_ONLY_CATEGORIES,
  UZUMASA_ONLY_SLOTS,
  KAMEOKA_ONLY_SLOTS,
  KNOWN_CAMPUSES,
};
