#!/usr/bin/env node
/**
 * scripts/checkMenuData.js
 *
 * Validates what the n8n scrapers wrote into `menu_items` and exits non-zero
 * when something is wrong. Intended for a timer on the bot host
 * (wfl-data-check.timer, weekdays at 05:30 JST — before the 6 AM post).
 *
 * It repairs before it judges: rows the scraper filed under an unrecognised
 * campus are relabelled first when their categories or slots prove the campus
 * (utils/campusNormalize), so the check reports what nothing could prove rather
 * than paging for something the bot had already fixed. A label repair is still a
 * pipeline failure, so it is said out loud in the report and the DM.
 *
 * Set UPTIME_KUMA_DATA_PUSH_URL to have the result pushed to a Uptime Kuma
 * monitor. With BOT_ADMIN_ID set, a failure is DMed to the admin as well, so the
 * check still pages you where no push monitor exists.
 *
 * The coverage check is relative: it only asserts a campus has a menu for days
 * some *other* campus has already published. A closed cafeteria therefore
 * produces no noise, while "Uzumasa got next week and Kameoka didn't" — the
 * exact August failure — is caught.
 */

require('dotenv').config();

const db = require('../src/db');
const logger = require('../src/utils/logger');
const { checkMenuData, publishingDays } = require('../src/utils/dataQuality');
const { todayCampus, isWeekday } = require('../src/utils/campusDate');
const { sendAdminDm } = require('../src/utils/adminAlert');
const { push: pingUptimeKuma, resolvePushUrl } = require('../src/utils/uptimeKuma');

const WINDOW_DAYS = parseInt(process.env.DATA_CHECK_WINDOW_DAYS, 10) || 21;

async function main() {
  await db.initConnection();

  const today = todayCampus();
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + WINDOW_DAYS * 86400000)
    .toISOString()
    .split('T')[0];

  // Repair what is provable before judging the data. The check runs at 05:30,
  // before the 6 AM post, and the complaint it exists to catch — Kameoka filed
  // under 'Unknown' — is often a label the bot can prove and fix itself (see
  // utils/campusNormalize). Reporting that as a data-quality failure pages
  // someone for something already repaired; doing the repair here means the
  // check only pages for the rows nothing can prove. A failed repair (the bot's
  // role lacking UPDATE, say) must not stop the check.
  let repaired = null;
  try {
    repaired = await db.repairUnknownCampus(today, end, { apply: true });
  } catch (err) {
    console.log(`  label repair skipped: ${err.message}`);
  }

  const rows = await db.getMenuItemsBetween(today, end);

  // Days any campus has published a *usable* menu — see the header note on
  // relative coverage and publishingDays() for why a lone row does not count.
  const publishedWeekdays = publishingDays(rows).filter(isWeekday);

  const result = checkMenuData(rows, publishedWeekdays);

  console.log(`Menu data check — ${today} to ${end}`);
  console.log(`  rows: ${result.checked.rows}`);
  if (repaired && (repaired.relabelled > 0 || repaired.deleted > 0)) {
    console.log(
      `  repaired: ${repaired.relabelled} mislabelled row(s) relabelled, ${repaired.deleted} duplicate(s) removed`
    );
  }
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
    await pingUptimeKuma(resolvePushUrl(pushUrl, { status: result.ok ? 'up' : 'down', msg }), 'menu-data-quality');
  }

  // Paging the human matters more than the exit code: this runs unattended at
  // 05:30, before the post that would otherwise go out wrong.
  if (!result.ok) {
    const shown = result.problems.slice(0, 10).map((p) => `- ${p}`).join('\n');
    const more = result.problems.length > 10 ? `\n- …and ${result.problems.length - 10} more` : '';
    // A repair still means the pipeline is broken: the menus are only right
    // because the bot patched them on the way past. Say so, or the next week
    // looks like a surprise.
    const repairLine =
      repaired && (repaired.relabelled > 0 || repaired.deleted > 0)
        ? `\n(${repaired.relabelled} row(s) were relabelled to Kameoka before this check — the parser is still writing the bad campus value.)`
        : '';
    await sendAdminDm(
      `⚠️ **Menu data check failed** — ${today}\n${shown}${more}${repairLine}\n\n` +
        'The scraped data is wrong or incomplete for the window starting today. ' +
        'Run `npm run check:data` on the bot host for the full report.'
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
