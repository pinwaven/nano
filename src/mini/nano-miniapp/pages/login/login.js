const app = getApp()
const { BASE } = require('../../utils/config.js')

Page({
  data: {
    step: 'checking',
    loading: true,
    error: '',
    phoneLoading: false,
    pendingAvatar: '',
  },

  _coachId: null,
  _inviteCode: null,
  _pendingLogin: null,
  _pendingAvatarPath: '',

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

      if (res.data.new_user) {
        this._pendingLogin = res.data
        this.setData({ step: 'phone', loading: false })
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
      this._finishLogin(this._pendingLogin)
      return
    }
    this.setData({ phoneLoading: true })
    try {
      const user = this._pendingLogin.user
      await wx.request({
        url: `${BASE}/api/bind-phone`,
        method: 'POST',
        header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.apiToken}` },
        data: { user_id: user.user_id, code },
      })
    } catch (e) {}
    this._finishLogin(this._pendingLogin)
  },

  skipPhone() {
    this._finishLogin(this._pendingLogin)
  },

  retry() {
    this.wxLogin()
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
