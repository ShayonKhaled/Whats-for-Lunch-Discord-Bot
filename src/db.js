const { Pool } = require('pg');
const logger = require('./utils/logger');
const { todayCampus } = require('./utils/campusDate');

let pool;

async function initConnection() {
  if (pool) {
    return pool;
  }

  pool = new Pool({
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    host: process.env.POSTGRES_HOST || 'localhost',
    port: process.env.POSTGRES_PORT || 5432,
    database: process.env.POSTGRES_DB || 'campus_lunch',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  pool.on('error', (err) => {
    logger.error(`Unexpected error on idle client: ${err.message}`);
  });

  try {
    const res = await pool.query('SELECT NOW()');
    logger.info(`✅ PostgreSQL connected: ${res.rows[0].now}`);
  } catch (err) {
    logger.error(`❌ PostgreSQL connection failed: ${err.message}`);
    throw err;
  }

  return pool;
}

async function addSubscription(guildId, guildName, channelId, channelName, roleId, campus) {
  try {
    const result = await pool.query(
      `INSERT INTO guild_subscriptions (guild_id, guild_name, channel_id, channel_name, role_id, campus)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (guild_id, campus) DO UPDATE
       SET channel_id = $3, channel_name = $4, role_id = $5, updated_at = NOW()
       RETURNING *`,
      [guildId, guildName, channelId, channelName, roleId, campus]
    );
    logger.info(`✅ Added/updated subscription: guild=${guildId}, campus=${campus}, channel=${channelId}, role=${roleId}`);
    return result.rows[0];
  } catch (err) {
    logger.error(`Error adding subscription: ${err.message}`);
    throw err;
  }
}

async function removeSubscription(guildId, campus) {
  try {
    const result = await pool.query(
      `UPDATE guild_subscriptions SET is_active = FALSE, updated_at = NOW()
       WHERE guild_id = $1 AND campus = $2 AND is_active = TRUE
       RETURNING *`,
      [guildId, campus]
    );
    logger.info(`✅ Removed subscription: guild=${guildId}, campus=${campus}`);
    return result.rows[0] || null;
  } catch (err) {
    logger.error(`Error removing subscription: ${err.message}`);
    throw err;
  }
}

async function getActiveSubscriptions() {
  try {
    const result = await pool.query(
      `SELECT * FROM guild_subscriptions WHERE is_active = TRUE ORDER BY subscribed_at ASC`
    );
    logger.debug(`Fetched ${result.rows.length} active subscriptions`);
    return result.rows;
  } catch (err) {
    logger.error(`Error fetching active subscriptions: ${err.message}`);
    throw err;
  }
}

async function getSubscriptionsByGuildId(guildId) {
  try {
    const result = await pool.query(
      `SELECT * FROM guild_subscriptions WHERE guild_id = $1 AND is_active = TRUE`,
      [guildId]
    );
    return result.rows;
  } catch (err) {
    logger.error(`Error fetching subscriptions for guild: ${err.message}`);
    throw err;
  }
}

async function getTodayMenu(campus) {
  try {
    // The DB runs in UTC, so CURRENT_DATE is yesterday during the 6 AM JST run
    const today = todayCampus();
    const result = await pool.query(
      `SELECT * FROM menu_items WHERE campus = $1 AND menu_date::date = $2::date ORDER BY category, subcategory`,
      [campus, today]
    );
    logger.debug(`Fetched ${result.rows.length} menu items for today (${campus}, ${today})`);
    return result.rows;
  } catch (err) {
    logger.error(`Error fetching today's menu: ${err.message}`);
    throw err;
  }
}

async function getMenuByDate(dateText, campus) {
  try {
    const result = await pool.query(
      `SELECT * FROM menu_items WHERE campus = $2 AND menu_date::date = $1::date ORDER BY category, subcategory`,
      [dateText, campus]
    );
    logger.debug(`Fetched ${result.rows.length} menu items for date ${dateText} (${campus})`);
    return result.rows;
  } catch (err) {
    logger.error(`Error fetching menu by date: ${err.message}`);
    throw err;
  }
}

async function getNextMenu(campus) {
  try {
    const nextRes = await pool.query(
      `SELECT menu_date FROM menu_items
       WHERE campus = $1
         AND (menu_date::date > $2::date)
         AND EXTRACT(ISODOW FROM menu_date::date) BETWEEN 1 AND 5
       ORDER BY menu_date::date ASC
       LIMIT 1`,
      [campus, todayCampus()]
    );

    if (!nextRes.rows || nextRes.rows.length === 0) {
      return { menuDate: null, items: [] };
    }

    const menuDate = nextRes.rows[0].menu_date;
    const itemsRes = await pool.query(
      `SELECT * FROM menu_items WHERE campus = $2 AND menu_date::date = $1::date ORDER BY category, subcategory`,
      [menuDate, campus]
    );

    logger.debug(`Fetched ${itemsRes.rows.length} menu items for next date ${menuDate} (${campus})`);
    if (itemsRes.rows.length > 0) {
      const cats = {};
      for (const r of itemsRes.rows) {
        const k = `${r.category}|||${r.subcategory}`;
        cats[k] = (cats[k] || 0) + 1;
      }
      logger.debug(`[getNextMenu] items by category|||subcategory: ${JSON.stringify(cats)}`);
    }
    return { menuDate, items: itemsRes.rows };
  } catch (err) {
    logger.error(`Error fetching next menu: ${err.message}`);
    throw err;
  }
}

async function hasSuccessfulDelivery(guildId, campus, menuDate) {
  try {
    const result = await pool.query(
      `SELECT 1 FROM bot_delivery_log WHERE guild_id = $1 AND campus = $2 AND menu_date = $3 AND status = 'success'`,
      [guildId, campus, menuDate]
    );
    return result.rows.length > 0;
  } catch (err) {
    logger.error(`Error checking delivery log: ${err.message}`);
    throw err;
  }
}

async function logDelivery(guildId, channelId, campus, menuDate, status, errorMessage) {
  try {
    await pool.query(
      // delivered_at is set explicitly: the live table has no DEFAULT on it,
      // so every row written since 2026-06-16 landed with a NULL timestamp.
      `INSERT INTO bot_delivery_log (guild_id, channel_id, campus, menu_date, status, error_message, delivered_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (guild_id, campus, menu_date) DO UPDATE
         SET status = EXCLUDED.status,
             error_message = EXCLUDED.error_message,
             delivered_at = NOW()`,
      [guildId, channelId, campus, menuDate, status, errorMessage]
    );
    logger.debug(`📝 Logged delivery: guild=${guildId}, campus=${campus}, status=${status}`);
  } catch (err) {
    // If the ON CONFLICT doesn't match (e.g. older schema with unique on guild_id,menu_date
    // without campus), try the older constraint, or just warn — the delivery already happened
    if (err.code === '23505') {
      logger.warn(`Delivery log conflict for guild=${guildId}, campus=${campus}, date=${menuDate} — skipping (row already exists)`);
      return;
    }
    logger.error(`Error logging delivery: ${err.message}`);
    throw err;
  }
}

async function getSubscriptionByGuildId(guildId, campus) {
  try {
    const result = await pool.query(
      `SELECT * FROM guild_subscriptions WHERE guild_id = $1 AND campus = $2`,
      [guildId, campus]
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error(`Error fetching subscription: ${err.message}`);
    throw err;
  }
}

// ─── Dish ratings ────────────────────────────────────────────────────────────

/**
 * Upsert a rating. Returns the saved row.
 * One rating per user per dish per day per guild — repeated calls update it.
 */
async function upsertRating(guildId, userId, menuDate, dishName, rating, campus) {
  try {
    const result = await pool.query(
      `INSERT INTO dish_ratings (guild_id, user_id, menu_date, dish_name, rating, campus)
       VALUES ($1::bigint, $2::bigint, $3::text, $4, $5, $6)
       ON CONFLICT (dish_name, menu_date, guild_id, user_id)
       DO UPDATE SET rating = EXCLUDED.rating, campus = EXCLUDED.campus, rated_at = NOW()
       RETURNING *`,
      [guildId, userId, menuDate, dishName, rating, campus ?? null]
    );
    logger.debug(`⭐ Rating saved: "${dishName}" = ${rating} by user=${userId} guild=${guildId}`);
    return result.rows[0];
  } catch (err) {
    logger.error(`Error upserting rating: ${err.message}`);
    throw err;
  }
}

/**
 * Fetch aggregate ratings for a list of dish names.
 * Returns a Map: dishName → { avg: number, count: number }
 *
 * Used by formatMenu to decorate recurring dishes.
 */
async function getRatingsForDishes(dishNames, campus) {
  if (!dishNames || dishNames.length === 0) return new Map();
  try {
    // Scoped to the campus: dish names collide across campuses ('Pork Cutlet',
    // 'Miso Ramen', …), and without this a rating given at one was shown on the
    // other's menu. Rows predating the campus column are NULL and are included
    // for the campus they were backfilled to, or ignored if unattributable.
    // Aggregation across dates and guilds is intentional — the point is to
    // decorate dishes that recur.
    const result = await pool.query(
      `SELECT dish_name,
              ROUND(AVG(rating)::numeric, 1) AS avg_rating,
              COUNT(*)::int                  AS rating_count
       FROM dish_ratings
       WHERE dish_name = ANY($1)
         AND ($2::text IS NULL OR campus = $2::text)
       GROUP BY dish_name`,
      [dishNames, campus ?? null]
    );
    const map = new Map();
    for (const row of result.rows) {
      map.set(row.dish_name, {
        avg: parseFloat(row.avg_rating),
        count: row.rating_count,
      });
    }
    return map;
  } catch (err) {
    logger.error(`Error fetching dish ratings: ${err.message}`);
    // Non-fatal — return empty map so the menu still renders
    return new Map();
  }
}

/**
 * Fetch a single user's ratings for a specific date + guild.
 * Returns a Map: dishName → rating (1–5)
 */
async function getUserRatingsForDate(guildId, userId, menuDate) {
  try {
    const result = await pool.query(
      `SELECT dish_name, rating
       FROM dish_ratings
       WHERE guild_id = $1::bigint AND user_id = $2::bigint AND menu_date = $3::text`,
      [guildId, userId, menuDate]
    );
    const map = new Map();
    for (const row of result.rows) {
      map.set(row.dish_name, row.rating);
    }
    return map;
  } catch (err) {
    logger.error(`Error fetching user ratings: ${err.message}`);
    return new Map();
  }
}

/** All menu rows in a date window — used by the data-quality check. */
async function getMenuItemsBetween(fromDate, toDate) {
  try {
    const result = await pool.query(
      `SELECT campus, menu_date, category, subcategory, dish_name, price
         FROM menu_items
        WHERE menu_date::date BETWEEN $1::date AND $2::date
        ORDER BY menu_date, campus`,
      [fromDate, toDate]
    );
    return result.rows;
  } catch (err) {
    logger.error(`Error fetching menu items between ${fromDate} and ${toDate}: ${err.message}`);
    throw err;
  }
}

/** Cheap liveness probe for the health endpoint. Throws if the DB is unreachable. */
async function ping() {
  await pool.query('SELECT 1');
}

/**
 * Most recent menu_date that was successfully delivered to anyone.
 * Surfaced by the health endpoint so "connected but posting nothing" is visible.
 */
async function getLastSuccessfulDelivery() {
  try {
    const result = await pool.query(
      // COALESCE because rows written between 2026-06-16 and the fix above
      // have a NULL delivered_at; created_at is populated on every row.
      `SELECT menu_date, MAX(COALESCE(delivered_at, created_at)) AS delivered_at
       FROM bot_delivery_log
       WHERE status = 'success'
       GROUP BY menu_date
       ORDER BY menu_date DESC
       LIMIT 1`
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error(`Error fetching last delivery: ${err.message}`);
    return null;
  }
}

async function closeConnection() {
  if (pool) {
    await pool.end();
    logger.info('PostgreSQL connection closed');
  }
}

module.exports = {
  initConnection,
  addSubscription,
  removeSubscription,
  getActiveSubscriptions,
  getSubscriptionsByGuildId,
  getTodayMenu,
  getMenuByDate,
  getNextMenu,
  hasSuccessfulDelivery,
  logDelivery,
  getSubscriptionByGuildId,
  // health & data quality
  ping,
  getLastSuccessfulDelivery,
  getMenuItemsBetween,
  // ratings
  upsertRating,
  getRatingsForDishes,
  getUserRatingsForDate,
  closeConnection,
};
