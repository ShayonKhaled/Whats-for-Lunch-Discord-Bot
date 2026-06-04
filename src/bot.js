require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const db = require('./db');
const logger = require('./utils/logger');
const { handleRatingInteraction } = require('./interactions/rateMenu');
const { handleCampusSelection } = require('./interactions/campusSelector');
const healthServer = require('./server');
const { push: pingUptimeKuma } = require('./utils/uptimeKuma');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ],
});

// Validate environment variables
const requiredEnvVars = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Initialize command collection
client.commands = new Collection();

// Load commands
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    logger.debug(`✅ Loaded command: ${command.data.name}`);
  } else {
    logger.warn(`⚠️ Command ${file} missing 'data' or 'execute' property`);
  }
}

// Load events
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter((f) => f.endsWith('.js'));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
  logger.debug(`✅ Loaded event: ${event.name}`);
}

// Interaction handler
client.on('interactionCreate', async (interaction) => {
  // ── Rating interactions (buttons + select menus) ──────────────────────────
  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    try {
      const handled = await handleRatingInteraction(interaction);
      if (handled) return;
    } catch (err) {
      logger.error(`Rating interaction error: ${err.message}`);
      // Fall through — don't crash the process over a rating failure
    }
  }

  // ── Campus selection buttons ──────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('campus_select:')) {
    await handleCampusSelection(interaction);
    return;
  }

  // ── Slash commands ────────────────────────────────────────────────────────
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    logger.warn(`⚠️ Command not found: ${interaction.commandName}`);
    return interaction.reply({ content: '❌ Command not found.', ephemeral: true });
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error(`Error executing command ${interaction.commandName}: ${error.message}`);
    const reply = { content: '❌ There was an error executing this command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

// Guild telemetry
client.on('guildCreate', (guild) => logger.info(`🎉 Bot added to server: ${guild.name} (${guild.id})`));
client.on('guildDelete', (guild) => logger.info(`👋 Bot removed from server: ${guild.name} (${guild.id})`));

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('📴 Shutting down bot...');
  await db.closeConnection();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('📴 Shutting down bot (SIGTERM)...');
  await db.closeConnection();
  client.destroy();
  process.exit(0);
});

async function start() {
  try {
    await db.initConnection();
    await client.login(process.env.DISCORD_BOT_TOKEN);

    // Start health endpoint for Uptime Kuma monitoring
    healthServer.start(client);

    // Heartbeat ping every 5 minutes so Uptime Kuma knows the bot is alive
    const HEARTBEAT_MS = 5 * 60 * 1000;
    setInterval(() => {
      pingUptimeKuma(process.env.UPTIME_KUMA_HEARTBEAT_URL, 'heartbeat');
    }, HEARTBEAT_MS);
    // Fire one immediately so Uptime Kuma registers it right away
    pingUptimeKuma(process.env.UPTIME_KUMA_HEARTBEAT_URL, 'heartbeat');

  } catch (error) {
    logger.error(`❌ Failed to start bot: ${error.message}`);
    process.exit(1);
  }
}

start();
