const test = require('node:test');
const assert = require('node:assert');
const { mock } = require('node:test');

const dispatchCommand = require('../src/commands/dispatch');
const menuPublisher = require('../src/publishers/menuPublisher');
const server = require('../src/server');
const db = require('../src/db');

function makeInteraction({
  subcommand = 'send',
  roleIds = ['1312000457077686304'],
  options = {},
} = {}) {
  let replied = null;
  let edited = null;
  return {
    inGuild: () => true,
    guildId: '100',
    guild: { name: 'KUAS Discord Server' },
    user: { id: '747445428731117679', username: 'JB', tag: 'JB#0001' },
    member: {
      id: '747445428731117679',
      displayName: 'JB',
      roles: { cache: new Map(roleIds.map((id) => [id, { id }])) },
    },
    client: {
      isReady: () => true,
      ws: { ping: 32 },
      guilds: { cache: new Map() },
    },
    options: {
      getSubcommand: () => subcommand,
      getString: (name) => options[name] ?? null,
      getChannel: (name) => options[name] ?? null,
      getBoolean: (name) => options[name] ?? null,
    },
    reply: async (payload) => { replied = payload; },
    deferReply: async () => {},
    editReply: async (payload) => { edited = payload; },
    get replied() { return replied; },
    get edited() { return edited; },
  };
}

test('/dispatch rejects users without the configured DASHBOARD_ADMIN_ROLE_ID', async () => {
  const prevRole = process.env.DASHBOARD_ADMIN_ROLE_ID;
  const prevAdmin = process.env.BOT_ADMIN_ID;
  process.env.DASHBOARD_ADMIN_ROLE_ID = '1312000457077686304';
  delete process.env.BOT_ADMIN_ID;

  try {
    const ix = makeInteraction({ subcommand: 'status', roleIds: [] });
    await dispatchCommand.execute(ix);
    assert.match(ix.replied.content, /Access Denied/);
    assert.match(ix.replied.content, /1312000457077686304/);
  } finally {
    if (prevRole === undefined) delete process.env.DASHBOARD_ADMIN_ROLE_ID;
    else process.env.DASHBOARD_ADMIN_ROLE_ID = prevRole;
    if (prevAdmin === undefined) delete process.env.BOT_ADMIN_ID;
    else process.env.BOT_ADMIN_ID = prevAdmin;
  }
});

test('/dispatch send forwards campus, date, channel, and force options to publishMenu', async () => {
  const prevRole = process.env.DASHBOARD_ADMIN_ROLE_ID;
  process.env.DASHBOARD_ADMIN_ROLE_ID = '1312000457077686304';

  let capturedOpts = null;
  mock.method(menuPublisher, 'publishMenu', async (_client, opts) => {
    capturedOpts = opts;
    return { date: '2026-11-25', sent: 1, skipped: 0, failed: 0, anyMenuAvailable: true };
  });

  try {
    const ix = makeInteraction({
      subcommand: 'send',
      options: {
        campus: 'Kameoka',
        date: '2026-11-25',
        channel: { id: '1504156220193440882' },
        force: true,
      },
    });
    await dispatchCommand.execute(ix);

    assert.deepStrictEqual(capturedOpts, {
      manual: true,
      campus: 'Kameoka',
      channelId: '1504156220193440882',
      date: '2026-11-25',
      force: true,
    });
    assert.match(ix.edited.content, /Manual Dispatch Sent/);
    assert.match(ix.edited.content, /1 sent/);
    assert.match(ix.edited.content, /2026-11-25/);
  } finally {
    mock.restoreAll();
    if (prevRole === undefined) delete process.env.DASHBOARD_ADMIN_ROLE_ID;
    else process.env.DASHBOARD_ADMIN_ROLE_ID = prevRole;
  }
});

