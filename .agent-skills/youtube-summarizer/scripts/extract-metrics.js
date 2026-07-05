#!/usr/bin/env node

/**
 * ==============================================================================
 *  YOUTUBE COPILOT v5.0.0 — METRICS EXTRACTION SCRIPT (scripts/extract-metrics.js)
 *  Deterministic parser for timestamps, URLs, and code blocks via standard input.
 * ==============================================================================
 */

function main() {
  let rawInput = '';

  // Read raw text payload from stdin
  process.stdin.on('data', (chunk) => {
    rawInput += chunk;
  });

  process.stdin.on('end', () => {
    try {
      const timestamps = extractTimestamps(rawInput);
      const links = extractLinks(rawInput);
      const codeBlocks = extractCodeBlocks(rawInput);

      const metrics = {
        timestamps,
        links,
        codeBlocks,
        wordCount: rawInput.split(/\s+/).filter(Boolean).length
      };

      // Output clean JSON
      process.stdout.write(JSON.stringify(metrics, null, 2) + '\n');
      process.exit(0);
    } catch (err) {
      console.error('JSON Extraction Error:', err);
      process.exit(1);
    }
  });
}

/**
 * Extracts timestamps like 12:34, 1:23, or 02:45:10 from text.
 */
function extractTimestamps(text) {
  const timestampRegex = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g;
  const matches = text.match(timestampRegex) || [];
  return [...new Set(matches)];
}

/**
 * Extracts HTTP/HTTPS links from text.
 */
function extractLinks(text) {
  const linkRegex = /https?:\/\/[^\s\)]+/g;
  const matches = text.match(linkRegex) || [];
  return [...new Set(matches)];
}

/**
 * Extracts triple-backtick markdown code blocks.
 */
function extractCodeBlocks(text) {
  const codeBlockRegex = /```([\s\S]*?)```/g;
  const blocks = [];
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match[1]) {
      blocks.push(match[1].trim());
    }
  }
  return blocks;
}

main();
