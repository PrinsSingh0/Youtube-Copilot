import 'dotenv/config';
import sysLogger from './config/logger.js';

// ─── Environment Validation Gate ─────────────────────────────────────────────
const supabaseUrlVal = process.env.SUPABASE_URL || '';
const supabaseAnonKeyVal = process.env.SUPABASE_ANON_KEY || '';
const encryptionSecretVal = process.env.ENCRYPTION_SECRET_KEY || '';
const globalAppSecretVal = process.env.GLOBAL_APP_SECRET || '';

const isUrlInvalid = !supabaseUrlVal || ['placeholder', 'your_project_id'].some(p => supabaseUrlVal.toLowerCase().includes(p));
const isAnonKeyInvalid = !supabaseAnonKeyVal || ['placeholder', 'your_project_id'].some(p => supabaseAnonKeyVal.toLowerCase().includes(p));
const isEncryptionSecretInvalid = !encryptionSecretVal || ['placeholder', 'your_project_id'].some(p => encryptionSecretVal.toLowerCase().includes(p));
const isGlobalAppSecretInvalid = !globalAppSecretVal || ['placeholder', 'your_project_id'].some(p => globalAppSecretVal.toLowerCase().includes(p));

if (isUrlInvalid || isAnonKeyInvalid || isEncryptionSecretInvalid || isGlobalAppSecretInvalid) {
  sysLogger.error({
    message: 'CRITICAL INITIALIZATION FAILURE: Required environment variables (SUPABASE_URL, SUPABASE_ANON_KEY, ENCRYPTION_SECRET_KEY, GLOBAL_APP_SECRET) are missing, undefined, or contain placeholder strings.',
    SUPABASE_URL: isUrlInvalid ? '❌ INVALID / PLACEHOLDER' : '✅ SET',
    SUPABASE_ANON_KEY: isAnonKeyInvalid ? '❌ INVALID / PLACEHOLDER' : '✅ SET',
    ENCRYPTION_SECRET_KEY: isEncryptionSecretInvalid ? '❌ INVALID / PLACEHOLDER' : '✅ SET',
    GLOBAL_APP_SECRET: isGlobalAppSecretInvalid ? '❌ INVALID / PLACEHOLDER' : '✅ SET',
    action: 'Hard process termination due to misconfigured environment block.',
    service: 'copilot-core-engine'
  });
  process.exit(1);
}

// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — CORE APP CONTROLLER (server.js)
//  Production routing pipeline — dispatches by x-target-platform header
//  All bypass/mock logic deprecated. Live Supabase credentials required.
// ==============================================================================
import express from 'express';
import cors from 'cors';
import supabase from './config/supabaseClient.js';
import { encryptToken } from './config/crypto.js';

import { validateHandshake } from './middleware/handshake.js';
import { verifySupabaseJWT } from './middleware/auth.js';

import { polishTranscription, generateSuggestion, executeEditIntent } from './services/aiService.js';
import { getUserPages, createNotebook, appendNote, appendSnapshot, createStandalonePage } from './services/notionService.js';

import { appendToGoogleDoc } from './services/googleDocsService.js';
import { getDecryptedAccessToken } from './services/integrationService.js';
import { 
  getUserPages as codaGetUserPages, 
  createStandalonePage as codaCreateStandalonePage, 
  appendNote as codaAppendNote, 
  appendSnapshot as codaAppendSnapshot 
} from './services/codaService.js';
import {
  codaAutoProvisionDoc,
  codaAppendSnapshotDirect,
  codaAppendNoteDirect,
  codaGetDocPages
} from './services/pkmServices.js';
import analyticsRouter from './routes/analytics.js';
import * as orchestrator from './src/agent/orchestrator.js';

// ─── Bootstrap ───────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Production whitelist: all sanctioned educational platforms
const allowedOrigins = [
  'https://www.youtube.com',
  'https://youtube.com',
  'https://www.udemy.com',
  'https://udemy.com',
  'https://www.coursera.org',
  'https://coursera.org',
  'https://unacademy.com',
  'https://www.unacademy.com',
  'https://scaler.com',
  'https://www.scaler.com',
];

// In development, also allow localhost extension testing
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:3000', 'http://localhost:5173', 'null');
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (service workers, Render health checks)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || origin.startsWith('chrome-extension://')) return callback(null, true);
    sysLogger.warn('CORS block', { blockedOrigin: origin });
    return callback(new Error('Blocked by CORS security policy'));
  },
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  credentials: true,
  optionsSuccessStatus: 200,
}));

app.use(express.json({ limit: '50mb' }));

// ─── Health Probe ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'healthy', version: '4.0.0', timestamp: new Date().toISOString() });
});

// ─── Handshake Middleware (applied to all /api/* routes) ─────────────────────
app.use('/api', validateHandshake);
app.use('/api', analyticsRouter);

