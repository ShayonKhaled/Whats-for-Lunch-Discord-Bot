const test = require('node:test');
const assert = require('node:assert');
const { mock } = require('node:test');

const db = require('../src/db');
const uptimeKuma = require('../src/utils/uptimeKuma');
const { publishMenu } = require('../src/publishers/menuPublisher');

const PUSH_URL = 'https://uptime.example/api/push/token';

/** Capture Uptime Kuma pushes and return the parsed status/msg of the last one. */
function capturePush() {
  const urls = [];
  mock.method(uptimeKuma, 'push', async (url) => {
    urls.push(url);
  });
  return {
    urls,
    last() {
      if (urls.length === 0) return null;
      const parsed = new URL(urls[urls.length - 1]);
      return {
        status: parsed.searchParams.get('status'),
        msg: parsed.searchParams.get('msg'),
      };
    },
  };
}

// 21:00 UTC on the 12th is 06:00 JST on the 13th — the exact instant the
// scheduler fires, and the instant at which the old UTC-based code resolved
// "today" to the previous day and skipped every guild.
const SIX_AM_JST = new Date('2026-08-12T21:00:00Z');
const JST_DATE = '2026-08-13';
const UTC_DATE = '2026-08-12';

function subscription(overrides = {}) {
  return {
    guild_id: '111',
    guild_name: 'Test Guild',
    channel_id: '222',
    campus: 'Uzumasa',
    role_id: null,
    ...overrides,
  };
}

function menuItem(overrides = {}) {
  return {
    campus: 'Uzumasa',
    menu_date: JST_DATE,
    day_name: 'Thursday',
    category: 'Set Meals',
    subcategory: 'Campus Lunch (1)',
    dish_name: 'Beef Cutlet',
    calories: 498,
    ...overrides,
  };
}

/** A Discord client stub that records what would have been sent. */
function makeClient({ channelMissing = false, canSend = true } = {}) {
  const sent = [];
  const me = {};
  const channel = {
    name: 'lunch',
    guild: { members: { me } },
    permissionsFor: () => ({ has: () => canSend }),
    send: async (payload) => {
      sent.push(payload);
    },
  };
  return {
    sent,
    client: {
      channels: { fetch: async () => (channelMissing ? null : channel) },
      users: { fetch: async () => null },
    },
  };
}

/** Install the default happy-path database mocks. Returns recorded calls. */
function mockDb({ alreadySent = false, items = [menuItem()], subs = [subscription()] } = {}) {
  const calls = { deliveryChecks: [], logged: [] };

  mock.method(db, 'getActiveSubscriptions', async () => subs);
  mock.method(db, 'getTodayMenu', async () => items);
  mock.method(db, 'getRatingsForDishes', async () => new Map());
  mock.method(db, 'hasSuccessfulDelivery', async (guildId, campus, menuDate) => {
    calls.deliveryChecks.push({ guildId, campus, menuDate });
    return alreadySent;
  });
  mock.method(db, 'logDelivery', async (guildId, channelId, campus, menuDate, status, error) => {
    calls.logged.push({ guildId, campus, menuDate, status, error });
  });

  return calls;
}

test.beforeEach(() => {
  mock.timers.enable({ apis: ['Date'], now: SIX_AM_JST.getTime() });
  delete process.env.UPTIME_KUMA_MENU_PUSH_URL;
  delete process.env.BOT_ADMIN_ID;
});

test.afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test('at 6 AM JST the duplicate guard is checked against the JST date', async () => {
  const calls = mockDb();
  const { client } = makeClient();

  await publishMenu(client);

  assert.strictEqual(calls.deliveryChecks.length, 1);
  assert.strictEqual(
    calls.deliveryChecks[0].menuDate,
    JST_DATE,
    `must ask about ${JST_DATE}; asking about ${UTC_DATE} is the bug that skipped every guild`
  );
});

test('the delivery is logged against the JST date too', async () => {
  const calls = mockDb();
  const { client } = makeClient();

  await publishMenu(client);

  assert.deepStrictEqual(calls.logged, [
    { guildId: '111', campus: 'Uzumasa', menuDate: JST_DATE, status: 'success', error: null },
  ]);
});

test('a menu is actually sent when nothing was delivered yet', async () => {
  mockDb({ alreadySent: false });
  const { client, sent } = makeClient();

  await publishMenu(client);

  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].content, /Beef Cutlet/);
  assert.ok(sent[0].components?.length, 'the rating button should be attached');
});

test('a guild already delivered today is skipped without re-sending', async () => {
  mockDb({ alreadySent: true });
  const { client, sent } = makeClient();

  await publishMenu(client);

  assert.strictEqual(sent.length, 0);
});

