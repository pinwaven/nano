const app = getApp()
const BASE = 'https://nano.fros.cc'

Page({
  data: {
    loading: true,
    error: '',
  },

  _coachId: null,

  onLoad(options) {
    if (options.coach_id) this._coachId = options.coach_id
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
      const channel = res.data.channel || null
      const coach = res.data.coach || null
      app.globalData.user = user
      app.globalData.channel = channel
      app.globalData.coach = coach
      app.globalData.lang = user.language === 'en' ? 'en' : 'zh'
      wx.setStorageSync('nano_user', user)
      wx.setStorageSync('nano_channel', channel)
      wx.setStorageSync('nano_coach', coach)
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
    const data = { code }
    if (this._coachId) data.coach_id = this._coachId
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${BASE}/api/wx-login`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data,
        success: resolve,
        fail: reject,
      })
    })
  },

  retry() {
    this.wxLogin()
  },
})