// Helper to extract platform user key
function getDestinationKey(req) {
  return req.headers['x-user-destination-key'] || '';
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE 1: Usage Heartbeat Telemetry (Phase 4.2)
//  POST /api/usage-heartbeat
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/usage-heartbeat', async (req, res) => {
  try {
    const user = await verifySupabaseJWT(req, res);
    if (!user) return;

    const {
      incrementSeconds = 30,
      videoId,
      videoTitle,
      platformOrigin,
      topicTag
    } = req.body;

    const { data, error } = await supabase.rpc('increment_user_heartbeat', {
      target_user_id: user.id,
      increment_seconds: incrementSeconds,
    });

    if (error) throw error;

    const result = data?.[0];
    if (!result?.can_proceed) {
      sysLogger.info('Heartbeat: daily limit reached', { userId: user.id });
      return res.status(402).json({
        status: 'blocked',
        tier: result?.current_tier || 'EXPIRED_FREE',
        message: 'Daily speech limit exhausted.',
      });
    }

    if (videoId) {
      const { error: eventError } = await supabase.rpc('log_event_and_calculate_streak', {
        target_user_id: user.id,
        target_topic: topicTag || 'Focus',
        target_destination: 'notion',
        target_video_id: videoId,
        target_video_title: videoTitle || 'Unknown Video',
        target_platform: platformOrigin || 'youtube',
        seconds_watched: incrementSeconds,
      });

      if (eventError) {
        sysLogger.error('Failed to log event and calculate streak:', { error: eventError.message });
      } else {
        sysLogger.info('Heartbeat: event logged and streak calculated successfully', { userId: user.id, videoId });
      }
    }

    sysLogger.info('Heartbeat: tick recorded', { userId: user.id, tier: result.current_tier });
    return res.status(200).json({
      status: 'allowed',
      tier: result.current_tier,
      minutesRemaining: result.minutes_remaining,
    });
  } catch (err) {
    sysLogger.error('Route Handler Fail [/api/usage-heartbeat]', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE 2: Tier Status Check
//  GET /api/tier-status
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/tier-status', async (req, res) => {
  try {
    const user = await verifySupabaseJWT(req, res);
    if (!user) return;

    const { data: profile } = await supabase
      .from('users')
      .select('stripe_subscription_status, trial_start_date')
      .eq('id', user.id)
      .single();

    if (!profile) return res.status(404).json({ error: 'User profile not found.' });

    const trialStart = new Date(profile.trial_start_date);
    const daysSinceTrialStart = (Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24);
    const isTrialActive = daysSinceTrialStart <= 7;
    const isPremium = profile.stripe_subscription_status === 'active';
    const isPaywallDay = !isTrialActive && !isPremium;

    let tier = 'ACTIVE_FREE';
    if (isPremium) tier = 'PREMIUM';
    else if (isTrialActive) tier = 'TRIAL';
    else if (isPaywallDay) tier = 'EXPIRED_FREE';

    sysLogger.info('Tier status check', { userId: user.id, tier });
    return res.status(200).json({
      tier,
      isPaywallDay,
      daysSinceTrialStart: Math.floor(daysSinceTrialStart),
      subscriptionStatus: profile.stripe_subscription_status,
    });
  } catch (err) {
    sysLogger.error('Route Handler Fail [/api/tier-status]', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE 3: Notion — Get User Pages
//  GET /api/notion/pages
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/notion/pages', async (req, res) => {
  try {
    const user = await verifySupabaseJWT(req, res);
    if (!user) return;

    const pages = await getUserPages(user.id);
    sysLogger.info('Notion Search Sync: Successfully parsed workspace elements', { count: pages.length, userId: user.id });
    return res.json({ success: true, pages });
  } catch (err) {
    sysLogger.error('Route Handler Fail [/api/notion/pages]', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE 3.1: Coda — Get User Pages
//  GET /api/coda/pages
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/coda/pages', async (req, res) => {
  try {
    const user = await verifySupabaseJWT(req, res);
    if (!user) return;

    const pages = await codaGetDocPages(user.id);
    sysLogger.info('Coda Search Sync: Successfully parsed pages from provisioned doc', { count: pages.length, userId: user.id });
    return res.json({ success: true, pages });
  } catch (err) {
    sysLogger.error('Route Handler Fail [/api/coda/pages]', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});



// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE 4: Notion — Create Notebook
//  POST /api/notion/create-notebook
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/notion/create-notebook', async (req, res) => {
  try {
    const user = await verifySupabaseJWT(req, res);
    if (!user) return;

    const { title, parentPageId } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'Notebook title is required.' });

    const result = await createNotebook(user.id, parentPageId || process.env.NOTION_WORKSPACE_HUB_ID, title);
    return res.json({ success: true, ...result });
  } catch (err) {
    sysLogger.error('Route Handler Fail [/api/notion/create-notebook]', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE 5: Notion — Append Snapshot
//  POST /api/notion/append-snapshot
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/notion/append-snapshot', async (req, res) => {
  try {
    const user = await verifySupabaseJWT(req, res);
    if (!user) return;

    const { targetPageId, parentType, imageData, timestamp, title, createIndividualPage } = req.body;
    if (!imageData) return res.status(400).json({ success: false, error: 'No image data received.' });

    if (targetPageId === 'workspace_root' || createIndividualPage) {
      const pageTitle = title || 'YouTube Copilot Frame Capture';
      const result = await createStandalonePage(user.id, targetPageId, parentType, pageTitle, '', imageData, timestamp);
      return res.json({ success: true, ...result });
    } else {
      await appendSnapshot(user.id, targetPageId, imageData, timestamp);
      return res.json({ success: true });
    }
  } catch (err) {
    sysLogger.error('Route Handler Fail [/api/notion/append-snapshot]', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE 6: Universal Export Pipeline
//  POST /api/export  —  dispatches by x-target-platform header
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/export', async (req, res) => {
  const platform = (req.headers['x-target-platform'] || '').toLowerCase();
  const containerId = req.headers['x-user-container-id'] || '';

  try {
    const user = await verifySupabaseJWT(req, res);
    if (!user) return;

    const { noteText, title = 'YouTube Copilot Note', transcription } = req.body;
    const rawText = noteText || transcription;
    if (!rawText) return res.status(400).json({ success: false, error: 'Note text is required.' });

    // Gemini polish pass before export
    const polishedText = await polishTranscription(rawText);

    let result;
    switch (platform) {
      case 'notion': {
        const createIndiv = req.headers['x-create-individual-page'] === 'true' || req.body.createIndividualPage;
        const parentType = req.headers['x-parent-type'] || req.body.parentType || 'page';
        if (containerId === 'workspace_root' || createIndiv) {
          const pageResult = await createStandalonePage(user.id, containerId, parentType, title || 'YouTube Copilot Note', polishedText);
          result = { success: true, platform: 'notion', ...pageResult };
        } else {
          await appendNote(user.id, containerId, polishedText, '🎙️', 'blue_background', 'AI Transcription Note');
          result = { success: true, platform: 'notion' };
        }
        sysLogger.info('Export: Notion note processed', { userId: user.id, pageId: containerId });
        break;
      }

      case 'googledocs': {
        const docResult = await appendToGoogleDoc(user.id, containerId, polishedText, title);
        result = { success: true, platform: 'googledocs', url: docResult.docUrl };
        sysLogger.info('Export: Google Docs note appended', { userId: user.id, docId: containerId });
        break;
      }
      default:
        return res.status(400).json({ success: false, error: `Unknown platform: "${platform}". Use notion | googledocs.` });
    }

    return res.json({ ...result, polishedText });
  } catch (err) {
    sysLogger.error(`Route Handler Fail [/api/export-${platform}]`, { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE 7: AI Suggestion Engine
//  POST /api/generate-suggestions
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/generate-suggestions', async (req, res) => {
  try {
    const { currentText, transcriptContext, imageData } = req.body;
    const suggestion = await generateSuggestion(currentText, transcriptContext, imageData);
    return res.json({ success: true, suggestion });
  } catch (err) {
    sysLogger.error('Route Handler Fail [/api/generate-suggestions]', { error: err.message });
    const isQuotaExceeded = err.message && (
      err.message.includes('429') || 
      err.message.includes('quota') || 
      err.message.includes('Quota') || 
      err.message.includes('limit') || 
      err.message.includes('RESOURCE_EXHAUSTED')
    );
    let fallbackSuggestion = 'AI Suggestion temporarily unavailable. Keep typing to take notes!';
    if (isQuotaExceeded) {
      fallbackSuggestion = 'AI quota exceeded for today. You can still type or dictate notes directly!';
    }
    return res.json({ success: true, suggestion: fallbackSuggestion, isFallback: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE 8: Conversational Edit Intent Engine
//  POST /api/edit-intent
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/edit-intent', async (req, res) => {
  try {
    const { currentText, voiceCommand } = req.body;
    if (!currentText || !voiceCommand) {
      return res.status(400).json({ success: false, error: 'currentText and voiceCommand are required.' });
    }
    const updatedText = await executeEditIntent(currentText, voiceCommand);
    return res.json({ success: true, updatedText });
  } catch (err) {
    sysLogger.error('Route Handler Fail [/api/edit-intent]', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Legacy Notion Routes (backward compat for old content.js during migration) ──
app.get('/api/get-user-pages', async (req, res) => {
  req.headers['x-target-platform'] = 'notion';
  const userKey = req.headers['x-user-destination-key'] || process.env.NOTION_API_KEY;
  try {
    const pages = await getUserPages(userKey);
    sysLogger.info('[Legacy] Notion pages fetch', { count: pages.length });
    return res.json({ success: true, pages });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/create-notebook', async (req, res) => {
  const userKey = req.headers['x-user-destination-key'] || process.env.NOTION_API_KEY;
  const { title, parentPageId } = req.body;
  const parentId = parentPageId || process.env.NOTION_WORKSPACE_HUB_ID;
  try {
    const result = await createNotebook(userKey, parentId, title);
    return res.json({ success: true, ...result });
  } catch (err) {
    sysLogger.error('Route Handler Fail [/api/create-notebook]', { error: err.message, stack: err.stack });
    return res.status(500).json({ success: false, error: err.message });
  }
});

function getUserKey(req, platform) {
  if (req.headers['x-user-destination-key']) {
    return req.headers['x-user-destination-key'];
  }

  if (platform === 'googledocs') return process.env.TEST_GDOCS_ACCESS_TOKEN || '';
  return process.env.NOTION_API_KEY || '';
}

async function uploadImageToTmpFiles(imageData) {
  try {
    const buffer = Buffer.from(imageData, 'base64');
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    const formData = new FormData();
    formData.append('file', blob, `snapshot-${Date.now()}.jpg`);

    const uploadRes = await fetch('https://tmpfiles.org/api/v1/upload', {
      method: 'POST',
      body: formData
    });
    if (!uploadRes.ok) throw new Error(`tmpfiles.org upload failed: ${uploadRes.statusText}`);
    const uploadData = await uploadRes.json();
    if (uploadData.status === 'success') {
      return uploadData.data.url.replace('https://tmpfiles.org/', 'https://tmpfiles.org/dl/');
    }
  } catch (err) {
    sysLogger.warn('Temporary image upload failed', { error: err.message });
  }
  return null;
}

app.post('/api/append-snapshot', async (req, res) => {
  const platform = (req.headers['x-target-platform'] || 'notion').toLowerCase();
  try {
    const { targetPageId, parentType, imageData, timestamp, title, createIndividualPage } = req.body;
    const user = await verifySupabaseJWT(req, res);
    if (!user) return;

    const targetPlatform = platform.toLowerCase();
    
    if (targetPlatform === 'coda') {
      const imageUrl = await uploadImageToTmpFiles(imageData);
      if (!imageUrl) {
        return res.status(500).json({ success: false, error: "Failed to upload image context for Coda integration." });
      }
      
      const result = await codaAppendSnapshotDirect(user.id, imageUrl, timestamp, title, targetPageId);
      return res.json(result);
    }





    if (platform === 'googledocs') {
      sysLogger.info(`Initiating Google Docs snapshot append for document: "${targetPageId}"`);
      const minutes = Math.floor(timestamp / 60);
      const seconds = Math.floor(timestamp % 60).toString().padStart(2, '0');
      const timeStr = `${minutes}:${seconds}`;

      const imageUrl = await uploadImageToTmpFiles(imageData);

      const docResult = await appendToGoogleDoc(
        user.id, 
        targetPageId, 
        `📸 Video Screenshot Context (${timeStr})`, 
        title || 'YouTube Copilot Frame Capture', 
        { imageUri: imageUrl || undefined }
      );
      return res.json({ success: true, url: docResult.docUrl });
    }





    if (targetPageId === 'workspace_root' || createIndividualPage) {
      const pageTitle = title || 'YouTube Copilot Frame Capture';
      const result = await createStandalonePage(user.id, targetPageId, parentType, pageTitle, '', imageData, timestamp);
      return res.json({ success: true, ...result });
    } else {
      await appendSnapshot(user.id, targetPageId, imageData, timestamp);
      return res.json({ success: true });
    }
  } catch (err) {
    sysLogger.error(`Route Handler Fail [/api/append-snapshot] (${platform})`, { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/append-audio', async (req, res) => {
  const platform = (req.headers['x-target-platform'] || 'notion').toLowerCase();
  const { targetPageId, parentType, transcription, title, createIndividualPage } = req.body;
  try {
    const user = await verifySupabaseJWT(req, res);
    if (!user) return;

    const polishedText = await polishTranscription(transcription);



    if (platform === 'googledocs') {
      sysLogger.info(`Initiating Google Docs voice note append for document: "${targetPageId}"`);
      const docResult = await appendToGoogleDoc(user.id, targetPageId, polishedText, title || 'YouTube Copilot Audio Note');
      return res.json({ success: true, polishedText, url: docResult.docUrl });
    }





    if (targetPageId === 'workspace_root' || createIndividualPage) {
      const result = await createStandalonePage(user.id, targetPageId, parentType, title || 'YouTube Copilot Audio Note', polishedText);
      return res.json({ success: true, polishedText, ...result });
    } else {
      await appendNote(user.id, targetPageId, polishedText, '🎙️', 'blue_background', 'AI Transcription Note');
      return res.json({ success: true, polishedText });
    }
  } catch (err) {
    sysLogger.error(`Route Handler Fail [/api/append-audio] (${platform})`, { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/append-note', async (req, res) => {
  const platform = (req.headers['x-target-platform'] || 'notion').toLowerCase();
  const { targetPageId, parentType, noteText, title, createIndividualPage } = req.body;
  try {
    const user = await verifySupabaseJWT(req, res);
    if (!user) return;

    const targetPlatform = platform.toLowerCase();
    
    if (targetPlatform === 'coda') {
      const result = await codaAppendNoteDirect(user.id, noteText, title, targetPageId);
      return res.json(result);
    }





    if (platform === 'googledocs') {
      sysLogger.info(`Initiating Google Docs note append for document: "${targetPageId}"`);
      const docResult = await appendToGoogleDoc(user.id, targetPageId, noteText, title || 'YouTube Copilot Note');
      return res.json({ success: true, url: docResult.docUrl });
    }





    if (targetPageId === 'workspace_root' || createIndividualPage) {
      const result = await createStandalonePage(user.id, targetPageId, parentType, title || 'YouTube Copilot Note', noteText);
      return res.json({ success: true, ...result });
    } else {
      await appendNote(user.id, targetPageId, noteText);
      return res.json({ success: true });
    }
  } catch (err) {
    sysLogger.error(`Route Handler Fail [/api/append-note] (${platform})`, { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});



// ─────────────────────────────────────────────────────────────────────────────
//  AGENT ROUTES: Agentic Video Processing Pipeline
//  POST /api/agent/start     — Starts the 5-step agent loop (returns immediately)
//  GET  /api/agent/status     — Polls current agent progress
//  GET  /api/agent/result     — Gets completed result
//  DELETE /api/agent/cancel   — Cancels an in-progress agent run
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts the agentic video processing pipeline.
 * Returns a sessionId within 200ms — the agent runs asynchronously in the background.
 * The frontend polls /api/agent/status/:sessionId every 2 seconds for progress.
 */
app.post('/api/agent/start', async (req, res) => {
  try {
    const user = await verifySupabaseJWT(req, res);
    if (!user) return;

    const { videoId, userGoal, timestamp, durationBefore, durationAfter } = req.body;
    if (!videoId) {
      return res.status(400).json({ success: false, error: 'videoId is required.' });
    }

    // Initialize session (fast — no async operations)
    const sessionId = orchestrator.initSession(videoId, user.id, userGoal, { timestamp, durationBefore, durationAfter });

    // Return immediately with sessionId (don't block the HTTP response)
    res.json({
      success: true,
      sessionId,
      status: 'agent_started',
      message: 'Agent is processing your video. Poll /api/agent/status/:sessionId for progress.',
    });

    // Run agent in background (fire-and-forget — errors are captured in session state)
    orchestrator.runAgent(videoId, userGoal || '', user.id, sessionId)
      .catch(err => {
        sysLogger.error('Agent background run failed', { sessionId, error: err.message });
        orchestrator.markFailed(sessionId, err);
      });
  } catch (err) {
    sysLogger.error('Route Handler Fail [/api/agent/start]', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Polls the current progress of an agent run.
 * Returns step number, step name, tools executed so far, and overall status.
 */
app.get('/api/agent/status/:sessionId', (req, res) => {
  try {
    const status = orchestrator.getAgentStatus(req.params.sessionId);
    return res.json(status);
  } catch (err) {
    sysLogger.error('Route Handler Fail [/api/agent/status]', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Returns the completed result of an agent run.
 * Only returns full data when status === 'complete'.
 */
app.get('/api/agent/result/:sessionId', (req, res) => {
  try {
    const result = orchestrator.getResult(req.params.sessionId);
    return res.json(result);
  } catch (err) {
    sysLogger.error('Route Handler Fail [/api/agent/result]', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Cancels an in-progress agent run.
 */
app.delete('/api/agent/cancel/:sessionId', (req, res) => {
  try {
    const cancelled = orchestrator.cancelAgent(req.params.sessionId);
    return res.json({ success: cancelled, sessionId: req.params.sessionId });
  } catch (err) {
    sysLogger.error('Route Handler Fail [/api/agent/cancel]', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ── Mock OAuth Consent Page ──────────────────────────────────────────────────
app.get('/auth/mock-consent', (req, res) => {
  const { platform, state } = req.query;
  const platformLabel = (platform || '').charAt(0).toUpperCase() + (platform || '').slice(1);
  
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize ${platformLabel} — YouTube Copilot</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --surface:     rgba(35, 44, 51, 0.98);
      --well:        rgba(11, 37, 69, 0.50);
      --accent:      #8DA9C4;
      --accent-dim:  rgba(141, 169, 196, 0.15);
      --text:        #DAEDF7;
      --muted:       rgba(141, 169, 196, 0.60);
      --success:     #34A853;
      --border:      rgba(141, 169, 196, 0.18);
      --border-glow: rgba(141, 169, 196, 0.45);
      --spring:      cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    body {
      min-height: 100vh;
      font-family: 'Inter', system-ui, sans-serif;
      background: linear-gradient(160deg, #0b1526 0%, #131f33 50%, #0d1a2e 100%);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .consent-card {
      width: 100%;
      max-width: 440px;
      background: rgba(35, 44, 51, 0.7);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 32px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.5);
      backdrop-filter: blur(10px);
      text-align: center;
    }
    .logo-badge {
      font-size: 40px;
      margin-bottom: 16px;
      display: inline-block;
      animation: float 3s ease-in-out infinite;
    }
    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-6px); }
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 8px;
      letter-spacing: -0.3px;
    }
    .desc {
      font-size: 13px;
      color: var(--muted);
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .permissions-list {
      background: var(--well);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      text-align: left;
      margin-bottom: 28px;
    }
    .permission-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 12.5px;
      margin-bottom: 10px;
      color: var(--text);
    }
    .permission-item:last-child {
      margin-bottom: 0;
    }
    .permission-icon {
      color: var(--success);
      font-weight: bold;
    }
    .btn-auth {
      display: block;
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #8DA9C4, #5b8db8);
      border: none;
      border-radius: 10px;
      color: #0b1526;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.15s var(--spring), opacity 0.15s;
    }
    .btn-auth:hover {
      transform: scale(1.02);
      opacity: 0.92;
    }
    .btn-cancel {
      display: block;
      width: 100%;
      padding: 12px;
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      margin-top: 12px;
      transition: color 0.15s, border-color 0.15s;
    }
    .btn-cancel:hover {
      color: var(--text);
      border-color: var(--accent);
    }
  </style>
</head>
<body>
  <div class="consent-card">
    <div class="logo-badge">🔌</div>
    <h1>Authorize ${platformLabel}</h1>
    <p class="desc">YouTube Copilot is requesting permission to link to your <strong>${platformLabel}</strong> workspace.</p>
    
    <div class="permissions-list">
      <div class="permission-item">
        <span class="permission-icon">✓</span>
        <span>Create pages and append structured notes</span>
      </div>
      <div class="permission-item">
        <span class="permission-icon">✓</span>
        <span>Access workspace information to list destinations</span>
      </div>
      <div class="permission-item">
        <span class="permission-icon">✓</span>
        <span>Sync spaced repetition study details</span>
      </div>
    </div>

    <button class="btn-auth" id="btn-authorize">Authorize One-Tap Integration</button>
    <button class="btn-cancel" id="btn-cancel">Cancel</button>
  </div>

  <script>
    document.getElementById('btn-authorize').addEventListener('click', () => {
      const platform = "${platform}";
      const state = "${state}";
      window.location.href = "/auth/" + platform + "/callback?code=mock_code_" + Math.random().toString(36).substring(2, 10) + "&state=" + encodeURIComponent(state);
    });

    document.getElementById('btn-cancel').addEventListener('click', () => {
      window.close();
    });
  </script>
</body>
</html>
  `);
});

// Helper for close window scripts
function getCloseWindowHtml(platform) {
  return `
    <html>
      <body>
        <script>
          try { window.opener.postMessage({ type: 'COPILOT_AUTH_SUCCESS', platform: '${platform}' }, '*'); } catch(e){}
          window.close();
        </script>
      </body>
    </html>
  `;
}

// ── Coda OAuth ─────────────────────────────────────────────────────────────
app.get('/auth/coda', (req, res) => {
  const { userId, extId } = req.query;
  if (!userId || !extId) {
    return res.status(400).send('Missing userId or extId');
  }
  const state = `${userId}:${extId}`;
  
  if (!process.env.CODA_CLIENT_ID || process.env.CODA_CLIENT_ID === 'YOUR_CODA_CLIENT_ID_HERE') {
    return res.redirect(`/auth/mock-consent?platform=coda&state=${encodeURIComponent(state)}`);
  }

  const redirectUri = `${req.protocol}://${req.get('host')}/auth/coda/callback`;
  const authUrl = `https://coda.io/oauth/authorize?client_id=${process.env.CODA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
  res.redirect(authUrl);
});

app.get('/auth/coda/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) {
    return res.status(400).send('Missing code or state');
  }
  const [userId, extId] = state.split(':');
  try {
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/coda/callback`;
    const authHeader = Buffer.from(`${process.env.CODA_CLIENT_ID}:${process.env.CODA_CLIENT_SECRET}`).toString('base64');
    
    let tokenData = { access_token: 'mock-coda-token-' + code };
    if (process.env.CODA_CLIENT_ID && process.env.CODA_CLIENT_SECRET && process.env.CODA_CLIENT_ID !== 'YOUR_CODA_CLIENT_ID_HERE') {
      const tokenRes = await fetch('https://coda.io/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${authHeader}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
      if (tokenRes.ok) {
        tokenData = await tokenRes.json();
      }
    }
    
    // Auto-provision Coda document named "📚 My AI Copilot Notebook"
    let autoDocId = 'doc_mock_yX12aB';
    if (!tokenData.access_token.startsWith('mock-coda-token-')) {
      try {
        autoDocId = await codaAutoProvisionDoc(tokenData.access_token);
      } catch (provErr) {
        sysLogger.error('Coda Callback: Auto-provisioning document failed', { error: provErr.message });
        autoDocId = 'doc_fallback_yX12aB';
      }
    }

    const { encryptedText, iv } = encryptToken(tokenData.access_token);
    const { error } = await supabase
      .from('user_integrations')
      .upsert({
        user_id: userId,
        platform_name: 'coda',
        encrypted_access_token: encryptedText,
        encryption_iv: iv,
        refresh_token: autoDocId, // Store auto-provisioned doc_id as explicit metadata
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,platform_name' });

    if (error) throw error;
    sysLogger.info('OAuth: Coda integrated successfully', { userId });
    
    if (extId) {
      res.redirect(`https://${extId}.chromiumapp.org/oauth2?status=success&platform=coda`);
    } else {
      res.send(getCloseWindowHtml('coda'));
    }
  } catch (err) {
    sysLogger.error('OAuth: Coda integration error', { error: err.message });
    res.status(500).send(`Authentication error: ${err.message}`);
  }
});

app.get('/api/auth/coda', (req, res) => res.redirect(`/auth/coda?${new URLSearchParams(req.query).toString()}`));
app.get('/api/auth/coda/callback', (req, res) => res.redirect(`/auth/coda/callback?${new URLSearchParams(req.query).toString()}`));



// ── Token Vault Router (kept for legacy/backward compatibility) ───────────────
app.post('/api/auth/store-token', verifySupabaseJWT, async (req, res) => {
  const { platform, token } = req.body;
  if (!platform || !token) {
    return res.status(400).json({ success: false, error: 'platform and token are required.' });
  }

  const validPlatforms = ['coda'];
  if (!validPlatforms.includes(platform.toLowerCase())) {
    return res.status(400).json({ success: false, error: `Invalid platform: ${platform}` });
  }

  try {
    let autoDocId = null;
    const platLower = platform.toLowerCase();
    if (platLower === 'coda') {
      if (token.startsWith('mock-coda-token-')) {
        autoDocId = 'doc_mock_yX12aB';
      } else {
        try {
          autoDocId = await codaAutoProvisionDoc(token);
        } catch (provErr) {
          sysLogger.error('Coda Store-Token: Auto-provisioning document failed', { error: provErr.message });
          autoDocId = 'doc_fallback_yX12aB';
        }
      }
    }

    const { encryptedText, iv } = encryptToken(token);
    const { error } = await supabase
      .from('user_integrations')
      .upsert({
        user_id: req.user.id,
        platform_name: platform.toLowerCase(),
        encrypted_access_token: encryptedText,
        encryption_iv: iv,
        refresh_token: autoDocId, // Store auto-provisioned doc_id as explicit metadata
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,platform_name' });

    if (error) throw error;

    sysLogger.info('DB: Encrypted token stored successfully', { userId: req.user.id, platform });
    return res.json({ success: true });
  } catch (err) {
    sysLogger.error('DB: Failed to store encrypted token', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});



app.get('/api/auth/retrieve-token/:platform', verifySupabaseJWT, async (req, res) => {
  const { platform } = req.params;
  const dbPlatform = (platform || '').toLowerCase();
  
  try {
    const token = await getDecryptedAccessToken(req.user.id, dbPlatform);
    return res.json({ success: true, token });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  OAUTH ROUTING PIPELINE: Notion, GitHub & Google Docs
// ─────────────────────────────────────────────────────────────────────────────

// ── Notion OAuth ─────────────────────────────────────────────────────────────
app.get('/auth/notion', (req, res) => {
  const { userId, extId } = req.query;
  if (!userId || !extId) {
    return res.status(400).send('Missing userId or extId');
  }
  const state = `${userId}:${extId}`;
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/notion/callback`;
  const authUrl = `https://api.notion.com/v1/oauth/authorize?client_id=${process.env.NOTION_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&owner=user&state=${state}`;
  res.redirect(authUrl);
});

app.get('/auth/notion/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) {
    return res.status(400).send('Missing code or state');
  }
  const [userId, extId] = state.split(':');
  try {
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/notion/callback`;
    const authHeader = Buffer.from(`${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authHeader}`,
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.message || 'Failed to exchange Notion authorization code');
    }
    
    const { encryptedText, iv } = encryptToken(tokenData.access_token);
    const { error } = await supabase
      .from('user_integrations')
      .upsert({
        user_id: userId,
        platform_name: 'notion',
        encrypted_access_token: encryptedText,
        encryption_iv: iv,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,platform_name' });

    if (error) throw error;
    sysLogger.info('OAuth: Notion integrated successfully', { userId });
    
    if (extId) {
      res.redirect(`https://${extId}.chromiumapp.org/oauth2?status=success&platform=notion`);
    } else {
      res.send(`
        <html>
          <body>
            <script>
              try { window.opener.postMessage({ type: 'COPILOT_AUTH_SUCCESS', platform: 'notion' }, '*'); } catch(e){}
              window.close();
            </script>
          </body>
        </html>
      `);
    }
  } catch (err) {
    sysLogger.error('OAuth: Notion integration error', { error: err.message });
    res.status(500).send(`Authentication error: ${err.message}`);
  }
});



// ── Google OAuth (Scope Escalation) ───────────────────────────────────────────
app.get('/auth/google', (req, res) => {
  const { userId, extId } = req.query;
  if (!userId || !extId) {
    return res.status(400).send('Missing userId or extId');
  }
  const state = `${userId}:${extId}`;
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/google/callback`;
  const scopes = [
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/drive.file'
  ].join(' ');
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent&state=${state}`;
  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) {
    return res.status(400).send('Missing code or state');
  }
  const [userId, extId] = state.split(':');
  try {
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/google/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Failed to exchange Google authorization code');
    }
    
    const { encryptedText, iv } = encryptToken(tokenData.access_token);
    const expiresIn = tokenData.expires_in || 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    
    const payload = {
      user_id: userId,
      platform_name: 'google_docs',
      encrypted_access_token: encryptedText,
      encryption_iv: iv,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    };
    
    if (tokenData.refresh_token) {
      const { encryptedText: encRefresh } = encryptToken(tokenData.refresh_token);
      payload.refresh_token = encRefresh;
    }
    
    const { error } = await supabase
      .from('user_integrations')
      .upsert(payload, { onConflict: 'user_id,platform_name' });

    if (error) throw error;
    sysLogger.info('OAuth: Google Docs integrated successfully', { userId });
    
    if (extId) {
      res.redirect(`https://${extId}.chromiumapp.org/oauth2?status=success&platform=google_docs`);
    } else {
      res.send(`
        <html>
          <body>
            <script>
              try { window.opener.postMessage({ type: 'COPILOT_AUTH_SUCCESS', platform: 'google_docs' }, '*'); } catch(e){}
              window.close();
            </script>
          </body>
        </html>
      `);
    }
  } catch (err) {
    sysLogger.error('OAuth: Google Docs integration error', { error: err.message });
    res.status(500).send(`Authentication error: ${err.message}`);
  }
});





// ── Central Integrations Link Status Query ──────────────────────────────────
app.get('/api/auth/status', verifySupabaseJWT, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_integrations')
      .select('platform_name')
      .eq('user_id', req.user.id);

    if (error) throw error;

    const integrationMap = {
      notion: data.some(i => i.platform_name === 'notion'),
      google_docs: data.some(i => i.platform_name === 'google_docs'),
      coda: data.some(i => i.platform_name === 'coda'),
    };

    res.status(200).json({
      success: true,
      authenticated: true,
      user: req.user,
      integrations: integrationMap,
    });
  } catch (err) {
    sysLogger.error({
      message: 'Route Handler Fail [/api/auth/status]',
      error: err.message || err,
      service: 'copilot-core-engine',
    });
    res.status(500).json({ success: false, error: 'Internal server lookup fault.' });
  }
});
app.delete('/api/auth/disconnect/:platform', verifySupabaseJWT, async (req, res) => {
  const { platform } = req.params;
  let dbPlatformName = (platform || '').toLowerCase();
  if (dbPlatformName === 'googledocs') dbPlatformName = 'google_docs';

  sysLogger.info('OAuth: Disconnect request received', { userId: req.user.id, platform: dbPlatformName });

  try {
    const { error } = await supabase
      .from('user_integrations')
      .delete()
      .eq('user_id', req.user.id)
      .eq('platform_name', dbPlatformName);

    if (error) throw error;

    sysLogger.info('OAuth: Platform disconnected successfully', { userId: req.user.id, platform: dbPlatformName });
    res.status(200).json({ success: true, platform: dbPlatformName });
  } catch (err) {
    sysLogger.error('Route Handler Fail [/api/auth/disconnect]', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  🧪 SANDBOX ROUTE: Integration Layer Test (NO JWT — dev only)
//  POST /api/test-export
//  Protected by x-copilot-token only. Reads static test keys from .env.
//  Dispatches by: { "platform": "github" | "jira" | "googledocs" }
//  Remove or gate behind NODE_ENV check before production deploy.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/test-export', async (req, res) => {
  // Hard-block in production
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Sandbox route disabled in production.' });
  }

  const platform  = (req.body.platform || '').toLowerCase();
  const noteText  = req.body.noteText  || 'Isolating integration layer frameworks to establish functional connection validation.';
  const title     = req.body.title     || 'Integration Sandbox Test Run';
  const meta      = req.body.meta      || { sourceUrl: 'https://www.youtube.com', timestamp: '02:15' };

  sysLogger.info('🧪 Sandbox test-export triggered', { platform, title });

  try {
    let result;

    switch (platform) {



      // ── Google Docs Append ────────────────────────────────────────────────
      case 'googledocs': {
        const accessToken = process.env.TEST_GDOCS_ACCESS_TOKEN;
        const documentId  = process.env.TEST_GDOCS_DOCUMENT_ID;

        if (!accessToken) throw new Error('TEST_GDOCS_ACCESS_TOKEN is not set in .env');
        if (!documentId)  throw new Error('TEST_GDOCS_DOCUMENT_ID is not set in .env');

        const docResult = await appendToGoogleDoc(accessToken, documentId, noteText, title, meta);

        sysLogger.info('✅ Sandbox Google Docs SUCCESS', { url: docResult.docUrl });
        result = {
          success: true,
          platform: 'googledocs',
          documentId: docResult.documentId,
          url: docResult.docUrl,
          message: `Note appended to Google Doc: ${docResult.docUrl}`,
        };
        break;
      }

      default:
        return res.status(400).json({
          success: false,
          error: `Unknown platform "${platform}". Use: googledocs`,
        });
    }

    return res.json(result);

  } catch (err) {
    sysLogger.error(`🧪 Sandbox test-export FAIL [${platform}]`, { error: err.message });
    return res.status(500).json({ success: false, platform, error: err.message });
  }
});

// ─── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  sysLogger.info(`Copilot Core Engine v4.0.0 active`, { port: PORT, env: process.env.NODE_ENV || 'development' });
});
