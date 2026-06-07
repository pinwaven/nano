const accountInfo = wx.getAccountInfoSync();
const envVersion = accountInfo.miniProgram.envVersion;

let BASE = 'https://nano.fros.cc';

switch (envVersion) {
  case 'develop':
    BASE = 'https://nano-dev.fros.cc';
    break;
  case 'trial':
  case 'release':
    BASE = 'https://nano.fros.cc';
    break;
}

// Bump this before each preview upload so you can confirm the newest build is on device.
// Format: MMDD-N (month+day, build number that day)
const VERSION = '0607-3';
const IS_DEV = envVersion === 'develop' || envVersion === 'trial';

module.exports = { BASE, VERSION, IS_DEV };
