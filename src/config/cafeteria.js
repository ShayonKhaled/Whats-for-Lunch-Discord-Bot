/**
 * src/config/cafeteria.js
 *
 * Operating details that change with the university calendar rather than with
 * the code. Previously these were string literals scattered across formatMenu,
 * notify, subscribe and status, so a schedule change meant editing several
 * files and shipping a release — twice in one day, on 2026-08-12.
 *
 * Editing this file is the whole change — and undoing it afterwards: vacation
 * mode was entered and left by editing HOURS and NOTICES here.
 */

// When the publisher posts. Must stay in step with the cron rule in
// menuPublisher.start() — this is the human-readable half of that.
const POSTING_TIME = '6:00 AM JST';

// The normal (term-time) schedule. During the vacation period these became
// tickets and service both at 11:30 AM, closing 1:30 PM.
const HOURS = {
  ticketsFrom: '10:30 AM',
  opens: '11:00 AM',
  closes: '2:00 PM',
};

/**
 * Notices appended to every menu, in order. Empty since the cafeteria returned
 * to its normal schedule — add a line here for the next closure, and clear it
 * again when that ends.
 */
const NOTICES = [];

/** The hours line shown at the foot of each menu. */
function hoursLine() {
  return `🎫 Tickets from **${HOURS.ticketsFrom}**  ·  🕚 Open **${HOURS.opens} – ${HOURS.closes}**`;
}

/**
 * Full footer: hours, the shared notices, then any campus-specific ones.
 * @param {string[]} [campusNotes] extra italicised paragraphs for this campus
 */
function buildFooter(campusNotes = []) {
  return [hoursLine(), ...NOTICES.map((n) => `*${n}*`), ...campusNotes.map((n) => `*${n}*`)].join('\n\n');
}

/**
 * Cafeteria Discount Campaign — students only, and Uzumasa only.
 *
 * Uzumasa students pay the menu's base price minus the amounts below, per the
 * campaign notice: 100 yen off lunch and à la carte, 50 yen off curry and
 * noodles, nothing off sides. Verified against the 2026-08-18 PDF, where the
 * base price minus the tier below reproduces every price this bot had
 * hardcoded (¥430→330, ¥380→330, ¥300→250, ¥250→200, ¥70→70).
 *
 * Note the PDF prints TWO prices for Set Meals and A La Carte (e.g. 430 above
 * 500). The lower is the visitor/staff price — confirmed at the cafeteria: a
 * set meal is ¥430 for visitors and staff, and students pay ¥330 after the
 * ¥100 campaign discount. The scraper is instructed to take the lower of the
 * two; what the higher figure represents is still unknown, but it is never
 * used. Curry, Ramen and Udon/Soba print a single price.
 *
 * Halal is not derived at all — it is a flat ¥400, see FIXED_STUDENT_PRICES.
 *
 * Kameoka does not run the campaign, so its printed price is already what a
 * student pays — every tier there is zero.
 *
 * Keyed by the `category` column in menu_items. A category with no entry is
 * treated as undiscounted.
 */
const STUDENT_DISCOUNT = {
  Uzumasa: {
    'Set Meals': 100,
    'A La Carte': 100,
    Curry: 50,
    Noodles: 50,
    Sides: 0,
    // Halal is deliberately absent — see FIXED_STUDENT_PRICES below.
  },
  Kameoka: {
    Set: 0,
    'Live Kitchen': 0, // counter service — its own tier, currently undiscounted
    Curry: 0,
    Ramen: 0,
    'Side Dish': 0,
  },
};

/**
 * Categories charged a flat price that does not follow the discount tiers.
 *
 * Halal is ¥400 at the Uzumasa payment machine regardless of the campaign
 * (confirmed at the cafeteria itself). Deriving it would be fragile: halal does
 * not return until September, so nobody has seen what the PDF prints for it,
 * and if that turns out to be ¥400 rather than ¥500 a -100 tier would show
 * ¥300 and undercharge on the menu. A fixed price is immune to that.
 */
const FIXED_STUDENT_PRICES = {
  Uzumasa: {
    Halal: 400,
  },
};

/**
 * What a student actually pays: a fixed price where one applies, otherwise the
 * menu's base price minus the campaign tier.
 * @returns {number|null} null when there is no price to work from.
 */
function studentPrice(campus, category, listedPrice) {
  const fixed = FIXED_STUDENT_PRICES[campus]?.[category];
  if (fixed !== undefined) return fixed;

  if (listedPrice === null || listedPrice === undefined || listedPrice === '') return null;
  const discount = STUDENT_DISCOUNT[campus]?.[category] ?? 0;
  return Number(listedPrice) - discount;
}

/** Whether a campus runs the discount campaign — drives the footer disclaimer. */
function hasStudentDiscount(campus) {
  return Object.values(STUDENT_DISCOUNT[campus] || {}).some((amount) => amount > 0);
}

module.exports = {
  POSTING_TIME,
  HOURS,
  NOTICES,
  STUDENT_DISCOUNT,
  FIXED_STUDENT_PRICES,
  hoursLine,
  buildFooter,
  studentPrice,
  hasStudentDiscount,
};
