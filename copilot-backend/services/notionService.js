// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — NOTION SERVICE (services/notionService.js)
//  Task 3.4: All Notion API operations isolated in one module
// ==============================================================================
import sysLogger from '../config/logger.js';
import { getDecryptedAccessToken } from './integrationService.js';

const NOTION_API_VERSION = '2022-06-28';

function getNotionHeaders(userKey) {
  return {
    'Authorization': `Bearer ${userKey}`,
    'Notion-Version': NOTION_API_VERSION,
    'Content-Type': 'application/json',
  };
}

/**
 * Fetches all pages & databases the integration has access to.
 * @param {string} userKey - User's Notion Integration Token
 */
export async function getUserPages(userId) {
  const userKey = await getDecryptedAccessToken(userId, 'notion');
  sysLogger.info('Notion: fetching user pages');
  const response = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers: getNotionHeaders(userKey),
    body: JSON.stringify({ sort: { direction: 'descending', timestamp: 'last_edited_time' } }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Notion Search Error');

  return (data.results || []).map(item => {
    let title = 'Untitled Notebook';
    if (item.object === 'database' && item.title?.[0]) {
      title = item.title[0].plain_text;
    } else if (item.object === 'page' && item.properties) {
      const titleProp = Object.values(item.properties).find(p => p.type === 'title');
      if (titleProp?.title?.[0]) title = titleProp.title[0].plain_text;
    }
    const icon = item.object === 'database' ? '🗂️' : '📝';
    return { id: item.id, title: `${icon} ${title}`, object: item.object };
  });
}

/**
 * Creates a new standalone child page under a parent page.
 */
export async function createNotebook(userId, parentPageId, title) {
  const userKey = await getDecryptedAccessToken(userId, 'notion');
  sysLogger.info('Notion: creating notebook', { title, parentPageId });
  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: getNotionHeaders(userKey),
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: parentPageId },
      properties: { title: { title: [{ text: { content: title } }] } },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Notion Page Creation Error');
  sysLogger.info('Notion: notebook created', { pageId: data.id, title });
  return { pageId: data.id, title };
}

/**
 * Creates a new standalone page either at the workspace root or inside a parent page/database.
 */
export async function createStandalonePage(userId, parentId, parentType, title, contentText, imageBase64 = null, timestamp = null) {
  const userKey = await getDecryptedAccessToken(userId, 'notion');
  sysLogger.info('Notion: creating standalone page', { parentId, parentType, title });

  let parent;
  if (parentId === 'workspace_root' || parentType === 'workspace' || !parentId) {
    parent = { type: 'workspace', workspace: true };
  } else if (parentType === 'database') {
    parent = { type: 'database_id', database_id: parentId };
  } else {
    parent = { type: 'page_id', page_id: parentId };
  }

  // Build page properties
  let properties = {};
  if (parent.type === 'database_id') {
    // Try "Name" as the database title column key first
    properties = {
      Name: {
        title: [{ text: { content: title } }]
      }
    };
  } else {
    // Pages use "title"
    properties = {
      title: {
        title: [{ text: { content: title } }]
      }
    };
  }

  // Build the children blocks
  const children = [];
  if (contentText) {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: contentText } }]
      }
    });
  }

  if (imageBase64) {
    try {
      const fileUploadId = await uploadImageToNotion(userKey, base64ToJpegBlob(imageBase64));
      const minutes = Math.floor((timestamp || 0) / 60);
      const seconds = Math.floor((timestamp || 0) % 60);
      const timeString = `${minutes}m ${seconds}s`;
      
      children.push({
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: [{ text: { content: `📸 Video Screenshot Context (${timeString})` } }] },
      });
      children.push({
        object: 'block',
        type: 'image',
        image: { type: 'file_upload', file_upload: { id: fileUploadId } },
      });
    } catch (err) {
      sysLogger.error('Notion: Image upload failed, creating text-only page', { error: err.message });
    }
  }

  const createPage = async (props) => {
    return await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: getNotionHeaders(userKey),
      body: JSON.stringify({
        parent,
        properties: props,
        ...(children.length > 0 ? { children } : {})
      }),
    });
  };

  let response = await createPage(properties);
  let data = await response.json();

  // Fallback: If database creation failed due to title property name, try "title"
  if (!response.ok && parent.type === 'database_id' && data.code === 'validation_error') {
    sysLogger.warn('Notion: database page creation failed with Name, trying title property fallback');
    properties = {
      title: {
        title: [{ text: { content: title } }]
      }
    };
    response = await createPage(properties);
    data = await response.json();
  }

  if (!response.ok) {
    throw new Error(data.message || 'Notion Page Creation Error');
  }

  sysLogger.info('Notion: standalone page created successfully', { pageId: data.id });
  return { pageId: data.id, url: data.url };
}


