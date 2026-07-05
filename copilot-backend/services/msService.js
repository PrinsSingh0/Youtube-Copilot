import sysLogger from '../config/logger.js';
import { getDecryptedAccessToken } from './integrationService.js';

/**
 * Appends an HTML-formatted note to a Microsoft OneNote section.
 * @param {string} userId     - Supabase user UUID (or raw Bearer token for sandbox)
 * @param {string} sectionId  - OneNote Section ID to append to
 * @param {string} noteText   - Note content
 * @param {string} title      - Page title
 */
export async function appendOneNotePage(userId, sectionId, noteText, title = 'YouTube Copilot Note') {
  sysLogger.info('Microsoft: appending OneNote page', { userId, sectionId, title });

  const token = await getDecryptedAccessToken(userId, 'ms');

  const htmlBody = `
<!DOCTYPE html>
<html>
  <head><title>${title}</title></head>
  <body>
    <h1>${title}</h1>
    <p style="font-family: Segoe UI, sans-serif; color: #333;">
      <strong>🎬 YouTube Copilot — Captured Note</strong>
    </p>
    <blockquote style="border-left: 4px solid #8DA9C4; padding-left: 12px; color: #444;">
      ${noteText}
    </blockquote>
    <p style="font-size: 11px; color: #999;">
      Captured at: ${new Date().toISOString()}
    </p>
  </body>
</html>`.trim();

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/me/onenote/sections/${sectionId}/pages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/xhtml+xml',
      },
      body: htmlBody,
    }
  );

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    sysLogger.error('Route Handler Fail [/api/export-ms]: Graph API Rejection', {
      status: response.status,
      message: errData.error?.message || 'Unknown error',
    });
    throw new Error(`Microsoft Graph API error: ${errData.error?.message || response.status}`);
  }

  const data = await response.json();
  sysLogger.info('Microsoft: OneNote page created successfully', { pageId: data.id });
  return { pageId: data.id, webUrl: data.links?.oneNoteWebUrl?.href };
}
