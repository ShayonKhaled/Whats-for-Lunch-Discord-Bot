require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const db = require('./db');
const logger = require('./utils/logger');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ],
});

// Validate environment variables
const requiredEnvVars = ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'POSTGRES_DB'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Initialize command collection
client.commands = new Collection();

// Load commands from src/commands/
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

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

// Load events from src/events/
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith('.js'));

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

// Handle slash command interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    logger.warn(`⚠️ Command not found: ${interaction.commandName}`);
    return interaction.reply({
      content: '❌ Command not found.',
      ephemeral: true,
    });
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error(`Error executing command ${interaction.commandName}: ${error.message}`);
    const reply = {
      content: '❌ There was an error executing this command.',
      ephemeral: true,
    };
    if (interaction.replied) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

// Handle guild joins (optional telemetry)
client.on('guildCreate', (guild) => {
  logger.info(`🎉 Bot added to server: ${guild.name} (${guild.id})`);
});

client.on('guildDelete', (guild) => {
  logger.info(`👋 Bot removed from server: ${guild.name} (${guild.id})`);
});

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

// Start the bot
async function start() {
  try {
    // Initialize database connection
    await db.initConnection();

    // Login to Discord
    await client.login(process.env.DISCORD_BOT_TOKEN);
  } catch (error) {
    logger.error(`❌ Failed to start bot: ${error.message}`);
    process.exit(1);
  }
}

start();
