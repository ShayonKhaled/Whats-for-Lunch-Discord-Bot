# What's for Lunch — Discord Bot

A Discord bot that broadcasts the daily Uzumasa Campus cafeteria menu to subscribed servers every weekday at 9:00 AM JST. Built to serve multiple Discord servers across the university from a single deployment.

## Features

-  **Per-guild subscriptions** - each server controls its own menu channel
-  **Auto-created notification role** - a `notify-menu` role is created automatically on subscribe
-  **Self-serve notifications** - members opt in/out with `/notify`, no admin needed
-  **Slash commands** — `/subscribe`, `/unsubscribe`, `/notify`, `/status`, `/preview`, `/nextmenu`
-  **Automatic daily delivery** - 9:00 AM JST, Monday–Friday
-  **Duplicate prevention** - tracks sent menus to avoid re-posts
-  **Rich formatting** - emojis, nutrition info, allergen warnings
-  **Error resilience** - logs delivery failures, alerts admin, continues on errors

---

## Quick Start

### 1. Database Setup

Run the bot schema migration against your PostgreSQL instance:

```bash
psql -d campus_lunch -f ../database/discord-bot-schema.sql
```

This creates two tables:
- `guild_subscriptions` — tracks which guilds are subscribed and stores their notification role ID
- `bot_delivery_log` — prevents duplicate menu posts

If you are upgrading from an older version of the bot, also run the role migration:

```bash
psql -d campus_lunch -f migrations/add_role_id.sql
```

### 2. Discord Developer Portal

1. Go to [Discord Developers](https://discord.com/developers/applications)
2. Click **New Application**
3. Go to the **Bot** tab → **Add Bot**
4. Under **TOKEN**, click **Copy** → save to `.env` as `DISCORD_BOT_TOKEN`
5. Go to **OAuth2** → **URL Generator**
6. Select scopes: `bot`, `applications.commands`
7. Select permissions: `Send Messages`, `Manage Roles`
8. Copy the generated URL and use it to invite the bot to your server

### 3. Environment Setup

```bash
cp .env.example .env
# Fill in your values
```

### 4. Install Dependencies

```bash
npm install
```

### 5. Register Slash Commands

This only needs to be run once, or whenever you add/change a command. Commands are registered globally and appear in all servers within ~1 hour.

```bash
npm run register
```

### 6. Run the Bot

```bash
npm start
```

The bot should log: `✅ Bot is online and ready!`

---

## Commands

### `/subscribe`
Admin only. Subscribes the current channel to daily menu updates. Automatically creates a `notify-menu` role that members can self-assign.

```
/subscribe
```

**Response:** ✅ Menu Bot Subscribed — confirms the channel and tells members about `/notify`.

---

### `/unsubscribe`
Admin only. Removes the server from daily menu updates.

```
/unsubscribe
```

---

### `/notify`
Available to all members. Toggles the `notify-menu` role on or off — run it once to opt in, again to opt out. Members with this role get pinged when the daily menu is posted.

```
/notify
```

---

### `/status`
Check whether the server is subscribed and which channel receives updates.

```
/status
```

---

### `/preview`
Preview today's menu as an ephemeral message (only visible to you).

```
/preview
```

---

### `/nextmenu`
Preview the menu for the next available weekday.

```
/nextmenu
```

---

## Architecture

```
[PostgreSQL: menu_items]
        ↓
[Bot reads at 9:00 AM JST Mon–Fri]
        ↓
[Queries guild_subscriptions for active servers]
        ↓
[Formats menu & sends to each subscribed channel]
        ↓
[@notify-menu role is pinged on first message chunk]
        ↓
[Logs delivery to prevent duplicates]
```

---

## Project Structure

```
wfl-bot/
├── migrations/
│   └── add_role_id.sql            # Run once when upgrading from older versions
├── scripts/
│   ├── publishNow.js              # Manually trigger a menu publish
│   ├── publishSampleToSubscriptions.js  # Send a test menu to all subscribers
│   ├── registerGlobalCommands.js  # Register slash commands globally
│   ├── registerGuildCommands.js   # Register slash commands to one guild (for testing)
│   └── sendTestMessage.js         # Send a test message to a specific channel
├── src/
│   ├── bot.js                     # Main entry point, command and event loader
│   ├── db.js                      # PostgreSQL connection and queries
│   ├── commands/
│   │   ├── subscribe.js           # /subscribe — admin, sets up channel and role
│   │   ├── unsubscribe.js         # /unsubscribe — admin, removes subscription
│   │   ├── notify.js              # /notify — members toggle their ping role
│   │   ├── status.js              # /status — check subscription info
│   │   ├── preview.js             # /preview — see today's menu
│   │   └── nextmenu.js            # /nextmenu — see next weekday's menu
│   ├── publishers/
│   │   └── menuPublisher.js       # Daily 9:00 AM JST cron job
│   ├── utils/
│   │   ├── formatMenu.js          # Menu formatting logic
│   │   └── logger.js              # Winston logging setup
│   └── events/
│       └── ready.js               # Bot ready event, starts the publisher
├── .env.example                   # Environment variable template
├── package.json
└── README.md
```

---

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DISCORD_BOT_TOKEN` | Bot token from Discord Developer Portal | ✅ |
| `DISCORD_CLIENT_ID` | Application client ID | ✅ |
| `POSTGRES_USER` | PostgreSQL user | ✅ |
| `POSTGRES_PASSWORD` | PostgreSQL password | ✅ |
| `POSTGRES_DB` | PostgreSQL database name | ✅ |
| `POSTGRES_HOST` | PostgreSQL host | defaults to `localhost` |
| `POSTGRES_PORT` | PostgreSQL port | defaults to `5432` |
| `BOT_ADMIN_ID` | Your Discord user ID — receives DM alerts on failures | optional |
| `NODE_ENV` | Set to `production` in deployment | defaults to `development` |
| `LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`) | defaults to `info` |

> `DISCORD_ROLE_ID` is no longer used. The notification role is now created and managed automatically per server.

---

## Logging

Logs are written to `logs/bot.log` and to the console.

- **Console**: `DEBUG` in development, `WARN` in production
- **File**: `DEBUG` level, rotating (5 files × 5 MB each)

```bash
tail -f logs/bot.log
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

## Adding the Bot to a New Server

Share the OAuth2 invite URL (generated in the Developer Portal) with the server admin. Once they add the bot, an admin in their server runs `/subscribe` in their desired channel. The bot will:

1. Create a `notify-menu` role in their server
2. Start posting the menu there every weekday at 9:00 AM JST
3. Allow their members to self-assign the role with `/notify`

No changes to the bot or database are needed on your end.

---

## Troubleshooting

**`/notify` says the server isn't set up even after `/subscribe`**
The `role_id` column is missing or empty. Run the migration (`migrations/add_role_id.sql`), then run `/unsubscribe` followed by `/subscribe` again to repopulate the role ID.

**Commands not appearing in a server**
Run `npm run register` and wait up to one hour for Discord to propagate global commands.

**Menu not posting at 9 AM**
- Check that menu items exist: `SELECT COUNT(*) FROM menu_items WHERE menu_date::date = CURRENT_DATE;`
- Check the guild is active: `SELECT * FROM guild_subscriptions WHERE is_active = TRUE;`
- Check logs: `tail -f logs/bot.log`

**Bot can't create the notify-menu role**
Ensure the bot has the **Manage Roles** permission in the server, and that its role is positioned above any roles it needs to manage in the server's role list.

**Menu not posting to a channel**
Ensure the bot has **Send Messages** permission in the subscribed channel.

---

## License

MIT