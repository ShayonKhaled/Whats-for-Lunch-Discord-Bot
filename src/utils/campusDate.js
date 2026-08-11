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

module.exports = { CAMPUS_TZ, todayCampus, isWeekday, weekdaysBetween };
