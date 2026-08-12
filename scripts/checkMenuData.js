#!/usr/bin/env node
/**
 * scripts/checkMenuData.js
 *
 * Validates what the n8n scrapers wrote into `menu_items` and exits non-zero
 * when something is wrong. Intended for cron:
 *
 *   0 12 * * *  cd /root/Whats-for-Lunch-Discord-Bot && npm run check:data
 *
 * Set UPTIME_KUMA_DATA_PUSH_URL to have the result pushed to a Uptime Kuma
 * monitor, so a bad scrape pages you the same way a dead bot would.
 *
 * The coverage check is relative: it only asserts a campus has a menu for days
 * some *other* campus has already published. A closed cafeteria therefore
 * produces no noise, while "Uzumasa got next week and Kameoka didn't" — the
 * exact August failure — is caught.
 */

require('dotenv').config();

const db = require('../src/db');
const logger = require('../src/utils/logger');
const { checkMenuData } = require('../src/utils/dataQuality');
const { todayCampus, isWeekday } = require('../src/utils/campusDate');
const { push: pingUptimeKuma } = require('../src/utils/uptimeKuma');

const WINDOW_DAYS = parseInt(process.env.DATA_CHECK_WINDOW_DAYS, 10) || 21;

async function main() {
  await db.initConnection();

  const today = todayCampus();
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + WINDOW_DAYS * 86400000)
    .toISOString()
    .split('T')[0];

  const rows = await db.getMenuItemsBetween(today, end);

  // Days any campus has published — see the header note on relative coverage.
  const publishedWeekdays = [...new Set(rows.map((r) => r.menu_date))]
    .filter(isWeekday)
    .sort();

  const result = checkMenuData(rows, publishedWeekdays);

  console.log(`Menu data check — ${today} to ${end}`);
  console.log(`  rows: ${result.checked.rows}`);
  console.log(`  weekdays published: ${publishedWeekdays.length ? publishedWeekdays.join(', ') : '(none)'}`);
  console.log(`  campuses seen: ${result.checked.campuses.join(', ') || '(none)'}`);

  if (result.ok) {
    console.log('\n✅ All checks passed');
  } else {
    console.log(`\n❌ ${result.problems.length} problem(s):`);
    for (const problem of result.problems) console.log(`  - ${problem}`);
  }

  const pushUrl = process.env.UPTIME_KUMA_DATA_PUSH_URL;
  if (pushUrl) {
    const msg = result.ok ? 'menu data ok' : result.problems.join('; ').slice(0, 300);
    await pingUptimeKuma(
      `${pushUrl}?status=${result.ok ? 'up' : 'down'}&msg=${encodeURIComponent(msg)}`,
      'menu-data-quality'
    );
  }

  await db.closeConnection();
  process.exit(result.ok ? 0 : 1);
}

main().catch(async (err) => {
  logger.error(`Menu data check failed to run: ${err.message}`);
  console.error(err.stack);
  await db.closeConnection().catch(() => {});
  process.exit(2);
});
