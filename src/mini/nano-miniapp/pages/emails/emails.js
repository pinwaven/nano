const app = getApp()
const { BASE } = require('../../utils/config.js')
const { maskPhone, maskEmail } = require('../../utils/phone.js')

// Email twin of pages/phones/phones.js — a separate page rather than a generalised one, so
// the working phone page is untouched and this one can be left out of the aeviva build's menu
// (pages/main/main.js gates the entry on the channel root, as the server does).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const T = {
  zh: {
    title: '邮箱管理',
    back: '返回',
    loading: '加载中…',
    primaryBadge: '主邮箱',
    unverifiedBadge: '未验证',
    setPrimaryAction: '设为主邮箱',
    removeAction: '移除',
    addEmailBtn: '+ 添加邮箱',
    emptyHint: '还没有绑定邮箱。绑定后可用邮箱验证码登录。',
    emailLabel: '邮箱地址',
    emailPlaceholder: 'name@example.com',
    sendCodeBtn: '发送验证码',
    sending: '发送中…',
    codeLabel: '输入验证码',
    codeSentTo: '验证码已发送至 {email}，请留意垃圾邮件文件夹',
    verifyBtn: '验证并添加',
    verifying: '验证中…',
    resendCode: '重新发送验证码',
    resendCooldown: '{n}秒后可重新发送',
    changeEmail: '更换邮箱',
    cancelBtn: '取消',
    confirmRemoveTitle: '移除邮箱',
    confirmRemoveContent: '确定要移除 {email} 吗？',
    confirmSetPrimaryTitle: '设为主邮箱',
    confirmSetPrimaryContent: '将 {email} 设为主邮箱？',
    errorInvalidEmail: '请输入正确的邮箱地址',
    errorSendFailed: '验证码发送失败，请重试',
    errorRateLimited: '发送过于频繁，请稍后再试',
    errorNetwork: '网络错误，请重试',
    errorInvalidCode: '验证码不正确',
    errorTooManyAttempts: '错误次数过多，请重新获取验证码',
    errorEmailInUse: '该邮箱已被其他账号绑定',
    errorChannel: '当前账号暂不支持邮箱登录',
    toastRemoved: '已移除',
    toastPrimarySet: '已设为主邮箱',
    toastAdded: '已添加',
  },
  en: {
    title: 'Manage Emails',
    back: 'Back',
    loading: 'Loading…',
    primaryBadge: 'Primary',
    unverifiedBadge: 'Unverified',
    setPrimaryAction: 'Set Primary',
    removeAction: 'Remove',
    addEmailBtn: '+ Add Email',
    emptyHint: 'No email yet. Add one to sign in with an email code.',
    emailLabel: 'Email Address',
    emailPlaceholder: 'name@example.com',
    sendCodeBtn: 'Send Code',
    sending: 'Sending…',
    codeLabel: 'Enter Verification Code',
    codeSentTo: 'Code sent to {email} — check your spam folder too',
    verifyBtn: 'Verify & Add',
    verifying: 'Verifying…',
    resendCode: 'Resend Code',
    resendCooldown: 'Resend in {n}s',
    changeEmail: 'Change Email',
    cancelBtn: 'Cancel',
    confirmRemoveTitle: 'Remove Email',
    confirmRemoveContent: 'Remove {email}?',
    confirmSetPrimaryTitle: 'Set Primary',
    confirmSetPrimaryContent: 'Set {email} as your primary email?',
    errorInvalidEmail: 'Please enter a valid email address',
    errorSendFailed: 'Failed to send code, please try again',
    errorRateLimited: 'Too many requests, please try again later',
    errorNetwork: 'Network error, please try again',
    errorInvalidCode: 'Invalid code',
    errorTooManyAttempts: 'Too many wrong attempts — request a new code',
    errorEmailInUse: 'This email is already bound to another account',
    errorChannel: 'Email login is not available for this account',
    toastRemoved: 'Removed',
    toastPrimarySet: 'Primary email updated',
    toastAdded: 'Added',
  },
}

function fmt(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined) ? vars[k] : '')
}

