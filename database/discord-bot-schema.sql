-- ============================================================================
-- What's for Lunch — Discord Bot Schema
-- Run: psql -d campus_lunch -f database/discord-bot-schema.sql
-- ============================================================================

-- Menu items populated by the campus-lunch-pipeline and halal upload flow.
CREATE TABLE IF NOT EXISTS menu_items (
  id          SERIAL PRIMARY KEY,
  campus      VARCHAR(50) NOT NULL,        -- 'Uzumasa'
  week_of     VARCHAR(10) NOT NULL,        -- '2026-05-11' (Monday of that week)
  day_name    VARCHAR(20) NOT NULL,        -- 'Monday', 'Tuesday', etc.
  menu_date   VARCHAR(10) NOT NULL,        -- 'YYYY-MM-DD'
  category    VARCHAR(50),                 -- 'Set Meals', 'A La Carte', 'Noodles', 'Sides', 'Halal'
  subcategory VARCHAR(50),                 -- 'Campus Lunch (1)', 'Ramen', 'Side Dish A', etc.
  dish_name   TEXT NOT NULL,
  allergens   TEXT,                        -- comma-separated: 'Milk, Wheat, Shrimp'
  calories    INTEGER,
  protein     NUMERIC(5,1),
  fat         NUMERIC(5,1),
  sodium      NUMERIC(5,1),
  price       INTEGER,                       -- yen, nullable. Populated for Kameoka, NULL for Uzumasa.
  created_at  TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_dish UNIQUE (campus, menu_date, dish_name, subcategory)
);

-- Guild subscriptions managed by the bot slash commands.
CREATE TABLE IF NOT EXISTS guild_subscriptions (
  guild_id        VARCHAR(20) NOT NULL,
  guild_name      TEXT NOT NULL,
  channel_id      VARCHAR(20) NOT NULL,
  channel_name    TEXT,
  role_id         VARCHAR(20),             -- ID of the auto-created notify-menu role
  campus          VARCHAR(50) NOT NULL DEFAULT 'Uzumasa',  -- 'Uzumasa' or 'Kameoka'
  is_active       BOOLEAN DEFAULT TRUE,
  subscribed_at   TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (guild_id, campus)
);

-- Prevents duplicate daily menu posts, and records why a day produced no post.
--
-- NOTE: this definition was corrected on 2026-08-12 to match the live table,
-- which had drifted — production has no `id` column, uses BIGINT for the
-- Discord snowflakes, and carries both created_at and delivered_at. The old
-- definition here claimed a DEFAULT on delivered_at that production does not
-- have, which is why rows written after 2026-06-16 had a NULL timestamp until
-- logDelivery was changed to set it explicitly.
CREATE TABLE IF NOT EXISTS bot_delivery_log (
  guild_id      BIGINT NOT NULL,
  channel_id    BIGINT,
  campus        VARCHAR(50) NOT NULL DEFAULT 'Uzumasa',  -- 'Uzumasa' or 'Kameoka'
  menu_date     TEXT NOT NULL,
  status        TEXT NOT NULL,             -- 'success', 'failed', 'skipped'
  error_message TEXT,                      -- reason, e.g. 'No menu published for this date'
  created_at    TIMESTAMP DEFAULT NOW(),
  delivered_at  TIMESTAMPTZ,               -- no default: set explicitly by logDelivery()
  CONSTRAINT unique_delivery UNIQUE (guild_id, campus, menu_date)
);

-- Dish ratings submitted via the interactive rating flow (v1.0.3).
CREATE TABLE IF NOT EXISTS dish_ratings (
  id          SERIAL PRIMARY KEY,
  guild_id    BIGINT NOT NULL,
  user_id     BIGINT NOT NULL,
  menu_date   TEXT NOT NULL,               -- 'YYYY-MM-DD'
  dish_name   TEXT NOT NULL,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  rated_at    TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_rating UNIQUE (dish_name, menu_date, guild_id, user_id)
);
