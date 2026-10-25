#!/usr/bin/env node
/**
 * scripts/fixCampusLabels.js
 *
 * Repairs menu rows the scraper filed under a campus the bot cannot match
 * (see src/utils/campusNormalize.js). Safe by construction: it only relabels a
 * date's rows when their categories prove the campus, and it deletes a row only
 * when an identical dish already exists for the campus it is moving to.
 *
 * Usage:
 *   node scripts/fixCampusLabels.js                 # today only, dry run
 *   node scripts/fixCampusLabels.js --apply         # today only, write changes
 *   node scripts/fixCampusLabels.js --all --apply   # every date on record
 *   node scripts/fixCampusLabels.js --from 2026-07-01 --to 2026-08-07 --apply
 *
 * Without --apply nothing is written; it prints what it would do and exits
 * non-zero if unrepairable rows were found, so a timer can alert on it.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const db = require('../src/db');
const { todayCampus } = require('../src/utils/campusDate');

function parseArgs(argv) {
  const args = { apply: false, all: false, from: null, to: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--all') args.all = true;
    else if (arg === '--from') args.from = argv[++i];
    else if (arg === '--to') args.to = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      args.help = true;
    }
  }
  return args;
}

const USAGE = `Usage: node scripts/fixCampusLabels.js [--apply] [--all] [--from YYYY-MM-DD] [--to YYYY-MM-DD]

  --apply   write the changes (default is a dry run)
  --all     every date on record, not just the current menu week
  --from    start of the date range (default: today)
  --to      end of the date range (default: today + 7, the menu week ahead)`;

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const today = todayCampus();
  // The weekly scrape writes Mon-Fri in one go, so the date range that matters
  // is the week ahead, not just today — see db.repairWindow.
  const window = db.repairWindow(today);
  const from = args.from || (args.all ? '1970-01-01' : window.from);
  const to = args.to || (args.all ? '2999-12-31' : window.to);

  await db.initConnection();
  console.log(`Scanning ${from} .. ${to} for rows with an unrecognised campus${args.apply ? '' : ' (dry run)'}`);

  const report = await db.repairUnknownCampus(from, to, { apply: args.apply });

  console.log(`\nRows examined:  ${report.examined}`);
  console.log(`Relabelled:     ${report.relabelled}`);
  console.log(`Duplicates cut: ${report.deleted}`);
  console.log(`Left alone:     ${report.skipped}`);

  for (const group of report.groups) {
    const action = group.campus
      ? `→ ${group.campus} (${group.relabelled} relabelled${group.deleted ? `, ${group.deleted} duplicate(s) deleted` : ''})`
      : '→ skipped';
    console.log(`  ${group.date}  ${String(group.rows).padStart(3)} row(s)  ${action}  [${group.reason}]`);
  }

  if (!args.apply && report.relabelled + report.deleted > 0) {
    console.log('\nDry run — nothing written. Re-run with --apply to make these changes.');
  }

  // A non-zero exit when rows are still mislabelled makes this usable from a
  // timer or CI: the alert is the exit status, not something to grep for.
  return report.skipped > 0 ? 1 : 0;
}

run()
  .then(async (code) => {
    await db.closeConnection().catch(() => {});
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(`Failed: ${err.message}`);
    await db.closeConnection().catch(() => {});
    process.exit(2);
  });
