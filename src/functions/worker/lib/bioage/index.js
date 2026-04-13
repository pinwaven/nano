#!/usr/bin/env node
'use strict';

/**
 * CLI entry point.
 *
 * Usage (flags):
 *   node index.js --age 39 \
 *     --biomarkers '{"hsCRP":1.4,"IL6":0.79,"GA":13.6,"CD38":1.4,"GDF15":470,"CystatinC":0.69}'
 *
 * Usage (stdin JSON):
 *   echo '{"ChronoAge":39,"BiomarkerValues":{"hsCRP":1.4,"IL6":0.79,"GA":13.6,"CD38":1.4,"GDF15":470,"CystatinC":0.69}}' \
 *     | node index.js
 */

const { runWorkflow } = require('./workflow');

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i += 2) flags[args[i]] = args[i + 1];

  const age = flags['--age'] ? parseInt(flags['--age'], 10) : 40;
  const biomarkers = flags['--biomarkers'] ? JSON.parse(flags['--biomarkers']) : {};
  return { ChronoAge: age, BiomarkerValues: biomarkers };
}

async function main() {
  let input;
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } else {
    input = parseArgs();
  }

  const result = runWorkflow(input);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => { console.error(err.message); process.exit(1); });
