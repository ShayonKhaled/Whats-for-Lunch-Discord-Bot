#!/usr/bin/env node
require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const { formatMenuMessage } = require('../src/utils/formatMenu');

const args = process.argv.slice(2);
let channelId = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--channel' || args[i] === '-c') channelId = args[++i];
}

if (!channelId) {
  console.error('Usage: node scripts/sendTestMessage.js --channel <CHANNEL_ID>');
  process.exit(1);
}

const sampleMenu = [
  {
    menu_date: '2026-05-18',
    day_name: 'Monday',
    category: 'Set Meals',
    subcategory: 'Campus Lunch (1)',
    dish_name: 'Sample Set A',
    calories: 650,
    protein: 25,
    fat: 20,
    allergens: 'Milk, Soy',
  },
  {
    menu_date: '2026-05-18',
    day_name: 'Monday',
    category: 'A La Carte',
    subcategory: 'A La Carte',
    dish_name: 'Sample Curry',
    calories: 520,
    protein: 18,
    fat: 15,
    allergens: 'Wheat',
  },
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}. Sending test menu to ${channelId}...`);
  try {
    const chunks = formatMenuMessage(sampleMenu);
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.error('Channel not found or bot missing access:', channelId);
      process.exit(1);
    }

    for (const chunk of chunks) {
      await channel.send({ content: chunk });
    }
    console.log('Test message sent.');
  } catch (err) {
    console.error('Failed to send test message:', err.message);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN).catch((err) => {
  console.error('Discord login failed:', err.message);
  process.exit(1);
});
