# What's for Lunch — Discord Bot

![Status](https://img.shields.io/badge/status-stable-green)
![License](https://img.shields.io/badge/license-MIT-blue)

A Discord bot that broadcasts the daily Uzumasa and Kameoka Campus cafeteria menus to subscribed servers every weekday at 9:00 AM JST. Reads from the same PostgreSQL database populated by the [campus-lunch-pipeline](https://github.com/ShayonKhaled/Campus-Lunch-Pipeline) and delivers it to any number of Discord servers independently.

---


## Infrastructure

**Bot Host**
- Runs as a systemd service on any machine with network access to PostgreSQL
- No cloud hosting required — fully self-hosted

**External Services**
- PostgreSQL — shared `campus_lunch` database populated by the pipeline; read-only from the bot's perspective
- Discord Bot API — slash commands and message delivery
- n8n workflow `workflow-1-menu-scraper-halal` — extracts Halal menus from weekly email PDFs and inserts into `menu_items`

---

## System Architecture

```
[PostgreSQL: menu_items]
         │
         │ Populated weekly by campus-lunch-pipeline
         │
         ▼
[Discord Bot: src/bot.js]
         │
         ├─ 9:00 AM JST, Mon–Fri → menuPublisher.js
         │         ├─ getActiveSubscriptions() → groups by campus
         │         ├─ getTodayMenu(campus) → per-campus menu fetch
         │         ├─ formatMenuMessage(…, campus) → campus-specific formatting
         │         ├─ channel.send() → posts to each subscribed guild's channel
         │         │         └─ @notify-menu-<campus> role mentioned on first chunk
         │         └─ logDelivery() → INSERT INTO bot_delivery_log (per guild+campus+date)
         │
         ├─ Campus Selection (buttons on every command)
         │         └─ campusSelector.js → "Uzumasa" / "Kameoka" buttons → executeForCampus()
         │
         ├─ Slash Commands
         │         ├─ /subscribe   → campus picker → creates notify-menu-<campus> role, upserts subscription
         │         ├─ /unsubscribe → campus picker → sets is_active = FALSE for that campus
         │         ├─ /notify      → campus picker → toggles campus-specific notify role on member
         │         ├─ /status      → campus picker → returns subscription info for that campus (+ cross-campus info)
         │         ├─ /preview     → campus picker → ephemeral: today's menu for chosen campus
         │         └─ /nextmenu    → campus picker → ephemeral: next weekday's menu for chosen campus
         │
         ├─ Rating Interactions (buttons + select menus)
         │         ├─ "Rate today's dishes" button on every menu post (campus-aware custom IDs)
         │         ├─ Dish picker → star rating select → upsert into dish_ratings
         │         └─ Aggregate ratings shown as ⭐ avg (n) next to recurring dishes
         │
         └─ Halal menu pipeline (external n8n workflow)
                   ├─ Campus-Lunch-Pipeline: workflow-1-menu-scraper-halal
                   ├─ Runs Saturdays 11:15 JST → parses weekly email PDF
                   └─ Inserts Halal dishes directly into menu_items (category='Halal')
```

---

## Database Schema

**Database:** `campus_lunch` on PostgreSQL

**Table:** `menu_items` *(read by the bot; written by the pipeline)*

```sql
CREATE TABLE menu_items (
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
  price       INTEGER,                       -- yen, nullable (populated for Kameoka)
  created_at  TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_dish UNIQUE (campus, menu_date, dish_name, subcategory)
);
```

**Table:** `guild_subscriptions` *(managed by the bot)*

```sql
CREATE TABLE guild_subscriptions (
  guild_id        VARCHAR(20) NOT NULL,
  guild_name      TEXT NOT NULL,
  channel_id      VARCHAR(20) NOT NULL,
  channel_name    TEXT,
  role_id         VARCHAR(20),             -- ID of the auto-created notify-menu-<campus> role
  campus          VARCHAR(50) NOT NULL DEFAULT 'Uzumasa',  -- 'Uzumasa' or 'Kameoka'
  is_active       BOOLEAN DEFAULT TRUE,
  subscribed_at   TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (guild_id, campus)
);
```

**Table:** `bot_delivery_log` *(prevents duplicate daily posts)*

```sql
CREATE TABLE bot_delivery_log (
  id            SERIAL PRIMARY KEY,
  guild_id      VARCHAR(20) NOT NULL,
  channel_id    VARCHAR(20) NOT NULL,
  campus        VARCHAR(50) NOT NULL DEFAULT 'Uzumasa',  -- 'Uzumasa' or 'Kameoka'
  menu_date     TEXT NOT NULL,
  status        TEXT NOT NULL,             -- 'success', 'failed', 'skipped'
  error_message TEXT,
  delivered_at  TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_delivery UNIQUE (guild_id, campus, menu_date)
);
```

**Table:** `dish_ratings` *(stores user star ratings per dish per day)*

```sql
CREATE TABLE dish_ratings (
  id          SERIAL PRIMARY KEY,
  guild_id    BIGINT NOT NULL,
  user_id     BIGINT NOT NULL,
  menu_date   TEXT NOT NULL,               -- 'YYYY-MM-DD'
  dish_name   TEXT NOT NULL,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  rated_at    TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_rating UNIQUE (dish_name, menu_date, guild_id, user_id)
);
```

---

## Key Technical Details

**Menu Publisher** (`src/publishers/menuPublisher.js`)
- Scheduled with `node-schedule` at `0 9 * * 1-5`, timezone `Asia/Tokyo`
- Groups active subscriptions by campus, fetches each campus's menu once
- Skips guild+campus combos that already have a `success` log entry for today
- Mentions the guild's `notify-menu-<campus>` role on the first message chunk only
- Formats menus with campus-specific config (Uzumasa hardcoded prices, Kameoka prices from DB)
- Alerts `BOT_ADMIN_ID` via DM if any guild delivery fails
- Splits formatted menus into ≤1900-char chunks to stay under Discord's 2000-char message limit

**Slash Commands** (`src/commands/`)
- All commands show a **campus selector** (Uzumasa / Kameoka buttons) before performing their action
- `/subscribe` and `/unsubscribe` require `ManageGuild` permission
- `/subscribe` automatically creates a per-campus role (`notify-menu-uzumasa` or `notify-menu-kameoka`) in the server if one does not already exist; the role ID is stored in `guild_subscriptions.role_id`
- A guild can subscribe to both campuses (in the same or different channels)
- `/notify` is self-serve — any member can toggle their per-campus ping without admin involvement
- `/preview` and `/nextmenu` responses are ephemeral (only the requesting user sees them)
- `/status` shows subscription info for the chosen campus and cross-references the other campus if also subscribed

**Halal Menu Pipeline** (external n8n workflow)
- The Halal menu is now handled by the [Campus-Lunch-Pipeline](https://github.com/ShayonKhaled/Campus-Lunch-Pipeline) n8n workflow `workflow-1-menu-scraper-halal`
- Runs Saturdays at 11:15 JST — extracts the Halal PDF from the weekly email, parses it with Claude, and inserts directly into `menu_items`
- Inserts use `category = 'Halal'`, `subcategory = 'Halal'`, `price = 400`
- The bot reads Halal items alongside all other menu items — no bot-side changes needed

**Discord Bot Configuration**
- Built with `discord.js` v14
- Slash commands registered globally via `scripts/registerGlobalCommands.js` (propagates within ~1 hour)
- For instant testing, register to a single guild with `scripts/registerGuildCommands.js --guild <ID>`
- Logging via Winston: debug-level file logs at `logs/bot.log`, warn-level to console in production

---

## Quick Start

### 1. Database Setup

Run the schema migration against your PostgreSQL instance:

```bash
psql -d campus_lunch -f database/discord-bot-schema.sql
```

### 2. Discord Developer Portal

1. Go to [Discord Developers](https://discord.com/developers/applications) → **New Application**
2. **Bot** tab → **Add Bot** → copy the token into `.env` as `DISCORD_BOT_TOKEN`
3. **OAuth2 → URL Generator**: select scopes `bot` and `applications.commands`, permissions `Send Messages` and `Manage Roles`
4. Use the generated URL to invite the bot to your server

### 3. Environment Setup

```bash
cp .env.example .env
# Fill in your values — see Configuration section below
```

### 4. Install Dependencies

```bash
npm install
```

### 5. Register Slash Commands

Only needs to run once, or after adding or changing a command:

```bash
npm run register
```

### 6. Run the Bot

```bash
npm start
```

The bot logs `✅ Bot is online and ready!` when connected.

---

## Commands

| Command | Who | Description |
|---|---|---|
| `/subscribe` | Admins | Campus picker → subscribes the current channel to daily menu posts for that campus. Creates a `notify-menu-<campus>` role automatically. |
| `/unsubscribe` | Admins | Campus picker → stops daily posts for that campus. Data is preserved and can re-subscribe anytime. |
| `/notify` | Everyone | Campus picker → toggles the campus-specific notify-menu ping role on yourself. |
| `/status` | Everyone | Campus picker → shows whether this server is subscribed to that campus, which channel receives posts, and if the other campus is also subscribed. |
| `/preview` | Everyone | Campus picker → ephemeral view of today's menu for the chosen campus. |
| `/nextmenu` | Everyone | Campus picker → ephemeral view of the next available weekday's menu for the chosen campus. |

Daily menu posts include a **"⭐ Rate today's dishes"** button. Tapping it opens an ephemeral flow where users pick a dish and rate it 1–5 stars. Previously-rated dishes show a star badge (e.g. `⭐ 4.2 (12)`) next to their name in future menus.

---

## Configuration

### Environment Variables

| Variable | Description | Required |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Bot token from Discord Developer Portal | Yes |
| `DISCORD_CLIENT_ID` | Application client ID | Yes |
| `POSTGRES_USER` | PostgreSQL user | Yes |
| `POSTGRES_PASSWORD` | PostgreSQL password | Yes |
| `POSTGRES_DB` | PostgreSQL database name | Yes |
| `POSTGRES_HOST` | PostgreSQL host | defaults to `localhost` |
| `POSTGRES_PORT` | PostgreSQL port | defaults to `5432` |
| `BOT_ADMIN_ID` | Your Discord user ID — receives DM alerts on delivery failures | optional |
| `NODE_ENV` | Set to `production` in deployment | defaults to `development` |
| `LOG_LEVEL` | Logging verbosity: `debug`, `info`, `warn` | defaults to `info` |

---

## Project Structure

```
wfl-bot/
├── migrations/
│   └── add_role_id.sql            # Run once when upgrading from older versions
├── scripts/
│   ├── publishNow.js              # Manually trigger a menu publish run
│   ├── publishSampleToSubscriptions.js  # Send a test menu to all subscribers
│   ├── registerGlobalCommands.js  # Register slash commands globally (~1hr propagation)
│   ├── registerGuildCommands.js   # Register slash commands to one guild (instant, for testing)
│   └── sendTestMessage.js         # Send a test message to a specific channel
├── src/
│   ├── bot.js                     # Main entry point, command and event loader
│   ├── db.js                      # PostgreSQL connection pool and all query functions
│   ├── commands/
│   │   ├── subscribe.js           # /subscribe — campus picker → creates notify-menu-<campus> role
│   │   ├── unsubscribe.js         # /unsubscribe — campus picker → deactivates subscription
│   │   ├── notify.js              # /notify — campus picker → toggles campus-specific role
│   │   ├── status.js              # /status — campus picker → subscription info (+ cross-campus)
│   │   ├── preview.js             # /preview — campus picker → today's menu (ephemeral)
│   │   └── nextmenu.js            # /nextmenu — campus picker → next weekday's menu (ephemeral)
│   ├── publishers/
│   │   └── menuPublisher.js       # Cron job: 9:00 AM JST Mon–Fri, groups by campus, delivers per-campus menus
│   ├── utils/
│   │   ├── formatMenu.js          # Campus-aware formatting (Uzumasa hardcoded prices, Kameoka from DB)
│   │   └── logger.js              # Winston logger: file and console transports
│   ├── interactions/
│   │   ├── campusSelector.js      # Campus picker buttons (Uzumasa / Kameoka) for all commands
│   │   └── rateMenu.js            # Rating button/select-menu interaction handler
│   └── events/
│       └── ready.js               # Bot ready: starts the publisher scheduler
├── .env.example
├── package.json
└── README.md
```

---

## Deployment with Systemd

Create `/etc/systemd/system/campus-lunch-discord-bot.service`:

```ini
[Unit]
Description=Campus Lunch Discord Bot
After=network.target postgresql.service

[Service]
Type=simple
User=nobody
WorkingDirectory=/path/to/wfl-bot
ExecStart=/usr/bin/node src/bot.js
Restart=on-failure
RestartSec=10
EnvironmentFile=/path/to/wfl-bot/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable campus-lunch-discord-bot
sudo systemctl start campus-lunch-discord-bot
sudo journalctl -u campus-lunch-discord-bot -f
```

---

## Known Limitations & Planned Improvements

1. **Global command propagation is slow** — Discord takes up to 1 hour; use guild commands during development
2. **Delivery log blocks same-day redelivery on channel change** — if a guild changes channels mid-day for a campus, the success log prevents re-posting that campus until the next day
3. **No web dashboard** — subscription management is entirely through slash commands; an admin panel would help for multi-guild oversight

---

## Additional information

- **Menu source:** Weekly PDF emailed every Friday, scraped by the [campus-lunch-pipeline](https://github.com/ShayonKhaled/Campus-Lunch-Pipeline)
- **Halal menu:** Extracted from the weekly email PDF by the n8n workflow `workflow-1-menu-scraper-halal` and inserted into `menu_items` alongside regular menus

---

## Troubleshooting

**`/notify` says the campus isn't set up even after `/subscribe`**
Ensure you're selecting the correct campus when running `/notify`. Each campus has a separate subscription and role. If the role was deleted, ask an admin to re-run `/subscribe` for that campus.

**Commands not appearing in a server**
Run `npm run register` and wait up to one hour. For instant results during testing, use `scripts/registerGuildCommands.js --guild <GUILD_ID>`.

**Menu not posting at 9 AM**
- Verify menu data exists: `SELECT campus, COUNT(*) FROM menu_items WHERE menu_date::date = CURRENT_DATE GROUP BY campus;`
- Verify the guild is active: `SELECT * FROM guild_subscriptions WHERE is_active = TRUE;`
- Check for a delivery log entry: `SELECT * FROM bot_delivery_log WHERE menu_date = CURRENT_DATE::text AND campus = 'Uzumasa';`
- Check logs: `tail -f logs/bot.log`

**Bot cannot create the `notify-menu-<campus>` role**
Ensure the bot has **Manage Roles** permission and that its own role sits above any roles it needs to manage in the server's role hierarchy.

**Menu not posting to a channel**
Ensure the bot has **Send Messages** permission in the subscribed channel.

---

## License

MIT
