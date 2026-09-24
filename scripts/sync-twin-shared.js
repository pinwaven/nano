#!/usr/bin/env node
/**
 * Build src/functions/twin/shared/: the worker code the twin function runs, copied at deploy.
 *
 *   node scripts/sync-twin-shared.js           # rebuild shared/ (s.yaml runs this pre-deploy)
 *   node scripts/sync-twin-shared.js --check   # list what would be copied and its npm deps; copy nothing
 *
 * The twin function answers every route between Curia and nano: its own twin reads and
 * contributions, and the two external job queues (Viva AG, document extraction). Those queues are
 * nano's own behaviour — a result becomes a chat message, a formulation is validated and stored,
 * extracted values are written into the record — and the twin function must behave exactly as the
 * worker's code says. So the worker stays the only source, and this copies the transitive closure
 * of what the queue handlers `require`, layout preserved, into shared/worker/.
 *
 * shared/ is git-ignored: a committed copy is a second source that drifts. What keeps the two
 * functions in step is that each deploy copies the worker as it is at that commit, and that
 * `twin_version` — a hash of what buildTwinBundle produced — is only comparable between functions
 * deployed from the same code. /ping reports `shared_code`, a hash of this directory, for that.
 *
 * It also checks the npm packages the closure needs are declared in twin/package.json, because a
 * missing one is not an error until the function first takes that path in production.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WORKER = path.join(ROOT, 'src/functions/worker');
const TWIN = path.join(ROOT, 'src/functions/twin');
const DST = path.join(TWIN, 'shared/worker');
const ENTRIES = ['handlers/viva_ag.js', 'handlers/doc_extraction.js'];

function closure() {
    const files = new Set();
    const npm = new Set();
    const walk = (file) => {
        const abs = require.resolve(path.resolve(file));
        if (files.has(abs)) return;
        if (!abs.startsWith(WORKER + path.sep)) throw new Error(`${file} is outside the worker`);
        files.add(abs);
        const src = fs.readFileSync(abs, 'utf8');
        for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
            const r = m[1];
            if (r.startsWith('.')) walk(path.join(path.dirname(abs), r));
            else if (!require('module').builtinModules.includes(r.replace(/^node:/, ''))) {
                npm.add(r.startsWith('@') ? r.split('/').slice(0, 2).join('/') : r.split('/')[0]);
            }
        }
    };
    for (const e of ENTRIES) walk(path.join(WORKER, e));
    return { files: [...files].sort(), npm: [...npm].sort() };
}

const { files, npm } = closure();
const declared = Object.keys(JSON.parse(fs.readFileSync(path.join(TWIN, 'package.json'), 'utf8')).dependencies || {});
const missing = npm.filter(d => !declared.includes(d));
if (missing.length) {
    console.error(`[sync-twin-shared] twin/package.json lacks: ${missing.join(', ')} (the worker's versions are in worker/package.json)`);
    process.exit(1);
}
if (process.argv.includes('--check')) {
    console.log(`${files.length} files, npm: ${npm.join(' ')}`);
    process.exit(0);
}
fs.rmSync(path.join(TWIN, 'shared'), { recursive: true, force: true });
for (const f of files) {
    const to = path.join(DST, path.relative(WORKER, f));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(f, to);
}
console.log(`[sync-twin-shared] ${files.length} files → src/functions/twin/shared/worker`);
