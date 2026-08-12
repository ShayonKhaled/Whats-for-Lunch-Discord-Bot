const test = require('node:test');
const assert = require('node:assert');

const { todayCampus, isWeekday, weekdaysBetween } = require('../src/utils/campusDate');

// The publisher fires at 6:00 AM JST = 21:00 UTC the previous day. Resolving
// "today" in UTC there returns yesterday, which is what silently blocked every
// delivery after 2026-08-06 — these cases pin that boundary down.
test('todayCampus resolves the date in JST, not UTC', async (t) => {
  const cases = [
    ['2026-08-12T21:00:00Z', '2026-08-13', '6 AM JST — the hour that broke posting'],
    ['2026-08-12T00:00:00Z', '2026-08-12', '9 AM JST — the old schedule'],
    ['2026-08-12T14:59:59Z', '2026-08-12', '11:59 PM JST'],
    ['2026-08-12T15:00:00Z', '2026-08-13', 'midnight JST'],
    ['2026-12-31T21:00:00Z', '2027-01-01', 'year rollover'],
  ];

  for (const [instant, expected, label] of cases) {
    await t.test(label, () => {
      assert.strictEqual(todayCampus(new Date(instant)), expected);
    });
  }
});

test('todayCampus returns a YYYY-MM-DD string', () => {
  assert.match(todayCampus(), /^\d{4}-\d{2}-\d{2}$/);
});

test('isWeekday distinguishes weekdays from weekends', () => {
  assert.strictEqual(isWeekday('2026-08-10'), true, 'Monday');
  assert.strictEqual(isWeekday('2026-08-14'), true, 'Friday');
  assert.strictEqual(isWeekday('2026-08-15'), false, 'Saturday');
  assert.strictEqual(isWeekday('2026-08-16'), false, 'Sunday');
});

test('isWeekday is not affected by the host timezone', () => {
  // A plain calendar date must never shift, whatever TZ the process runs in.
  const original = process.env.TZ;
  try {
    for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
      process.env.TZ = tz;
      assert.strictEqual(isWeekday('2026-08-15'), false, `Saturday in ${tz}`);
      assert.strictEqual(isWeekday('2026-08-17'), true, `Monday in ${tz}`);
    }
  } finally {
    process.env.TZ = original;
  }
});

test('weekdaysBetween lists closed weekdays, exclusive at both ends', () => {
  // The Aug 2026 cafeteria closure: Wed 12th, reopening Tue 18th.
  assert.deepStrictEqual(
    weekdaysBetween('2026-08-12', '2026-08-18'),
    ['2026-08-13', '2026-08-14', '2026-08-17']
  );
});

test('weekdaysBetween treats consecutive weekdays as no gap', () => {
  assert.deepStrictEqual(weekdaysBetween('2026-08-03', '2026-08-04'), []);
});

test('weekdaysBetween does not count a weekend as a closure', () => {
  // Friday to Monday: the cafeteria is not "closed", it is simply the weekend.
  assert.deepStrictEqual(weekdaysBetween('2026-08-07', '2026-08-10'), []);
});

test('weekdaysBetween spans month and year boundaries', () => {
  assert.deepStrictEqual(weekdaysBetween('2026-12-31', '2027-01-04'), ['2027-01-01']);
  assert.deepStrictEqual(
    weekdaysBetween('2026-07-30', '2026-08-04'),
    ['2026-07-31', '2026-08-03']
  );
});

test('weekdaysBetween returns empty when the range is inverted or empty', () => {
  assert.deepStrictEqual(weekdaysBetween('2026-08-18', '2026-08-12'), []);
  assert.deepStrictEqual(weekdaysBetween('2026-08-12', '2026-08-12'), []);
});
