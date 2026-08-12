const CAMPUS_TZ = 'Asia/Tokyo';

// The publisher runs at 6:00 AM JST, which is 21:00 UTC the *previous* day.
// Anything that means "the menu for today" must therefore be resolved in the
// campus timezone — `new Date().toISOString()` and Postgres' `CURRENT_DATE`
// (the DB runs in UTC) both return yesterday at that hour.
function todayCampus(now = new Date()) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: CAMPUS_TZ }).format(now);
}

// menu_date is a varchar holding YYYY-MM-DD, so parse it as a plain calendar
// date in UTC — never local time, which would shift the day either side of midnight.
function parseDate(dateText) {
  const [y, m, d] = dateText.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isWeekday(dateText) {
  const day = parseDate(dateText).getUTCDay();
  return day >= 1 && day <= 5;
}

/** Weekdays strictly between two YYYY-MM-DD dates, exclusive at both ends. */
function weekdaysBetween(afterDate, beforeDate) {
  const days = [];
  const cursor = parseDate(afterDate);
  const end = parseDate(beforeDate);

  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor < end) {
    const dateText = cursor.toISOString().split('T')[0];
    if (isWeekday(dateText)) days.push(dateText);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Every calendar date from `fromDate` to `toDate`, inclusive at both ends,
 * weekends included. Unlike weekdaysBetween this is for *display* — the
 * dashboard shows a continuous run of days so a missing weekday is visible as
 * a gap in a sequence rather than an absence you have to notice.
 */
function datesBetween(fromDate, toDate) {
  const days = [];
  const cursor = parseDate(fromDate);
  const end = parseDate(toDate);

  while (cursor <= end) {
    days.push(cursor.toISOString().split('T')[0]);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** YYYY-MM-DD `offset` days from `dateText` (negative goes back). */
function shiftDate(dateText, offset) {
  const d = parseDate(dateText);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().split('T')[0];
}

/** Weekday name for a YYYY-MM-DD date, resolved as a plain calendar date. */
function dayName(dateText) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(
    parseDate(dateText)
  );
}

module.exports = {
  CAMPUS_TZ,
  todayCampus,
  isWeekday,
  weekdaysBetween,
  datesBetween,
  shiftDate,
  dayName,
};
