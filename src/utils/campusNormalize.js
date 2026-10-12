/**
 * src/utils/campusNormalize.js
 *
 * Recognising Kameoka menus that the scraper filed under campus 'Unknown'.
 *
 * The n8n parser resolves campus as `... || 'Unknown'`. When the Kameoka branch
 * loses that value somewhere in its node chain the workflow still reports
 * success, and the dishes land under a campus the bot — which matches campus
 * exactly — can never see. It happened on 2026-10-05 and again on 2026-10-12:
 * both times the 6 AM post skipped every Kameoka subscriber while Uzumasa went
 * out as normal, and nothing failed.
 *
 * The repair must never guess, so it demands positive evidence. A group of rows
 * is called Kameoka only when it contains a category only Kameoka uses *and*
 * none that only Uzumasa uses. Categories both campuses use — Curry and Ramen
 * appear on either side — prove nothing on their own and are refused.
 *
 * Pure function of the rows: no database, no clock, so it is testable.
 */

const { KNOWN_CAMPUSES } = require('./dataQuality');

// Category names unique to one campus. Uzumasa's side of the overlap is the
// plural 'Sides'; Kameoka's is the singular 'Side Dish'.
const UZUMASA_ONLY_CATEGORIES = new Set(['Set Meals', 'A La Carte', 'Noodles', 'Sides', 'Halal']);
const KAMEOKA_ONLY_CATEGORIES = new Set(['Set', 'Live Kitchen', 'Side Dish']);

/**
 * Decide which campus a group of mislabelled rows belongs to.
 *
 * @param {object[]} rows rows sharing one menu_date, all with an unknown campus
 * @returns {{campus: string|null, reason: string, uzumasaMarkers: string[], kameokaMarkers: string[]}}
 *          `campus` is null when the evidence is not conclusive — the caller
 *          must leave those rows alone rather than guess.
 */
function classifyUnknownRows(rows) {
  const categories = [...new Set((rows || []).map((r) => r && r.category).filter(Boolean))].sort();
  const uzumasaMarkers = categories.filter((c) => UZUMASA_ONLY_CATEGORIES.has(c));
  const kameokaMarkers = categories.filter((c) => KAMEOKA_ONLY_CATEGORIES.has(c));

  if (uzumasaMarkers.length > 0) {
    return {
      campus: null,
      reason: `carries Uzumasa-only categor${uzumasaMarkers.length === 1 ? 'y' : 'ies'} ${uzumasaMarkers.join(', ')}`,
      uzumasaMarkers,
      kameokaMarkers,
    };
  }

  if (kameokaMarkers.length === 0) {
    return {
      campus: null,
      reason:
        categories.length === 0
          ? 'no categories to judge by'
          : `only shared categories (${categories.join(', ')}) — no positive Kameoka evidence`,
      uzumasaMarkers,
      kameokaMarkers,
    };
  }

  return {
    campus: 'Kameoka',
    reason: `Kameoka-only categor${kameokaMarkers.length === 1 ? 'y' : 'ies'} ${kameokaMarkers.join(', ')} and no Uzumasa-only category`,
    uzumasaMarkers,
    kameokaMarkers,
  };
}

module.exports = {
  classifyUnknownRows,
  UZUMASA_ONLY_CATEGORIES,
  KAMEOKA_ONLY_CATEGORIES,
  KNOWN_CAMPUSES,
};
