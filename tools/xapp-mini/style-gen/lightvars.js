// node lightvars.js <mini.wxss> [--derived-only] → MP-only light block: the miniapp's own .theme-light rules verbatim,
// plus every colour declaration that reads a CSS variable, restated under .theme-light (xapp's base
// rules carry dark literals, so those declarations never flip on their own).
const fs = require('fs');
const css = fs.readFileSync(process.argv[2], 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const COLOR = /^(color|background|background-color|border|border-(top|bottom|left|right)(-color)?|border-color|box-shadow|outline)$/;
const own = [], derived = [];
const isColor = d => COLOR.test(d.split(':')[0].trim());
const isVar = d => /var\(--/.test(d.split(':').slice(1).join(':'));
const rules = [];
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim(); if (sel.startsWith('@') || /keyframes|^\d+%|^from|^to$/.test(sel)) continue;
  rules.push({ sel, decls: m[2].split(';').map(s => s.trim()).filter(Boolean) });
}
// Restating `.x { color: var(--a) }` as `.theme-light .x` adds a class of specificity, so it now
// beats a modifier the miniapp declares with literal colours (`.wd-dot-on { background: #10b981 }`
// lost to `.theme-light .wd-dot` and the connected dot went grey). Such modifiers are restated
// too, in the miniapp's order: a rule whose last class extends a restated one (`.wd-dot` →
// `.wd-dot-on`, `.wd-dot.on`).
const lastClass = s => { const m = s.trim().split(/\s+|>/).pop().match(/\.[A-Za-z0-9_-]+/g); return m || []; };
const varClasses = new Set();
for (const r of rules) {
  if (/theme-light/.test(r.sel) || !r.decls.some(d => isColor(d) && isVar(d))) continue;
  for (const s of r.sel.split(',')) { const c = lastClass(s); if (c.length) varClasses.add(c[0]); }
}
// Single-compound selectors only: `.a-on .b` keeps its miniapp specificity order against the
// miniapp's own two-class `.theme-light .b` rule, which must still win (the twin-layer dots).
const extendsVar = s => { if (/\s|>/.test(s.trim())) return false; const c = lastClass(s); if (!c.length) return false;
  if (c.length > 1 && varClasses.has(c[0])) return true;
  for (const v of varClasses) if (c[0] !== v && c[0].startsWith(v + '-')) return true;
  return false; };
for (const { sel, decls } of rules) {
  if (/theme-light/.test(sel)) { own.push(`${sel} { ${decls.join('; ')}; }`); continue; }
  const sels = sel.split(',').map(s => s.trim());
  const keep = decls.filter(d => isColor(d) && (isVar(d) || sels.some(extendsVar)));
  if (!keep.length) continue;
  derived.push(`${sels.map(s => '.theme-light ' + s).join(', ')} { ${keep.join('; ')}; }`);
}
// --derived-only: just the restated half, for a file whose own .theme-light rules are already ported.
console.log((process.argv.includes('--derived-only') ? derived : derived.concat(own)).join('\n'));
console.error(`${derived.length} derived, ${own.length} own`);
