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
// tickets and service both at 11:30 AM, closing 1:30 PM. Ticket sales moved to
// 10:00 AM in November 2026 while service still opens at 11:00 — the two are
// separate numbers on purpose, students buy early and eat when the kitchen opens.
const HOURS = {
  ticketsFrom: '10:00 AM',
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
 * Two campaigns stack on Uzumasa's main dishes:
 *   - The Student Guardian Association's: 100 yen off lunch and à la carte,
 *     50 yen off curry and noodles, nothing off sides.
 *   - Kyoto Prefecture's subsidy, running since 2026-11: a further 70 yen off
 *     every main dish. Side dishes are ¥70 and would come out free, and Halal is
 *     a flat price at the payment machine, so neither takes the subsidy.
 *
 * The totals below are what a student pays less than the listed price. They were
 * verified against the 2026-08-18 PDF, where the listed price minus the tier
 * reproduced every price this bot had hardcoded (¥430→330→260, ¥380→330→260,
 * ¥300→250→180, ¥250→200→130, ¥70→70).
 *
 * Note the PDF prints TWO prices for Set Meals and A La Carte (e.g. 430 above
 * 500). The lower is the visitor/staff price — confirmed at the cafeteria: a
 * set meal is ¥430 for visitors and staff, and students pay ¥260 after both
 * campaigns. The scraper is instructed to take the lower of the two; what the
 * higher figure represents is still unknown, but it is never used. Curry, Ramen
 * and Udon/Soba print a single price.
 *
 * Halal is not derived at all — it is a flat ¥400, see FIXED_STUDENT_PRICES.
 *
 * Kameoka does not run either campaign, so its printed price is already what a
 * student pays — every tier there is zero.
 *
 * Keyed by the `category` column in menu_items. A category with no entry is
 * treated as undiscounted.
 */
const ASSOCIATION_OFF = {
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

/** Kyoto Prefecture's subsidy, per campus. Kameoka does not take part. */
const PREFECTURE_SUBSIDY = { Uzumasa: 70, Kameoka: 0 };

/** Categories the subsidy does not touch: ¥70 sides, and the flat-price Halal. */
const SUBSIDY_EXEMPT = new Set(['Sides', 'Halal']);

/** Association tier plus the prefecture subsidy where it applies. */
function addSubsidy(campus, tiers) {
  const subsidy = PREFECTURE_SUBSIDY[campus] || 0;
  const out = {};
  for (const [category, amount] of Object.entries(tiers)) {
    out[category] = SUBSIDY_EXEMPT.has(category) ? amount : amount + subsidy;
  }
  return out;
}

const STUDENT_DISCOUNT = {
  Uzumasa: addSubsidy('Uzumasa', ASSOCIATION_OFF.Uzumasa),
  Kameoka: addSubsidy('Kameoka', ASSOCIATION_OFF.Kameoka),
};

/**
 * Categories charged a flat price that does not follow the discount tiers.
 *
 * Uzumasa Halal is ¥400 at the payment machine regardless of the campaign
 * (confirmed at the cafeteria itself).
 *
 * Kameoka main categories use fixed student prices confirmed at the cafeteria
 * (Set A/B ¥330, Live Kitchen ¥280, Curry ¥230, Ramen ¥230, Udon & Soba ¥130).
 * Side dishes remain untouched so their scraped/listed price passes through.
 */
const FIXED_STUDENT_PRICES = {
  Uzumasa: {
    Halal: 400,
  },
  Kameoka: {
    Set: 330,
    'Live Kitchen': 280,
    Curry: 230,
    Ramen: 230,
    Noodles: 130,
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