test('the rating button is keyed to the JST date', async () => {
  mockDb();
  const { client, sent } = makeClient();

  await publishMenu(client);

  const customId = sent[0].components[0].components[0].data.custom_id;
  assert.strictEqual(customId, `rate_menu_open:Uzumasa:${JST_DATE}`);
});

test('a missing channel is logged as failed rather than throwing', async () => {
  const calls = mockDb();
  const { client } = makeClient({ channelMissing: true });

  await publishMenu(client);

  assert.strictEqual(calls.logged.length, 1);
  assert.strictEqual(calls.logged[0].status, 'failed');
  assert.match(calls.logged[0].error, /Channel not found/);
});

test('missing send permission is logged as failed', async () => {
  const calls = mockDb();
  const { client, sent } = makeClient({ canSend: false });

  await publishMenu(client);

  assert.strictEqual(sent.length, 0);
  assert.strictEqual(calls.logged[0].status, 'failed');
  assert.match(calls.logged[0].error, /permission/i);
});

test('each campus is delivered independently', async () => {
  const calls = mockDb({
    subs: [
      subscription({ guild_id: '111', campus: 'Uzumasa' }),
      subscription({ guild_id: '222', campus: 'Kameoka' }),
    ],
  });
  const { client, sent } = makeClient();

  await publishMenu(client);

  assert.strictEqual(sent.length, 2);
  assert.deepStrictEqual(
    calls.logged.map((l) => l.campus).sort(),
    ['Kameoka', 'Uzumasa']
  );
});

test('a campus with no menu records a skipped row per subscriber', async () => {
  const calls = mockDb({
    items: [],
    subs: [
      subscription({ guild_id: '111' }),
      subscription({ guild_id: '222' }),
    ],
  });
  const { client, sent } = makeClient();

  await publishMenu(client);

  assert.strictEqual(sent.length, 0, 'nothing to send');
  assert.strictEqual(calls.deliveryChecks.length, 0, 'no point checking for duplicates');

  // Without these rows a silent no-post day is indistinguishable from the
  // publisher never having run — which is what hid the August outage.
  assert.strictEqual(calls.logged.length, 2);
  for (const row of calls.logged) {
    assert.strictEqual(row.status, 'skipped');
    assert.strictEqual(row.menuDate, JST_DATE);
    assert.match(row.error, /No menu published/i);
  }
});

// ── Uptime Kuma signalling ───────────────────────────────────────────────────
// Reporting "up" unconditionally is what let five days of zero deliveries look
// healthy. The status must now reflect the outcome — without paging during a
// legitimate cafeteria closure.

test('reports up when menus are delivered', async () => {
  process.env.UPTIME_KUMA_MENU_PUSH_URL = PUSH_URL;
  mockDb();
  const push = capturePush();
  const { client } = makeClient();

  await publishMenu(client);

  assert.strictEqual(push.last().status, 'up');
  assert.match(push.last().msg, /1 sent/);
});

test('reports DOWN when a menu existed but nothing was delivered', async () => {
  // The August failure exactly: menu present, duplicate guard skipped everyone.
  process.env.UPTIME_KUMA_MENU_PUSH_URL = PUSH_URL;
  mockDb({ alreadySent: true });
  const push = capturePush();
  const { client } = makeClient();

  await publishMenu(client);

  assert.strictEqual(push.last().status, 'down', 'a published menu reaching nobody is a failure');
  assert.match(push.last().msg, /0 delivered/);
});

test('reports up — not down — when the cafeteria is simply closed', async () => {
  // No menu published means zero deliveries is correct. Paging here would have
  // meant a week of false alarms over the August closure.
  process.env.UPTIME_KUMA_MENU_PUSH_URL = PUSH_URL;
  mockDb({ items: [] });
  const push = capturePush();
  const { client } = makeClient();

  await publishMenu(client);

  assert.strictEqual(push.last().status, 'up');
  assert.match(push.last().msg, /closed/i);
});

test('reports down when every guild fails to receive the menu', async () => {
  process.env.UPTIME_KUMA_MENU_PUSH_URL = PUSH_URL;
  mockDb();
  const push = capturePush();
  const { client } = makeClient({ channelMissing: true });

  await publishMenu(client);

  assert.strictEqual(push.last().status, 'down');
});

test('no ping is attempted when no push URL is configured', async () => {
  delete process.env.UPTIME_KUMA_MENU_PUSH_URL;
  mockDb();
  const push = capturePush();
  const { client } = makeClient();

  await publishMenu(client);

  assert.strictEqual(push.urls.length, 0);
});

test('a publisher error does not reject — it is caught and logged', async () => {
  mock.method(db, 'getActiveSubscriptions', async () => {
    throw new Error('database is down');
  });
  const { client } = makeClient();

  await assert.doesNotReject(() => publishMenu(client));
});
