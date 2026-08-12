/**
 * src/config/cafeteria.js
 *
 * Operating details that change with the university calendar rather than with
 * the code. Previously these were string literals scattered across formatMenu,
 * notify, subscribe and status, so a schedule change meant editing several
 * files and shipping a release — twice in one day, on 2026-08-12.
 *
 * Editing this file is the whole change.
 */

// When the publisher posts. Must stay in step with the cron rule in
// menuPublisher.start() — this is the human-readable half of that.
const POSTING_TIME = '6:00 AM JST';

const HOURS = {
  ticketsFrom: '11:30 AM',
  opens: '11:30 AM',
  closes: '1:30 PM',
};

/**
 * Notices appended to every menu, in order. Set to [] when the cafeteria
 * returns to its normal schedule.
 */
const NOTICES = [
  'Please note that the cafeteria is operating on a reduced schedule during the vacation period.',
];

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
 * 500); the lower is the base price, and the scraper is instructed to take it.
 * Curry, Ramen and Udon/Soba print a single price.
 *
 * Halal is UNVERIFIED — it is not served until September, so no halal row has
 * ever carried a listed price. Its student price is known to be ¥400, which the
 * fallback table supplies. When halal returns, check that the scraped base minus
 * 100 still lands on 400 before trusting the derived value.
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
    Halal: 100,
    Curry: 50,
    Noodles: 50,
    Sides: 0,
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
 * Convert a listed (visitor) price into what a student actually pays.
 * @returns {number|null} null when there is no listed price to work from.
 */
function studentPrice(campus, category, listedPrice) {
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
  hoursLine,
  buildFooter,
  studentPrice,
  hasStudentDiscount,
};
