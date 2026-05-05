const accountInfo = wx.getAccountInfoSync();
const envVersion = accountInfo.miniProgram.envVersion;

let BASE = 'https://nano.fros.cc';

switch (envVersion) {
  case 'develop':
  case 'trial':
    BASE = 'https://nano-dev.fros.cc';
    break;
  case 'release':
    BASE = 'https://nano.fros.cc';
    break;
}

module.exports = { BASE };
