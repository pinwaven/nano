const app = getApp()
const BASE = 'https://nano.fros.cc'

Page({
  data: {
    loading: true,
    error: '',
  },

  onLoad() {
    this.wxLogin()
  },

  async wxLogin() {
    this.setData({ loading: true, error: '' })
    try {
      const { code } = await this.getCode()
      const res = await this.callWxLogin(code)

      if (!res.data?.success) {
        throw new Error(res.data?.error || 'Login failed')
      }

      const user = res.data.user
      // user_id for API calls is the external_id (openid) when returned from wx-login,
      // but the DB stores user_id separately — use user.user_id
      app.globalData.user = user
      app.globalData.lang = user.language === 'en' ? 'en' : 'zh'
      wx.setStorageSync('nano_user', user)
      wx.reLaunch({ url: '/pages/main/main' })
    } catch (e) {
      console.error('wxLogin error', e)
      this.setData({ loading: false, error: e.message || '登录失败，请重试' })
    }
  },

  getCode() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: resolve,
        fail: reject,
      })
    })
  },

  callWxLogin(code) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${BASE}/api/wx-login`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { code },
        success: resolve,
        fail: reject,
      })
    })
  },

  retry() {
    this.wxLogin()
  },
})
