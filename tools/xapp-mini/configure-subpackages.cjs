const fs = require('node:fs');
const path = require('node:path');

// Patch native JSON for cross-subpackage components, including AG inside UserHealth.
// The main package can render a placeholder until each optional component downloads.
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

  if (!app.subPackages?.some(p => p.name === 'learn' && p.root === 'packages/learn')) {
    throw new Error('Missing Learn subpackage');
  }
  const mainFile = path.join(outputDir, 'pages/main/main.json');
  const mainConfig = JSON.parse(fs.readFileSync(mainFile, 'utf8'));
  if (!mainConfig.usingComponents?.['learn-panel']?.includes('packages/learn/') ||
      !fs.existsSync(path.join(outputDir, 'packages/learn/components/learn-panel/learn-panel.js'))) {
    throw new Error('Main page must reference the packaged Learn component');
  }
  mainConfig.componentPlaceholder = { ...mainConfig.componentPlaceholder, 'learn-panel': 'view' };
  fs.writeFileSync(mainFile, JSON.stringify(mainConfig, null, 2) + '\n');
}

module.exports = { configureSubpackages };
if (require.main === module) {
  if (!process.argv[2]) throw new Error('Usage: configure-subpackages.cjs <compiled-mini-dir>');
  configureSubpackages(process.argv[2]);
  console.log('xapp-mini: Viva AG and Learn cross-subpackage component placeholders configured');
}