test('/dispatch send rejects malformed dates', async () => {
  const prevRole = process.env.DASHBOARD_ADMIN_ROLE_ID;
  process.env.DASHBOARD_ADMIN_ROLE_ID = '1312000457077686304';

  try {
    const ix = makeInteraction({
      subcommand: 'send',
      options: { date: '25-11-2026' },
    });
    await dispatchCommand.execute(ix);
    assert.match(ix.replied.content, /Invalid date/);
  } finally {
    if (prevRole === undefined) delete process.env.DASHBOARD_ADMIN_ROLE_ID;
    else process.env.DASHBOARD_ADMIN_ROLE_ID = prevRole;
  }
});

test('/dispatch status displays live DB, Discord, and channel status ephemerally', async () => {
  const prevRole = process.env.DASHBOARD_ADMIN_ROLE_ID;
  process.env.DASHBOARD_ADMIN_ROLE_ID = '1312000457077686304';

  mock.method(server, 'buildStatus', async () => ({
    healthy: true,
    databaseConnected: true,
    dbLatencyMs: 4,
    dbPool: { totalCount: 2, idleCount: 1 },
    discordConnected: true,
    wsPingMs: 31,
    guilds: 1,
    uptimeSeconds: 7200,
    host: { rssMb: 64 },
    scheduler: { postingTime: '6:00 AM JST' },
    lastDelivery: { menuDate: '2026-11-25' },
    pipelineHorizon: [{ campus: 'Kameoka', latestDate: '2026-12-04', upcomingDays: 7, upcomingItems: 63 }],
  }));
  mock.method(db, 'getActiveSubscriptions', async () => [
    { guild_id: '100', guild_name: 'KUAS Discord Server', channel_id: '1504156157600600197', channel_name: 'cafeteria-uzumasa', campus: 'Uzumasa' },
  ]);
  mock.method(server, 'inspectSubscriptionConnection', () => ({
    campus: 'Uzumasa',
    channelId: '1504156157600600197',
    canSend: true,
    connectionDetail: 'Connected & permitted to post',
  }));

  try {
    const ix = makeInteraction({ subcommand: 'status' });
    await dispatchCommand.execute(ix);
    assert.match(ix.edited.content, /Bot & Server Status/);
    assert.match(ix.edited.content, /4 ms/);
    assert.match(ix.edited.content, /31 ms WS/);
    assert.match(ix.edited.content, /1504156157600600197/);
  } finally {
    mock.restoreAll();
    if (prevRole === undefined) delete process.env.DASHBOARD_ADMIN_ROLE_ID;
    else process.env.DASHBOARD_ADMIN_ROLE_ID = prevRole;
  }
});

test('/dispatch check runs pipeline health check and repairs when repair=true', async () => {
  const prevRole = process.env.DASHBOARD_ADMIN_ROLE_ID;
  process.env.DASHBOARD_ADMIN_ROLE_ID = '1312000457077686304';

  let repairCalled = false;
  mock.method(db, 'repairUnknownCampus', async () => {
    repairCalled = true;
    return { relabelled: 3, deleted: 0 };
  });
  mock.method(server, 'buildDataHealth', async () => ({
    ok: true,
    from: '2026-11-25',
    to: '2026-12-16',
    problems: [],
    checked: { rows: 120, weekdays: ['2026-11-25', '2026-11-26'] },
    repairPreview: { relabelled: 0 },
  }));

  try {
    const ix = makeInteraction({ subcommand: 'check', options: { repair: true } });
    await dispatchCommand.execute(ix);
    assert.strictEqual(repairCalled, true);
    assert.match(ix.edited.content, /Upcoming Menu Data Healthy/);
    assert.match(ix.edited.content, /relabelled \*\*3\*\* row/);
  } finally {
    mock.restoreAll();
    if (prevRole === undefined) delete process.env.DASHBOARD_ADMIN_ROLE_ID;
    else process.env.DASHBOARD_ADMIN_ROLE_ID = prevRole;
  }
});
