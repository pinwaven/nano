// node lightvars.js <mini.wxss> → MP-only light block: the miniapp's own .theme-light rules verbatim,
// plus every colour declaration that reads a CSS variable, restated under .theme-light (xapp's base
// rules carry dark literals, so those declarations never flip on their own).
const fs = require('fs');
const css = fs.readFileSync(process.argv[2], 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const COLOR = /^(color|background|background-color|border|border-(top|bottom|left|right)(-color)?|border-color|box-shadow|outline)$/;
const own = [], derived = [];
let depth = 0;
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim(); if (sel.startsWith('@') || /keyframes|^\d+%|^from|^to$/.test(sel)) continue;
  const decls = m[2].split(';').map(s => s.trim()).filter(Boolean);
  if (/theme-light/.test(sel)) { own.push(`${sel} { ${decls.join('; ')}; }`); continue; }
  const keep = decls.filter(d => { const [k, ...v] = d.split(':'); return COLOR.test(k.trim()) && /var\(--/.test(v.join(':')); });
  if (!keep.length) continue;
  const sels = sel.split(',').map(s => '.theme-light ' + s.trim()).join(', ');
  derived.push(`${sels} { ${keep.join('; ')}; }`);
}
console.log(derived.concat(own).join('\n'));
console.error(`${derived.length} derived, ${own.length} own`);
