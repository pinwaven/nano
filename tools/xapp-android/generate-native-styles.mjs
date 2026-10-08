// Resolve the mini's palette and text-size tokens into native CSS literals.
// Native has no CSS-variable cascade. Keep the shared visual fixes as the source
// of truth instead of maintaining another hand-copied set of theme rules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { syntax } = require('csso');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(root, 'src/xapp');
const out = path.join(source, 'unpackage/native-styles');

export function miniCss(text) {
  const css = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  const stack = [true];
  return css.split('\n').filter(line => {
    const directive = line.match(/\/\*\s*#(ifdef|ifndef)\s+(.+?)\s*\*\//);
    if (directive) {
      const matches = directive[2].split(/\s*\|\|\s*/).includes('MP-WEIXIN');
      stack.push(stack.at(-1) && (directive[1] === 'ifdef' ? matches : !matches));
      return false;
    }
    if (/\/\*\s*#endif/.test(line)) { stack.pop(); return false; }
    return stack.at(-1);
  }).join('\n');
}
function rules(css) {
  const result = [];
  syntax.walk(syntax.parse(css, { parseCustomProperty: false }), node => {
    if (node.type !== 'Rule' || node.prelude?.type !== 'SelectorList') return;
    const declarations = [];
    node.block.children.forEach(d => {
      if (d.type === 'Declaration') declarations.push([d.property, syntax.generate(d.value)]);
    });
    result.push({ selector: syntax.generate(node.prelude), declarations });
  });
  return result;
}
const globals = rules(miniCss(fs.readFileSync(path.join(source, 'App.uvue'), 'utf8')));
function tokens(theme, level, local) {
  const values = {};
  for (const r of [...globals, ...local]) {
    if (r.selector.includes('.theme-light') && theme !== 'light') continue;
    const size = r.selector.match(/\.fs-(\d)/);
    if (size && Number(size[1]) !== level) continue;
    for (const [key, value] of r.declarations) if (key.startsWith('--')) values[key] = value;
  }
  return values;
}
export function resolve(value, values) {
  for (let i = 0; i < 5 && value.includes('var('); i++) {
    value = value.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g,
      (m, key, fallback) => values[key] ?? fallback ?? m);
  }
  return value;
}
const unsupported = new Set(['gap', 'filter', 'backdrop-filter', 'box-sizing', 'text-decoration', 'white-space',
  'text-transform', 'animation', 'aspect-ratio', 'grid-template-columns', 'inset',
  'overflow-wrap', 'overflow-x', 'overflow-y', 'word-break']);
export function nativeDeclaration(key, raw, values) {
  if (key.startsWith('--') || key.startsWith('-webkit-') || unsupported.has(key)) return null;
  let value = resolve(raw, values);
  value = value.trim().replace(/\s+/g, ' ');
  if (/var\(|env\(|calc\(|radial-gradient|inherit|initial|unset/.test(value)) return null;
  if (/\d(?:vh|vw)\b/.test(value)) return null;
  if (/^(max|min)-(width|height)$/.test(key) && /%|vh|vw/.test(value)) return null;
  if (/^(max|min)-(width|height)$/.test(key) && value === 'auto') return null;
  if (key === 'position' && value === 'fixed') return null;
  if (key === 'position' && value === 'static') value = 'relative';
  if (key === 'display' && !['flex', 'none'].includes(value)) return null;
  if (['align-items', 'align-content', 'justify-content'].includes(key) && value === 'normal') return null;
  if (key === 'line-height' && /^\d*\.?\d+$/.test(value)) return null;
  if (key === 'border-radius' && value.includes('%')) return null;
  if (key === 'font-family') value = 'sans-serif-condensed';
  if (key === 'align-items' && value === 'baseline') value = 'center';
  if (key === 'background' && value.includes('linear-gradient')) key = 'background-image';
  if (key === 'background-image' && value.startsWith('linear-gradient(')) {
    // Native accepts a direction and two colors, not degree angles or CSS stops.
    const parts = value.slice('linear-gradient('.length, -1).split(/,(?![^()]*\))/).map(s => s.trim());
    let direction = parts.shift();
    if (/^-?[\d.]+deg$/.test(direction)) {
      const angle = ((parseFloat(direction) % 360) + 360) % 360;
      direction = ['to top', 'to top right', 'to right', 'to bottom right', 'to bottom',
        'to bottom left', 'to left', 'to top left'][Math.round(angle / 45) % 8];
    }
    if (!direction.startsWith('to ')) { parts.unshift(direction); direction = 'to bottom'; }
    const clean = color => color.replace(/\s+-?[\d.]+(?:%|px|rpx)$/, '').trim();
    if (parts.length < 2) return null;
    value = `linear-gradient(${direction},${clean(parts[0])},${clean(parts.at(-1))})`;
  }
  if (key === 'box-shadow' && value !== 'none') {
    // Android's runtime shadow parser expects four px lengths before the color;
    // it cannot parse rpx or the mini's additional inset highlight.
    const shadow = value.split(/,(?![^()]*\))/)[0];
    if (shadow.includes('inset')) return null;
    const color = shadow.match(/rgba?\([^)]*\)|#[a-f0-9]{3,8}/i)?.[0];
    if (!color) return null;
    const lengths = shadow.slice(0, shadow.indexOf(color)).trim().split(/\s+/).map(length => {
      const number = parseFloat(length);
      return `${length.endsWith('rpx') ? number / 2 : number}px`;
    });
    if (lengths.some(length => length.includes('NaN'))) return null;
    while (lengths.length < 4) lengths.push('0px');
    value = `${lengths.join(' ')} ${color.replace(/\s+/g, '')}`;
  }
  return `${key}:${value}`;
}
export function nativeFontDeclarations(font, ratio, values) {
  const declaration = nativeDeclaration(...font, values);
  if (!declaration) return [];
  const length = declaration.match(/^font-size:([\d.]+)(rpx|px)$/);
  // Unlike WebView text, native TextViews clip glyphs outside the line box.
  // Scale the line box with the font, including the mini's unitless ratios.
  return length ? [declaration, `line-height:${Math.round(Number(length[1]) * ratio * 100) / 100}${length[2]}`] : [declaration];
}
export function nativeSelector(selector, level = null) {
  const light = /^\.theme-light(?:\.fs-\d)?\s+/.test(selector);
  let result = selector.replace(/^\.theme-light(?:\.fs-\d)?\s+/, '');
  if (light || level !== null) {
    const classes = [...result.matchAll(/\.[\w-]+/g)];
    const last = classes.at(-1);
    if (!last) return null;
    const name = last[0];
    const replacement = (light ? `${name}-native-light` : '') + (level !== null ? `${name}-native-fs-${level}` : '');
    result = result.slice(0, last.index) + replacement + result.slice(last.index + name.length);
  }
  return result;
}
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['unpackage', 'node_modules', '.git'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.name.endsWith('.uvue') && file !== path.join(source, 'App.uvue')) generate(file);
  }
}
function generate(file) {
  const text = fs.readFileSync(file, 'utf8');
  const css = miniCss(text);
  const local = rules(css);
  const output = [];
  // Only mini-only fixes and token-based declarations should override the native
  // layout. Existing native flex/scroll/canvas adaptations remain authoritative.
  const miniOnly = rules([...text.matchAll(/\/\* #ifdef MP-WEIXIN \*\/([\s\S]*?)\/\* #endif \*\//g)].map(m => m[1]).join('\n').replace(/<[^>]+>/g, ''));
  const signature = r => JSON.stringify([r.selector, r.declarations]);
  const miniSignatures = new Set(miniOnly.map(signature));
  // Preserve source order: the mini's later explicit contrast fixes must beat
  // earlier token colors, just as they do in DevTools.
  const candidates = local.filter(r => miniSignatures.has(signature(r)) || r.declarations.some(([, v]) => v.includes('var(') || v.includes('linear-gradient(')));
  for (const r of candidates) {
    const selectors = r.selector.split(',').filter(s => !/[:#\[]/.test(s) && s.trim().split(/\s+|[>+~]/).every(part => /^\.[\w.-]+$/.test(part)));
    if (!selectors.length) continue;
    const theme = r.selector.includes('.theme-light') ? 'light' : 'dark';
    const font = r.declarations.find(([k, v]) => k === 'font-size' && /var\(--fs-/.test(v));
    const lineHeight = r.declarations.find(([k]) => k === 'line-height')?.[1];
    const ratio = lineHeight && /^\d*\.?\d+$/.test(lineHeight) ? Number(lineHeight) : 1.2;
    const decls = r.declarations.map(([k, v]) => nativeDeclaration(k, v, tokens(theme, 0, local))).filter(Boolean);
    if (font) decls.push(...nativeFontDeclarations(font, ratio, tokens(theme, 0, local)));
    if (decls.length) output.push(`${selectors.map(s => nativeSelector(s)).join(',')}{${decls.join(';')}}`);
    if (font) for (let level = 0; level <= 3; level++) {
      const declarations = nativeFontDeclarations(font, ratio, tokens(theme, level, local));
      if (declarations.length) output.push(`${selectors.map(s => nativeSelector(s, level)).join(',')}{${declarations.join(';')}}`);
    }
  }
  const name = path.relative(source, file).replaceAll(path.sep, '-').replace(/\.uvue$/, '.css');
  const unique = [...new Set(output.toReversed())].reverse();
  fs.writeFileSync(path.join(out, name), `/* Generated from shared mini styles; do not edit. */\n${unique.join('\n')}\n`);
  console.log(`${name}: ${unique.length} native style rules`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(out, { recursive: true });
  visit(source);
}
