#!/usr/bin/env node
// Regenerates src/theme-tokens.css from the Mini Program's app.wxss: the dark/light palette
// and the four text-scale levels, with rpx ÷ 2 = px. Run after an app.wxss token change.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const wxss = fs.readFileSync(path.resolve(here, '../../../mini/nano-miniapp/app.wxss'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ''); // drop every comment first
const rpx = s => s.replace(/(-?\d+(?:\.\d+)?)rpx/g, (_, n) => `${n / 2}px`);
function block(selector) {
  const i = wxss.search(new RegExp(`(^|\\n)${selector.replace(".", "\\.")} \\{`));
  if (i < 0) throw new Error(`no ${selector}`);
  const j = wxss.indexOf('\n}', i);
  return wxss.slice(wxss.indexOf("{", i) + 1, j).split('\n')
    .map(l => l.replace(/\s+$/, '')).filter(l => /--[\w-]+:/.test(l)).join('\n');
}
const out = `/* ── Waven Design System — User App ──
   Theme + text-scale tokens are GENERATED from src/mini/nano-miniapp/app.wxss (rpx ÷ 2 = px)
   so the web twin uses the miniapp's exact palette and type curve. \`.theme-light\` and
   \`.fs-1/.fs-2/.fs-3\` go on <html> (see store/AppContext.jsx). Regenerate with
   scripts/sync-theme-from-miniapp.mjs after an app.wxss change. */

:root {
${rpx(block('page'))}

  --frame-w: 390px;
  --frame-h: 844px;
}

:root.theme-light {
${rpx(block('.theme-light'))}
  color: var(--text);
}

:root.fs-1 {
${rpx(block('.fs-1'))}
}

:root.fs-2 {
${rpx(block('.fs-2'))}
}

:root.fs-3 {
${rpx(block('.fs-3'))}
}
`;
fs.writeFileSync(path.resolve(here, '../src/theme-tokens.css'), out);
console.log('wrote src/theme-tokens.css');
