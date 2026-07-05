// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — CENTRAL INTEGRATION SERVICE (services/integrationService.js)
// ==============================================================================
import supabase from '../config/supabaseClient.js';
import { decryptToken, encryptToken } from '../config/crypto.js';
import sysLogger from '../config/logger.js';

/**
 * Retrieves the decrypted access token for a given user and platform.
 * If the platform is 'google_docs' and the token is expired or close to expiration,
 * it automatically refreshes the token using the saved refresh token.
 * 
 * @param {string} userId - UUID of the authenticated user
 * @param {string} platformName - 'github', 'notion', 'google_docs'
 * @returns {Promise<string>} - The decrypted access token
 */
export async function getDecryptedAccessToken(userId, platformName) {
  // If the parameter is a raw token instead of a UUID (used for testing or sandbox), bypass lookup
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    sysLogger.info('DB: getDecryptedAccessToken received a raw token, bypassing database lookup', { platform: platformName });
    return userId;
  }

  if (!supabase) {
    throw new Error('Database service is not configured.');
  }

  sysLogger.info('DB: Looking up integration token', { userId, platform: platformName });

  const { data, error } = await supabase
    .from('user_integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('platform_name', platformName)
    .single();

  if (error || !data) {
    sysLogger.error('DB: Integration credentials lookup failed or not found', {
      userId,
      platform: platformName,
      error: error?.message,
    });
    throw new Error(`Integration for '${platformName}' is not linked. Please connect it first.`);
  }

  // Decrypt the token
  let token;
  try {
    token = decryptToken(data.encrypted_access_token, data.encryption_iv);
  } catch (err) {
    sysLogger.error('Crypto: Failed to decrypt access token. Deleting stale integration.', { userId, platform: platformName, error: err.message });
    try {
      await supabase
        .from('user_integrations')
        .delete()
        .eq('user_id', userId)
        .eq('platform_name', platformName);
    } catch (delErr) {
      sysLogger.error('DB: Failed to delete stale integration row', { error: delErr.message });
    }
    throw new Error('Encryption verification failed. Please reconnect the integration.');
  }

  // Google Docs Access Token automatic refresh logic (tokens expire in 1 hour)
  if (platformName === 'google_docs') {
    const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
    const isExpired = expiresAt - Date.now() < 300000; // Less than 5 minutes remaining

    if (isExpired && data.refresh_token) {
      sysLogger.info('GoogleDocs: Token expired or near expiration, attempting refresh...', { userId });
      try {
        const decryptedRefreshToken = decryptToken(data.refresh_token, data.encryption_iv);
        token = await refreshGoogleToken(userId, decryptedRefreshToken);
      } catch (err) {
        sysLogger.error('GoogleDocs: Auto-refresh failed', { userId, error: err.message });
        // Return current token as fallback, it might still work if clock skew
      }
    }
  }



  // Microsoft OneNote Access Token automatic refresh logic (tokens expire in 1 hour)
  if (platformName === 'ms') {
    const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
    const isExpired = expiresAt - Date.now() < 300000; // Less than 5 minutes remaining

    if (isExpired && data.refresh_token) {
      sysLogger.info('OneNote: Token expired or near expiration, attempting refresh...', { userId });
      try {
        const decryptedRefreshToken = decryptToken(data.refresh_token, data.encryption_iv);
        token = await refreshMsToken(userId, decryptedRefreshToken);
      } catch (err) {
        sysLogger.error('OneNote: Auto-refresh failed', { userId, error: err.message });
      }
    }
  }

  sysLogger.info('DB: Integration token retrieved successfully', { userId, platform: platformName });
  return token;
}

/**
 * Refreshes Google Docs OAuth access token using a refresh token.
 * 
 * @param {string} userId - UUID of the user
 * @param {string} refreshToken - The decrypted refresh token
 * @returns {Promise<string>} - The new decrypted access token
 */
async function refreshGoogleToken(userId, refreshToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Google client configurations are missing in .env');
  }

  sysLogger.info('GoogleDocs: Sending refresh token request', { userId });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const body = await res.json();
  if (!res.ok) {
    sysLogger.error('GoogleDocs: Refresh endpoint rejected credentials', { error: body });
    throw new Error(`Google refresh failed: ${body.error_description || body.error || res.status}`);
  }

  const newAccessToken = body.access_token;
  const expiresIn = body.expires_in || 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  // Encrypt the new access token
  const { encryptedText: encAccess, iv: accessIv } = encryptToken(newAccessToken);
  
  // Encrypt the new refresh token if Google returned one (Google sometimes returns it again, but usually not)
  let encRefresh = undefined;
  if (body.refresh_token) {
    const { encryptedText: rText } = encryptToken(body.refresh_token);
    encRefresh = rText;
  }

  const updatePayload = {
    encrypted_access_token: encAccess,
    encryption_iv: accessIv,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };

  if (encRefresh) {
    updatePayload.refresh_token = encRefresh;
  }

  const { error: updateErr } = await supabase
    .from('user_integrations')
    .update(updatePayload)
    .eq('user_id', userId)
    .eq('platform_name', 'google_docs');

  if (updateErr) {
    sysLogger.error('GoogleDocs: Failed to save refreshed token to database', { error: updateErr.message });
    throw updateErr;
  }

  sysLogger.info('GoogleDocs: Token refreshed and saved successfully', { userId });
  return newAccessToken;
}



/**
 * Refreshes Microsoft OneNote OAuth access token.
 */
async function refreshMsToken(userId, refreshToken) {
  const clientId = process.env.ONENOTE_CLIENT_ID;
  const clientSecret = process.env.ONENOTE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Microsoft OneNote client configurations are missing in .env');
  }

  sysLogger.info('OneNote: Sending refresh token request', { userId });

  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'offline_access Notes.Create user.read',
    }),
  });

  const body = await res.json();
  if (!res.ok) {
    sysLogger.error('OneNote: Refresh endpoint rejected credentials', { error: body });
    throw new Error(`OneNote refresh failed: ${body.error_description || body.error || res.status}`);
  }

  const newAccessToken = body.access_token;
  const expiresIn = body.expires_in || 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  const { encryptedText: encAccess, iv: accessIv } = encryptToken(newAccessToken);

  let encRefresh = undefined;
  if (body.refresh_token) {
    const { encryptedText: rText } = encryptToken(body.refresh_token);
    encRefresh = rText;
  }

  const updatePayload = {
    encrypted_access_token: encAccess,
    encryption_iv: accessIv,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };

  if (encRefresh) {
    updatePayload.refresh_token = encRefresh;
  }

  const { error: updateErr } = await supabase
    .from('user_integrations')
    .update(updatePayload)
    .eq('user_id', userId)
    .eq('platform_name', 'ms');

  if (updateErr) {
    sysLogger.error('OneNote: Failed to save refreshed token to database', { error: updateErr.message });
    throw updateErr;
  }

  sysLogger.info('OneNote: Token refreshed and saved successfully', { userId });
  return newAccessToken;
}
