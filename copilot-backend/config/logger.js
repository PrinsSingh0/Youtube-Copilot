// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — WINSTON PRODUCTION LOGGING ENGINE (config/logger.js)
//  Task 1.4: Structured JSON logger per TRD §6.1
// ==============================================================================
import winston from 'winston';

const productionFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const sysLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: productionFormat,
  defaultMeta: { service: 'copilot-core-engine' },
  transports: [
    new winston.transports.Console()
  ],
});

export default sysLogger;
