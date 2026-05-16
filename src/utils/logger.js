const winston = require('winston');
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const isDev = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || (isDev ? 'debug' : 'info');

const sharedFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    if (stack) {
      return `${timestamp} [${level.toUpperCase()}] ${message}\n${stack}`;
    }
    return `${timestamp} [${level.toUpperCase()}] ${message}`;
  })
);

const logger = winston.createLogger({
  level: logLevel,
  format: sharedFormat,
  transports: [
    // Console transport — colorize runs after the shared formatter so the
    // timestamp and level are still present in the output.
    new winston.transports.Console({
      level: isDev ? 'debug' : 'warn',
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        sharedFormat
      ),
    }),
    // File transport
    new winston.transports.File({
      filename: path.join(logsDir, 'bot.log'),
      level: 'debug',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

module.exports = logger;
