const fs = require('node:fs');
const path = require('node:path');

// HBuilderX exposes placeholders in pages.json, but this reference is inside UserHealth.
// Set the native component JSON option so the main package can render before AG downloads.
function configureSubpackages(outputDir) {
  const app = JSON.parse(fs.readFileSync(path.join(outputDir, 'app.json'), 'utf8'));
  if (!app.subPackages?.some(p => p.name === 'viva-ag' && p.root === 'packages/viva-ag')) {
    throw new Error('Missing Viva AG subpackage');
  }
  const file = path.join(outputDir, 'components/user-health/user-health.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const target = config.usingComponents?.['viva-ag-panel'];
  if (!target || !target.includes('packages/viva-ag/')) {
    throw new Error('UserHealth must reference the packaged Viva AG component');
  }
  if (!fs.existsSync(path.join(outputDir, 'packages/viva-ag/components/viva-ag-panel/viva-ag-panel.js'))) {
    throw new Error('Viva AG component was not compiled into its subpackage');
  }
  config.componentPlaceholder = { ...config.componentPlaceholder, 'viva-ag-panel': 'view' };
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
}

module.exports = { configureSubpackages };
if (require.main === module) {
  if (!process.argv[2]) throw new Error('Usage: configure-subpackages.cjs <compiled-mini-dir>');
  configureSubpackages(process.argv[2]);
  console.log('xapp-mini: Viva AG cross-subpackage component placeholder configured');
}