Page({
  data: {
    lang: 'zh',
    t: T.zh,
    theme: 'dark',
    statusBarHeight: 44,
    user: null,
    emails: [],
    loading: true,

    addMode: false,
    addStep: 'email', // 'email' | 'code'
    newEmail: '',
    code: '',
    addLoading: false,
    addError: '',
    resendCooldown: 0,
    resendCooldownText: '',
    codeSentToText: '',
  },

  _cooldownTimer: null,

  onLoad() {
    const user = app.globalData.user || wx.getStorageSync('nano_user')
    const lang = app.globalData.lang || (user?.language === 'en' ? 'en' : 'zh')
    const theme = app.globalData.theme || wx.getStorageSync('nano_theme') || 'dark'
    const { statusBarHeight } = wx.getSystemInfoSync()
    this.setData({ user, lang, t: T[lang] || T.zh, theme, statusBarHeight })
    this.fetchEmails()
  },

  onUnload() {
    clearInterval(this._cooldownTimer)
  },

  goBack() {
    wx.navigateBack()
  },

  noop() {},

  async fetchEmails() {
    const user = this.data.user
    if (!user || user.guest) { this.setData({ loading: false }); return }
    this.setData({ loading: true })
    try {
      const res = await this._req(`${BASE}/api/email-otp/list?user_id=${encodeURIComponent(user.user_id)}`, 'GET')
      const emails = (res.data?.success && res.data.emails) ? res.data.emails : []
      this.setData({ emails, loading: false })
    } catch (e) {
      this.setData({ loading: false })
    }
  },

  // ── Add email ────────────────────────────────────────────────────────────

  openAddEmail() {
    this.setData({ addMode: true, addStep: 'email', newEmail: '', code: '', addError: '' })
  },

  closeAddEmail() {
    clearInterval(this._cooldownTimer)
    this.setData({ addMode: false, resendCooldown: 0 })
  },

  onEmailInput(e) {
    this.setData({ newEmail: String(e.detail.value || '').trim().slice(0, 254), addError: '' })
  },

  onCodeInput(e) {
    const val = String(e.detail.value || '').replace(/\D/g, '').slice(0, 6)
    this.setData({ code: val, addError: '' })
    if (val.length === 6) this.verifyCode()
  },

  _startCooldown() {
    const { t } = this.data
    this.setData({ resendCooldown: 60, resendCooldownText: fmt(t.resendCooldown, { n: 60 }) })
    clearInterval(this._cooldownTimer)
    this._cooldownTimer = setInterval(() => {
      const next = this.data.resendCooldown - 1
      if (next <= 0) {
        clearInterval(this._cooldownTimer)
        this.setData({ resendCooldown: 0 })
      } else {
        this.setData({ resendCooldown: next, resendCooldownText: fmt(this.data.t.resendCooldown, { n: next }) })
      }
    }, 1000)
  },

  async sendCode() {
    const { t, lang } = this.data
    const newEmail = this.data.newEmail.trim().toLowerCase()
    if (!EMAIL_RE.test(newEmail)) {
      this.setData({ addError: t.errorInvalidEmail })
      return
    }
    if (this.data.resendCooldown > 0) return
    this.setData({ addLoading: true, addError: '' })
    try {
      const res = await this._req(`${BASE}/api/email-otp/send`, 'POST', { email: newEmail, purpose: 'bind', language: lang })
      if (!res.data?.success) {
        const err = res.data?.error
        const msg = err === 'rate_limited' ? t.errorRateLimited
          : err === 'invalid_email' ? t.errorInvalidEmail
          : t.errorSendFailed
        this.setData({ addLoading: false, addError: msg })
        return
      }
      this.setData({ addStep: 'code', addLoading: false, code: '', newEmail, codeSentToText: fmt(t.codeSentTo, { email: newEmail }) })
      this._startCooldown()
    } catch (e) {
      this.setData({ addLoading: false, addError: t.errorNetwork })
    }
  },

  async verifyCode() {
    const { newEmail, code, addLoading, t, user } = this.data
    if (!code || addLoading) return
    this.setData({ addLoading: true, addError: '' })
    try {
      const res = await this._req(`${BASE}/api/email-otp/bind`, 'POST', { user_id: user.user_id, email: newEmail, code })
      if (!res.data?.success) {
        const err = res.data?.error
        const msg = err === 'invalid_code' ? t.errorInvalidCode
          : err === 'too_many_attempts' ? t.errorTooManyAttempts
          : err === 'email_in_use' ? t.errorEmailInUse
          : err === 'channel_not_supported' ? t.errorChannel
          : t.errorNetwork
        this.setData({ addLoading: false, addError: msg })
        return
      }
      // Either this account with the address attached, or the merge winner when the address
      // already belonged to an older account — the authoritative record for whoever the
      // user now is, so it replaces the cached session user (see phones.js).
      this._applyUpdatedUser(res.data.user, res.data.channel)
      this.setData({ addLoading: false, addMode: false })
      wx.showToast({ title: t.toastAdded, icon: 'success' })
      this.fetchEmails()
    } catch (e) {
      this.setData({ addLoading: false, addError: t.errorNetwork })
    }
  },

  changeEmail() {
    clearInterval(this._cooldownTimer)
    this.setData({ addStep: 'email', code: '', addError: '', resendCooldown: 0 })
  },

  // ── Set primary / remove ────────────────────────────────────────────────

  setPrimary(e) {
    const email = e.currentTarget.dataset.email
    const { t, user } = this.data
    wx.showModal({
      title: t.confirmSetPrimaryTitle,
      content: fmt(t.confirmSetPrimaryContent, { email }),
      success: async (res) => {
        if (!res.confirm) return
        try {
          const r = await this._req(`${BASE}/api/email-otp/set-primary`, 'POST', { user_id: user.user_id, email })
          if (!r.data?.success) { wx.showToast({ title: t.errorNetwork, icon: 'none' }); return }
          const row = this.data.emails.find(x => x.email === email)
          this._applyEmailChange(email, !!(row && row.verified_at))
          wx.showToast({ title: t.toastPrimarySet, icon: 'success' })
          this.fetchEmails()
        } catch (err) {
          wx.showToast({ title: t.errorNetwork, icon: 'none' })
        }
      },
    })
  },

  removeEmail(e) {
    const email = e.currentTarget.dataset.email
    const { t, user } = this.data
    wx.showModal({
      title: t.confirmRemoveTitle,
      content: fmt(t.confirmRemoveContent, { email }),
      success: async (res) => {
        if (!res.confirm) return
        try {
          const r = await this._req(`${BASE}/api/email-otp/remove`, 'POST', { user_id: user.user_id, email })
          if (!r.data?.success) { wx.showToast({ title: t.errorNetwork, icon: 'none' }); return }
          const next = r.data.new_primary
          const row = next && this.data.emails.find(x => x.email === next)
          this._applyEmailChange(next, !!(row && row.verified_at))
          wx.showToast({ title: t.toastRemoved, icon: 'success' })
          this.fetchEmails()
        } catch (err) {
          wx.showToast({ title: t.errorNetwork, icon: 'none' })
        }
      },
    })
  },

  // Reflects a primary-email change (set-primary / remove) into the cached session user.
  _applyEmailChange(newPrimaryEmail, verified) {
    const user = this.data.user
    if (!user) return
    this._applyUpdatedUser({ ...user, email: newPrimaryEmail, email_verified: !!newPrimaryEmail && verified }, app.globalData.channel)
  },

  _applyUpdatedUser(updatedUser, channel) {
    const { phone: _ph, email: _em, ...userToStore } = updatedUser
    const maskedPhone = updatedUser.maskedPhone || maskPhone(_ph) || maskEmail(_em)
    const fullUser = { ...updatedUser, maskedPhone }
    app.globalData.user = fullUser
    if (channel) app.globalData.channel = channel
    wx.setStorageSync('nano_user', {
      ...userToStore,
      phoneSet: !!(_ph || updatedUser.phoneSet),
      phone_verified: !!updatedUser.phone_verified,
      email_verified: !!updatedUser.email_verified,
      maskedPhone,
    })
    this.setData({ user: fullUser })
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
