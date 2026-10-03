// node fsvars.js <mini.wxss> <xapp.uvue> → MP-only text-scale rules: every miniapp rule whose font-size
// reads var(--fs-N) restated for xapp-mini (whose own rules carry px literals that never scale), with
// the rule's line-height when it declares one. A miniapp class whose text xapp moved into a child
// <text class="<cls>-txt|-text|-label"> also gets the rule on that child.
const fs = require('fs');
const css = fs.readFileSync(process.argv[2], 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const uvue = fs.readFileSync(process.argv[3], 'utf8');
const tpl = uvue.slice(0, uvue.indexOf('<script'));
const xcls = new Set(); for (const m of tpl.matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).forEach(c => c && xcls.add(c));
for (const m of tpl.matchAll(/'([a-z][a-z0-9-]+)'/g)) xcls.add(m[1]);
const out = [];
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const sel = m[1].trim().replace(/\s+/g, ' ');
  if (sel.startsWith('@') || /%|^from|^to$/.test(sel)) continue;
  const decls = m[2].split(';').map(s => s.trim()).filter(Boolean);
  const fsd = decls.find(d => /^font-size\s*:/.test(d) && /var\(--fs-\d+/.test(d));
  if (!fsd) continue;
  const lh = decls.find(d => /^line-height\s*:/.test(d));
  const sels = sel.split(',').map(s => s.trim()).filter(s => /^[.a-z0-9_ -]+$/i.test(s) && !s.split(' ').some(t => ['view', 'image', 'input', 'textarea', 'button', 'scroll-view'].includes(t)));
  const extra = [];
  for (const s of sels) {
    const last = s.split(' ').pop();
    if (!last.startsWith('.')) continue;
    const c = last.slice(1);
    for (const suf of ['-txt', '-text', '-label', '-ghost', '-on', '-off', '-active', '-primary', '-dim']) if (xcls.has(c + suf) && !css.includes('.' + c + suf)) extra.push(s.replace(/\.[^ .]+$/, '.' + c + suf));
  }
  const all = [...new Set([...sels, ...extra])];
  if (!all.length) continue;
  out.push(`${all.join(', ')} { ${fsd}${lh ? '; ' + lh : ''}; }`);
}
console.log(out.join('\n')); console.error(out.length + ' rules');
