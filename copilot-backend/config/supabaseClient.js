// ==============================================================================
//  YOUTUBE COPILOT v4.0.0 — SUPABASE CLIENT CONFIG (config/supabaseClient.js)
//  Production-strict initialization — crashes on placeholder credentials.
// ==============================================================================
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';
import sysLogger from './logger.js';

if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

// ─── Strict Environment Validation ───────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const PLACEHOLDER_PATTERNS = ['YOUR_PROJECT_ID', 'your_project_id', 'placeholder'];
const KEY_PLACEHOLDER_PATTERNS = ['YOUR_SERVICE_ROLE_KEY_HERE', 'your_service_role_key', 'placeholder-key'];

const urlInvalid = !supabaseUrl || PLACEHOLDER_PATTERNS.some(p => supabaseUrl.includes(p));
const keyInvalid = !supabaseKey || KEY_PLACEHOLDER_PATTERNS.some(p => supabaseKey.includes(p));

if (urlInvalid || keyInvalid) {
  sysLogger.error({
    message: 'FATAL: Supabase credentials are missing or contain placeholder values. The server cannot start.',
    SUPABASE_URL: urlInvalid ? '❌ INVALID / PLACEHOLDER' : '✅ SET',
    SUPABASE_SERVICE_ROLE_KEY: keyInvalid ? '❌ INVALID / PLACEHOLDER' : '✅ SET',
    action: 'Set real credentials in your .env file. Copy your service_role key from: Supabase Dashboard → Settings → API.',
    service: 'copilot-core-engine',
  });
  process.exit(1);
}

// ─── Client Initialization (verified credentials only) ──────────────────────
const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { transport: WebSocket },
});

sysLogger.info('Supabase client initialized successfully', {
  projectUrl: supabaseUrl.replace(/\/\/(.{8}).*?(\.supabase)/, '//$1***$2'),
});

export default supabase;
