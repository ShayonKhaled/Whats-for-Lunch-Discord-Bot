const test = require('node:test');
const assert = require('node:assert');

const { POSTING_TIME, HOURS, hoursLine, buildFooter } = require('../src/config/cafeteria');
const { formatMenuMessage } = require('../src/utils/formatMenu');

test('the hours line is built from config, not hardcoded', () => {
  const line = hoursLine();
  assert.ok(line.includes(HOURS.ticketsFrom), 'ticket time should come from config');
  assert.ok(line.includes(HOURS.opens));
  assert.ok(line.includes(HOURS.closes));
});

test('ticket time matches opening time during reduced hours', () => {
  // The cafeteria notice states ticket sales and service both begin at 11:30;
  // advertising an earlier ticket time sent students an hour early.
  assert.strictEqual(HOURS.ticketsFrom, HOURS.opens);
});

test('buildFooter appends campus-specific notes after the shared ones', () => {
  const footer = buildFooter(['Campus specific note.']);
  assert.ok(footer.startsWith(hoursLine()), 'hours come first');
  assert.ok(footer.includes('*Campus specific note.*'), 'campus note is italicised');
  assert.ok(
    footer.indexOf('Campus specific note.') > footer.indexOf(hoursLine()),
    'campus notes come last'
  );
});

test('buildFooter works with no campus notes', () => {
  const footer = buildFooter();
  assert.ok(footer.startsWith(hoursLine()));
  assert.ok(!footer.includes('undefined'));
});

test('POSTING_TIME is a JST time, matching the scheduler', () => {
  assert.match(POSTING_TIME, /JST/);
});

test('rendered menus pick up the configured hours', () => {
  const [chunk] = formatMenuMessage([
    {
      campus: 'Uzumasa',
      menu_date: '2026-08-18',
      day_name: 'Tuesday',
      category: 'Set Meals',
      subcategory: 'Campus Lunch (1)',
      dish_name: 'Beef Cutlet',
      calories: 498,
    },
  ]);

  // Guards the regression where the footer advertised 10:30 while config said 11:30.
  assert.ok(
    chunk.includes(`Tickets from **${HOURS.ticketsFrom}**`),
    'the footer must reflect config, not a stale literal'
  );
});
