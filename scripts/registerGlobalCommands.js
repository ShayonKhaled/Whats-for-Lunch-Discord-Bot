#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const clientId = process.env.DISCORD_CLIENT_ID;
const token = process.env.DISCORD_BOT_TOKEN;

if (!clientId || !token) {
  console.error('Missing DISCORD_CLIENT_ID or DISCORD_BOT_TOKEN in .env');
  process.exit(1);
}

const commands = [];
const commandsPath = path.join(__dirname, '..', 'src', 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command?.data?.toJSON) {
    commands.push(command.data.toJSON());
  }
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log(`Registering ${commands.length} global commands...`);
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('Done. Commands will appear in all servers within ~1 hour.');
  } catch (err) {
    console.error('Failed:', err);
    process.exit(1);
  }
})();