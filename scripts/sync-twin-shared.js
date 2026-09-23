#!/usr/bin/env node
/**
 * The twin function (src/functions/twin) ships byte-identical copies of the worker modules that
 * build the twin bundle and compute its version. The worker is the source; this copies it.
 *
 *   node scripts/sync-twin-shared.js           # copy worker/lib → twin/shared
 *   node scripts/sync-twin-shared.js --check   # exit 1 if any copy has drifted (tests run this)
 *
 * Why copies and not one module: an FC function deploys one directory, and a require outside it
 * does not exist once uploaded. Why it matters that they are identical: a bundle's twin_version is
 * a hash of what buildTwinBundle produced, so two deploy units running two versions of it hash one
 * unchanged twin two ways, and a replica reads that as a change. s.yaml runs this before every
 * twin deploy; tests/twin-function.test.js fails on drift so a worker edit cannot ship alone.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src/functions/worker/lib');
const DST = path.join(ROOT, 'src/functions/twin/shared');
const FILES = ['twinBundle.js', 'twinMirror.js', 'oss.js', 'time-utils.js', 'labHistory.js', 'questionnaireContext.js'];

const check = process.argv.includes('--check');
const drift = [];
fs.mkdirSync(DST, { recursive: true });
for (const f of FILES) {
    const src = fs.readFileSync(path.join(SRC, f));
    const dstPath = path.join(DST, f);
    const dst = fs.existsSync(dstPath) ? fs.readFileSync(dstPath) : null;
    if (dst && src.equals(dst)) continue;
    if (check) drift.push(f);
    else { fs.writeFileSync(dstPath, src); console.log(`[sync-twin-shared] ${f}`); }
}
if (check && drift.length) {
    console.error(`[sync-twin-shared] drifted from worker/lib: ${drift.join(', ')} — run node scripts/sync-twin-shared.js`);
    process.exit(1);
}
