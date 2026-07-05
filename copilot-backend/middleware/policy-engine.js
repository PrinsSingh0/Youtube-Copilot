/**
 * ==============================================================================
 *  YOUTUBE COPILOT v5.0.0 — POLICY HARNESS GATEWAY (middleware/policy-engine.js)
 *  ★ CORE SECURITY HARNESS ★ — Governing tool runs via structural and semantic checks.
 * ==============================================================================
 */

import dotenv from 'dotenv';
dotenv.config({ path: 'c:/Ai Copilot 4.0 - Copy/copilot-backend/.env' });
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import sysLogger from '../config/logger.js';

// Initialize Gemini client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// A lightweight, regex-based, zero-dependency YAML parser for policies.yaml
export function parseYaml(yamlContent) {
  const result = {
    environment: { name: '', blocked_tools: [] },
    roles: {}
  };
  
  const lines = yamlContent.split(/\r?\n/);
  let currentSection = null; // 'environment' or 'roles'
  let currentRole = null;
  let inBlockedTools = false;
  let inAllowedTools = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Detect high-level sections
    if (trimmed.startsWith('environment:')) {
      currentSection = 'environment';
      inBlockedTools = false;
      continue;
    }
    if (trimmed.startsWith('roles:')) {
      currentSection = 'roles';
      continue;
    }

    if (currentSection === 'environment') {
      if (trimmed.startsWith('name:')) {
        result.environment.name = trimmed.split(':')[1].trim();
      } else if (trimmed.startsWith('blocked_tools:')) {
        inBlockedTools = true;
      } else if (inBlockedTools && trimmed.startsWith('-')) {
        const tool = trimmed.substring(1).trim();
        result.environment.blocked_tools.push(tool);
      }
    }

    if (currentSection === 'roles') {
      if (trimmed.endsWith(':') && !trimmed.startsWith('allowed_tools:')) {
        currentRole = trimmed.substring(0, trimmed.length - 1).trim();
        result.roles[currentRole] = { allowed_tools: [] };
        inAllowedTools = false;
      } else if (trimmed.startsWith('allowed_tools:')) {
        inAllowedTools = true;
      } else if (inAllowedTools && trimmed.startsWith('-')) {
        const tool = trimmed.substring(1).trim();
        if (currentRole) {
          result.roles[currentRole].allowed_tools.push(tool);
        }
      }
    }
  }

  return result;
}

// Load static policies
const POLICIES_PATH = path.resolve('c:/Ai Copilot 4.0 - Copy/copilot-backend/config/policies.yaml');
let policies = { environment: { name: 'development', blocked_tools: [] }, roles: {} };

try {
  if (fs.existsSync(POLICIES_PATH)) {
    const yamlText = fs.readFileSync(POLICIES_PATH, 'utf8');
    policies = parseYaml(yamlText);
    sysLogger.info('Policy Engine: Loaded policies.yaml successfully.');
  } else {
    sysLogger.warn(`Policy Engine: policies.yaml not found at ${POLICIES_PATH}. Using default empty policy.`);
  }
} catch (err) {
  sysLogger.error(`Policy Engine initialization error: ${err.message}`);
}

/**
 * 1. Structural Gating Check
 * Validates tool permissions synchronously. Throws Error on failure.
 */
export function checkStructuralPolicy(toolName, userRole, currentEnv = 'development') {
  // Check if tool is blocked in environment
  const blockedTools = policies.environment?.blocked_tools || [];
  if (blockedTools.includes(toolName)) {
    throw new Error(`Policy Violation: Tool "${toolName}" is blocked in "${currentEnv}" environment.`);
  }

  // Check if tool is allowed for user role
  const roleEntry = policies.roles?.[userRole];
  if (!roleEntry) {
    throw new Error(`Policy Violation: Role "${userRole}" is not defined in permission registry.`);
  }

  const allowedTools = roleEntry.allowed_tools || [];
  if (!allowedTools.includes(toolName)) {
    throw new Error(`Policy Violation: Role "${userRole}" is not authorized to execute tool "${toolName}".`);
  }

  return true;
}

/**
 * 2. Semantic Gating Check
 * Asynchronously inspects payload via Gemini to catch plain-text emails or secrets leaks.
 */
export async function checkSemanticPolicy(toolName, argsPayload) {
  const payloadString = JSON.stringify(argsPayload);

  // Quick pre-filtering to save tokens (check for obvious email addresses or secrets variables)
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const secretsKeywords = ['password', 'secret', 'private_key', 'api_key', 'bearer', 'token'];

  const hasEmail = emailRegex.test(payloadString);
  const hasSecretKeyword = secretsKeywords.some(kw => payloadString.toLowerCase().includes(kw));

  if (!hasEmail && !hasSecretKeyword) {
    return true; // No risk, fast pass
  }

  // Double check with Gemini to avoid false positives and catch sophisticated injection/leak patterns
  const prompt = `Analyze the following tool arguments payload for security compliance.
You must flag a violation if the payload attempts to leak unmasked plain-text email addresses or sensitive credential secrets (like unmasked API keys, raw passwords, encryption keys, or private tokens).

Return JSON only in the following schema:
{
  "violation": true/false,
  "reason": "explanation of what was leaked or state why it is clean"
}

Payload to inspect:
${payloadString}
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    const resultText = response?.text || '{}';
    const result = JSON.parse(resultText);

    if (result.violation) {
      sysLogger.error(`[SecOps Semantic Gate] Policy Violation detected in tool "${toolName}": ${result.reason}`);
      return 'POLICY_VIOLATION: Unmasked sensitive information detected.';
    }

    return true;
  } catch (err) {
    sysLogger.warn(`Semantic policy analysis failed or timed out: ${err.message}. Falling back to default block for safety.`);
    // Safe default: block if Gemini fails during check
    return 'POLICY_VIOLATION: Security validation loop failed.';
  }
}
