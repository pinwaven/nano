#!/usr/bin/env node
'use strict';

/**
 * CLI entry point.
 *
 * Usage:
 *   node index.js --age 39 --test-id TEST-001 --user-id USER-001 \
 *     --tags '["焦虑","糖尿病前期"]' \
 *     --biomarker-values '{"hsCRP": 4.8}' \
 *     --biometrics '{"Height": 159, "Weight": 80, "Sex": "女"}'
 *
 *   Or pass a single JSON object via stdin:
 *   echo '{"ChronoAge":39,"TestID":"T1","UserID":"U1","Tags":[]}' | node index.js
 */

const { runWorkflow } = require('./workflow');

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    flags[args[i]] = args[i + 1];
  }

  return {
    ChronoAge: flags['--age'] ? parseInt(flags['--age'], 10) : 40,
    TestID: flags['--test-id'] ?? `TEST-${Date.now()}`,
    UserID: flags['--user-id'] ?? 'anonymous',
    Tags: flags['--tags'] ? JSON.parse(flags['--tags']) : [],
    BiomarkerValues: flags['--biomarker-values'] ? JSON.parse(flags['--biomarker-values']) : {},
    Biometrics: flags['--biometrics'] ? JSON.parse(flags['--biometrics']) : {},
  };
}

async function main() {
  let input;

  if (!process.stdin.isTTY) {
    // Read JSON from stdin
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } else {
    input = parseArgs();
  }

  const { output, cached } = runWorkflow(input);

  if (cached) process.stderr.write('[cache hit] Returning saved result for TestID: ' + input.TestID + '\n');

  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
