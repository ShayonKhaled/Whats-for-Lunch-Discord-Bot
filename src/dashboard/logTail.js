/**
 * src/dashboard/logTail.js
 *
 * Reads recent entries out of logs/bot.log for the dashboard's error panel.
 *
 * The delivery log answers "did this guild get the menu"; it cannot answer
 * "did the publisher throw before it got that far". Those failures only exist
 * in the winston file transport, so the dashboard reads it directly.
 *
 * Only the tail of the file is read. The transport rotates at 5 MB and parsing
 * all of it on every poll would be wasteful for the last few dozen lines.
 */

const fs = require('fs/promises');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../logs/bot.log');

/** How much of the end of the file to parse. Comfortably more than one screen. */
const TAIL_BYTES = 256 * 1024;

/** Matches the logger's printf format: `2026-08-12 04:10:33 [ERROR] message` */
const ENTRY_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[([A-Z]+)\] ([\s\S]*)$/;

const LEVEL_RANK = { DEBUG: 10, VERBOSE: 20, INFO: 30, WARN: 40, ERROR: 50 };

/**
 * @param {object} [options]
 * @param {string} [options.minLevel='WARN'] lowest level to include
 * @param {number} [options.limit=100]       most recent N entries
 * @param {string} [options.file]            override the log path (tests)
 * @returns {Promise<{entries: object[], available: boolean, reason?: string}>}
 */
async function readRecent({ minLevel = 'WARN', limit = 100, file = LOG_FILE } = {}) {
  const threshold = LEVEL_RANK[minLevel.toUpperCase()] ?? LEVEL_RANK.WARN;

  let handle;
  try {
    handle = await fs.open(file, 'r');
  } catch (err) {
    // A missing log file is normal on a fresh install, not an error worth
    // failing the whole dashboard request over.
    return { entries: [], available: false, reason: err.code === 'ENOENT' ? 'no log file yet' : err.message };
  }

  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const length = size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);

    let text = buffer.toString('utf8');
    // Reading from a byte offset almost certainly lands mid-line; drop the
    // first partial line so it is not parsed as a stack-trace continuation.
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);

    const entries = parseEntries(text).filter(
      (e) => (LEVEL_RANK[e.level] ?? LEVEL_RANK.INFO) >= threshold
    );

    return { entries: entries.slice(-limit).reverse(), available: true };
  } finally {
    await handle.close();
  }
}

/**
 * Splits log text into entries. Lines that do not start with a timestamp are
 * continuations of the previous entry — winston appends stack traces that way.
 */
function parseEntries(text) {
  const entries = [];

  for (const line of text.split('\n')) {
    const match = ENTRY_RE.exec(line);
    if (match) {
      entries.push({ timestamp: match[1], level: match[2], message: match[3] });
    } else if (line.trim() && entries.length > 0) {
      entries[entries.length - 1].message += `\n${line}`;
    }
  }
  return entries;
}

module.exports = { readRecent, parseEntries, LOG_FILE };
