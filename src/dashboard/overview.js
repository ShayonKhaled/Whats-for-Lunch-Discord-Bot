/**
 * src/dashboard/overview.js
 *
 * Turns three flat result sets — subscriptions, per-day menu counts and
 * delivery-log rows — into the day-by-day view the admin dashboard renders.
 *
 * This is a pure function on purpose. The interesting part of the dashboard is
 * not the HTML, it is deciding what "posted successfully" means on a given
 * day, and that judgement is worth testing without a database or a Discord
 * client in the way.
 *
 * The distinction that matters most here is between a day with no menu and a
 * day with a menu that reached nobody. The first is the cafeteria being
 * closed; the second is the failure that went unnoticed for five days in
 * August 2026. They produce very different statuses below.
 */

const { isWeekday, dayName } = require('../utils/campusDate');

/**
 * Day statuses, roughly in order of how much they should worry you.
 *
 *   failed        a menu existed and no guild received it — this is broken
 *   partial       some subscribers got it, some did not
 *   delivered     every expected subscriber got it
 *   pending       today, or a future date, that has not been published yet
 *   no-menu       no menu rows for any campus — cafeteria closed, or not scraped
 *   no-subscribers a menu existed but nobody was subscribed to that campus
 *   weekend       Saturday or Sunday; the publisher does not run
 */
const STATUS = {
  FAILED: 'failed',
  PARTIAL: 'partial',
  DELIVERED: 'delivered',
  PENDING: 'pending',
  NO_MENU: 'no-menu',
  NO_SUBSCRIBERS: 'no-subscribers',
  WEEKEND: 'weekend',
};

/**
 * Which subscriptions should have received a menu on a given date.
 *
 * A guild that subscribed last Tuesday did not miss last Monday's menu, so
 * subscriptions are only expected from their subscribed_at date onward.
 *
 * The reverse case is not representable: unsubscribing sets is_active = FALSE
 * but records no timestamp, so a guild that unsubscribed yesterday drops out
 * of the expected set for every past day too. That understates historical
 * expectations rather than inventing failures, which is the safer direction.
 */
function expectedFor(subscriptions, campus, dateText) {
  return subscriptions.filter(
    (sub) =>
      sub.campus === campus &&
      sub.is_active !== false &&
      (!sub.subscribed_at || toDateText(sub.subscribed_at) <= dateText)
  );
}

/** A Date or a YYYY-MM-DD string, normalised to YYYY-MM-DD. */
function toDateText(value) {
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value).split('T')[0];
}

function statusFor({ dateText, today, campuses }) {
  if (!isWeekday(dateText)) return STATUS.WEEKEND;

  const withMenu = campuses.filter((c) => c.itemCount > 0);
  if (withMenu.length === 0) return STATUS.NO_MENU;

  const expected = withMenu.reduce((n, c) => n + c.expectedCount, 0);
  if (expected === 0) return STATUS.NO_SUBSCRIBERS;

  const delivered = withMenu.reduce((n, c) => n + c.successCount, 0);

  if (delivered >= expected) return STATUS.DELIVERED;
  if (delivered > 0) return STATUS.PARTIAL;

  // Nothing delivered. Before the day has been published that is simply not
  // yet done; afterwards it is the outage we care about.
  return dateText >= today ? STATUS.PENDING : STATUS.FAILED;
}

/**
 * @param {object}   input
 * @param {string[]} input.dates          YYYY-MM-DD, the window to report on
 * @param {string}   input.today          YYYY-MM-DD in campus time
 * @param {object[]} input.subscriptions  rows from guild_subscriptions
 * @param {object[]} input.menuCounts     {menu_date, campus, item_count}
 * @param {object[]} input.deliveries     rows from bot_delivery_log (+guild_name)
 * @returns {object} the /api/overview payload
 */
