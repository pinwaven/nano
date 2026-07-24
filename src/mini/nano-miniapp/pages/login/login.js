const app = getApp()
const { BASE, CHANNEL_SLUG, CHANNEL_DISPLAY, IS_DEV, VERSION, WX_VERSION } = require('../../utils/config.js')

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
    version: IS_DEV ? VERSION : WX_VERSION,

    // Phone-skip passcode overlay
    skipPassOpen: false,
    skipPassInput: '',
    skipPassError: false,

    // Privacy consent popup
    showPrivacyPopup: false,
  },

  _coachId: null,
  _inviteCode: null,
  _refCode: null,
  _pendingLogin: null,
  _pendingAvatarPath: '',

  onShow() {
    app._onPrivacyRequest = () => {
      this.setData({ showPrivacyPopup: true })
    }
  },

  onHide() {
    if (app._onPrivacyRequest) app._onPrivacyRequest = null
  },

  onUnload() {
    if (app._onPrivacyRequest) app._onPrivacyRequest = null
  },

  noop() {},

  onPrivacyAgree() {
    if (app._privacyResolve) {
      app._privacyResolve({ event: 'agree', buttonId: 'login-privacy-agree-btn' })
      app._privacyResolve = null
    }
    this.setData({ showPrivacyPopup: false })
  },

  onPrivacyCancel() {
    if (app._privacyResolve) {
      app._privacyResolve({ event: null })
      app._privacyResolve = null
    }
    this.setData({ showPrivacyPopup: false })
  },

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

      if (res.data.new_user) {
        this._pendingLogin = res.data
        this.setData({ step: 'phone', loading: false, channel: res.data.channel || this.data.channel })
        return
      }

      this._finishLogin(res.data)
    } catch (e) {
      if (IS_DEV) console.error('wxLogin error', e)
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
                fail: (err) => {
                  if (IS_DEV) console.error('avatar PUT upload failed:', err)
                },
              })
            },
            fail: (err) => {
              if (IS_DEV) console.error('avatar readFile failed:', err)
            },
          })
        },
        fail: (err) => {
          if (IS_DEV) console.error('avatar presign failed:', err)
        },
      })
    }

    const isRemoteNetworkUrl = (url) => {
      if (!url || typeof url !== 'string') return false
      if (url.startsWith('wxfile://') || url.startsWith('content://')) return false
      if (url.startsWith('http://tmp') || url.startsWith('https://tmp')) return false
      if (url.startsWith('http://usr') || url.startsWith('https://usr')) return false
      if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) return false
      return url.startsWith('http://') || url.startsWith('https://')
    }

    if (isRemoteNetworkUrl(avatarUrl)) {
      wx.downloadFile({
        url: avatarUrl,
        success: (res) => upload(res.tempFilePath),
        fail: (err) => {
          if (IS_DEV) console.error('downloadFile failed, fallback to upload direct:', err)
          upload(avatarUrl)
        },
      })
    } else {
      upload(avatarUrl)
    }
  },

  async handleGetPhone(e) {
    const { code, errMsg } = e.detail
    if (errMsg !== 'getPhoneNumber:ok' || !code) {
      if (IS_DEV) console.error('getPhoneNumber error detail:', e.detail)
      if (errMsg && errMsg.includes('frequently')) {
        wx.showToast({ title: '操作太频繁，请稍后再试', icon: 'none', duration: 2500 })
      } else if (errMsg && (errMsg.includes('deny') || errMsg.includes('cancel'))) {
        wx.showToast({ title: '需要授权手机号才能继续', icon: 'none', duration: 2000 })
      } else {
        wx.showToast({ title: errMsg || '授权失败，请重试', icon: 'none', duration: 2500 })
      }
      return
    }
    if (this.data.phoneLoading) return
    this.setData({ phoneLoading: true })
    try {
      const user = this._pendingLogin?.user || {}
      await new Promise((resolve, reject) => {
        wx.request({
          url: `${BASE}/api/bind-phone`,
          method: 'POST',
          header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.apiToken}` },
          data: { user_id: user.user_id, code, app_id: wx.getAccountInfoSync().miniProgram.appId },
          success: (res) => resolve(res),
          fail: (err) => reject(err),
        })
      })
      this._finishLogin(this._pendingLogin)
    } catch (err) {
      if (IS_DEV) console.error('bind-phone failed:', err)
      this.setData({ phoneLoading: false })
      wx.showToast({ title: '手机号绑定失败，请重试', icon: 'none', duration: 2000 })
    }
  },

  retry() {
    this.wxLogin()
  },

  openSkipPass() {
    this.setData({ skipPassOpen: true, skipPassInput: '', skipPassError: false })
  },

  closeSkipPass() {
    this.setData({ skipPassOpen: false, skipPassInput: '', skipPassError: false })
  },

  handleSkipPassKey(e) {
    const { skipPassInput, skipPassError } = this.data
    if (skipPassError || skipPassInput.length >= 4) return
    const digit = e.currentTarget.dataset.digit
    const next = skipPassInput + digit
    if (next.length < 4) {
      this.setData({ skipPassInput: next })
      return
    }
    if (next === '1709') {
      this.setData({ skipPassInput: next })
      setTimeout(() => {
        this.setData({ skipPassOpen: false, skipPassInput: '' })
        this._finishLogin(this._pendingLogin)
      }, 180)
    } else {
      this.setData({ skipPassInput: next, skipPassError: true })
      setTimeout(() => {
        this.setData({ skipPassInput: '', skipPassError: false })
      }, 900)
    }
  },

  handleSkipPassDelete() {
    const { skipPassInput } = this.data
    if (skipPassInput.length === 0) return
    this.setData({ skipPassInput: skipPassInput.slice(0, -1), skipPassError: false })
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
    // Store a trimmed user object: omit phone/email (sensitive PII); keep phoneSet flag
    // for session-restore and phone-prompt checks. Full data is re-fetched as needed.
    const { phone: _ph, email: _em, ...userToStore } = user
    wx.setStorageSync('nano_user', { ...userToStore, phoneSet: !!_ph })
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
