const app = getApp()
const { BASE, CHANNEL_SLUG, CHANNEL_DISPLAY, IS_DEV, VERSION, WX_VERSION } = require('../../utils/config.js')

Page({
  data: {
    step: 'checking',
    loading: true,
    error: '',
    codeInput: '',
    codeLoading: false,
    channel: null,
    version: IS_DEV ? VERSION : WX_VERSION,
  },

  _coachId: null,
  _inviteCode: null,
  _refCode: null,

  onLoad(options) {
    if (options.coach_id) this._coachId = options.coach_id
    if (options.invite) this._inviteCode = options.invite
    if (options.ref) {
      this._refCode = options.ref
      wx.setStorageSync('nano_ref', options.ref)
    }
    // If already have a valid session and no invite/coach params, go straight to main.
    // WeChat mini-program review requires free browsing — phone verification is never
    // a standing gate, only ever shown as part of a deliberate in-app sign-up (below).
    // Exception: a sign-up that was interrupted mid-flight (app closed/reopened right
    // after _finishNewUser, before completing or cancelling verify-phone) must resume
    // there, not silently drop into main — otherwise closing the app is an accidental
    // "skip verification forever" button.
    if (app.globalData.user && !options.invite && !options.coach_id) {
      const url = app.globalData.user.pendingPhoneVerification
        ? '/pages/verify-phone/verify-phone?new=1'
        : '/pages/main/main'
      wx.reLaunch({ url })
      return
    }
    const storedChannel = wx.getStorageSync('nano_channel')
    this.setData({ channel: storedChannel || CHANNEL_DISPLAY || null })
    this.wxLogin()
  },

  async wxLogin() {
    this.setData({ loading: true, error: '', step: 'checking' })
    try {
      const { code } = await this._getCode()
      const res = await this._callWxLogin(code, this._inviteCode)

      if (res.data?.guest) {
        app.globalData.user = { guest: true }
        wx.reLaunch({ url: '/pages/main/main' })
        return
      }

      if (!res.data?.success) {
        throw new Error(res.data?.error || '登录失败，请重试')
      }

      // Only a deliberate in-app sign-up (typed/shared invite code, or a coach link)
      // routes through phone verification. A brand-new account silently created by
      // channel branding (channel_slug, no explicit invite/coach) is treated like any
      // other successful login — straight to main, same as a guest.
      if (res.data.new_user && (this._inviteCode || this._coachId)) {
        this._finishNewUser(res.data)
        return
      }

      this._finishLogin(res.data)
    } catch (e) {
      if (IS_DEV) console.error('wxLogin error', e)
      this.setData({ loading: false, step: 'error', error: e.message || '登录失败，请重试' })
    }
  },

  retry() {
    this.wxLogin()
  },

  onCodeInput(e) {
    this.setData({ codeInput: e.detail.value })
  },

  async submitCode() {
    const code = this.data.codeInput.trim()
    if (!code) return
    this.setData({ codeLoading: true })
    try {
      const { code: wxCode } = await this._getCode()
      this._inviteCode = code
      const res = await this._callWxLogin(wxCode, code)
      if (!res.data?.success) throw new Error(res.data?.error || '邀请码无效')
      if (res.data.new_user) {
        this._finishNewUser(res.data)
        return
      }
      this._finishLogin(res.data)
    } catch (e) {
      wx.showToast({ title: e.message || '邀请码无效', icon: 'none' })
      this.setData({ codeLoading: false })
    }
  },

  // Brand-new accounts are always phone-unverified by construction (no bind-phone
  // step happens before account creation anymore) — send straight to verify-phone,
  // which also owns the optional avatar-picker for this first-run case (?new=1).
  // Only reached for a deliberate sign-up (see wxLogin/submitCode) — never a silent
  // auto-created account, so this never blocks ordinary browsing.
  _finishNewUser(data) {
    const user = { ...data.user, pendingPhoneVerification: true }
    const channel = data.channel || null
    app.globalData.user = user
    app.globalData.channel = channel
    app.globalData.lang = user.language === 'en' ? 'en' : 'zh'
    const { phone: _ph, email: _em, ...userToStore } = user
    wx.setStorageSync('nano_user', { ...userToStore, phoneSet: !!_ph, phone_verified: !!user.phone_verified })
    wx.setStorageSync('nano_channel', channel)
    wx.reLaunch({ url: '/pages/verify-phone/verify-phone?new=1' })
  },

  _finishLogin(data) {
    const user = data.user
    const channel = data.channel || null
    const coach = data.coach || null
    app.globalData.user = user
    app.globalData.channel = channel
    app.globalData.coach = coach
    app.globalData.lang = user.language === 'en' ? 'en' : 'zh'
    // Store a trimmed user object: omit phone/email (sensitive PII); keep phoneSet flag
    // for session-restore checks. Full data is re-fetched as needed.
    const { phone: _ph, email: _em, ...userToStore } = user
    wx.setStorageSync('nano_user', { ...userToStore, phoneSet: !!_ph, phone_verified: !!user.phone_verified })
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
    const { appId } = wx.getAccountInfoSync().miniProgram
    const data = { code, app_id: appId }
    if (this._coachId) data.coach_id = this._coachId
    if (inviteCode) data.invite_code = inviteCode
    if (!inviteCode && CHANNEL_SLUG) data.channel_slug = CHANNEL_SLUG
    const ref = this._refCode || wx.getStorageSync('nano_ref')
    if (ref) data.ref = ref
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${BASE}/api/wx-login`,
        method: 'POST',
        header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.apiToken}` },
        data,
        success: (res) => {
          wx.removeStorageSync('nano_ref')
          resolve(res)
        },
        fail: reject,
      })
    })
  },
})
