
const db = require('../db');
const logger = require('../utils/logger');

const OWNER_ID = process.env.BOT_ADMIN_ID;
const UPLOAD_CHANNEL_NAME = 'halal-menu-upload';
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const FETCH_TIMEOUT_MS = 60_000;   // 60s for image + API call
const API_TIMEOUT_MS   = 90_000;   // Claude Vision can be slow

function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

module.exports = {
  name: 'messageCreate',
  once: false,

  async execute(message) {
    // Ignore bots
    if (message.author.bot) return;

    // Only respond in the designated upload channel
    if (message.channel.name !== UPLOAD_CHANNEL_NAME) return;

    // Require BOT_ADMIN_ID to be configured
    if (!OWNER_ID) {
      logger.warn('BOT_ADMIN_ID not set — halal menu upload is disabled.');
      return;
    }

    // Only respond to the owner
    if (message.author.id !== OWNER_ID) {
      return message.reply('⛔ Only the bot owner can upload halal menus.');
    }

    // Must have exactly one image attachment
    const attachment = message.attachments.first();
    if (!attachment || !attachment.contentType?.startsWith('image/')) {
      return message.reply('⚠️ Please attach an image of the halal menu poster.');
    }

    const statusMsg = await message.reply('🔍 Reading the poster...');


    try {
      // Download the image and convert to base64

      const imageResponse = await fetchWithTimeout(attachment.url);
      const imageBuffer = await imageResponse.arrayBuffer();

      const image = await loadImage(Buffer.from(imageBuffer));
      const scale = Math.min(1, 1800 / image.width);
      const canvas = createCanvas(Math.floor(image.width * scale), Math.floor(image.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const compressedBuffer = canvas.toBuffer('image/jpeg', { quality: 0.85 });

      const base64Image = compressedBuffer.toString('base64');
      const mediaType = 'image/jpeg';
      // Send to Claude vision for extraction
      const claudeResponse = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: base64Image,
                  },
                },
                {
                  type: 'text',
                  text: `This is a halal lunch menu poster for Uzumasa Campus cafeteria.
The menu lists meals available on Tuesdays and Thursdays for a given month.

Extract every halal meal entry and return ONLY a JSON array, no markdown, no explanation.
Each object must have these fields:
- "dish_name": string
- "day_name": "Tuesday" or "Thursday"
- "menu_date": "YYYY-MM-DD" (infer from the month/year on the poster and the day names; if the poster shows week numbers, map them to actual calendar dates)
- If a dish name is obscured, crossed out, covered, or unreadable, skip that entry entirely — do not include it in the output.
Today's date for reference: ${new Date().toISOString().split('T')[0]}
- Remove the word "Halal" from the beginning of dish names if present, and ensure the first letter is capitalized.
- IMPORTANT: Ignore the date range shown in the title/header. Derive each item's date solely from the 販売日 (sale date) column in the table rows themselves.
Example output:
[
  { "dish_name": "Chicken Biryani", "day_name": "Tuesday", "menu_date": "2026-05-20" },
  { "dish_name": "Lamb Curry", "day_name": "Thursday", "menu_date": "2026-05-22" }
]

Return only the JSON array.`,
                },
              ],
            },
          ],
        }),
      }, API_TIMEOUT_MS);

      if (!claudeResponse.ok) {
        const err = await claudeResponse.text();
        logger.error(`Claude API error: ${err}`);
        return statusMsg.edit('❌ Claude API error. Check logs.');
      }

      const claudeData = await claudeResponse.json();
      const rawText = claudeData.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');

      // Parse the JSON response
      let items;
      try {
        const cleaned = rawText.replace(/```json|```/g, '').trim();
        items = JSON.parse(cleaned);
      } catch {
        logger.error(`Failed to parse Claude response: ${rawText}`);
        return statusMsg.edit(`❌ Claude returned unexpected output:\n\`\`\`\n${rawText.slice(0, 500)}\n\`\`\``);
      }

      if (!Array.isArray(items) || items.length === 0) {
        return statusMsg.edit('⚠️ No menu items found in the image. Try a clearer photo.');
      }

      // Insert into menu_items
      let inserted = 0;
      let skipped = 0;

      for (const item of items) {
        if (!item.dish_name || !item.menu_date || !item.day_name) {
          logger.warn(`Skipping incomplete item: ${JSON.stringify(item)}`);
          skipped++;
          continue;
        }

        try {
          await db.addHalalMenuItem({
            campus: 'Uzumasa',
            week_of: getWeekOf(item.menu_date),
            day_name: item.day_name,
            menu_date: item.menu_date,
            dish_name: item.dish_name,
          });
          inserted++;
        } catch (err) {
          logger.error(`Failed to insert halal item "${item.dish_name}": ${err.message}`);
          skipped++;
        }
      }

      const lines = items.map((i) => `• ${i.menu_date} (${i.day_name}): **${i.dish_name}**`).join('\n');
      return statusMsg.edit(
        `✅ Done — inserted **${inserted}** item(s), skipped **${skipped}**.\n\n${lines}`
      );

    } catch (err) {
      logger.error(`messageCreate halal handler error: ${err.message}`);
      return statusMsg.edit('❌ Something went wrong. Check the logs.');
    }
  },
};

// Returns the Monday date of the week containing the given date, e.g. "2026-05-18"
function getWeekOf(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysFromMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(year, month - 1, day - daysFromMonday);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const d = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
