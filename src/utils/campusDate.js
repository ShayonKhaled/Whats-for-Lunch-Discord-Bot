const CAMPUS_TZ = 'Asia/Tokyo';

// The publisher runs at 6:00 AM JST, which is 21:00 UTC the *previous* day.
// Anything that means "the menu for today" must therefore be resolved in the
// campus timezone — `new Date().toISOString()` and Postgres' `CURRENT_DATE`
// (the DB runs in UTC) both return yesterday at that hour.
function todayCampus(now = new Date()) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: CAMPUS_TZ }).format(now);
}

module.exports = { CAMPUS_TZ, todayCampus };
