#!/usr/bin/env node
require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const db = require('../src/db');
const { formatMenuMessage } = require('../src/utils/formatMenu');

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

async function run() {
  try {
    await db.initConnection();
  } catch (err) {
    console.error('DB init failed:', err.message);
    process.exit(1);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}. Sending sample menu to subscriptions...`);

    try {
      const subs = await db.getActiveSubscriptions();
      console.log(`Found ${subs.length} active subscription(s)`);

      if (subs.length === 0) {
        console.log('No subscriptions found; nothing to send.');
        await db.closeConnection().catch(() => {});
        client.destroy();
        process.exit(0);
      }

      const chunks = formatMenuMessage(sampleMenu);

      for (const s of subs) {
        try {
          const channel = await client.channels.fetch(s.channel_id).catch(() => null);
          if (!channel) {
            console.warn(`Channel not found for guild ${s.guild_name} (${s.channel_id})`);
            continue;
          }

          let first = true;
          for (const chunk of chunks) {
            const content = first ? `📢 **Sample Menu**\n${chunk}` : chunk;
            await channel.send({ content });
            first = false;
          }
          console.log(`Sent sample to ${s.guild_name} / #${s.channel_name}`);
        } catch (err) {
          console.error(`Failed to send to ${s.guild_name}: ${err.message}`);
        }
      }
    } catch (err) {
      console.error('Publisher error:', err.message);
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
