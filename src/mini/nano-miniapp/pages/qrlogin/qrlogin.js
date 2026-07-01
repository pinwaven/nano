const { BASE: PROD_BASE } = require('../../utils/config');
const DEV_BASE = 'https://nano-dev.fros.cc';
const app = getApp();

Page({
  data: {
    status: 'idle',      // idle | loading | confirmed | error
    confirmed: false,
    error: false,
    errorMsg: '',
    sessionId: '',
    apiBase: '',
    userInfo: null,
    nickname: '',
  },

  onLoad(options) {
    // scene is URL-encoded when launched from QR scan
    const scene = decodeURIComponent(options.scene || '');
    if (!scene) {
      this.setData({ error: true, errorMsg: '二维码无效，请重新扫描' });
      return;
    }
    // 'd:' prefix means dev backend; otherwise use prod
    const isdev = scene.startsWith('d:');
    const sessionId = isdev ? scene.slice(2) : scene;
    const apiBase = isdev ? DEV_BASE : PROD_BASE;
    this.setData({ sessionId, apiBase });

    // Load user from storage to show who's logging in
    const storedUser = wx.getStorageSync('nano_user') || app.globalData?.user;
    if (storedUser) {
      this.setData({ nickname: storedUser.nickname || '' });
    }
    // Try to get WeChat avatar/nickname via getUserProfile (WeChat 2.21.2+)
    try {
      const info = wx.getUserInfoSync();
      if (info && info.userInfo) {
        this.setData({ userInfo: info.userInfo });
      }
    } catch (_) {}
  },

  confirmLogin() {
    const storedUser = wx.getStorageSync('nano_user') || app.globalData?.user;
    if (!storedUser || !storedUser.user_id) {
      this.setData({ error: true, errorMsg: '请先登录微信小程序后再扫码' });
      return;
    }
    this.setData({ status: 'loading' });
    wx.request({
      url: `${this.data.apiBase}/api/qr-login/confirm`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { session_id: this.data.sessionId, openid: storedUser.user_id },
      success: (res) => {
        if (res.data && res.data.success) {
          this.setData({ status: 'confirmed', confirmed: true });
        } else {
          const msg = res.data?.error || '确认失败，请重试';
          this.setData({ status: 'error', error: true, errorMsg: msg });
        }
      },
      fail: () => {
        this.setData({ status: 'error', error: true, errorMsg: '网络错误，请重试' });
      },
    });
  },

  cancelLogin() {
    wx.navigateBack({ delta: 1 });
  },
});
