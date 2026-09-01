App({
  globalData: {
    user: null,
    channel: null,
    coach: null,
    lang: 'zh',
    theme: 'dark',
    textScale: 0,   // accessibility text size, 0-3; see .fs-1/.fs-2/.fs-3 in app.wxss
    apiToken: 'tokenData-gh9bc7917115bid72c68c8c4693g',
    sandboxMode: false,
  },

  // Holds the resolve fn WeChat passes to onNeedPrivacyAuthorization.
  // The user-health component reads this and calls it after the user taps agree.
  _privacyResolve: null,
  _onPrivacyRequest: null,

  onLaunch() {
    try {
      const user = wx.getStorageSync('nano_user')
      const channel = wx.getStorageSync('nano_channel')
      const coach = wx.getStorageSync('nano_coach')
      // Deliberately read OUTSIDE the `if (user)` block below, unlike theme: an
      // accessibility setting has to survive logout and apply on the guest/login
      // screens too, where globalData.user is still null.
      // `??` chain, not `||`: 0 is a valid level and `||` would treat it as unset and
      // fall through to the server value.
      const storedScale = parseInt(wx.getStorageSync('nano_text_scale'), 10)
      const serverScale = parseInt(user && user.text_scale, 10)
      const resolvedScale = Number.isNaN(storedScale)
        ? (Number.isNaN(serverScale) ? 0 : serverScale)
        : storedScale
      this.globalData.textScale = Math.max(0, Math.min(3, resolvedScale))
      // Restore any stored account regardless of phone completeness — phone is optional
      // (see guest sign-up password-skip). Missing-phone nudging is handled in-chat instead.
      if (user) {
        this.globalData.user = user
        this.globalData.channel = channel || null
        this.globalData.coach = coach || null
        this.globalData.lang = user.language === 'en' ? 'en' : ((channel?.locale === 'en') ? 'en' : 'zh')
        const savedTheme = wx.getStorageSync('nano_theme')
        this.globalData.theme = savedTheme || user.theme || 'dark'
        this.globalData.sandboxMode = !!wx.getStorageSync('nano_sandbox_active')
      }
    } catch (e) {}

    // WeChat fires this whenever a privacy API (e.g. openBluetoothAdapter) is
    // called and the user hasn't consented yet. Without this listener WeChat
    // blocks the call with "fail appid privacy api banned" in release builds.
    if (wx.onNeedPrivacyAuthorization) {
      wx.onNeedPrivacyAuthorization((resolve) => {
        this._privacyResolve = resolve
        if (this._onPrivacyRequest) this._onPrivacyRequest()
      })
    }
  },
})
