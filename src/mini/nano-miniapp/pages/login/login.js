const app = getApp()
const BASE = 'https://nano.fros.cc'

Page({
  data: {
    step: 'checking',   // 'checking' | 'invite' | 'error'
    loading: true,
    error: '',
    inviteCode: '',
    inviteError: '',
    inviteBusy: false,
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

      if (res.data?.new_user) {
        // Not registered yet — prompt for invite code
        this.setData({ loading: false, step: 'invite', inviteError: '' })
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

  onInviteInput(e) {
    this.setData({ inviteCode: e.detail.value, inviteError: '' })
  },

  async submitInvite() {
    const { inviteCode, inviteBusy } = this.data
    if (inviteBusy) return
    const code = inviteCode.trim()
    if (!code) {
      this.setData({ inviteError: '请输入邀请码' })
      return
    }
    this.setData({ inviteBusy: true, inviteError: '' })
    try {
      const { code: wxCode } = await this._getCode()
      const res = await this._callWxLogin(wxCode, code)

      if (res.data?.invalid_code) {
        this.setData({ inviteError: '邀请码无效或已失效，请重新输入', inviteBusy: false })
        return
      }
      if (!res.data?.success) {
        this.setData({ inviteError: res.data?.error || '注册失败，请重试', inviteBusy: false })
        return
      }

      this._finishLogin(res.data)
    } catch (e) {
      this.setData({ inviteError: '网络错误，请重试', inviteBusy: false })
    }
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

  retry() {
    this.wxLogin()
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
        header: { 'Content-Type': 'application/json' },
        data,
        success: resolve,
        fail: reject,
      })
    })
  },
})
