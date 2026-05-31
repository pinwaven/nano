const app = getApp()
const { BASE } = require('../../utils/config.js')

Page({
  data: {
    step: 'checking',
    loading: true,
    error: '',
    phoneLoading: false,
    codeInput: '',
    codeLoading: false,
    pendingAvatar: '',
    channel: null,
  },

  _coachId: null,
  _inviteCode: null,
  _refCode: null,
  _pendingLogin: null,
  _pendingAvatarPath: '',

  onLoad(options) {
    if (options.coach_id) this._coachId = options.coach_id
    if (options.invite) this._inviteCode = options.invite
    if (options.ref) {
      this._refCode = options.ref
      wx.setStorageSync('nano_ref', options.ref)
    }
    // If already have a valid session and no invite/coach params, go straight to main
    if (app.globalData.user && !options.invite && !options.coach_id) {
      wx.reLaunch({ url: '/pages/main/main' })
      return
    }
    const storedChannel = wx.getStorageSync('nano_channel')
    if (storedChannel) this.setData({ channel: storedChannel })
    this.wxLogin()
  },

  async wxLogin() {
    this.setData({ loading: true, error: '', step: 'checking' })
    try {
      const { code } = await this._getCode()
      const res = await this._callWxLogin(code, this._inviteCode)

      if (res.data?.guest) {
        this.setData({ step: 'code', loading: false })
        return
      }

      if (!res.data?.success) {
        throw new Error(res.data?.error || '登录失败，请重试')
      }

      if (res.data.new_user) {
        this._pendingLogin = res.data
        this.setData({ step: 'phone', loading: false, channel: res.data.channel || this.data.channel })
        return
      }

      this._finishLogin(res.data)
    } catch (e) {
      console.error('wxLogin error', e)
      this.setData({ loading: false, step: 'error', error: e.message || '登录失败，请重试' })
    }
  },

  handleChooseAvatar(e) {
    const avatarUrl = e.detail?.avatarUrl
    if (!avatarUrl) return
    // Show immediately so the user sees feedback while uploading
    this.setData({ pendingAvatar: avatarUrl })

    const upload = (localPath) => {
      wx.request({
        url: `${BASE}/api/oss-presign?type=avatar&filename=avatar.jpg&category=users`,
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
                  // Upload finished after _finishLogin already ran — update globalData + storage
                  const gUser = app.globalData.user
                  if (gUser && !gUser.guest) {
                    gUser.avatar_url = get_url
                    wx.setStorageSync('nano_user', gUser)
                    wx.request({
                      url: `${BASE}/api/users/${gUser.user_id}`,
                      method: 'PUT',
                      header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.apiToken}` },
                      data: { nickname: gUser.nickname, phone: gUser.phone, email: gUser.email,
                              gender: gUser.gender, birth_date: gUser.birth_date, language: gUser.language,
                              coach_id: gUser.coach_id, avatar_url: get_url },
                    })
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
    if (errMsg !== 'getPhoneNumber:ok' || !code) {
      wx.showToast({ title: '需要授权手机号才能继续', icon: 'none', duration: 2000 })
      return
    }
    this.setData({ phoneLoading: true })
    try {
      const user = this._pendingLogin.user
      await wx.request({
        url: `${BASE}/api/bind-phone`,
        method: 'POST',
        header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.apiToken}` },
        data: { user_id: user.user_id, code, app_id: wx.getAccountInfoSync().miniProgram.appId },
      })
    } catch (e) {}
    this._finishLogin(this._pendingLogin)
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
        this._pendingLogin = res.data
        this.setData({ step: 'phone', codeLoading: false, channel: res.data.channel || this.data.channel })
        return
      }
      this._finishLogin(res.data)
    } catch (e) {
      wx.showToast({ title: e.message || '邀请码无效', icon: 'none' })
      this.setData({ codeLoading: false })
    }
  },

  _finishLogin(data) {
    const user = data.user
    const channel = data.channel || null
    const coach = data.coach || null
    // Use OSS URL if upload finished, otherwise the currently displayed URL as fallback.
    // If upload is still in progress, its success callback will update main.js once main loads.
    const avatarToSave = this._pendingAvatarPath || this.data.pendingAvatar
    if (avatarToSave) {
      user.avatar_url = avatarToSave
      if (this._pendingAvatarPath) {
        wx.request({
          url: `${BASE}/api/users/${user.user_id}`,
          method: 'PUT',
          header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.apiToken}` },
          data: { nickname: user.nickname, phone: user.phone, email: user.email,
                  gender: user.gender, birth_date: user.birth_date, language: user.language,
                  coach_id: user.coach_id, avatar_url: avatarToSave },
        })
      }
      this._pendingAvatarPath = ''
    }
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
    const { appId } = wx.getAccountInfoSync().miniProgram
    const data = { code, app_id: appId }
    if (this._coachId) data.coach_id = this._coachId
    if (inviteCode) data.invite_code = inviteCode
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
