const app = getApp()
const { BASE, CHANNEL_SLUG, CHANNEL_DISPLAY, IS_DEV, VERSION, WX_VERSION, EMAIL_LOGIN_AVAILABLE } = require('../../utils/config.js')
const { maskPhone, maskEmail } = require('../../utils/phone.js')

const LOGIN_PHONE_RE = /^1\d{10}$/
const LOGIN_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/


Page({
  data: {
    step: 'checking',
    loading: true,
    error: '',
    codeInput: '',
    codeLoading: false,
    channel: null,
    version: IS_DEV ? VERSION : WX_VERSION,
    // Logged-out ("continue as previous") screen. Holds the masked phone, or the masked
    // email for an email-only account — display only, one slot so the logout snapshot
    // (main.js/coach.js handleLogout) needs no second field.
    maskedPhone: '',
    // Phone/email-entry ("use a different number") sub-flow
    phoneStep: 'phone', // 'phone' | 'code'
    loginMethod: 'phone', // 'phone' | 'email' — which identifier the entry step collects
    emailLoginAvailable: false,
    phone: '',
    email: '',
    code: '',
    phoneError: '',
    phoneLoading: false,
    resendCooldown: 0,
    // Same list/default as verify-phone.js's signup screen — login-by-phone
    // (/phone-otp/verify) only actually accepts China numbers, so the send-code
    // button only appears for the otpSupported entry, but the picker itself
    // mirrors the signup screen for visual consistency.
    countryOptions: [
      { code: '+86', label: '中国 +86', otpSupported: true },
      { code: '+1', label: '美国 +1', otpSupported: false },
      { code: '+852', label: '中国香港 +852', otpSupported: false },
      { code: '+65', label: '新加坡 +65', otpSupported: false },
      { code: '+886', label: '中国台湾 +886', otpSupported: false },
      { code: '+66', label: '泰国 +66', otpSupported: false },
      { code: '+60', label: '马来西亚 +60', otpSupported: false },
      { code: '+84', label: '越南 +84', otpSupported: false },
      { code: '+81', label: '日本 +81', otpSupported: false },
    ],
    countryIndex: 0,
  },

  _coachId: null,
  _inviteCode: null,
  _refCode: null,
  // Channel picked by a channel QR code (`?channel=<id>` or wxacode scene `ch:<id>`) — resolved
  // to the channel's display name so it rides the existing channel_slug path in /wx-login.
  _channelSlug: null,
  _cooldownTimer: null,

  async onLoad(options) {
    if (options.coach_id) this._coachId = options.coach_id
    if (options.invite) this._inviteCode = options.invite
    // A 小程序码 minted by GET /channels/:id/miniapp-qrcode lands here with scene `ch:<id>`
    // (URL-encoded when launched from a real scan, same as pages/qrlogin). A plain
    // `?channel=<id>` query covers share links and DevTools compile-mode testing.
    const scene = decodeURIComponent(options.scene || '')
    const channelParam = options.channel || (scene.startsWith('ch:') ? scene.slice(3) : '')
    const channelId = /^\d+$/.test(channelParam) ? parseInt(channelParam, 10) : 0
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
    // Gated on the BUILD only (the aeviva-branded appid never offers it), not on whichever
    // channel was stored by the previous login: on the root app that is just who signed in
    // last, and hiding the option behind it stranded anyone switching from an aeviva account
    // to a Waven one. The server refuses an aeviva-tree account by itself
    // (channel_not_supported), so nothing is lost by offering the entry.
    this.setData({
      channel: storedChannel || CHANNEL_DISPLAY || null,
      emailLoginAvailable: EMAIL_LOGIN_AVAILABLE,
    })

    // Channel QR on the root build: fetch the channel's logo/name BEFORE wxLogin so the first
    // paint is already branded, not the Waven logo swapped after the login round-trip. Awaited
    // (bounded by the request timeout) because it also decides channel_slug for a brand-new
    // scanner; a failed fetch degrades to the unbranded flow rather than blocking login.
    if (channelId && !this._inviteCode && !this._coachId) {
      const branded = await this._fetchChannelBranding(channelId)
      if (branded) {
        this._channelSlug = branded.name
        this.setData({ channel: { name: branded.name, logo_url: branded.logo_url } })
      }
    }

    // Landed here from an explicit logout (main.js/coach.js handleLogout) — offer
    // "continue as previous" instead of silently re-authenticating right away.
    // Always show this screen whenever we have a session to restore, even if that
    // account has no phone on file to display (login-card falls back to a generic
    // label in that case) — an explicit logout should never silently re-log the
    // user back in with zero interaction, phone or not.
    if (options.loggedOut && !options.invite && !options.coach_id) {
      const lastSession = wx.getStorageSync('nano_last_session')
      if (lastSession && lastSession.user) {
        this.setData({ step: 'loggedOut', loading: false, maskedPhone: lastSession.maskedPhone || '' })
        return
      }
    }
    this.wxLogin()
  },

  onUnload() {
    clearInterval(this._cooldownTimer)
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
    // maskedPhone is computed here (the one moment the raw phone is actually
    // available) and persisted alongside phoneSet/phone_verified, because raw
    // phone itself is deliberately never stored/kept past this point — see
    // _finishLogin below for why re-deriving it later doesn't work.
    const maskedPhone = maskPhone(_ph) || maskEmail(_em)
    user.maskedPhone = maskedPhone
    wx.setStorageSync('nano_user', { ...userToStore, phoneSet: !!_ph, phone_verified: !!user.phone_verified, email_verified: !!user.email_verified, maskedPhone })
    wx.setStorageSync('nano_channel', channel)
    wx.setStorageSync('nano_base', BASE)   // the backend this session is valid against — app.js checks it on launch
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
    // maskedPhone (masked, not raw — safe to keep) is captured NOW because this is
    // the only point the raw phone is ever available: app.onLaunch() only ever
    // restores app.globalData.user from this trimmed wx.storage copy, so without
    // persisting a masked form here, any logout after even a single app restart
    // (routine on mobile) would find no phone to show on the logged-out screen.
    // An email-only account (no phone) shows its masked email on the logged-out screen instead.
    const maskedPhone = maskPhone(_ph) || maskEmail(_em)
    user.maskedPhone = maskedPhone
    wx.setStorageSync('nano_user', { ...userToStore, phoneSet: !!_ph, phone_verified: !!user.phone_verified, email_verified: !!user.email_verified, maskedPhone })
    wx.setStorageSync('nano_channel', channel)
    wx.setStorageSync('nano_base', BASE)   // the backend this session is valid against — app.js checks it on launch
    wx.setStorageSync('nano_coach', coach)
    wx.reLaunch({ url: '/pages/main/main' })
  },

  // ── Logged-out screen ──────────────────────────────────────────────────────

  // Restores the exact previous session directly from local storage — no network
  // call, no OTP. Deliberately NOT routed through wxLogin()/openid re-resolution:
  // if the user had switched to a different phone/account via verifyLoginCode()
  // below and later logged out again, openid would still resolve to the
  // *original* account, silently landing them in the wrong one. This mirrors
  // exitSandbox() in main.js/coach.js (restore a known snapshot, not re-derive).
  continueAsPrevious() {
    const lastSession = wx.getStorageSync('nano_last_session')
    if (!lastSession || !lastSession.user) { this.wxLogin(); return }
    app.globalData.user = lastSession.user
    app.globalData.channel = lastSession.channel || null
    app.globalData.coach = lastSession.coach || null
    app.globalData.lang = lastSession.user.language === 'en' ? 'en' : 'zh'
    wx.setStorageSync('nano_user', lastSession.user)
    wx.setStorageSync('nano_channel', lastSession.channel || null)
    wx.setStorageSync('nano_coach', lastSession.coach || null)
    wx.setStorageSync('nano_base', BASE)
    wx.reLaunch({ url: '/pages/main/main' })
  },

  useOtherNumber() {
    clearInterval(this._cooldownTimer)
    this.setData({
      step: 'phoneEntry', phoneStep: 'phone', loginMethod: 'phone', phone: '', email: '', code: '',
      phoneError: '', phoneLoading: false, resendCooldown: 0, countryIndex: 0,
    })
  },

  // Logged-out card → straight to the email entry (the phone card's toggle also reaches it).
  useEmailLogin() {
    this.useOtherNumber()
    this.setData({ loginMethod: 'email' })
  },

  // Phone ⇄ email switch on the entry step. Only rendered when emailLoginAvailable.
  toggleLoginMethod() {
    if (this.data.phoneStep !== 'phone' || this.data.phoneLoading) return
    const loginMethod = this.data.loginMethod === 'email' ? 'phone' : 'email'
    this.setData({ loginMethod, phoneError: '', code: '' })
  },

  onEmailInput(e) {
    this.setData({ email: String(e.detail.value || '').trim().slice(0, 254), phoneError: '' })
  },

  backToLoggedOut() {
    clearInterval(this._cooldownTimer)
    const lastSession = wx.getStorageSync('nano_last_session')
    this.setData({ step: 'loggedOut', maskedPhone: lastSession?.maskedPhone || '', phoneError: '' })
  },

  onCountryChange(e) {
    this.setData({ countryIndex: Number(e.detail.value), phone: '', phoneError: '' })
  },

  onPhoneInput(e) {
    const otpSupported = this.data.countryOptions[this.data.countryIndex].otpSupported
    const maxLen = otpSupported ? 11 : 15
    this.setData({ phone: e.detail.value.replace(/\D/g, '').slice(0, maxLen), phoneError: '' })
  },

  onLoginCodeInput(e) {
    const val = String(e.detail.value || '').replace(/\D/g, '').slice(0, 6)
    this.setData({ code: val, phoneError: '' })
    if (val.length === 6) this.verifyLoginCode()
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

  // The wxml's send / resend buttons call this on both steps; it routes by loginMethod.
  sendLoginCode() {
    return this.data.loginMethod === 'email' ? this._sendEmailLoginCode() : this._sendPhoneLoginCode()
  },

  verifyLoginCode() {
    return this.data.loginMethod === 'email' ? this._verifyEmailLoginCode() : this._verifyPhoneLoginCode()
  },

  async _sendEmailLoginCode() {
    const email = this.data.email.trim().toLowerCase()
    if (!LOGIN_EMAIL_RE.test(email)) {
      this.setData({ phoneError: '请输入正确的邮箱地址' })
      return
    }
    if (this.data.resendCooldown > 0) return
    this.setData({ phoneLoading: true, phoneError: '' })
    try {
      const res = await this._phoneReq(`${BASE}/api/email-otp/send`, { email, language: app.globalData.lang || 'zh' })
      if (!res.data?.success) {
        const err = res.data?.error
        const msg = err === 'rate_limited' ? '发送过于频繁，请稍后再试'
          : err === 'invalid_email' ? '请输入正确的邮箱地址'
          : '验证码发送失败，请重试'
        this.setData({ phoneLoading: false, phoneError: msg })
        return
      }
      this.setData({ phoneStep: 'code', phoneLoading: false, code: '', email })
      this._startCooldown()
    } catch (e) {
      this.setData({ phoneLoading: false, phoneError: '网络错误，请重试' })
    }
  },

  async _verifyEmailLoginCode() {
    const { email, code, phoneLoading } = this.data
    if (!code || phoneLoading) return
    this.setData({ phoneLoading: true, phoneError: '' })
    try {
      const res = await this._phoneReq(`${BASE}/api/email-otp/verify`, { email, code, language: app.globalData.lang || 'zh' })
      if (!res.data?.success) {
        const err = res.data?.error
        const msg = err === 'invalid_code' ? '验证码不正确'
          : err === 'too_many_attempts' ? '错误次数过多，请重新获取验证码'
          : err === 'channel_not_supported' ? '该账号暂不支持邮箱登录，请使用手机号'
          : '验证失败，请重试'
        this.setData({ phoneLoading: false, phoneError: msg, code: '' })
        return
      }
      clearInterval(this._cooldownTimer)
      this._finishLogin(res.data)
    } catch (e) {
      this.setData({ phoneLoading: false, phoneError: '网络错误，请重试' })
    }
  },

  async _sendPhoneLoginCode() {
    const phone = this.data.phone.trim()
    // Login-by-phone (/phone-otp/verify) only accepts China numbers — the picker
    // itself still lists every country for visual parity with the signup screen,
    // but the send-code button is hidden for non-supported ones in the wxml, so
    // this is a defensive backstop rather than the primary guard.
    if (!this.data.countryOptions[this.data.countryIndex].otpSupported || !LOGIN_PHONE_RE.test(phone)) {
      this.setData({ phoneError: '请输入正确的手机号' })
      return
    }
    if (this.data.resendCooldown > 0) return
    this.setData({ phoneLoading: true, phoneError: '' })
    try {
      const res = await this._phoneReq(`${BASE}/api/phone-otp/send`, { phone })
      if (!res.data?.success) {
        this.setData({ phoneLoading: false, phoneError: '验证码发送失败，请重试' })
        return
      }
      this.setData({ phoneStep: 'code', phoneLoading: false, code: '' })
      this._startCooldown()
    } catch (e) {
      this.setData({ phoneLoading: false, phoneError: '网络错误，请重试' })
    }
  },

  async _verifyPhoneLoginCode() {
    const { phone, code, phoneLoading } = this.data
    if (!code || phoneLoading) return
    this.setData({ phoneLoading: true, phoneError: '' })
    try {
      const res = await this._phoneReq(`${BASE}/api/phone-otp/verify`, { phone, code })
      if (!res.data?.success) {
        const msg = res.data?.error === 'invalid_code' ? '验证码不正确' : '验证失败，请重试'
        this.setData({ phoneLoading: false, phoneError: msg, code: '' })
        return
      }
      clearInterval(this._cooldownTimer)
      this._finishLogin(res.data)
    } catch (e) {
      this.setData({ phoneLoading: false, phoneError: '网络错误，请重试' })
    }
  },

  _phoneReq(url, data) {
    return new Promise((resolve, reject) => {
      wx.request({
        url, method: 'POST',
        header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.apiToken}` },
        data,
        success: resolve,
        fail: reject,
      })
    })
  },

  _getCode() {
    return new Promise((resolve, reject) => {
      wx.login({ success: resolve, fail: reject })
    })
  },

  // Resolves to { name, logo_url } or null — never throws (branding is best-effort).
  _fetchChannelBranding(channelId) {
    return new Promise((resolve) => {
      wx.request({
        url: `${BASE}/api/channel-branding?id=${channelId}`,
        method: 'GET',
        timeout: 4000,
        header: { 'Authorization': `Bearer ${app.globalData.apiToken}` },
        success: (res) => resolve(res.data?.success && res.data.channel?.name ? res.data.channel : null),
        fail: () => resolve(null),
      })
    })
  },

  _callWxLogin(code, inviteCode) {
    const { appId } = wx.getAccountInfoSync().miniProgram
    const data = { code, app_id: appId }
    if (this._coachId) data.coach_id = this._coachId
    if (inviteCode) data.invite_code = inviteCode
    // A scanned channel QR wins over the build's default: on the root build CHANNEL_SLUG is
    // null anyway, and on a branded build a QR for another channel is a deliberate choice.
    if (!inviteCode && (this._channelSlug || CHANNEL_SLUG)) data.channel_slug = this._channelSlug || CHANNEL_SLUG
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
