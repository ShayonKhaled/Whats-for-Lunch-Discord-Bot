![Status](https://img.shields.io/badge/status-stable-green)
![License](https://img.shields.io/badge/license-MIT-blue)


# What's for Lunch — Discord Bot

A Discord bot that broadcasts the daily Uzumasa Campus cafeteria menu to subscribed servers every weekday at 9:00 AM JST. Reads from the same PostgreSQL database populated by the [campus-lunch-pipeline](https://github.com/ShayonKhaled/Campus-Lunch-Pipeline) and delivers it to any number of Discord servers independently.

---

## Infrastructure

**Bot Host**
- Runs as a systemd service on any machine with network access to PostgreSQL
- No cloud hosting required — fully self-hosted

**External Services**
- PostgreSQL — shared `campus_lunch` database populated by the pipeline; read-only from the bot's perspective
- Discord Bot API — slash commands and message delivery
- Anthropic Claude API (`claude-sonnet-4-6`) — vision extraction for halal menu photo uploads

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
         │         ├─ getTodayMenu() → SELECT * FROM menu_items WHERE menu_date = CURRENT_DATE
         │         ├─ formatMenuMessage() → groups by category/subcategory, builds Discord markdown
         │         ├─ getActiveSubscriptions() → SELECT * FROM guild_subscriptions WHERE is_active
         │         ├─ channel.send() → posts to each subscribed guild's channel
         │         │         └─ @notify-menu role mentioned on first chunk
         │         └─ logDelivery() → INSERT INTO bot_delivery_log (prevents re-posts)
         │
         ├─ Slash Commands
         │         ├─ /subscribe   → creates notify-menu role, saves to guild_subscriptions
         │         ├─ /unsubscribe → sets is_active = FALSE
         │         ├─ /notify      → toggles notify-menu role on the requesting member
         │         ├─ /status      → returns subscription info for the current guild
         │         ├─ /preview     → ephemeral: today's menu from DB
         │         └─ /nextmenu    → ephemeral: next available weekday's menu from DB
         │
         └─ #halal-menu-upload channel (owner only)
                   ├─ messageCreate event → receives image attachment
                   ├─ Claude Vision API → extracts dish names, dates, day names as JSON
                   └─ addHalalMenuItem() → inserts into menu_items with category='Halal'
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
  created_at  TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_dish UNIQUE (campus, menu_date, dish_name, subcategory)
);
```

**Table:** `guild_subscriptions` *(managed by the bot)*

```sql
CREATE TABLE guild_subscriptions (
  guild_id        VARCHAR(20) PRIMARY KEY,
  guild_name      TEXT NOT NULL,
  channel_id      VARCHAR(20) NOT NULL,
  channel_name    TEXT,
  role_id         VARCHAR(20),             -- ID of the auto-created notify-menu role
  is_active       BOOLEAN DEFAULT TRUE,
  subscribed_at   TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);
```

**Table:** `bot_delivery_log` *(prevents duplicate daily posts)*

```sql
CREATE TABLE bot_delivery_log (
  id            SERIAL PRIMARY KEY,
  guild_id      VARCHAR(20) NOT NULL,
  channel_id    VARCHAR(20) NOT NULL,
  menu_date     TEXT NOT NULL,
  status        TEXT NOT NULL,             -- 'success', 'failed', 'skipped'
  error_message TEXT,
  delivered_at  TIMESTAMP DEFAULT NOW(),
  CONSTRAINT unique_delivery UNIQUE (guild_id, menu_date)
);
```

---

## Key Technical Details

**Menu Publisher** (`src/publishers/menuPublisher.js`)
- Scheduled with `node-schedule` at `0 9 * * 1-5`, timezone `Asia/Tokyo`
- Skips guilds that already have a `success` log entry for today; `failed` and `skipped` rows do not block redelivery
- Mentions the guild's `notify-menu` role on the first message chunk only
- Alerts `BOT_ADMIN_ID` via DM if any guild delivery fails
- Splits formatted menus into ≤1900-char chunks to stay under Discord's 2000-char message limit

**Slash Commands** (`src/commands/`)
- `/subscribe` and `/unsubscribe` require `ManageGuild` permission
- `/subscribe` automatically creates a `notify-menu` role in the server if one does not already exist; the role ID is stored in `guild_subscriptions.role_id`
- `/notify` is self-serve — any member can toggle their own ping without admin involvement
- `/preview` and `/nextmenu` are ephemeral (only the requesting user sees the response)

**Halal Menu Upload** (`src/events/messageCreate.js`)
- Only active in channels named `halal-menu-upload`, restricted to the bot owner
- Image is resized to a max width of 1800px and compressed to JPEG before sending to Claude
- Claude Vision (`claude-sonnet-4-6`) extracts dish name, day name, and date from the poster
- Extracted items are inserted into `menu_items` with `category = 'Halal'` and `subcategory = 'Halal'`
- Duplicate dishes on the same date are silently skipped via `ON CONFLICT DO NOTHING`

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

If upgrading from an older version that does not have the `role_id` column:

```bash
psql -d campus_lunch -f migrations/add_role_id.sql
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
| `/subscribe` | Admins | Subscribes the current channel to daily menu posts. Creates a `notify-menu` role automatically. |
| `/unsubscribe` | Admins | Stops daily posts. Data is preserved and the server can re-subscribe at any time. |
| `/notify` | Everyone | Toggles the `notify-menu` ping role on yourself. |
| `/status` | Everyone | Shows whether this server is subscribed and which channel receives posts. |
| `/preview` | Everyone | Ephemeral view of today's menu. |
| `/nextmenu` | Everyone | Ephemeral view of the next available weekday's menu. |

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
| `ANTHROPIC_API_KEY` | Anthropic API key (required for halal menu upload) | Yes if using halal upload |
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
│   │   ├── subscribe.js           # /subscribe — sets up channel and creates notify-menu role
│   │   ├── unsubscribe.js         # /unsubscribe — deactivates subscription
│   │   ├── notify.js              # /notify — self-serve role toggle for members
│   │   ├── status.js              # /status — subscription info for this guild
│   │   ├── preview.js             # /preview — today's menu (ephemeral)
│   │   └── nextmenu.js            # /nextmenu — next weekday's menu (ephemeral)
│   ├── publishers/
│   │   └── menuPublisher.js       # Cron job: 9:00 AM JST Mon–Fri, delivers to all guilds
│   ├── utils/
│   │   ├── formatMenu.js          # Groups items by category, builds Discord markdown chunks
│   │   └── logger.js              # Winston logger: file and console transports
│   └── events/
│       ├── ready.js               # Bot ready: starts the publisher scheduler
│       └── messageCreate.js       # Halal menu image upload handler
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

1. **`OWNER_ID` for halal upload is hardcoded** — should be moved to an environment variable
2. **No rate limiting on halal uploads** — a bad actor in the upload channel could spam Claude API calls
3. **Global command propagation is slow** — Discord takes up to 1 hour; use guild commands during development
4. **Delivery log blocks same-day redelivery on channel change** — if a guild changes channels mid-day, the success log prevents re-posting until the next day
5. **No web dashboard** — subscription management is entirely through slash commands; an admin panel would help for multi-guild oversight

---

## Additional information

- **Menu source:** Weekly PDF emailed every Friday, scraped by the [campus-lunch-pipeline](https://github.com/ShayonKhaled/Campus-Lunch-Pipeline)
- **Halal menu:** Posted separately as a monthly paper poster; the image of which is uploaded manually via the `#halal-menu-upload` channel

---

## Troubleshooting

**`/notify` says the server isn't set up even after `/subscribe`**
The `role_id` column is missing. Run `migrations/add_role_id.sql`, then `/unsubscribe` and `/subscribe` again to repopulate it.

**Commands not appearing in a server**
Run `npm run register` and wait up to one hour. For instant results during testing, use `scripts/registerGuildCommands.js --guild <GUILD_ID>`.

**Menu not posting at 9 AM**
- Verify menu data exists: `SELECT COUNT(*) FROM menu_items WHERE menu_date::date = CURRENT_DATE;`
- Verify the guild is active: `SELECT * FROM guild_subscriptions WHERE is_active = TRUE;`
- Check for a delivery log entry: `SELECT * FROM bot_delivery_log WHERE menu_date = CURRENT_DATE::text;`
- Check logs: `tail -f logs/bot.log`

**Bot cannot create the `notify-menu` role**
Ensure the bot has **Manage Roles** permission and that its own role sits above any roles it needs to manage in the server's role hierarchy.

**Menu not posting to a channel**
Ensure the bot has **Send Messages** permission in the subscribed channel.

**Halal menu upload not working**
- Confirm the channel is named exactly `halal-menu-upload`
- Confirm `ANTHROPIC_API_KEY` is set in `.env`
- Check that the image is a clear photo of the poster — blurry or partially obscured images reduce extraction accuracy

---

## License

MIT
