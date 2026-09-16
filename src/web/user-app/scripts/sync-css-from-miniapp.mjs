#!/usr/bin/env node
// Regenerates src/mini-css/*.css from the Mini Program's WXSS so the web twin renders the same
// class names with the same rules. Mechanical: rpx ÷ 2 = px; `page {}` and `:host {}` roots are
// dropped (tokens come from theme-tokens.css); element selectors map view→div / text→span /
// image→img. Ported components use the miniapp's class names verbatim so this stays a twin.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MINI = path.resolve(here, '../../../mini/nano-miniapp');
const OUT = path.resolve(here, '../src/mini-css');
fs.mkdirSync(OUT, { recursive: true });

const FILES = {
  'main.css': 'pages/main/main.wxss',
  'user-health.css': 'components/user-health/user-health.wxss',
  'health-documents.css': 'components/health-documents/health-documents.wxss',
  'viva-ag-panel.css': 'components/viva-ag-panel/viva-ag-panel.wxss',
  'toolbox.css': 'components/toolbox/toolbox.wxss',
  'avatar-picker.css': 'components/avatar-picker/avatar-picker.wxss',
  'phones.css': 'pages/phones/phones.wxss',
  'emails.css': 'pages/emails/emails.wxss',
  'referral.css': 'pages/referral/referral.wxss',
  'login.css': 'pages/login/login.wxss',
};

const ELEMENT_MAP = { view: 'div', text: 'span', image: 'img', navigator: 'a', 'scroll-view': 'div', 'rich-text': 'div' };

function dropRootBlocks(css) {
  // remove `page { … }` and `:host { … }` blocks (top level, no nesting inside)
  return css.replace(/(^|\n)(page|:host)\s*\{[^}]*\}/g, '$1');
}
function convert(css) {
  // WXSS @imports of sibling pages (phones/emails import referral.wxss) — those files are
  // generated as their own modules and loaded by main.jsx, so the import is dropped here.
  css = css.replace(/^@import\s+[^;]+;\s*$/gm, '');
  css = dropRootBlocks(css);
  css = css.replace(/(-?\d+(?:\.\d+)?)rpx/g, (_, n) => `${n / 2}px`);
  // element selectors in descendant position: `.foo text {` → `.foo span {`
  css = css.replace(/([ >+~])(view|text|image|navigator|scroll-view|rich-text)(?=[\s,{:.#\[])/g, (m, pre, el) => pre + ELEMENT_MAP[el]);
  // wx `button::after` reset is harmless on the web; keep. `placeholder-class` has no CSS analogue.
  return css;
}

for (const [out, src] of Object.entries(FILES)) {
  const p = path.join(MINI, src);
  if (!fs.existsSync(p)) { console.warn(`skip ${src} (missing)`); continue; }
  const header = `/* GENERATED from src/mini/nano-miniapp/${src} by scripts/sync-css-from-miniapp.mjs.\n   Do not edit by hand — change the WXSS and re-run \`npm run sync:css\`. */\n\n`;
  fs.writeFileSync(path.join(OUT, out), header + convert(fs.readFileSync(p, 'utf8')));
  console.log(`wrote src/mini-css/${out}`);
}

// Static assets the miniapp templates reference by absolute path (/assets/icons/*.svg, the
// logo). Copied under public/assets so the same paths resolve on the web (base '/app/' is
// applied by Vite at build time via import.meta.env.BASE_URL — see src/assets.js).
const ASSETS_SRC = path.join(MINI, 'assets');
const ASSETS_OUT = path.resolve(here, '../public/assets');
fs.rmSync(ASSETS_OUT, { recursive: true, force: true });
fs.cpSync(ASSETS_SRC, ASSETS_OUT, { recursive: true });
console.log('copied assets → public/assets');
