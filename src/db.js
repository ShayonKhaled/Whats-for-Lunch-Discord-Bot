const { Pool } = require('pg');
const logger = require('./utils/logger');

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

async function addSubscription(guildId, guildName, channelId, channelName, roleId) {
  try {
    const result = await pool.query(
      `INSERT INTO guild_subscriptions (guild_id, guild_name, channel_id, channel_name, role_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (guild_id) DO UPDATE
       SET channel_id = $3, channel_name = $4, role_id = $5, updated_at = NOW()
       RETURNING *`,
      [guildId, guildName, channelId, channelName, roleId]
    );

    // If channel changed, clear any pending delivery for today so the new channel gets the menu
    await pool.query(
      `DELETE FROM bot_delivery_log
       WHERE guild_id = $1
       AND menu_date = CURRENT_DATE
       AND status = 'pending'`,
      [guildId]
    );

    logger.info(`✅ Added/updated subscription: guild=${guildId}, channel=${channelId}, role=${roleId}`);
    return result.rows[0];
  } catch (err) {
    logger.error(`Error adding subscription: ${err.message}`);
    throw err;
  }
}


async function addHalalMenuItem({ campus, week_of, day_name, menu_date, dish_name }) {
  try {
    const result = await pool.query(
      `INSERT INTO menu_items (campus, week_of, day_name, menu_date, category, subcategory, dish_name)
       VALUES ($1, $2, $3, $4, 'Halal', 'Halal', $5)
       ON CONFLICT (campus, menu_date, dish_name, subcategory) DO NOTHING
       RETURNING *`,
      [campus, week_of, day_name, menu_date, dish_name]
    );
    logger.debug(`Halal insert: ${dish_name} on ${menu_date} — ${result.rows.length ? 'inserted' : 'already exists'}`);
    return result.rows[0] || null;
  } catch (err) {
    logger.error(`Error inserting halal menu item: ${err.message}`);
    throw err;
  }
}


async function removeSubscription(guildId) {
  try {
    const result = await pool.query(
      `UPDATE guild_subscriptions SET is_active = FALSE, updated_at = NOW() WHERE guild_id = $1 RETURNING *`,
      [guildId]
    );
    logger.info(`✅ Removed subscription: guild=${guildId}`);
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

async function getTodayMenu() {
  try {
    // Cast menu_date to date for a consistent comparison regardless of
    // whether the column is stored as date or varchar.
    const result = await pool.query(
      `SELECT * FROM menu_items WHERE menu_date::date = CURRENT_DATE ORDER BY category, subcategory`
    );
    logger.debug(`Fetched ${result.rows.length} menu items for today`);
    return result.rows;
  } catch (err) {
    logger.error(`Error fetching today's menu: ${err.message}`);
    throw err;
  }
}

async function getMenuByDate(dateText) {
  try {
    const result = await pool.query(
      `SELECT * FROM menu_items WHERE menu_date::date = $1::date ORDER BY category, subcategory`,
      [dateText]
    );
    logger.debug(`Fetched ${result.rows.length} menu items for date ${dateText}`);
    return result.rows;
  } catch (err) {
    logger.error(`Error fetching menu by date: ${err.message}`);
    throw err;
  }
}

async function getNextMenu() {
  try {
    const nextRes = await pool.query(
      `SELECT menu_date FROM menu_items
       WHERE (menu_date::date > CURRENT_DATE)
         AND EXTRACT(ISODOW FROM menu_date::date) BETWEEN 1 AND 5
       ORDER BY menu_date::date ASC
       LIMIT 1`
    );

    if (!nextRes.rows || nextRes.rows.length === 0) {
      return { menuDate: null, items: [] };
    }

    const menuDate = nextRes.rows[0].menu_date;
    const itemsRes = await pool.query(
      `SELECT * FROM menu_items WHERE menu_date::date = $1::date ORDER BY category, subcategory`,
      [menuDate]
    );

    logger.debug(`Fetched ${itemsRes.rows.length} menu items for next date ${menuDate}`);
    return { menuDate, items: itemsRes.rows };
  } catch (err) {
    logger.error(`Error fetching next menu: ${err.message}`);
    throw err;
  }
}


async function claimDelivery(guildId, channelId, menuDate) {
  try {
    const result = await pool.query(
      `INSERT INTO bot_delivery_log (guild_id, channel_id, menu_date, status)
       VALUES ($1::text, $2::text, $3::text, 'pending')
       ON CONFLICT (guild_id, menu_date) DO NOTHING
       RETURNING *`,
      [guildId, channelId, menuDate]
    );
    return result.rows.length > 0;
  } catch (err) {
    logger.error(`Error claiming delivery: ${err.message}`);
    throw err;
  }
}

async function logDelivery(guildId, channelId, menuDate, status, errorMessage) {
  try {
    await pool.query(
      `UPDATE bot_delivery_log
       SET status = $4, error_message = $5, delivered_at = NOW()
       WHERE guild_id = $1 AND menu_date = $3`,
      [guildId, channelId, menuDate, status, errorMessage]
    );
    logger.debug(`📝 Logged delivery: guild=${guildId}, status=${status}`);
  } catch (err) {
    logger.error(`Error logging delivery: ${err.message}`);
    throw err;
  }
}


async function getSubscriptionByGuildId(guildId) {
  try {
    const result = await pool.query(
      `SELECT * FROM guild_subscriptions WHERE guild_id = $1`,
      [guildId]
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error(`Error fetching subscription: ${err.message}`);
    throw err;
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
  getTodayMenu,
  getMenuByDate,
  getNextMenu,
  claimDelivery,      
  logDelivery,
  getSubscriptionByGuildId,
  closeConnection,
};