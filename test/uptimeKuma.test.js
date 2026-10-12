const test = require('node:test');
const assert = require('node:assert');

const { resolvePushUrl, push } = require('../src/utils/uptimeKuma');

const TOKEN = 'abc123token';
const BARE = `https://uptime.example/api/push/${TOKEN}`;
// Exactly what Uptime Kuma's UI puts on the clipboard for a push monitor.
const UI_FORM = `${BARE}?status=up&msg=OK&ping=`;

test('the URL Uptime Kuma shows is accepted as-is', () => {
  const url = resolvePushUrl(UI_FORM, { status: 'down', msg: 'menu published but 0 delivered' });
  const parsed = new URL(url);

  assert.strictEqual(url.split('?').length - 1, 1, 'appending to an existing query made this malformed');
  assert.strictEqual(parsed.pathname, `/api/push/${TOKEN}`, 'the token path survives');
  assert.strictEqual(parsed.searchParams.get('status'), 'down', 'the UI default is replaced, not kept');
  assert.strictEqual(parsed.searchParams.get('msg'), 'menu published but 0 delivered');
});

test('a bare push URL works too', () => {
  const parsed = new URL(resolvePushUrl(BARE, { status: 'up', msg: 'heartbeat' }));

  assert.strictEqual(parsed.searchParams.get('status'), 'up');
  assert.strictEqual(parsed.searchParams.get('msg'), 'heartbeat');
});

test('the message is encoded here, so callers must not pre-encode it', () => {
  const msg = 'no menu published for today — cafeteria closed (3 sent, 0 skipped) & nothing failed';
  const parsed = new URL(resolvePushUrl(BARE, { status: 'up', msg }));

  assert.strictEqual(parsed.searchParams.get('msg'), msg, 'round-trips unchanged');
});

test('status defaults to up', () => {
  assert.strictEqual(new URL(resolvePushUrl(BARE)).searchParams.get('status'), 'up');
});

test('nothing to push to yields null rather than a broken URL', () => {
  assert.strictEqual(resolvePushUrl(undefined), null);
  assert.strictEqual(resolvePushUrl(''), null);
  assert.strictEqual(resolvePushUrl('not a url'), null);
});

test('pushing nowhere is a no-op, not a crash', async () => {
  await assert.doesNotReject(() => push(null, 'test-label'));
});
