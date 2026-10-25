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
  const dms = [];
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
    dms,
    client: {
      channels: { fetch: async () => (channelMissing ? null : channel) },
      users: {
        fetch: async () => ({
          send: async (payload) => {
            dms.push(payload);
          },
        }),
      },
    },
  };
}

/** Install the default happy-path database mocks. Returns recorded calls. */
function mockDb({ alreadySent = false, items = [menuItem()], subs = [subscription()], repair = null, repairError = null, lastKnownPrices = new Map() } = {}) {
  const calls = { deliveryChecks: [], logged: [], repairs: [] };

  mock.method(db, 'getActiveSubscriptions', async () => subs);
  mock.method(db, 'getTodayMenu', async () => items);
  // Recorded with a snapshot of how many menus had been read by this point, so a
  // test can prove the repair runs before the reads rather than after them.
  mock.method(db, 'repairUnknownCampus', async (from, to) => {
    calls.repairs.push({ from, to, menusReadSoFar: db.getTodayMenu.mock.calls.length });
    if (repairError) throw new Error(repairError);
    return { examined: 0, groups: [], relabelled: 0, deleted: 0, skipped: 0, ...(repair || {}) };
  });
  mock.method(db, 'getRatingsForDishes', async () => new Map());
  mock.method(db, 'getLastKnownPrices', async () => lastKnownPrices);
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

// ── Mislabelled campus rows ──────────────────────────────────────────────────
// Twice in October 2026 the scraper filed Kameoka's week under campus 'Unknown'.
// The bot matches campus exactly, so those runs sent Uzumasa only — silently,
// with every other signal green. The publish now repairs the labels first and
// tells the admin it had to, so the upstream bug stays visible.

test('repairs mislabelled campus rows before reading any menu', async () => {
  const calls = mockDb({ repair: { relabelled: 55, skipped: 0 } });
  const { client } = makeClient();

  await publishMenu(client);

  assert.strictEqual(calls.repairs.length, 1, 'the repair runs once per publish');
  assert.strictEqual(calls.repairs[0].from, JST_DATE);
  // A whole week, not just today: the scrape writes Mon-Fri in one go, so
  // repairing today alone leaves the rest of the week under 'Unknown' until each
  // morning's post — the dashboard and /nextmenu show it as missing until then.
  assert.strictEqual(
    calls.repairs[0].to,
    '2026-08-20',
    'the repair must cover the week ahead, not just today'
  );
  assert.strictEqual(
    calls.repairs[0].menusReadSoFar,
    0,
    'repairing after the menu read would leave the same run still missing Kameoka'
  );
});

test('a repair is reported to the admin even when every menu went out', async () => {
  process.env.BOT_ADMIN_ID = '999';
  mockDb({ repair: { relabelled: 55, deleted: 2 } });
  const { client, sent, dms } = makeClient();

  await publishMenu(client);

  assert.strictEqual(sent.length, 1, 'the menu still goes out');
  assert.strictEqual(dms.length, 1, 'and the scraper problem is reported');
  assert.match(dms[0].content, /55 row\(s\)/);
  assert.match(dms[0].content, /n8n parser/);
});

test('rows whose campus cannot be proven are left alone, not guessed at', async () => {
  const calls = mockDb({ repair: { relabelled: 0, skipped: 11 } });
  const { client, sent } = makeClient();

  await publishMenu(client);

  assert.strictEqual(sent.length, 1, 'an unprovable label must not block the publish');
  assert.ok(calls.repairs.length === 1);
});

test('a refused label is reported with the reason, because only a human can fix it', async () => {
  // The bot could not decide, so the day's Kameoka menu is missing. The admin
  // needs the evidence the classifier saw — the categories and slots — to tell
  // whether the pipeline is writing the wrong campus or the wrong category.
  process.env.BOT_ADMIN_ID = '999';
  mockDb({
    repair: {
      relabelled: 0,
      skipped: 11,
      groups: [
        {
          date: JST_DATE,
          rows: 11,
          campus: null,
          reason: 'only shared categories (Curry, Ramen) and slot(s) (Curry|||Curry) — no positive Kameoka evidence',
        },
      ],
    },
  });
  const { client, dms } = makeClient();

  await publishMenu(client);

  assert.strictEqual(dms.length, 1, 'the missing menu must not be silent');
  assert.match(dms[0].content, /could not be repaired/);
  assert.match(dms[0].content, new RegExp(`${JST_DATE}: 11 row\\(s\\)`));
  assert.match(dms[0].content, /Curry\|\|\|Curry/);
  assert.doesNotMatch(dms[0].content, /relabelled to Kameoka/, 'it must not claim a repair it did not make');
});

test('a failing repair does not stop the publish', async () => {
  mockDb({ repairError: 'permission denied for table menu_items' });
  const { client, sent } = makeClient();

  await publishMenu(client);

  assert.strictEqual(sent.length, 1, 'the menu matters more than the repair');
});

test('a manual run does not page anyone when everyone already has today', async () => {
  // The dashboard's re-publish button is a *retry*: after a good day, every
  // guild is skipped and the run looks exactly like the August outage from the
  // inside. Alerting on that would page the admin every time the button worked.
  process.env.UPTIME_KUMA_MENU_PUSH_URL = PUSH_URL;
  process.env.BOT_ADMIN_ID = '999';
  mockDb({ alreadySent: true });
  const push = capturePush();
  const { client, dms } = makeClient();

  await publishMenu(client, { manual: true });

  assert.strictEqual(push.urls.length, 0, 'no health signal from a manual run');
  assert.strictEqual(dms.length, 0, 'and no admin DM');
});

test('the scheduled run keeps the signal a manual run suppresses', async () => {
  process.env.UPTIME_KUMA_MENU_PUSH_URL = PUSH_URL;
  process.env.BOT_ADMIN_ID = '999';
  mockDb({ alreadySent: true });
  const push = capturePush();
  const { client, dms } = makeClient();

  await publishMenu(client);

  assert.strictEqual(push.last().status, 'down', 'the unattended run still reports');
  assert.strictEqual(dms.length, 1, 'and still wakes someone up');
});

// ── Prices the scraper dropped ───────────────────────────────────────────────
// Weeks of 2026-10-05 and 2026-10-12 arrived with every price NULL, so Kameoka
// menus posted with no ¥ figures at all. The publisher hands the formatter the
// last prices that were actually scraped.

test('the menu carries a price even when the scrape dropped it', async () => {
  mockDb({
    subs: [subscription({ campus: 'Kameoka' })],
    items: [menuItem({ campus: 'Kameoka', category: 'Curry', subcategory: 'A', dish_name: 'Original Curry', price: null })],
    lastKnownPrices: new Map([['Curry|||A', 350]]),
  });
  const { client, sent } = makeClient();

  await publishMenu(client);

  assert.match(sent[0].content, /¥350/, 'a priceless week must still show prices');
});
