const app = getApp()
const { BASE } = require('../../utils/config.js')

const PHONE_RE = /^1\d{10}$/

Page({
  data: {
    step: 'phone', // 'phone' | 'code'
    phone: '',
    code: '',
    loading: false,
    error: '',
    resendCooldown: 0,
  },

  _cooldownTimer: null,

  onLoad() {
    const user = app.globalData.user
    if (!user || user.guest) {
      // Nothing to verify without a real account — bounce back to login.
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    if (user.phone) this.setData({ phone: user.phone })
  },

  onUnload() {
    clearInterval(this._cooldownTimer)
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value.replace(/\D/g, ''), error: '' })
  },

  onCodeInput(e) {
    this.setData({ code: e.detail.value.replace(/\D/g, ''), error: '' })
  },

  async handleGetPhone(e) {
    const { code, errMsg } = e.detail
    if (errMsg !== 'getPhoneNumber:ok' || !code) return
    try {
      const { appId } = wx.getAccountInfoSync().miniProgram
      const res = await this._req(`${BASE}/api/resolve-phone`, 'POST', { code, app_id: appId })
      if (res.data?.success && res.data.phone) {
        this.setData({ phone: res.data.phone, error: '' })
      }
    } catch (e) {}
  },

  _startCooldown() {
    this.setData({ resendCooldown: 60 })
    clearInterval(this._cooldownTimer)
    this._cooldownTimer = setInterval(() => {
      const next = this.data.resendCooldown - 1
      if (next <= 0) {
        clearInterval(this._cooldownTimer)
        this.setData({ resendCooldown: 0 })
      } else {
        this.setData({ resendCooldown: next })
      }
    }, 1000)
  },

  async sendCode() {
    const phone = this.data.phone.trim()
    if (!PHONE_RE.test(phone)) {
      this.setData({ error: '请输入正确的手机号' })
      return
    }
    this.setData({ loading: true, error: '' })
    try {
      const res = await this._req(`${BASE}/api/phone-otp/send`, 'POST', { phone })
      if (!res.data?.success) {
        this.setData({ loading: false, error: '验证码发送失败，请重试' })
        return
      }
      this.setData({ step: 'code', loading: false, code: '' })
      this._startCooldown()
    } catch (e) {
      this.setData({ loading: false, error: '网络错误，请重试' })
    }
  },

  async verifyCode() {
    const { phone, code } = this.data
    if (!code) return
    this.setData({ loading: true, error: '' })
    try {
      const user = app.globalData.user
      const res = await this._req(`${BASE}/api/phone-otp/bind`, 'POST', { user_id: user.user_id, phone, code })
      if (!res.data?.success) {
        const msg = res.data?.error === 'invalid_code' ? '验证码不正确'
          : res.data?.error === 'phone_in_use' ? '该手机号已被其他账号绑定，请更换手机号'
          : '验证失败，请重试'
        if (res.data?.error === 'phone_in_use') {
          this.setData({ loading: false, error: msg, step: 'phone', code: '' })
        } else {
          this.setData({ loading: false, error: msg })
        }
        return
      }
      const updatedUser = { ...user, ...res.data.user, phoneSet: true, phone_verified: true }
      app.globalData.user = updatedUser
      if (res.data.channel) app.globalData.channel = res.data.channel
      const { phone: _ph, email: _em, ...userToStore } = updatedUser
      wx.setStorageSync('nano_user', { ...userToStore, phoneSet: true, phone_verified: true })
      wx.reLaunch({ url: '/pages/main/main' })
    } catch (e) {
      this.setData({ loading: false, error: '网络错误，请重试' })
    }
  },

  changeNumber() {
    clearInterval(this._cooldownTimer)
    this.setData({ step: 'phone', code: '', error: '', resendCooldown: 0 })
  },

  _req(url, method, data) {
    return new Promise((resolve, reject) => {
      wx.request({
        url, method, data,
        header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.apiToken}` },
        success: resolve,
        fail: reject,
      })
    })
  },
})
