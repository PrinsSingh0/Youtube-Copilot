#!/usr/bin/env node

/**
 * ==============================================================================
 *  YOUTUBE COPILOT v5.0.0 — PRE-FLIGHT LINT & HARNESS GATE (bin/harness-hook.js)
 *  ★ CORE SECURITY & COMPLIANCE HOOK ★ — Audits workspace code for trailing placeholders.
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');

const PLACEHOLDER_PATTERNS = [
  /YOUR_PROJECT_ID/i,
  /YOUR_SERVICE_ROLE_KEY/i,
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /YOUR_[A-Z0-9_]+_HERE/i
];

const SCAN_DIRS = [
  'copilot-backend',
  'bin',
  '.agent-skills'
];

const IGNORE_FILES = [
  'node_modules',
  '.git',
  'package-lock.json',
  'dist'
];

function scanDir(dir, violations) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORE_FILES.includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      scanDir(fullPath, violations);
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs') || entry.name.endsWith('.json') || entry.name.endsWith('.md'))) {
      if (entry.name === 'harness-hook.js') continue;
      
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        // Skip lines that reference AGENTS.md rules, the tool itself, or build-in validator checks to avoid self-triggering
        if (line.includes('AGENTS.md') || 
            line.includes('harness-hook.js') || 
            line.includes('PLACEHOLDER_PATTERNS') ||
            line.includes('isUrlInvalid') ||
            line.includes('isAnonKeyInvalid') ||
            line.includes('isEncryptionSecretInvalid') ||
            line.includes('isGlobalAppSecretInvalid') ||
            line.includes('YOUR_CODA_CLIENT_ID_HERE')) {
          return;
        }

        for (const pattern of PLACEHOLDER_PATTERNS) {
          if (pattern.test(line)) {
            violations.push({
              file: fullPath,
              line: index + 1,
              content: line.trim(),
              pattern: pattern.toString()
            });
            break;
          }
        }
      });
    }
  }
}

const violations = [];
SCAN_DIRS.forEach(d => {
  const fullPath = path.join(__dirname, '..', d);
  scanDir(fullPath, violations);
});

if (violations.length > 0) {
  console.error(JSON.stringify({
    placeholderViolation: true,
    message: 'Found trailing placeholder or TODO comments in codebase!',
    violations
  }, null, 2));
  process.exit(1);
} else {
  console.log(JSON.stringify({
    placeholderViolation: false,
    message: 'Harness validation completed successfully. No trailing placeholders or TODOs found.'
  }, null, 2));
  process.exit(0);
}
