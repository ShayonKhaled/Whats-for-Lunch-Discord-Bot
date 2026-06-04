-- Migration: Add role_id column to guild_subscriptions
-- Run: psql -d campus_lunch -f migrations/add_role_id.sql
--
-- This column stores the Discord role ID of the auto-created notify-menu role.
-- Required for /notify to work. If this migration has not been run, /notify will
-- fail with "server isn't set up" even after /subscribe. The fix is running this
-- migration and then re-running /subscribe.

ALTER TABLE guild_subscriptions
  ADD COLUMN IF NOT EXISTS role_id VARCHAR(20);
