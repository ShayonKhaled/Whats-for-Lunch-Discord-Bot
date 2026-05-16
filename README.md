# Campus Lunch Discord Bot

A Discord bot that broadcasts daily lunch menu updates to multiple Discord servers. The bot reads from the PostgreSQL database populated by the main n8n scraper and delivers formatted menus to all subscribed guilds.

## Features

- ✅ **Per-guild subscriptions** — each server controls its own menu channel
- ✅ **Slash commands** — `/subscribe`, `/unsubscribe`, `/status`, `/preview`
- ✅ **Automatic daily delivery** — 9 AM JST, Monday–Friday
- ✅ **Duplicate prevention** — tracks sent menus to avoid re-posts
- ✅ **Rich formatting** — emojis, nutrition info, allergens
- ✅ **Error resilience** — logs delivery failures, continues on errors

## Quick Start

### 1. Database Setup

Run the bot schema migration against your PostgreSQL instance:

```bash
psql -d campus_lunch -f ../database/discord-bot-schema.sql
```

This creates two tables:
- `guild_subscriptions` — tracks which guilds are subscribed
- `bot_delivery_log` — prevents duplicate menu posts

### 2. Discord Developer Portal

1. Go to [Discord Developers](https://discord.com/developers/applications)
2. Click "New Application"
3. Go to "Bot" tab → "Add Bot"
4. Under "TOKEN", click "Copy" → save to `.env` as `DISCORD_BOT_TOKEN`
5. Go to "OAuth2" → "URL Generator"
6. Select scopes: `bot`, `applications.commands`
7. Select permissions: `Send Messages`, `Embed Links`
8. Copy the generated URL and invite the bot to your test server

### 3. Environment Setup

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
# Edit .env with your token, PostgreSQL credentials, etc.
```

### 4. Install & Run

```bash
npm install
npm start
```

The bot should log: `✅ Bot is online and ready!`

## Usage

Once the bot is in a server:

### `/subscribe`
Admin command to subscribe the current channel to menu updates.

```
/subscribe
```

**Response:** ✅ Menu updates will be posted in #channel-name!

### `/unsubscribe`
Remove the server from menu updates.

```
/unsubscribe
```

### `/status`
Check if the server is subscribed and when the next update is.

```
/status
```

### `/preview`
Get today's menu as an ephemeral message (visible only to you).

```
/preview
```

## Architecture

```
[PostgreSQL: menu_items]
        ↓
[Bot reads at 9 AM JST Mon-Fri]
        ↓
[Queries guild_subscriptions table]
        ↓
[Formats menu & sends to each subscribed channel]
        ↓
[Logs delivery to prevent duplicates]
```

## Project Structure

```
wfl-bot/
├── src/
│   ├── bot.js                 # Main entry point, command loader
│   ├── db.js                  # PostgreSQL connection & queries
│   ├── commands/
│   │   ├── subscribe.js       # /subscribe command
│   │   ├── unsubscribe.js     # /unsubscribe command
│   │   ├── status.js          # /status command
│   │   └── preview.js         # /preview command
│   ├── publishers/
│   │   └── menuPublisher.js   # Daily 9 AM cron job
│   ├── utils/
│   │   ├── formatMenu.js      # Menu formatting logic
│   │   └── logger.js          # Winston logging setup
│   └── events/
│       └── ready.js           # Bot ready event
├── .env.example               # Environment template
├── package.json               # Dependencies
└── README.md                  # This file
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DISCORD_BOT_TOKEN` | Bot token from Discord Developer Portal | *required* |
| `DISCORD_CLIENT_ID` | Application client ID | *required* |
| `POSTGRES_USER` | PostgreSQL user | `campus_lunch_user` |
| `POSTGRES_PASSWORD` | PostgreSQL password | *required* |
| `POSTGRES_HOST` | PostgreSQL host | `localhost` |
| `POSTGRES_PORT` | PostgreSQL port | `5432` |
| `POSTGRES_DB` | PostgreSQL database | `campus_lunch` |
| `BOT_ADMIN_ID` | Your Discord user ID (for alerts) | *optional* |
| `NODE_ENV` | Environment mode | `production` |
| `LOG_LEVEL` | Logging verbosity | `info` |
| `TZ` | Timezone for cron job | `Asia/Tokyo` |

## Logging

Logs are written to `logs/bot.log` and console.

- **Console**: INFO level in dev, WARN in prod
- **File**: DEBUG level, rotating (5 files, 5MB each)

To watch logs in real-time:

```bash
tail -f logs/bot.log
```

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

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable campus-lunch-discord-bot
sudo systemctl start campus-lunch-discord-bot
sudo journalctl -u campus-lunch-discord-bot -f  # watch logs
```

## Testing Checklist

- [ ] Database tables created (`guild_subscriptions`, `bot_delivery_log`)
- [ ] `.env` file filled with real values
- [ ] `npm install` completes without errors
- [ ] `npm start` logs "Bot is online and ready!"
- [ ] `/subscribe` command works in a test server
- [ ] `/status` shows subscription info
- [ ] `/preview` shows today's menu
- [ ] `/unsubscribe` removes subscription
- [ ] Menu posts automatically at 9 AM JST (or trigger manually in publisher)
- [ ] No duplicate posts when re-running same day

## Troubleshooting

### Bot doesn't show up in member list
- Check invite URL has correct scopes: `bot`, `applications.commands`
- Verify permissions include `Send Messages`

### Commands not working
- Run `npm install` to ensure all dependencies are installed
- Check bot has `applications.commands` scope in OAuth2 settings
- Verify bot token is correct in `.env`

### Menu not posting
- Check PostgreSQL connection: `POSTGRES_HOST`, credentials
- Verify menu items exist: `SELECT COUNT(*) FROM menu_items WHERE menu_date = CURRENT_DATE`
- Check guild is in `guild_subscriptions` table with `is_active = true`
- View logs: `tail -f logs/bot.log`

### Permission denied errors
- Ensure bot has "Send Messages" permission in the channel
- Check bot role is positioned above message content permissions

## Support

For issues, check `logs/bot.log` for detailed error messages. The bot includes comprehensive logging for debugging.

## License

MIT
