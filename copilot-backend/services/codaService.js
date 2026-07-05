// ==============================================================================
//  YOUTUBE COPILOT — CODA SERVICE (services/codaService.js)
//  Handles real API interactions with Coda: page listing, page creation, content append
// ==============================================================================
import sysLogger from '../config/logger.js';
import { getDecryptedAccessToken } from './integrationService.js';

/**
 * Fetches all pages inside the user's first few Coda documents.
 * Returns array of { id: "docId:pageId", title: "[Doc Name] Page Name", object: "page" }
 */
export async function getUserPages(userId) {
  const userKey = await getDecryptedAccessToken(userId, 'coda');
  sysLogger.info('Coda: Fetching user documents', { userId });
  
  const docsRes = await fetch('https://coda.io/apis/v1/docs', {
    headers: { 'Authorization': `Bearer ${userKey}` }
  });
  if (!docsRes.ok) {
    const errData = await docsRes.json().catch(() => ({}));
    throw new Error(errData.message || `Coda docs fetch failed: ${docsRes.status}`);
  }
  
  const docsData = await docsRes.json();
  const docs = docsData.items || [];
  const allPages = [];
  
  // Fetch pages from first 5 documents to balance thoroughness and speed/rate limits
  const docsToFetch = docs.slice(0, 5);
  for (const doc of docsToFetch) {
    try {
      sysLogger.info(`Coda: Fetching pages for document: ${doc.name}`, { docId: doc.id });
      const pagesRes = await fetch(`https://coda.io/apis/v1/docs/${doc.id}/pages`, {
        headers: { 'Authorization': `Bearer ${userKey}` }
      });
      if (pagesRes.ok) {
        const pagesData = await pagesRes.json();
        const pages = pagesData.items || [];
        pages.forEach(p => {
          allPages.push({
            id: `${doc.id}:${p.id}`,
            title: `🥥 [${doc.name}] ${p.name}`,
            object: 'page'
          });
        });
      }
    } catch (err) {
      sysLogger.error(`Coda: Failed to fetch pages for doc ${doc.name}`, { error: err.message });
    }
  }
  
  return allPages;
}

/**
 * Creates a standalone page inside a Coda document.
 * If parentPageId is workspace_root or not selected, uses the first document.
 */
export async function createStandalonePage(userId, parentPageId, parentType, title, contentText) {
  const userKey = await getDecryptedAccessToken(userId, 'coda');
  
  let docId, parentId;
  if (parentPageId && parentPageId.includes(':') && parentPageId !== 'workspace_root') {
    [docId, parentId] = parentPageId.split(':');
  } else {
    sysLogger.info('Coda: No document context selected. Resolving default document.');
    const docsRes = await fetch('https://coda.io/apis/v1/docs', {
      headers: { 'Authorization': `Bearer ${userKey}` }
    });
    const docsData = await docsRes.json();
    const doc = docsData?.items?.[0];
    if (!doc) {
      throw new Error('Please create at least one Coda document in your workspace first.');
    }
    docId = doc.id;
  }
  
  sysLogger.info('Coda: Creating standalone page', { docId, parentPageId });
  const contentHtml = contentText
    .split('\n\n')
    .map(para => `<p>${para.trim().replace(/\n/g, '<br/>')}</p>`)
    .join('');

  const body = {
    name: title || 'YouTube Copilot Note',
    pageContent: {
      type: 'canvas',
      canvasContent: {
        format: 'html',
        content: contentHtml
      }
    }
  };
  
  if (parentId) {
    body.parentPageId = parentId;
  }

  const res = await fetch(`https://coda.io/apis/v1/docs/${docId}/pages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${userKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `Coda page creation failed: ${res.status}`);
  }

  return { 
    success: true, 
    pageId: `${docId}:${data.id}`, 
    url: data.browserLink || `https://coda.io/d/study-hub_d${docId}#_r${data.id}` 
  };
}

/**
 * Appends a written note to a Coda page.
 */
export async function appendNote(userId, docPageId, noteText) {
  const userKey = await getDecryptedAccessToken(userId, 'coda');
  if (!docPageId || !docPageId.includes(':')) {
    throw new Error('Invalid Coda destination ID. Must be in docId:pageId format.');
  }
  const [docId, pageId] = docPageId.split(':');
  
  sysLogger.info('Coda: Appending note to page', { docId, pageId });
  
  const contentHtml = noteText
    .split('\n\n')
    .map(para => `<p>${para.trim().replace(/\n/g, '<br/>')}</p>`)
    .join('');

  const body = {
    pageContent: {
      type: 'canvas',
      canvasContent: {
        format: 'html',
        content: contentHtml
      }
    },
    insertionMode: 'append'
  };

  const res = await fetch(`https://coda.io/apis/v1/docs/${docId}/pages/${pageId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${userKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || `Coda append note failed: ${res.status}`);
  }
  
  return { success: true, url: `https://coda.io/d/study-hub_d${docId}#_r${pageId}` };
}

/**
 * Appends a video screenshot/snapshot to a Coda page.
 */
export async function appendSnapshot(userId, docPageId, imageUrl, timestamp, title) {
  const userKey = await getDecryptedAccessToken(userId, 'coda');
  if (!docPageId || !docPageId.includes(':')) {
    throw new Error('Invalid Coda destination ID. Must be in docId:pageId format.');
  }
  const [docId, pageId] = docPageId.split(':');
  
  sysLogger.info('Coda: Appending snapshot to page', { docId, pageId });
  
  const minutes = Math.floor(timestamp / 60);
  const seconds = Math.floor(timestamp % 60).toString().padStart(2, '0');
  const timeStr = `${minutes}:${seconds}`;

  const imgHtml = `<h3>📸 Screenshot Context (${timeStr})</h3><p><img src="${imageUrl}" style="max-width:100%; border-radius:8px;" /></p>`;

  const body = {
    pageContent: {
      type: 'canvas',
      canvasContent: {
        format: 'html',
        content: imgHtml
      }
    },
    insertionMode: 'append'
  };

  const res = await fetch(`https://coda.io/apis/v1/docs/${docId}/pages/${pageId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${userKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || `Coda append snapshot failed: ${res.status}`);
  }
  
  return { success: true, url: `https://coda.io/d/study-hub_d${docId}#_r${pageId}` };
}