/**
 * Appends a styled callout block to a Notion page.
 */
export async function appendNote(userId, pageId, noteText, icon = '💡', color = 'purple_background', prefix = 'AI Recommended Note') {
  const userKey = await getDecryptedAccessToken(userId, 'notion');
  sysLogger.info('Notion: appending note block', { pageId, textLength: noteText.length });
  const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: getNotionHeaders(userKey),
    body: JSON.stringify({
      children: [{
        object: 'block',
        type: 'callout',
        callout: {
          icon: { type: 'emoji', emoji: icon },
          color,
          rich_text: [{ text: { content: `${prefix} — ${noteText}` } }],
        },
      }],
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Notion block append failed: ${errText}`);
  }
  sysLogger.info('Notion: note appended successfully', { pageId });
}

/**
 * Uploads a JPEG blob to Notion File Uploads API and returns the file upload ID.
 */
async function uploadImageToNotion(userKey, imageBlob) {
  const filename = `youtube-capture-${Date.now()}.jpg`;
  const headers = {
    'Authorization': `Bearer ${userKey}`,
    'Notion-Version': NOTION_API_VERSION,
    'Content-Type': 'application/json',
  };

  const createResponse = await fetch('https://api.notion.com/v1/file_uploads', {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode: 'single_part', filename, content_type: 'image/jpeg' }),
  });
  if (!createResponse.ok) {
    const errText = await createResponse.text();
    throw new Error(`Notion upload slot initialization failed: ${errText}`);
  }
  const fileUpload = await createResponse.json();
  const sendUrl = fileUpload.upload_url || `https://api.notion.com/v1/file_uploads/${fileUpload.id}/send`;

  const formData = new FormData();
  formData.append('file', imageBlob, filename);

  const sendResponse = await fetch(sendUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${userKey}`, 'Notion-Version': NOTION_API_VERSION },
    body: formData,
  });
  if (!sendResponse.ok) throw new Error('Notion file binary upload failed.');
  const uploaded = await sendResponse.json();
  return uploaded.id || fileUpload.id;
}

function base64ToJpegBlob(rawBase64) {
  const cleanBase64 = rawBase64.replace(/^data:image\/jpeg;base64,/, '');
  const binary = atob(cleanBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

/**
 * Appends a screenshot + heading block to a Notion page.
 */
export async function appendSnapshot(userId, pageId, imageBase64, timestamp) {
  const userKey = await getDecryptedAccessToken(userId, 'notion');
  const minutes = Math.floor((timestamp || 0) / 60);
  const seconds = Math.floor((timestamp || 0) % 60);
  const timeString = `${minutes}m ${seconds}s`;

  sysLogger.info('Notion: uploading snapshot', { pageId, timeString });
  const imageBlob = base64ToJpegBlob(imageBase64);
  const fileUploadId = await uploadImageToNotion(userKey, imageBlob);

  const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: getNotionHeaders(userKey),
    body: JSON.stringify({
      children: [
        {
          object: 'block',
          type: 'heading_3',
          heading_3: { rich_text: [{ text: { content: `📸 Video Screenshot Context (${timeString})` } }] },
        },
        {
          object: 'block',
          type: 'image',
          image: { type: 'file_upload', file_upload: { id: fileUploadId } },
        },
      ],
    }),
  });
  if (!response.ok) throw new Error('Notion Block Construction Error');
  sysLogger.info('Notion: snapshot appended successfully', { pageId, timeString });
}
