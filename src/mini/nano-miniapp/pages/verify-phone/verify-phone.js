const app = getApp()
const { BASE } = require('../../utils/config.js')

const PHONE_RE = /^1\d{10}$/

Page({
  data: {
    step: 'phone', // 'phone' | 'code'
    phone: '',
    code: '',
    codeDigits: ['', '', '', '', '', ''],
    loading: false,
    error: '',
    resendCooldown: 0,
    // Only shown right after brand-new account creation (login.js passes ?new=1) —
    // an already-existing account being retroactively forced through this gate has
    // no reason to be asked for an avatar again.
    showAvatarStep: false,
    pendingAvatar: '',
    // Only China (`otpSupported: true`) goes through real SMS-OTP — PHONE_RE and
    // PNVS's countryCode are both hardcoded to '86' server-side, and Aliyun PNVS
    // isn't confirmed to support delivery/signature approval outside China. The
    // other countries are accepted as-is with no verification (see
    // acceptUnverifiedPhone) rather than blocked outright.
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

  _cooldownTimer: null,
  _pendingAvatarPath: '',

  onLoad(options) {
    const user = app.globalData.user
    if (!user || user.guest) {
      // Nothing to verify without a real account — bounce back to login.
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.setData({ showAvatarStep: options.new === '1' })
    // user.phone is stored as E.164 (+86...) for China numbers — this input only
    // ever collects/displays the bare 11-digit form, so strip the prefix back off.
    if (user.phone) this.setData({ phone: user.phone.replace(/^\+86/, '') })
  },

  onUnload() {
    clearInterval(this._cooldownTimer)
  },

  onPhoneInput(e) {
    const otpSupported = this.data.countryOptions[this.data.countryIndex].otpSupported
    const maxLen = otpSupported ? 11 : 15
    this.setData({ phone: e.detail.value.replace(/\D/g, '').slice(0, maxLen), error: '' })
  },

  onCountryChange(e) {
    this.setData({ countryIndex: Number(e.detail.value), phone: '', error: '' })
  },

  onCodeInput(e) {
    const val = String(e.detail.value || '').replace(/\D/g, '').slice(0, 6)
    const digits = val.split('')
    while (digits.length < 6) digits.push('')
    this.setData({ code: val, codeDigits: digits, error: '' })
    if (val.length === 6) this.verifyCode()
  },

  // Fires on every tap regardless of whether the native chooseAvatar sheet
  // actually opens — lets us tell (via remote debug console) whether the tap
  // reached the button at all vs. the picker opening then failing/cancelling.
  handleAvatarTap() {
    console.log('[verify-phone] avatar button tapped')
  },

  handleChooseAvatar(e) {
    console.log('[verify-phone] chooseavatar event', e.detail)
    const avatarUrl = e.detail?.avatarUrl
    if (!avatarUrl) {
      if (e.detail?.errMsg && !/cancel/i.test(e.detail.errMsg)) {
        wx.showToast({ title: '头像获取失败，请重试', icon: 'none' })
      }
      return
    }
    // Show immediately so the user sees feedback while uploading
    this.setData({ pendingAvatar: avatarUrl })

    const upload = (localPath) => {
      wx.request({
        url: `${BASE}/api/oss/presign?type=avatar&filename=avatar.jpg&category=users`,
        method: 'GET',
        header: { 'Authorization': `Bearer ${app.globalData.apiToken}` },
        success: (presignRes) => {
          const { put_url, get_url } = presignRes.data || {}
          if (!put_url) return
          wx.getFileSystemManager().readFile({
            filePath: localPath,
            success: (fileRes) => {
              wx.request({
                url: put_url,
                method: 'PUT',
                data: fileRes.data,
                header: { 'Content-Type': 'application/octet-stream' },
                responseType: 'text',
                success: () => {
                  this._pendingAvatarPath = get_url
                  this.setData({ pendingAvatar: get_url })
                  // If verifyCode already ran and moved on to main.js by the time this
                  // upload finishes, patch the saved user directly here — verifyCode's
                  // own PUT (below) only fires when the upload finished before it did.
                  const gUser = app.globalData.user
                  if (gUser && !gUser.guest) {
                    gUser.avatar_url = get_url
                    wx.setStorageSync('nano_user', gUser)
                    this._req(`${BASE}/api/users/${gUser.user_id}`, 'PUT', {
                      nickname: gUser.nickname, phone: gUser.phone, email: gUser.email,
                      gender: gUser.gender, birth_date: gUser.birth_date, language: gUser.language,
                      coach_id: gUser.coach_id, avatar_url: get_url,
                    }).catch(() => {})
                  }
                },
              })
            },
          })
        },
      })
    }

    if (avatarUrl.startsWith('http')) {
      wx.downloadFile({
        url: avatarUrl,
        success: (res) => upload(res.tempFilePath),
      })
    } else {
      upload(avatarUrl)
    }
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
      this.setData({ step: 'code', loading: false, code: '', codeDigits: ['', '', '', '', '', ''] })
      this._startCooldown()
    } catch (e) {
      this.setData({ loading: false, error: '网络错误，请重试' })
    }
  },

  async verifyCode() {
    const { phone, code, loading } = this.data
    if (!code || loading) return
    this.setData({ loading: true, error: '' })
    try {
      const user = app.globalData.user
      const res = await this._req(`${BASE}/api/phone-otp/bind`, 'POST', { user_id: user.user_id, phone, code })
      if (!res.data?.success) {
        const msg = res.data?.error === 'invalid_code' ? '验证码不正确'
          : res.data?.error === 'phone_in_use' ? '该手机号已被其他账号绑定，请更换手机号'
          : '验证失败，请重试'
        if (res.data?.error === 'phone_in_use') {
          this.setData({ loading: false, error: msg, step: 'phone', code: '', codeDigits: ['', '', '', '', '', ''] })
        } else {
          this.setData({ loading: false, error: msg })
        }
        return
      }
      const updatedUser = { ...user, ...res.data.user, phoneSet: true, phone_verified: true, pendingPhoneVerification: false }
      app.globalData.user = updatedUser
      if (res.data.channel) app.globalData.channel = res.data.channel
      const { phone: _ph, email: _em, ...userToStore } = updatedUser
      wx.setStorageSync('nano_user', { ...userToStore, phoneSet: true, phone_verified: true })
      wx.reLaunch({ url: '/pages/main/main' })
    } catch (e) {
      this.setData({ loading: false, error: '网络错误，请重试' })
    }
  },

  // Non-China numbers skip OTP entirely — accepted as typed, with no proof of
  // ownership. phone_verified stays false (handlePhoneAcceptUnverified never sets
  // phone_verified_at), but pendingPhoneVerification is still cleared so the
  // sign-up completes like the OTP path does.
  async acceptUnverifiedPhone() {
    const { phone, loading, countryOptions, countryIndex } = this.data
    if (loading || phone.length < 4) return
    this.setData({ loading: true, error: '' })
    try {
      const user = app.globalData.user
      const fullPhone = `${countryOptions[countryIndex].code}${phone}`
      const res = await this._req(`${BASE}/api/phone-otp/accept-unverified`, 'POST', { user_id: user.user_id, phone: fullPhone })
      if (!res.data?.success) {
        const msg = res.data?.error === 'phone_in_use' ? '该手机号已被其他账号绑定，请更换手机号' : '提交失败，请重试'
        this.setData({ loading: false, error: msg })
        return
      }
      const updatedUser = { ...user, ...res.data.user, phoneSet: true, pendingPhoneVerification: false }
      app.globalData.user = updatedUser
      if (res.data.channel) app.globalData.channel = res.data.channel
      const { phone: _ph, email: _em, ...userToStore } = updatedUser
      wx.setStorageSync('nano_user', { ...userToStore, phoneSet: true, phone_verified: !!updatedUser.phone_verified })
      wx.reLaunch({ url: '/pages/main/main' })
    } catch (e) {
      this.setData({ loading: false, error: '网络错误，请重试' })
    }
  },

  changeNumber() {
    clearInterval(this._cooldownTimer)
    this.setData({ step: 'phone', code: '', codeDigits: ['', '', '', '', '', ''], error: '', resendCooldown: 0 })
  },

  handleLogout() {
    clearInterval(this._cooldownTimer)
    const user = app.globalData.user
    // This page is only ever reached moments after a brand-new account was created
    // (see login.js _finishNewUser, ?new=1) — it has no phone, no chat history, no
    // data of any kind yet. Cancelling here should fully undo that sign-up, not
    // leave behind a phone-less, unverified account still usable via a plain
    // re-login (WeChat would just log the same openid back into the same row).
    // Best-effort: local session is cleared regardless of whether this succeeds.
    if (user && !user.guest && this.data.showAvatarStep) {
      this._req(`${BASE}/api/users/${user.user_id}`, 'DELETE').catch(() => {})
    }
    wx.removeStorageSync('nano_user')
    app.globalData.user = null
    wx.reLaunch({ url: '/pages/login/login' })
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
