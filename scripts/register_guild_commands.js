#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

// Simple arg parsing
const args = process.argv.slice(2);
let guildId = null;
let clientId = process.env.DISCORD_CLIENT_ID;
let token = process.env.DISCORD_BOT_TOKEN;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--guild' || args[i] === '-g') guildId = args[++i];
  if (args[i] === '--client' || args[i] === '-c') clientId = args[++i];
  if (args[i] === '--token' || args[i] === '-t') token = args[++i];
}

if (!guildId) {
  console.error('Usage: node scripts/register_guild_commands.js --guild <GUILD_ID> [--client <CLIENT_ID>] [--token <BOT_TOKEN>]');
  process.exit(1);
}

if (!clientId) {
  console.error('Missing client id. Set DISCORD_CLIENT_ID in .env or pass --client.');
  process.exit(1);
}

if (!token) {
  console.error('Missing bot token. Set DISCORD_BOT_TOKEN in .env or pass --token.');
  process.exit(1);
}

// Load command definitions from src/commands
const commands = [];
const commandsPath = path.join(__dirname, '..', 'src', 'commands');
if (!fs.existsSync(commandsPath)) {
  console.error('Commands directory not found:', commandsPath);
  process.exit(1);
}

const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  try {
    const command = require(filePath);
    if (command && command.data && typeof command.data.toJSON === 'function') {
      commands.push(command.data.toJSON());
    } else {
      console.warn(`Skipping ${file} — no valid command export`);
    }
  } catch (err) {
    console.warn(`Failed to load ${file}: ${err.message}`);
  }
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`Registering ${commands.length} commands to guild ${guildId}...`);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log('Commands registered successfully.');
  } catch (error) {
    console.error('Failed to register commands:', error);
    process.exit(1);
  }
})();
