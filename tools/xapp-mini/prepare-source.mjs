// Native target-view style hooks are unnecessary in WeChat's CSS cascade.
// Restore the original class attributes before the mini compiler sees them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = path.join(root, 'src/xapp');
const stage = path.join(root, 'temp/xapp-mini-source');
export function restoreClassBindings(text) {
  return text.replace(/\s:class="nativeClass\('([^']*)', \((.*?)\)\)"/g,
    (_match, names, dynamic) => ` class="${names}"${dynamic === 'null' ? '' : ` :class="${dynamic}"`}`)
    .replace(/^import \{ nativeClass as nativeVisualClass \}.*\n/gm, '')
    .replace(/\s*nativeClass\(names : string, dynamic : any \| null\) : (?:any|string) \{\s*return nativeVisualClass\([^\n]+\)\s*\},/, '');
}
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.name.endsWith('.uvue')) {
      fs.writeFileSync(file, restoreClassBindings(fs.readFileSync(file, 'utf8')));
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.rmSync(stage, { recursive: true, force: true });
  fs.cpSync(source, stage, { recursive: true, filter: file => !['unpackage', 'node_modules'].includes(path.basename(file)) });
  visit(stage);
  console.log(stage);
}
