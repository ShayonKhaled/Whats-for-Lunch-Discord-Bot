
# Change Log
All notable changes to this project will be documented in this file.
 
The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).
 
## [Unreleased]

### Changed
- **Vacation mode is over.** The cafeteria is back on its normal schedule —
  tickets from 10:30 AM, open **11:00 AM – 2:00 PM** — and the "reduced schedule
  during the vacation period" notice has been dropped from both campuses'
  footers. Cancelling one meant cancelling the other: the footer would otherwise
  advertise normal hours under a reduced-hours warning.
- The 6:00 AM JST posting time is unchanged; vacation mode had bundled it with
  the reduced hours, but it is kept deliberately and is now the documented
  schedule (README said 9:00 AM, which had been stale since 2026-08-04).

## [1.2.0] - 2026-08-12

### Fixed
- **Daily menu posting had been silently broken since 2026-08-07.** The publisher runs at 6:00 AM JST — 21:00 UTC the previous day — but resolved "today" from a UTC date while the DB ran UTC `CURRENT_DATE`. The duplicate guard therefore asked "did we deliver yesterday?", found a success row, and skipped every guild every weekday. Dates are now resolved in `Asia/Tokyo` via `utils/campusDate`.
- Kameoka menus were written with `campus = 'Unknown'` by the n8n parser and so were invisible to the bot's exact-match query. Fixed in the workflow; 22 rows for 2026-08-18–21 recovered.
- Kameoka prices were dropped by the same parser — the Gemini prompt's field schema omitted `price` and the parser never mapped it.
- Ticket sales time corrected from 10:30 AM to 11:30 AM for the reduced-hours period.
- Ratings were matched on `dish_name` alone, so a rating given at one campus appeared on the other's menu. Now scoped by campus.
- `delivered_at` was never written — the live column has no `DEFAULT` and `logDelivery` did not set it, so every row since 2026-06-16 had a NULL timestamp.
- `/status` rendered dates in the host timezone (UTC) rather than JST.
- `database/discord-bot-schema.sql` did not describe the live tables; corrected.

### Added
- Delivery observability: `skipped` rows are recorded when there is no menu, Uptime Kuma is told `down` when a menu was published but reached nobody, and `/api/status` returns 503 when the database or Discord connection is down.
- `npm run check:data` — validates scraped menu data (campus labels, per-campus coverage, Kameoka prices, well-formedness) and pushes to its own Uptime Kuma monitor.
- `/nextmenu` shows a cafeteria-closed notice with the reopening date instead of silently jumping ahead.
- Test suite (Node's built-in runner), ESLint 9, and GitHub Actions CI on Node 20 and 22.
- `src/config/cafeteria.js` — opening hours, notices and posting time in one place instead of scattered string literals.

### Changed
- `engines.node` from `>=18` to `>=20`. Node 18 is end-of-life and production runs 20.20.2.
- `ready` event replaced with `Events.ClientReady`, and `ephemeral: true` with `flags: MessageFlags.Ephemeral`, both deprecated ahead of discord.js v15.

## [1.1.1] - 2026-06-14
- Halal menu upload replaced by n8n workflow.
- Removed: halal image upload event handler, `addHalalMenuItem()` in db.js, `@napi-rs/canvas` dependency, `ANTHROPIC_API_KEY` from env.
- n8n workflow `workflow-1-menu-scraper-halal` (Campus-Lunch-Pipeline) now extracts Halal menus from weekly email PDFs and inserts directly into `menu_items`.

## [1.1.0] - 2026-06-05
- Multi-campus support: Uzumasa and Kameoka campuses
- Campus selector buttons on all slash commands (/subscribe, /unsubscribe, /preview, /nextmenu, /status, /notify)
- Per-campus notify-menu roles (notify-menu-uzumasa, notify-menu-kameoka)
- Kameoka Campus menu formatting with prices from database
- Publisher groups subscriptions by campus, delivers per-campus menus
- Rating custom IDs include campus for per-campus rating flows

## [1.0.3] - 2026-06-04
- Added a "Rate today's dishes" button
- Users can rate menu items from 1 to 5 stars
- When a menu item returns, its star rating is shown next to it

## [1.0.2] - 2026-05-31
- Menu prices added.
- Included:
- Dish and subcategory prices shown in menu output, plus the cafeteria discount notice for students.

## [1.0.1] - 2026-05-18
- Halal menu support added.
- Included:
- Halal menu upload handling, image-based menu extraction, halal menu database storage, and menu formatting support for halal entries.

## [1.0.0] - 2026-05-16
- Initial release — project created.
- Included:
- Basic bot functions: startup logic, slash commands, subscription handling, database storage, ready-event handling, menu publishing, and menu formatting.

- Notes: No functional changes since initial commit.
