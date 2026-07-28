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

// Bump this before each preview upload so you can confirm the newest build is on device.
// Format: MMDD-N (month+day, build number that day)
const VERSION = '0607-3';
const IS_DEV = envVersion === 'develop' || envVersion === 'trial';

// Maps appid → channel slug for brand-specific miniprograms.
// New users who open a branded miniprogram are auto-assigned to that channel.
// Fill in the real appid once the WeChat account is registered.
const APPID_TO_CHANNEL_SLUG = {
  // 'wx<aeviva-appid>': 'aeviva',
};
const CHANNEL_SLUG = APPID_TO_CHANNEL_SLUG[accountInfo.miniProgram.appId] || null;

module.exports = { BASE, VERSION, IS_DEV, CHANNEL_SLUG };
