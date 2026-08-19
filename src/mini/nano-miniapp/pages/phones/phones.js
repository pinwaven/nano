const app = getApp()
const { BASE } = require('../../utils/config.js')
const { maskPhone } = require('../../utils/phone.js')

const PHONE_RE = /^1\d{10}$/

const T = {
  zh: {
    title: '手机号管理',
    back: '返回',
    loading: '加载中…',
    primaryBadge: '主号码',
    setPrimaryAction: '设为主号码',
    removeAction: '移除',
    addPhoneBtn: '+ 添加手机号',
    phoneLabel: '手机号',
    phonePlaceholder: '请输入手机号',
    sendCodeBtn: '发送验证码',
    sending: '发送中…',
    codeLabel: '输入验证码',
    codeSentTo: '验证码已发送至 {phone}',
    verifyBtn: '验证并添加',
    verifying: '验证中…',
    resendCode: '重新发送验证码',
    resendCooldown: '{n}秒后可重新发送',
    changeNumber: '更换手机号',
    cancelBtn: '取消',
    confirmRemoveTitle: '移除手机号',
    confirmRemoveContent: '确定要移除 {phone} 吗？',
    confirmSetPrimaryTitle: '设为主号码',
    confirmSetPrimaryContent: '将 {phone} 设为主号码？',
    errorInvalidPhone: '请输入正确的手机号',
    errorSendFailed: '验证码发送失败，请重试',
    errorNetwork: '网络错误，请重试',
    errorInvalidCode: '验证码不正确',
    errorPhoneInUse: '该手机号已被其他账号绑定',
    toastRemoved: '已移除',
    toastPrimarySet: '已设为主号码',
    toastAdded: '已添加',
  },
  en: {
    title: 'Manage Phone Numbers',
    back: 'Back',
    loading: 'Loading…',
    primaryBadge: 'Primary',
    setPrimaryAction: 'Set Primary',
    removeAction: 'Remove',
    addPhoneBtn: '+ Add Phone Number',
    phoneLabel: 'Phone Number',
    phonePlaceholder: 'Enter phone number',
    sendCodeBtn: 'Send Code',
    sending: 'Sending…',
    codeLabel: 'Enter Verification Code',
    codeSentTo: 'Code sent to {phone}',
    verifyBtn: 'Verify & Add',
    verifying: 'Verifying…',
    resendCode: 'Resend Code',
    resendCooldown: 'Resend in {n}s',
    changeNumber: 'Change Number',
    cancelBtn: 'Cancel',
    confirmRemoveTitle: 'Remove Phone Number',
    confirmRemoveContent: 'Remove {phone}?',
    confirmSetPrimaryTitle: 'Set Primary',
    confirmSetPrimaryContent: 'Set {phone} as your primary number?',
    errorInvalidPhone: 'Please enter a valid phone number',
    errorSendFailed: 'Failed to send code, please try again',
    errorNetwork: 'Network error, please try again',
    errorInvalidCode: 'Invalid code',
    errorPhoneInUse: 'This number is already bound to another account',
    toastRemoved: 'Removed',
    toastPrimarySet: 'Primary number updated',
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
    phones: [],
    loading: true,

    addMode: false,
    addStep: 'phone', // 'phone' | 'code'
    newPhone: '',
    code: '',
    codeDigits: ['', '', '', '', '', ''],
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
    this.fetchPhones()
  },

  onUnload() {
    clearInterval(this._cooldownTimer)
  },

  goBack() {
    wx.navigateBack()
  },

  noop() {},

  async fetchPhones() {
    const user = this.data.user
    if (!user || user.guest) { this.setData({ loading: false }); return }
    this.setData({ loading: true })
    try {
      const res = await this._req(`${BASE}/api/phone-otp/list?user_id=${encodeURIComponent(user.user_id)}`, 'GET')
      const phones = (res.data?.success && res.data.phones) ? res.data.phones.map(p => ({ ...p, masked: maskPhone(p.phone) })) : []
      this.setData({ phones, loading: false })
    } catch (e) {
      this.setData({ loading: false })
    }
  },

  // ── Add phone ────────────────────────────────────────────────────────────

  openAddPhone() {
    this.setData({ addMode: true, addStep: 'phone', newPhone: '', code: '', codeDigits: ['', '', '', '', '', ''], addError: '' })
  },

  closeAddPhone() {
    clearInterval(this._cooldownTimer)
    this.setData({ addMode: false, resendCooldown: 0 })
  },

  onPhoneInput(e) {
    this.setData({ newPhone: e.detail.value.replace(/\D/g, '').slice(0, 11), addError: '' })
  },

  onCodeInput(e) {
    const val = String(e.detail.value || '').replace(/\D/g, '').slice(0, 6)
    const digits = val.split('')
    while (digits.length < 6) digits.push('')
    this.setData({ code: val, codeDigits: digits, addError: '' })
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
    const { newPhone, t } = this.data
    if (!PHONE_RE.test(newPhone)) {
      this.setData({ addError: t.errorInvalidPhone })
      return
    }
    this.setData({ addLoading: true, addError: '' })
    try {
      const res = await this._req(`${BASE}/api/phone-otp/send`, 'POST', { phone: newPhone })
      if (!res.data?.success) {
        this.setData({ addLoading: false, addError: t.errorSendFailed })
        return
      }
      this.setData({ addStep: 'code', addLoading: false, code: '', codeDigits: ['', '', '', '', '', ''], codeSentToText: fmt(t.codeSentTo, { phone: newPhone }) })
      this._startCooldown()
    } catch (e) {
      this.setData({ addLoading: false, addError: t.errorNetwork })
    }
  },

  async verifyCode() {
    const { newPhone, code, addLoading, t, user } = this.data
    if (!code || addLoading) return
    this.setData({ addLoading: true, addError: '' })
    try {
      const res = await this._req(`${BASE}/api/phone-otp/bind`, 'POST', { user_id: user.user_id, phone: newPhone, code })
      if (!res.data?.success) {
        const msg = res.data?.error === 'invalid_code' ? t.errorInvalidCode
          : res.data?.error === 'phone_in_use' ? t.errorPhoneInUse
          : t.errorNetwork
        this.setData({ addLoading: false, addError: msg })
        return
      }
      // res.data.user is either this account (new phone attached, non-primary) or,
      // if the number was already verified on a different account, the merge winner
      // — either way it's the current, authoritative record for whoever the user
      // now is, so it fully replaces the cached session user.
      this._applyUpdatedUser(res.data.user, res.data.channel)
      this.setData({ addLoading: false, addMode: false })
      wx.showToast({ title: t.toastAdded, icon: 'success' })
      this.fetchPhones()
    } catch (e) {
      this.setData({ addLoading: false, addError: t.errorNetwork })
    }
  },

  changeNumber() {
    clearInterval(this._cooldownTimer)
    this.setData({ addStep: 'phone', code: '', codeDigits: ['', '', '', '', '', ''], addError: '', resendCooldown: 0 })
  },

  // ── Set primary / remove ────────────────────────────────────────────────

  setPrimary(e) {
    const phone = e.currentTarget.dataset.phone
    const { t, user } = this.data
    wx.showModal({
      title: t.confirmSetPrimaryTitle,
      content: fmt(t.confirmSetPrimaryContent, { phone: maskPhone(phone) }),
      success: async (res) => {
        if (!res.confirm) return
        try {
          const r = await this._req(`${BASE}/api/phone-otp/set-primary`, 'POST', { user_id: user.user_id, phone })
          if (!r.data?.success) { wx.showToast({ title: t.errorNetwork, icon: 'none' }); return }
          this._applyPhoneChange(phone)
          wx.showToast({ title: t.toastPrimarySet, icon: 'success' })
          this.fetchPhones()
        } catch (err) {
          wx.showToast({ title: t.errorNetwork, icon: 'none' })
        }
      },
    })
  },

  removePhone(e) {
    const phone = e.currentTarget.dataset.phone
    const { t, user } = this.data
    wx.showModal({
      title: t.confirmRemoveTitle,
      content: fmt(t.confirmRemoveContent, { phone: maskPhone(phone) }),
      success: async (res) => {
        if (!res.confirm) return
        try {
          const r = await this._req(`${BASE}/api/phone-otp/remove`, 'POST', { user_id: user.user_id, phone })
          if (!r.data?.success) { wx.showToast({ title: t.errorNetwork, icon: 'none' }); return }
          this._applyPhoneChange(r.data.new_primary)
          wx.showToast({ title: t.toastRemoved, icon: 'success' })
          this.fetchPhones()
        } catch (err) {
          wx.showToast({ title: t.errorNetwork, icon: 'none' })
        }
      },
    })
  },

  // Reflects a primary-phone change (set-primary / remove) back into the cached
  // session user, same fields verify-phone.js keeps in sync on its own phone writes.
  _applyPhoneChange(newPrimaryPhone) {
    const user = this.data.user
    if (!user) return
    const updatedUser = { ...user, phone: newPrimaryPhone, phone_verified: !!newPrimaryPhone }
    this._applyUpdatedUser(updatedUser, app.globalData.channel)
  },

  _applyUpdatedUser(updatedUser, channel) {
    const { phone: _ph, email: _em, ...userToStore } = updatedUser
    const maskedPhone = maskPhone(_ph)
    const fullUser = { ...updatedUser, maskedPhone }
    app.globalData.user = fullUser
    if (channel) app.globalData.channel = channel
    wx.setStorageSync('nano_user', { ...userToStore, phoneSet: true, phone_verified: !!updatedUser.phone_verified, maskedPhone })
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
