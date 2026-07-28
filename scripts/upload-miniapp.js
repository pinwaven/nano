#!/usr/bin/env node
// Upload a channel's miniprogram to WeChat without opening DevTools.
// Usage: node scripts/upload-miniapp.js <channel>
// Keys live in certs/ — named waven-mini-upload-key.<appid>.key

const ci = require('miniprogram-ci');
const path = require('path');

const CHANNELS = {
  waven:  { appid: 'wx84bd7d00a6fd626e', key: 'certs/waven-mini-upload-key.wx84bd7d00a6fd626e.key' },
  aeviva: { appid: 'wxd19a1403c4fea89d', key: 'certs/aeviva-mini-upload-key.wxd19a1403c4fea89d.key' },
  fusion: { appid: 'wxecbcf00ce480fcf2', key: 'certs/fusion-mini-upload-key.wxecbcf00ce480fcf2.key' },
};

const channel = process.argv[2];
const cfg = CHANNELS[channel];

if (!cfg) {
  console.error(`Unknown channel: ${channel || '(none)'}`);
  console.error(`Available: ${Object.keys(CHANNELS).join(', ')}`);
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');

const project = new ci.Project({
  appid: cfg.appid,
  type: 'miniProgram',
  projectPath: path.join(ROOT, 'src/mini/nano-miniapp'),
  privateKeyPath: path.join(ROOT, cfg.key),
  ignores: ['node_modules/**/*'],
});

(async () => {
  const { version } = require('../package.json');
  console.log(`Uploading channel: ${channel}  appid: ${cfg.appid}  version: ${version}`);
  await ci.upload({
    project,
    version,
    desc: `Upload channel: ${channel}`,
    onProgressUpdate: (task) => {
      if (task._status !== 'done') process.stdout.write('.');
    },
  });
  console.log(`\nDone — ${channel} (${cfg.appid}) uploaded as v${version}`);
})().catch((err) => {
  console.error('\nUpload failed:', err.message || err);
  process.exit(1);
});
