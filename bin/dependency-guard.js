#!/usr/bin/env node

/**
 * ==============================================================================
 *  YOUTUBE COPILOT v5.0.0 — SLOPSQUATTING DEPENDENCY ARMOR (bin/dependency-guard.js)
 *  ★ CORE SECURITY GATE ★ — Blocks hallucinated npm packages during code edits.
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');

// Cryptographically/statically pinned registry of approved packages
const APPROVED_REGISTRY = new Set([
  'express',
  'cors',
  'dotenv',
  'winston',
  'ws',
  'uuid',
  'groq-sdk',
  '@supabase/supabase-js',
  '@google/genai',
  'youtube-transcript',
  'buffer'
]);

// Standard Node.js core library built-ins
const NODE_BUILTINS = new Set([
  'fs', 'path', 'child_process', 'crypto', 'events', 'util',
  'stream', 'buffer', 'assert', 'os', 'url', 'module', 'net',
  'http', 'https', 'dns', 'querystring', 'zlib'
]);

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Strip comments to prevent false positives in comments/documentation
  const contentWithoutComments = content
    .replace(/\/\*[\s\S]*?\*\//g, '')  // multi-line comments
    .replace(/\/\/.*/g, '');           // single-line comments

  const imports = [];

  // Regex 1: import ... from 'package'
  const importRegex = /import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g;
  // Regex 2: require('package')
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  let match;
  while ((match = importRegex.exec(contentWithoutComments)) !== null) {
    imports.push({ name: match[1], file: filePath });
  }

  while ((match = requireRegex.exec(contentWithoutComments)) !== null) {
    imports.push({ name: match[1], file: filePath });
  }

  return imports;
}

function runDependencyCheck() {
  const directoriesToScan = [
    'c:/Ai Copilot 4.0 - Copy/copilot-backend',
    'c:/Ai Copilot 4.0 - Copy/bin',
    'c:/Ai Copilot 4.0 - Copy/.agent-skills'
  ];

  const violations = [];

  function traverseAndScan(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      // Skip node_modules, .git, and temporary files
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
        continue;
      }

      if (entry.isDirectory()) {
        traverseAndScan(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
        const foundImports = scanFile(fullPath);
        
        for (const imp of foundImports) {
          const name = imp.name;
          
          // Skip relative file imports
          if (name.startsWith('.') || path.isAbsolute(name)) {
            continue;
          }

          // Check against built-ins and pinned registry
          if (!NODE_BUILTINS.has(name) && !APPROVED_REGISTRY.has(name)) {
            violations.push({
              file: fullPath,
              packageName: name
            });
          }
        }
      }
    }
  }

  // Traverse all target paths
  for (const scanPath of directoriesToScan) {
    traverseAndScan(scanPath);
  }

  if (violations.length > 0) {
    const errorPayload = {
      securityViolation: true,
      violationType: 'SLOPSQUATTING_ATTACK_OR_HALLUCINATED_PACKAGE',
      message: 'Aborting operation: Found unverified, untrusted, or hallucinated package dependency imports.',
      violations: violations,
      timestamp: new Date().toISOString(),
      action: 'Send payload back to the self-repair loop to patch the dependency error cleanly.'
    };

    console.error(JSON.stringify(errorPayload, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    securityViolation: false,
    message: 'Supply chain audit completed successfully. Zero untrusted dependencies discovered.',
    totalCheckedPackages: APPROVED_REGISTRY.size
  }, null, 2));
  process.exit(0);
}

runDependencyCheck();
