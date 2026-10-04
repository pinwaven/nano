// node lightinherit.js <mini.wxss> <xapp.uvue> → MP-only light rules for xapp text that inherits its colour
// in the miniapp. xapp's <text> inherits nothing, so a child the port gave its own class and a dark
// literal (.fcard-cta-label: #A0B4FF) stayed dark-theme blue under .theme-light, while the miniapp's
// text took its parent's light colour (.fcard-cta { color: var(--chat-accent) }).
//
// Walks the xapp template: for each element whose class the miniapp never colours, that xapp colours
// with a literal, and that has no .theme-light colour rule yet, the light colour of its nearest
// ancestor that has one (the last single-class `.theme-light .x { color }` rule in the xapp file, so
// run it after lightvars.js's output is in place). Static class="" only; :class modifiers are ignored.
const fs = require('fs');
const css = fs.readFileSync(process.argv[2], 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const uvue = fs.readFileSync(process.argv[3], 'utf8');
const tpl = uvue.slice(uvue.indexOf('<template>'), uvue.lastIndexOf('</template>')).replace(/<!--[\s\S]*?-->/g, '');
const style = uvue.slice(uvue.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '');

const isColorDecl = d => /^\s*color\s*:/.test(d);
const miniColored = new Set(), miniLiteral = new Set();
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const decl = m[2].split(';').find(isColorDecl);
  if (!decl) continue;
  for (const c of m[1].matchAll(/\.([\w-]+)/g)) miniColored.add(c[1]);
  // A literal colour on a plain class is the same in both themes: text under it inherits nothing new.
  if (!/var\(--/.test(decl) && !/theme-light/.test(m[1]))
    for (const sel of m[1].split(',')) { const b = sel.trim().match(/^\.([\w-]+)$/); if (b) miniLiteral.add(b[1]); }
}
const lightColor = new Map(), lightMentioned = new Set(), darkColored = new Set();
for (const m of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const decl = m[2].split(';').find(isColorDecl);
  if (!decl) continue;
  for (const s of m[1].split(',').map(x => x.trim())) {
    const lm = s.match(/^\.theme-light\s+\.([\w-]+)$/);
    if (lm) { lightColor.set(lm[1], decl.trim()); lightMentioned.add(lm[1]); continue; }
    if (/theme-light/.test(s)) { const last = s.match(/\.([\w-]+)\s*$/); if (last) lightMentioned.add(last[1]); continue; }
    const bm = s.match(/^\.([\w-]+)$/);
    if (bm) darkColored.add(bm[1]);
  }
}
const stack = [], seen = new Map();
const FIXED = 'fixed';
for (const t of tpl.matchAll(/<(\/?)([a-z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
  const [, close, tag, attrs, self] = t;
  if (tag === 'template') continue;
  if (close) { stack.pop(); continue; }
  const cm = attrs.match(/(?:^|\s)class="([^"]*)"/);
  const classes = cm ? cm[1].split(/\s+/).filter(Boolean) : [];
  const mine = classes.map(c => lightColor.get(c)).find(Boolean) || (classes.some(c => miniLiteral.has(c)) ? FIXED : null);
  const inherited = [...stack].reverse().find(Boolean);
  // The last class of a multi-class element is its most specific one (.x-txt .x-txt-ghost).
  const c = classes[classes.length - 1];
  if (!mine && inherited && tag === 'text' && c && !miniColored.has(c) && darkColored.has(c) && !lightMentioned.has(c)) {
    if (!seen.has(c)) seen.set(c, new Set());
    seen.get(c).add(inherited);
  }
  if (!self) stack.push(mine || null);
}
// A class that would inherit different colours in different places, or none (FIXED), is left alone.
const out = [...seen].filter(([, v]) => v.size === 1 && !v.has(FIXED)).map(([c, v]) => [c, [...v][0]]);
const lines = out.map(([c, d]) => `.theme-light .${c} { ${d}; }`);
console.log(lines.join('\n')); console.error(lines.length + ' inherited colour rules');
