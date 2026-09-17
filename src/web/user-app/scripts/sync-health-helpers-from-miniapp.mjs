#!/usr/bin/env node
// Regenerates src/health/helpers.js from the pure prelude of the Mini Program's user-health
// component (everything above `Component({`): ring display builders, sleep-session helpers,
// scoring, lab tables and _buildLabPanel, colour maps. No wx.* call survives — the one function
// that reads wx.storage (_getRealtimeReadings) is dropped, and the two require()s become imports.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../../../mini/nano-miniapp/components/user-health/user-health.js');
const OUT = path.resolve(here, '../src/health/helpers.js');

const src = fs.readFileSync(SRC, 'utf8');
const end = src.indexOf('\nComponent({');
if (end < 0) throw new Error('no Component({');
let body = src.slice(0, end);

// strip the `const T = { … }` and TWIN_LAYER_LABELS tables (they live in src/i18n/health.js)
const cut = (text, startMarker) => {
  const i = text.indexOf(`\n${startMarker}`);
  if (i < 0) return text;
  const j = text.indexOf('\n}\n', i);
  return text.slice(0, i + 1) + text.slice(j + 3);
};
body = cut(body, 'const T = {');
body = cut(body, 'const TWIN_LAYER_LABELS = {');
// drop the wx-bound function
body = cut(body, 'function _getRealtimeReadings(syncedAt) {');
// drop miniapp-only requires / getApp
body = body.replace(/^const app = getApp\(\)\n/m, '');
body = body.replace(/^const \{[^}]*\} = require\([^)]*\)\n/gm, '');
body = body.replace(/^\s*const \{ flagOutliers, interpolateFlagged \} = require\('\.\.\/\.\.\/utils\/wearable\/signal-smoothing\.js'\)\n/m, '');

const names = [...body.matchAll(/^(?:function|const)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
const header = `// GENERATED from src/mini/nano-miniapp/components/user-health/user-health.js (the pure prelude
// above Component({)) by scripts/sync-health-helpers-from-miniapp.mjs. Do not edit by hand.
/* eslint-disable */
import smoothing from '@mini/wearable/signal-smoothing.js';
import mood from '@mini/mood.js';
import HEALTH_T, { TWIN_LAYER_LABELS } from '../i18n/health.js';
const { flagOutliers, interpolateFlagged } = smoothing;
const { computeMood, resolveAvatarUrl, DEFAULT_MOOD } = mood;
const T = HEALTH_T;
export { computeMood, resolveAvatarUrl, DEFAULT_MOOD, TWIN_LAYER_LABELS, T as HEALTH_T };

`;
fs.writeFileSync(OUT, header + body + `\nexport {\n  ${[...new Set(names)].join(', ')},\n};\n`);
console.log(`wrote src/health/helpers.js (${names.length} exports)`);
