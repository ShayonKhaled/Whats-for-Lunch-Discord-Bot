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

module.exports = { POSTING_TIME, HOURS, NOTICES, hoursLine, buildFooter };
