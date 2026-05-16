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

async function addSubscription(guildId, guildName, channelId, channelName) {
  try {
    const result = await pool.query(
      `INSERT INTO guild_subscriptions (guild_id, guild_name, channel_id, channel_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (guild_id) DO UPDATE
       SET channel_id = $3, channel_name = $4, updated_at = NOW()
       RETURNING *`,
      [guildId, guildName, channelId, channelName]
    );
    logger.info(`✅ Added/updated subscription: guild=${guildId}, channel=${channelId}`);
    return result.rows[0];
  } catch (err) {
    logger.error(`Error adding subscription: ${err.message}`);
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
    const result = await pool.query(
      `SELECT * FROM menu_items WHERE menu_date = CURRENT_DATE::text ORDER BY category, subcategory`
    );
    logger.debug(`Fetched ${result.rows.length} menu items for today`);
    return result.rows;
  } catch (err) {
    logger.error(`Error fetching today's menu: ${err.message}`);
    throw err;
  }
}

async function hasDeliveryLog(guildId, menuDate) {
  try {
    const result = await pool.query(
      `SELECT 1 FROM bot_delivery_log WHERE guild_id = $1 AND menu_date = $2`,
      [guildId, menuDate]
    );
    return result.rows.length > 0;
  } catch (err) {
    logger.error(`Error checking delivery log: ${err.message}`);
    throw err;
  }
}

async function logDelivery(guildId, channelId, menuDate, status, errorMessage) {
  try {
    await pool.query(
      `INSERT INTO bot_delivery_log (guild_id, channel_id, menu_date, status, error_message)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (guild_id, menu_date) DO NOTHING`,
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
  hasDeliveryLog,
  logDelivery,
  getSubscriptionByGuildId,
  closeConnection,
};
