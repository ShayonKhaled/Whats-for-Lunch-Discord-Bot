#!/usr/bin/env node
require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const db = require('../src/db');
const menuPublisher = require('../src/publishers/menuPublisher');

async function run() {
  try {
    await db.initConnection();
  } catch (err) {
    console.error('DB init failed:', err.message);
    process.exit(1);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}, running publisher now...`);
    try {
      await menuPublisher.publishMenu(client);
      console.log('Publish run complete');
    } catch (err) {
      console.error('Publish failed:', err.message);
    } finally {
      await db.closeConnection().catch(() => {});
      client.destroy();
      process.exit(0);
    }
  });

  client.login(process.env.DISCORD_BOT_TOKEN).catch((err) => {
    console.error('Discord login failed:', err.message);
    process.exit(1);
  });
}

run();
