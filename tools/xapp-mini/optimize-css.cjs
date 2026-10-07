const fs = require('node:fs');
const path = require('node:path');
const csso = require('csso');

// Consolidate generated WXSS, leaving source UTS/UVue and other targets untouched.
// Never replace a file with a larger result (some WXSS constructs cannot be shortened).
function optimizeCss(outputDir) {
  const totals = { files: 0, before: 0, after: 0 };
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith('.wxss')) {
        const source = fs.readFileSync(file, 'utf8');
        const result = csso.minify(source, { restructure: true }).css;
        const before = Buffer.byteLength(source);
        const after = Buffer.byteLength(result);
        totals.before += before;
        totals.after += Math.min(before, after);
        if (after < before) {
          fs.writeFileSync(file, result);
          totals.files++;
        }
      }
    }
  }
  visit(outputDir);
  return totals;
}

module.exports = { optimizeCss };
if (require.main === module) {
  if (!process.argv[2]) throw new Error('Usage: optimize-css.cjs <compiled-mini-dir>');
  const result = optimizeCss(process.argv[2]);
  console.log(`xapp-mini CSS: ${result.before} → ${result.after} bytes (${result.files} files consolidated)`);
}
