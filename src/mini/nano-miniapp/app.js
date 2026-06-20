App({
  globalData: {
    user: null,
    channel: null,
    coach: null,
    lang: 'zh',
    theme: 'dark',
    apiToken: 'tokenData-gh9bc7917115bid72c68c8c4693g',
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
      // Only restore session if the profile is complete (phone bound)
      if (user && user.phone) {
        this.globalData.user = user
        this.globalData.channel = channel || null
        this.globalData.coach = coach || null
        this.globalData.lang = user.language === 'en' ? 'en' : ((channel?.locale === 'en') ? 'en' : 'zh')
        const savedTheme = wx.getStorageSync('nano_theme')
        this.globalData.theme = savedTheme || user.theme || 'dark'
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
