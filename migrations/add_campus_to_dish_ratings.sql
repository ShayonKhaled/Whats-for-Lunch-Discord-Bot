-- ============================================================================
-- Scope dish ratings to a campus.
--
-- getRatingsForDishes() matched on dish_name alone, so a rating given at one
-- campus was displayed on the other's menu. Dishes genuinely collide: as of
-- 2026-08-12, 'Pork Cutlet', 'Cardamon Curry', 'Miso Ramen' and others exist
-- under more than one campus.
--
-- Safe to re-run. Additive only — no column is dropped or retyped.
-- ============================================================================

ALTER TABLE dish_ratings ADD COLUMN IF NOT EXISTS campus VARCHAR(50);

-- Backfill from the menu the rating was given against. Verified unambiguous:
-- every existing rating joins to exactly one campus (0 rows match both).
UPDATE dish_ratings r
   SET campus = m.campus
  FROM (
    SELECT DISTINCT dish_name, menu_date, campus
      FROM menu_items
  ) m
 WHERE r.campus IS NULL
   AND m.dish_name = r.dish_name
   AND m.menu_date = r.menu_date;

-- Anything still unattributed is a rating for a dish no longer in menu_items.
-- Left NULL deliberately rather than guessed at; reads tolerate it.

CREATE INDEX IF NOT EXISTS idx_dish_ratings_campus_dish
    ON dish_ratings (campus, dish_name);

-- NOTE: the unique constraint stays (dish_name, menu_date, guild_id, user_id)
-- rather than gaining campus. Adding it would let one user rate the same dish
-- name at both campuses on the same day — correct in principle, but it rewrites
-- a live constraint for a case that has never occurred (0 rows). Revisit if the
-- campuses ever share a menu date with overlapping dish names.
