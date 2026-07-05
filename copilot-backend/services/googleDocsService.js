// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — GOOGLE DOCS SERVICE (services/googleDocsService.js)
//  Appends formatted text to a Google Doc using the Docs REST API.
//  Auth: OAuth2 Bearer token (user token or service account access token)
// ==============================================================================
import sysLogger from '../config/logger.js';
import { getDecryptedAccessToken } from './integrationService.js';

const DOCS_API_BASE = 'https://docs.googleapis.com/v1/documents';

/**
 * Appends a formatted note block to the END of a Google Document.
 * @param {string} userId      - Supabase user UUID
 * @param {string} documentId   - The Google Doc ID (from the URL)
 * @param {string} noteText     - The note content to append
 * @param {string} title        - Section heading for the note
 * @param {object} meta         - Optional metadata { sourceUrl, timestamp }
 * @returns {Promise<{documentId: string, revisionsUpdated: number}>}
 */
export async function appendToGoogleDoc(userId, documentId, noteText, title = 'YouTube Copilot Note', meta = {}) {
  const accessToken = await getDecryptedAccessToken(userId, 'google_docs');
  sysLogger.info('GoogleDocs: fetching current document end index', { documentId });

  // ── 1. Get current doc to find end-of-body index ──────────────────────────
  const getRes = await fetch(`${DOCS_API_BASE}/${documentId}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!getRes.ok) {
    const err = await getRes.json().catch(() => ({}));
    sysLogger.error('GoogleDocs: failed to fetch document', {
      status: getRes.status,
      message: err.error?.message,
    });
    throw new Error(`Google Docs GET failed: ${err.error?.message || getRes.status}`);
  }

  const doc = await getRes.json();

  // The body content array — last element is always the terminal newline paragraph
  const bodyContent = doc.body?.content || [];
  const lastElement = bodyContent[bodyContent.length - 1];
  // insertIndex must be BEFORE the last newline (endIndex - 1)
  const insertIndex = (lastElement?.endIndex ?? 2) - 1;

  sysLogger.info('GoogleDocs: inserting at index', { documentId, insertIndex });

  // ── 2. Build the batchUpdate request ─────────────────────────────────────
  const metaLine = meta.sourceUrl
    ? `\nSource: ${meta.sourceUrl}${meta.timestamp ? ` @ ${meta.timestamp}` : ''}\n`
    : '\n';

  const fullText = `\n─────────────────────────\n📝 ${title}\n${metaLine}${noteText}\n`;

  const requests = [];

  if (meta.imageUri) {
    requests.push({
      insertInlineImage: {
        uri: meta.imageUri,
        location: { index: insertIndex },
        objectSize: {
          height: { magnitude: 270, unit: 'PT' },
          width: { magnitude: 480, unit: 'PT' }
        }
      }
    });
  }

  requests.push({
    insertText: {
      location: { index: insertIndex },
      text: fullText,
    },
  });

  requests.push({
    updateParagraphStyle: {
      range: {
        startIndex: insertIndex + 1, // after the leading \n
        endIndex: insertIndex + 1 + `─────────────────────────\n`.length,
      },
      paragraphStyle: { namedStyleType: 'NORMAL_TEXT' },
      fields: 'namedStyleType',
    },
  });

  const batchRes = await fetch(`${DOCS_API_BASE}/${documentId}:batchUpdate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  });

  if (!batchRes.ok) {
    const err = await batchRes.json().catch(() => ({}));
    sysLogger.error('GoogleDocs: batchUpdate failed', {
      status: batchRes.status,
      message: err.error?.message,
    });
    throw new Error(`Google Docs batchUpdate failed: ${err.error?.message || batchRes.status}`);
  }

  const result = await batchRes.json();
  const revisionsUpdated = result.replies?.length || 0;

  sysLogger.info('GoogleDocs: note appended successfully', { documentId, revisionsUpdated });
  return {
    documentId,
    revisionsUpdated,
    docUrl: `https://docs.google.com/document/d/${documentId}/edit`,
  };
}
