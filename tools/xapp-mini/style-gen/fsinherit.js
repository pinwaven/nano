// node fsinherit.js <mini.wxss> <mini.wxml> <xapp.uvue> → for each miniapp element class that sets no font-size
// of its own but inherits one that reads var(--fs-N) from its nearest ancestor class, a rule giving that
// class the inherited size — xapp's <text> children carry px sizes and inherit nothing.
const fs = require('fs');
const css = fs.readFileSync(process.argv[2], 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const wxml = fs.readFileSync(process.argv[3], 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const uvue = fs.readFileSync(process.argv[4], 'utf8');
const xstyle = uvue.slice(uvue.indexOf('<style'));
const own = new Map(), anyFont = new Set();
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const fsd = m[2].split(';').map(s => s.trim()).find(d => /^font-size\s*:/.test(d));
  if (!fsd) continue;
  for (const s of m[1].split(',')) { const last = s.trim().split(/\s+/).pop(); if (/^\.[\w-]+$/.test(last)) { anyFont.add(last.slice(1)); if (/var\(--fs-\d+/.test(fsd) && s.trim() === last) own.set(last.slice(1), fsd); } }
}
const stack = [], out = new Map();
for (const t of wxml.matchAll(/<(\/?)([a-z-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
  const [, close, tag, attrs, self] = t;
  if (close) { stack.pop(); continue; }
  const cm = attrs.match(/class="([^"]*)"/);
  const classes = cm ? cm[1].replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/).filter(Boolean) : [];
  const mine = classes.map(c => own.get(c)).find(Boolean);
  const inherited = [...stack].reverse().find(Boolean);
  if (!mine && inherited && classes.length && !classes.some(c => anyFont.has(c)))
    for (const c of classes) if (new RegExp(`\\.${c}(\\s*,[^{]*)?\\s*\\{[^}]*font-size`).test(xstyle)) out.set(c, inherited);
  if (!self && !['input', 'image', 'textarea'].includes(tag)) stack.push(mine || null);
}
const lines = [...out].map(([c, d]) => `.${c} { ${d}; }`);
console.log(lines.join('\n')); console.error(lines.length + ' inherited rules');
