#!/usr/bin/env node
// The web user-app is a twin of the Mini Program, whose UI strings live as `const T = {zh, en}`
// literals INSIDE page/component files (not modules, so they can't be imported via @mini).
// This script slices each literal out, evaluates it, and either
//   --write : regenerates src/i18n/<name>.js from it (verbatim copy, one module per source)
//   (default): diffs the key sets against the committed modules and exits 1 on drift.
// Run from anywhere: `npm run check:i18n` / `npm run sync:i18n` (root package.json).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MINI = path.resolve(here, '../../../mini/nano-miniapp');
const OUT = path.resolve(here, '../src/i18n');

const SOURCES = [
  { name: 'main',      file: 'pages/main/main.js' },
  { name: 'health',    file: 'components/user-health/user-health.js', extra: ['TWIN_LAYER_LABELS'] },
  { name: 'documents', file: 'components/health-documents/health-documents.js' },
  { name: 'ag',        file: 'components/viva-ag-panel/viva-ag-panel.js' },
  { name: 'phones',    file: 'pages/phones/phones.js' },
  { name: 'emails',    file: 'pages/emails/emails.js' },
  { name: 'referral',  file: 'pages/referral/referral.js' },
];

// Slice `const NAME = {` … matching `}` at column 0 (the miniapp files end each table with a
// bare `}` line). Returns the literal source text.
function sliceLiteral(src, name) {
  const start = src.indexOf(`\nconst ${name} = {`);
  if (start < 0) throw new Error(`no "const ${name} = {" in source`);
  const from = start + 1 + `const ${name} = `.length;
  const end = src.indexOf('\n}\n', from);
  if (end < 0) throw new Error(`unterminated ${name}`);
  return src.slice(from, end + 2);
}

function evalLiteral(text) {
  // eslint-disable-next-line no-new-func
  return new Function(`return (${text})`)();
}

function keysOf(obj, prefix = '') {
  const out = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...keysOf(v, `${prefix}${k}.`));
    else out.push(`${prefix}${k}`);
  }
  return out.sort();
}

const write = process.argv.includes('--write');
let drift = 0;

for (const s of SOURCES) {
  const src = fs.readFileSync(path.join(MINI, s.file), 'utf8');
  const literal = sliceLiteral(src, 'T');
  const extras = (s.extra || []).map(n => ({ n, text: sliceLiteral(src, n) }));
  const T = evalLiteral(literal);
  const outFile = path.join(OUT, `${s.name}.js`);
  if (write) {
    const header = `// GENERATED from src/mini/nano-miniapp/${s.file} by scripts/sync-i18n-from-miniapp.mjs.\n// Do not edit by hand — change the miniapp table and re-run \`npm run sync:i18n\`.\n// Keys are the Mini Program's; the web app reads them through src/i18n/index.js.\n\n`;
    let body = '';
    for (const e of extras) body += `export const ${e.n} = ${e.text};\n\n`;
    body += `const T = ${literal};\n\nexport default T;\n`;
    fs.writeFileSync(outFile, header + body);
    console.log(`wrote ${path.relative(process.cwd(), outFile)} (${Object.keys(T.zh).length} zh / ${Object.keys(T.en).length} en keys)`);
    continue;
  }
  if (!fs.existsSync(outFile)) { console.error(`MISSING ${outFile} — run with --write`); drift++; continue; }
  const mod = await import(outFile);
  const web = mod.default;
  for (const lang of ['zh', 'en']) {
    const a = keysOf(T[lang]), b = keysOf(web?.[lang] || {});
    const missing = a.filter(k => !b.includes(k));
    const stale = b.filter(k => !a.includes(k));
    if (missing.length || stale.length) {
      drift++;
      console.error(`DRIFT ${s.name}.${lang}: ${missing.length} missing on web, ${stale.length} stale on web`);
      missing.slice(0, 20).forEach(k => console.error(`   + ${k}`));
      stale.slice(0, 20).forEach(k => console.error(`   - ${k}`));
    }
  }
}
if (!write) {
  if (drift) { console.error(`\ni18n drift in ${drift} table(s). Run: npm run sync:i18n`); process.exit(1); }
  console.log('i18n: web tables match the miniapp.');
}
