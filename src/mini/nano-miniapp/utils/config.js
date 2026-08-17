const accountInfo = wx.getAccountInfoSync();
const envVersion = accountInfo.miniProgram.envVersion;

let BASE = 'https://nano.gcn.net';

switch (envVersion) {
  case 'develop':
    BASE = 'https://nano-dev.gcn.net';
    break;
  case 'trial':
  case 'release':
    BASE = 'https://nano.gcn.net';
    break;
}

// Bump on every change anywhere under src/mini/nano-miniapp/, not just before preview
// uploads — no build pipeline exists, so this is the only way to confirm WeChat DevTools
// is actually running the latest code rather than a stale cached compile. See CLAUDE.md
// "Miniapp VERSION Marker". Format: MMDD-N (month+day, build number that day).
const VERSION = '0817-1';
const WX_VERSION = accountInfo.miniProgram.version || '';
const IS_DEV = envVersion === 'develop' || envVersion === 'trial';

// Maps appid → channel config for brand-specific miniprograms.
// New users are auto-assigned to the channel; the logo/name show on the login screen immediately.
const APPID_TO_CHANNEL = {
  'wxd19a1403c4fea89d': {
    slug: 'Aeviva China',
    name: 'AEVIVA',
    logo: 'https://waven-nano.oss-cn-shanghai.aliyuncs.com/channels/logo/0d0321b89b5c9e25.png?OSSAccessKeyId=LTAI5t6bJNW5XQyeiNr2MUp4&Expires=2094125079&Signature=xWrxY1%2F4uMjlPIKPzNYD95sjnAc%3D',
  },
};
const _channelCfg = APPID_TO_CHANNEL[accountInfo.miniProgram.appId] || null;
const CHANNEL_SLUG = _channelCfg ? _channelCfg.slug : null;
const CHANNEL_DISPLAY = _channelCfg ? { logo_url: _channelCfg.logo, name: _channelCfg.name } : null;

module.exports = { BASE, VERSION, WX_VERSION, IS_DEV, CHANNEL_SLUG, CHANNEL_DISPLAY };
