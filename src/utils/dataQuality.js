/**
 * src/utils/dataQuality.js
 *
 * Assertions over what the n8n scrapers write into `menu_items`.
 *
 * Both of August's data bugs — Kameoka rows landing with campus 'Unknown', and
 * prices being dropped entirely — sat in the database for weeks because nothing
 * ever looked at the data. Each is a one-line check here.
 *
 * Pure function of a set of rows so it is testable without a database.
 */

const KNOWN_CAMPUSES = ['Uzumasa', 'Kameoka'];

// Campuses whose prices come from the DB rather than a hardcoded table in
// formatMenu.js. Uzumasa is deliberately absent — its rows are always priceless.
const PRICED_CAMPUSES = ['Kameoka'];

const MIN_ITEMS_PER_DAY = 4;

/**
 * @param {object[]} rows      Rows from menu_items covering the window checked.
 * @param {string[]} weekdays  The upcoming weekdays that should have a menu.
 * @returns {{ok: boolean, problems: string[], checked: object}}
 */
function checkMenuData(rows, weekdays) {
  const problems = [];

  // `weekdays` is the set of dates some campus has already published, so a
  // cafeteria closure produces an empty list rather than a wall of false
  // alarms. Nothing at all upcoming is itself worth surfacing.
  if (weekdays.length === 0) {
    problems.push('no menu published for any campus in the window checked');
    return { ok: false, problems, checked: { rows: rows.length, weekdays, campuses: [] } };
  }

  // 1. Unexpected campus labels — catches the 'Unknown' regression.
  const seenCampuses = [...new Set(rows.map((r) => r.campus))];
  for (const campus of seenCampuses) {
    if (!KNOWN_CAMPUSES.includes(campus)) {
      const count = rows.filter((r) => r.campus === campus).length;
      problems.push(`unexpected campus "${campus}" on ${count} row(s) — the bot matches campus exactly and will never see these`);
    }
  }

  // 2. Coverage: each known campus should have a usable menu for each weekday.
  for (const campus of KNOWN_CAMPUSES) {
    for (const day of weekdays) {
      const items = rows.filter((r) => r.campus === campus && r.menu_date === day);
      if (items.length === 0) {
        problems.push(`${campus} has no menu for ${day}`);
      } else if (items.length < MIN_ITEMS_PER_DAY) {
        problems.push(`${campus} has only ${items.length} item(s) for ${day} (expected at least ${MIN_ITEMS_PER_DAY})`);
      }
    }
  }

  // 3. Prices, for the campuses that are supposed to carry them.
  for (const campus of PRICED_CAMPUSES) {
    for (const day of weekdays) {
      const items = rows.filter((r) => r.campus === campus && r.menu_date === day);
      if (items.length === 0) continue; // already reported by the coverage check
      const priced = items.filter((r) => r.price !== null && r.price !== undefined && r.price !== '');
      if (priced.length === 0) {
        problems.push(`${campus} has no prices for ${day} — all ${items.length} row(s) are NULL`);
      }
    }
  }

  // 4. Rows the formatter cannot place.
  const malformed = rows.filter((r) => !r.dish_name || !r.category || !r.menu_date);
  if (malformed.length > 0) {
    problems.push(`${malformed.length} row(s) missing dish_name, category or menu_date`);
  }

  return {
    ok: problems.length === 0,
    problems,
    checked: {
      rows: rows.length,
      weekdays,
      campuses: seenCampuses,
    },
  };
}

module.exports = { checkMenuData, KNOWN_CAMPUSES, PRICED_CAMPUSES, MIN_ITEMS_PER_DAY };
