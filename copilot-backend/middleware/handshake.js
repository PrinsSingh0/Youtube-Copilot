// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — STATELESS HANDSHAKE MIDDLEWARE (middleware/handshake.js)
//  Task 3.2: Block all requests failing the x-copilot-token header check
// ==============================================================================
import sysLogger from '../config/logger.js';

export const validateHandshake = (req, res, next) => {
  // Skip preflight OPTIONS requests
  if (req.method === 'OPTIONS') return next();

  const incomingToken = (req.headers['x-copilot-token'] || '').trim();
  const serverSecret = (process.env.APP_SECRET_TOKEN || '').trim();
  const globalAppSecret = (process.env.GLOBAL_APP_SECRET || '').trim();

  if (!incomingToken || (incomingToken !== serverSecret && incomingToken !== globalAppSecret)) {
    sysLogger.warn('Security Event: Unauthorized handshake attempt', {
      ip: req.ip,
      path: req.originalUrl,
      method: req.method,
    });
    return res.status(401).json({ error: 'Access Denied: Server handshake validation mismatch.' });
  }

  next();
};
