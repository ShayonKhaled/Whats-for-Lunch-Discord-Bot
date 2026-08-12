const test = require('node:test');
const assert = require('node:assert');

const { buildOverview, STATUS } = require('../src/dashboard/overview');
const { parseEntries } = require('../src/dashboard/logTail');
const { datesBetween, shiftDate, dayName } = require('../src/utils/campusDate');

const TODAY = '2026-08-12'; // a Wednesday
const MONDAY = '2026-08-10';
const SATURDAY = '2026-08-08';

function sub(overrides = {}) {
  return {
    guild_id: '111',
    guild_name: 'Test Guild',
    channel_name: 'menus',
    campus: 'Uzumasa',
    is_active: true,
    subscribed_at: '2026-01-01',
    ...overrides,
  };
}

function delivery(overrides = {}) {
  return {
    guild_id: '111',
    guild_name: 'Test Guild',
    campus: 'Uzumasa',
    menu_date: MONDAY,
    status: 'success',
    error_message: null,
    delivered_at: '2026-08-09T21:00:05.000Z', // 06:00 JST on the 10th
    ...overrides,
  };
}

function overviewFor(dates, { subscriptions = [], menuCounts = [], deliveries = [] } = {}) {
  return buildOverview({ dates, today: TODAY, subscriptions, menuCounts, deliveries });
}

function dayOf(overview, date) {
  return overview.days.find((d) => d.date === date);
}

// ─── Day status ──────────────────────────────────────────────────────────────

test('a menu delivered to every subscriber is "delivered"', () => {
  const o = overviewFor([MONDAY], {
    subscriptions: [sub()],
    menuCounts: [{ menu_date: MONDAY, campus: 'Uzumasa', item_count: 12 }],
    deliveries: [delivery()],
  });
  assert.strictEqual(dayOf(o, MONDAY).status, STATUS.DELIVERED);
  assert.strictEqual(o.summary.delivered, 1);
});

// The failure mode this dashboard exists for: the menu was there, nobody got it.
test('a past weekday with a menu and no successful delivery is "failed"', () => {
  const o = overviewFor([MONDAY], {
    subscriptions: [sub()],
    menuCounts: [{ menu_date: MONDAY, campus: 'Uzumasa', item_count: 12 }],
    deliveries: [delivery({ status: 'failed', error_message: 'Channel not found' })],
  });
  assert.strictEqual(dayOf(o, MONDAY).status, STATUS.FAILED);
  assert.strictEqual(o.summary.failed, 1);
});

test('a menu that produced no delivery-log rows at all is "failed", not "no-menu"', () => {
  const o = overviewFor([MONDAY], {
    subscriptions: [sub()],
    menuCounts: [{ menu_date: MONDAY, campus: 'Uzumasa', item_count: 12 }],
    deliveries: [],
  });

  const day = dayOf(o, MONDAY);
  assert.strictEqual(day.status, STATUS.FAILED);

  // …and the silent guild is named rather than merely absent.
  const uzumasa = day.campuses.find((c) => c.campus === 'Uzumasa');
  assert.strictEqual(uzumasa.missingCount, 1);
  assert.strictEqual(uzumasa.deliveries[0].status, 'missing');
  assert.match(uzumasa.deliveries[0].errorMessage, /never reached this guild/);
});

test('some subscribers delivered and some not is "partial"', () => {
  const o = overviewFor([MONDAY], {
    subscriptions: [sub(), sub({ guild_id: '222', guild_name: 'Second' })],
    menuCounts: [{ menu_date: MONDAY, campus: 'Uzumasa', item_count: 12 }],
    deliveries: [
      delivery(),
      delivery({ guild_id: '222', status: 'failed', error_message: 'Missing SendMessages permission' }),
    ],
  });
  assert.strictEqual(dayOf(o, MONDAY).status, STATUS.PARTIAL);
});

// Zero deliveries with no menu is the cafeteria being closed — it must not be
// reported as a failure, or the dashboard cries wolf through every vacation.
test('a weekday with no menu rows is "no-menu", not "failed"', () => {
  const o = overviewFor([MONDAY], { subscriptions: [sub()] });
  assert.strictEqual(dayOf(o, MONDAY).status, STATUS.NO_MENU);
  assert.strictEqual(o.summary.failed, 0);
});

test('today with a menu and nothing delivered yet is "pending", not "failed"', () => {
  const o = overviewFor([TODAY], {
    subscriptions: [sub()],
    menuCounts: [{ menu_date: TODAY, campus: 'Uzumasa', item_count: 12 }],
  });
  assert.strictEqual(dayOf(o, TODAY).status, STATUS.PENDING);
  assert.strictEqual(dayOf(o, TODAY).isToday, true);
});

test('weekends are marked as such and excluded from the summary', () => {
  const o = overviewFor([SATURDAY], {
    subscriptions: [sub()],
    menuCounts: [{ menu_date: SATURDAY, campus: 'Uzumasa', item_count: 12 }],
  });
  assert.strictEqual(dayOf(o, SATURDAY).status, STATUS.WEEKEND);
  assert.strictEqual(o.summary.weekdays, 0);
});

test('a menu with nobody subscribed to that campus is "no-subscribers"', () => {
  const o = overviewFor([MONDAY], {
    subscriptions: [],
    menuCounts: [{ menu_date: MONDAY, campus: 'Kameoka', item_count: 9 }],
  });
  assert.strictEqual(dayOf(o, MONDAY).status, STATUS.NO_SUBSCRIBERS);
});