function buildOverview({ dates, today, subscriptions = [], menuCounts = [], deliveries = [] }) {
  // Index the flat rows by date so each day is assembled in one pass rather
  // than rescanning every result set per day.
  const menuByDate = new Map();
  for (const row of menuCounts) {
    const date = toDateText(row.menu_date);
    if (!menuByDate.has(date)) menuByDate.set(date, new Map());
    menuByDate.get(date).set(row.campus, Number(row.item_count) || 0);
  }

  const deliveriesByDate = new Map();
  for (const row of deliveries) {
    const date = toDateText(row.menu_date);
    if (!deliveriesByDate.has(date)) deliveriesByDate.set(date, []);
    deliveriesByDate.get(date).push(row);
  }

  // Every campus we know about, whether from a subscription or from a menu.
  // Deriving this rather than hardcoding ['Uzumasa', 'Kameoka'] means a third
  // campus appears in the dashboard the moment it appears in the data.
  const allCampuses = [
    ...new Set([
      ...subscriptions.map((s) => s.campus),
      ...menuCounts.map((m) => m.campus),
      ...deliveries.map((d) => d.campus),
    ]),
  ].sort();

  const days = dates.map((dateText) => {
    const menus = menuByDate.get(dateText) || new Map();
    const dayDeliveries = deliveriesByDate.get(dateText) || [];

    const campuses = allCampuses.map((campus) => {
      const expected = expectedFor(subscriptions, campus, dateText);
      const rows = dayDeliveries.filter((d) => d.campus === campus);

      const byStatus = { success: [], failed: [], skipped: [] };
      for (const row of rows) {
        (byStatus[row.status] ||= []).push(row);
      }

      // Guilds that should have been posted to but produced no log row at all.
      // These are invisible in the delivery log by definition, which is exactly
      // why they are worth naming here.
      const logged = new Set(rows.map((r) => String(r.guild_id)));
      const missing = expected
        .filter((sub) => !logged.has(String(sub.guild_id)))
        .map((sub) => ({
          guild_id: String(sub.guild_id),
          guild_name: sub.guild_name,
          channel_name: sub.channel_name,
          campus,
          status: 'missing',
          error_message: 'No delivery-log row — the publisher never reached this guild',
          delivered_at: null,
        }));

      return {
        campus,
        itemCount: menus.get(campus) || 0,
        expectedCount: expected.length,
        successCount: byStatus.success.length,
        failedCount: byStatus.failed.length,
        skippedCount: byStatus.skipped.length,
        missingCount: missing.length,
        deliveries: [...rows, ...missing].map(normaliseDelivery),
      };
    });

    const status = statusFor({ dateText, today, campuses });

    return {
      date: dateText,
      dayName: dayName(dateText),
      isWeekday: isWeekday(dateText),
      isToday: dateText === today,
      status,
      totalItems: campuses.reduce((n, c) => n + c.itemCount, 0),
      // The first time anything landed for this day, which is what "what time
      // was it posted" means when several guilds are posted to in sequence.
      firstDeliveredAt: earliest(campuses.flatMap((c) => c.deliveries)),
      // Only campuses with something to say — a campus with no menu and no
      // subscribers is noise on every single row otherwise.
      campuses: campuses.filter(
        (c) => c.itemCount > 0 || c.deliveries.length > 0 || c.expectedCount > 0
      ),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    today,
    from: dates[0] ?? today,
    to: dates[dates.length - 1] ?? today,
    campuses: allCampuses,
    days,
    summary: summarise(days),
  };
}

function normaliseDelivery(row) {
  return {
    guildId: String(row.guild_id),
    guildName: row.guild_name || `Unknown guild (${row.guild_id})`,
    channelName: row.channel_name || null,
    campus: row.campus,
    status: row.status,
    errorMessage: row.error_message || null,
    deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : null,
  };
}

function earliest(deliveries) {
  const times = deliveries
    .filter((d) => d.status === 'success' && d.deliveredAt)
    .map((d) => d.deliveredAt)
    .sort();
  return times[0] ?? null;
}

/** Counts for the header strip, over weekdays only — weekends are not news. */
function summarise(days) {
  const counted = days.filter((d) => d.isWeekday);
  const tally = (status) => counted.filter((d) => d.status === status).length;

  return {
    weekdays: counted.length,
    delivered: tally(STATUS.DELIVERED),
    partial: tally(STATUS.PARTIAL),
    failed: tally(STATUS.FAILED),
    pending: tally(STATUS.PENDING),
    noMenu: tally(STATUS.NO_MENU),
    noSubscribers: tally(STATUS.NO_SUBSCRIBERS),
  };
}

module.exports = { buildOverview, STATUS };
