const app = getApp()
const BASE = 'https://nano.fros.cc'

Page({
  data: {
    step: 'checking',
    loading: true,
    error: '',
  },

  _coachId: null,
  _inviteCode: null,

  onLoad(options) {
    if (options.coach_id) this._coachId = options.coach_id
    if (options.invite) this._inviteCode = options.invite
    this.wxLogin()
  },

  async wxLogin() {
    this.setData({ loading: true, error: '', step: 'checking' })
    try {
      const { code } = await this._getCode()
      const res = await this._callWxLogin(code, this._inviteCode)

      if (res.data?.guest) {
        app.globalData.user = { guest: true, user_id: res.data.openid, nickname: null, language: 'zh' }
        app.globalData.channel = null
        app.globalData.coach = null
        wx.reLaunch({ url: '/pages/main/main' })
        return
      }

      if (!res.data?.success) {
        throw new Error(res.data?.error || '登录失败，请重试')
      }

      this._finishLogin(res.data)
    } catch (e) {
      console.error('wxLogin error', e)
      this.setData({ loading: false, step: 'error', error: e.message || '登录失败，请重试' })
    }
  },

  retry() {
    this.wxLogin()
  },

  _finishLogin(data) {
    const user = data.user
    const channel = data.channel || null
    const coach = data.coach || null
    app.globalData.user = user
    app.globalData.channel = channel
    app.globalData.coach = coach
    app.globalData.lang = user.language === 'en' ? 'en' : 'zh'
    wx.setStorageSync('nano_user', user)
    wx.setStorageSync('nano_channel', channel)
    wx.setStorageSync('nano_coach', coach)
    wx.reLaunch({ url: '/pages/main/main' })
  },

  _getCode() {
    return new Promise((resolve, reject) => {
      wx.login({ success: resolve, fail: reject })
    })
  },

  _callWxLogin(code, inviteCode) {
    const data = { code }
    if (this._coachId) data.coach_id = this._coachId
    if (inviteCode) data.invite_code = inviteCode
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${BASE}/api/wx-login`,
        method: 'POST',
        header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.apiToken}` },
        data,
        success: resolve,
        fail: reject,
      })
    })
  },
})
