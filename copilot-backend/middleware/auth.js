import supabase from '../config/supabaseClient.js';
import sysLogger from '../config/logger.js';

export async function verifySecureHandshake(req, res, next) {
  // 1. Static Application Password Check
  const incomingAppToken = (req.headers['x-copilot-token'] || '').trim();
  const globalAppSecret = (process.env.GLOBAL_APP_SECRET || '').trim();

  if (!incomingAppToken || incomingAppToken !== globalAppSecret) {
    sysLogger.warn('Security Event: Unauthorized handshake attempt or mismatch on x-copilot-token', {
      ip: req.ip,
      path: req.originalUrl,
      method: req.method,
    });
    res.status(401).json({ error: 'Access Denied: Handshake token validation failed.' });
    return null;
  }

  // 2. Stateless Remote JWT Verification
  const authHeader = req.headers.authorization || req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sysLogger.warn('Security Event: Missing or malformed authorization header', {
      ip: req.ip,
      path: req.originalUrl,
    });
    res.status(401).json({ error: 'Missing or malformed authorization header.' });
    return null;
  }

  const token = authHeader.split(' ')[1];

  // Dev bypass for mock tokens
  if (process.env.NODE_ENV !== 'production' && token.endsWith('.mocksignature')) {
    try {
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      const mockUser = {
        id: payload.sub || '23331303-1918-41b3-9db4-482668fc695d',
        email: payload.email || 'prisingh751@gmail.com',
      };
      req.user = mockUser;
      if (typeof next === 'function') {
        return next();
      }
      return mockUser;
    } catch (e) {
      sysLogger.warn('Failed to parse mock token', { error: e.message });
    }
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      throw error || new Error('User profile not authenticated in remote service.');
    }

    req.user = user;
    if (typeof next === 'function') {
      return next();
    }
    return user;
  } catch (err) {
    sysLogger.warn({
      message: 'JWT verification failed against remote Supabase instance.',
      error: err.message,
      service: 'copilot-core-engine',
      ip: req.ip,
      path: req.originalUrl,
    });
    res.status(401).json({ error: 'Authentication challenge failed.', details: err.message });
    return null;
  }
}

// Export verifySupabaseJWT as an alias to preserve imports in other files
export const verifySupabaseJWT = verifySecureHandshake;