// ─── Expectation window ──────────────────────────────────────────────────────

test('a guild is not expected to have received menus from before it subscribed', () => {
  const o = overviewFor([MONDAY], {
    subscriptions: [sub({ subscribed_at: '2026-08-11' })], // subscribed the day after
    menuCounts: [{ menu_date: MONDAY, campus: 'Uzumasa', item_count: 12 }],
  });
  // No expectation, so this is not a failure — just a day nobody was signed up for.
  assert.strictEqual(dayOf(o, MONDAY).status, STATUS.NO_SUBSCRIBERS);
  assert.strictEqual(dayOf(o, MONDAY).campuses[0].missingCount, 0);
});

test('a Date-typed subscribed_at is handled as well as a string', () => {
  const o = overviewFor([MONDAY], {
    subscriptions: [sub({ subscribed_at: new Date('2026-01-01T00:00:00Z') })],
    menuCounts: [{ menu_date: MONDAY, campus: 'Uzumasa', item_count: 12 }],
    deliveries: [delivery()],
  });
  assert.strictEqual(dayOf(o, MONDAY).status, STATUS.DELIVERED);
});

// ─── Per-campus independence ─────────────────────────────────────────────────

test('campuses are evaluated separately and both appear on the day', () => {
  const o = overviewFor([MONDAY], {
    subscriptions: [sub(), sub({ guild_id: '333', guild_name: 'Kameoka Guild', campus: 'Kameoka' })],
    menuCounts: [
      { menu_date: MONDAY, campus: 'Uzumasa', item_count: 12 },
      { menu_date: MONDAY, campus: 'Kameoka', item_count: 8 },
    ],
    deliveries: [
      delivery(),
      delivery({ guild_id: '333', campus: 'Kameoka', status: 'skipped', error_message: 'No menu published for this date' }),
    ],
  });

  const day = dayOf(o, MONDAY);
  assert.deepStrictEqual(o.campuses, ['Kameoka', 'Uzumasa']);
  assert.strictEqual(day.status, STATUS.PARTIAL);
  assert.strictEqual(day.totalItems, 20);
  assert.strictEqual(day.campuses.find((c) => c.campus === 'Kameoka').skippedCount, 1);
});

// ─── Timestamps ──────────────────────────────────────────────────────────────

test('firstDeliveredAt is the earliest successful post, ignoring failures', () => {
  const o = overviewFor([MONDAY], {
    subscriptions: [sub(), sub({ guild_id: '222', guild_name: 'Second' })],
    menuCounts: [{ menu_date: MONDAY, campus: 'Uzumasa', item_count: 12 }],
    deliveries: [
      delivery({ delivered_at: '2026-08-09T21:00:09.000Z' }),
      delivery({ guild_id: '222', delivered_at: '2026-08-09T21:00:02.000Z' }),
      delivery({ guild_id: '444', status: 'failed', delivered_at: '2026-08-09T20:00:00.000Z' }),
    ],
  });
  assert.strictEqual(dayOf(o, MONDAY).firstDeliveredAt, '2026-08-09T21:00:02.000Z');
});

test('a delivery from a guild no longer in guild_subscriptions still shows up', () => {
  const o = overviewFor([MONDAY], {
    subscriptions: [],
    menuCounts: [{ menu_date: MONDAY, campus: 'Uzumasa', item_count: 12 }],
    deliveries: [delivery({ guild_id: '999', guild_name: null })],
  });
  const row = dayOf(o, MONDAY).campuses[0].deliveries[0];
  assert.match(row.guildName, /Unknown guild \(999\)/);
});

// ─── Date helpers ────────────────────────────────────────────────────────────

test('datesBetween is inclusive at both ends and includes weekends', () => {
  assert.deepStrictEqual(datesBetween('2026-08-07', '2026-08-10'), [
    '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10',
  ]);
});

test('datesBetween crosses a month boundary', () => {
  assert.deepStrictEqual(datesBetween('2026-07-30', '2026-08-02'), [
    '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02',
  ]);
});

test('shiftDate moves backwards across a month boundary', () => {
  assert.strictEqual(shiftDate('2026-08-02', -3), '2026-07-30');
  assert.strictEqual(shiftDate(TODAY, 0), TODAY);
});

test('dayName resolves as a plain calendar date, not local time', () => {
  assert.strictEqual(dayName('2026-08-12'), 'Wednesday');
  assert.strictEqual(dayName('2026-08-08'), 'Saturday');
});

// ─── Log parsing ─────────────────────────────────────────────────────────────

test('log entries are split on the timestamp prefix', () => {
  const entries = parseEntries(
    '2026-08-12 04:10:33 [INFO] Bot is online\n' +
    '2026-08-12 04:11:00 [ERROR] Publisher job error: boom\n'
  );
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[1].level, 'ERROR');
  assert.strictEqual(entries[1].message, 'Publisher job error: boom');
});

test('stack-trace continuation lines attach to the entry above them', () => {
  const entries = parseEntries(
    '2026-08-12 04:11:00 [ERROR] Publisher job error: boom\n' +
    '    at publishMenu (/src/publishers/menuPublisher.js:20:5)\n' +
    '    at process.run (node:internal/main:1:1)\n'
  );
  assert.strictEqual(entries.length, 1);
  assert.match(entries[0].message, /at publishMenu/);
  assert.match(entries[0].message, /at process\.run/);
});
