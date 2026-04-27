App({
  globalData: {
    user: null,
    channel: null,
    coach: null,
    lang: 'zh',
    theme: 'dark',
    apiToken: 'tokenData-gh9bc7917115bid72c68c8c4693g',
  },
  onLaunch() {
    try {
      const user = wx.getStorageSync('nano_user')
      const channel = wx.getStorageSync('nano_channel')
      const coach = wx.getStorageSync('nano_coach')
      if (user) {
        this.globalData.user = user
        this.globalData.channel = channel || null
        this.globalData.coach = coach || null
        this.globalData.lang = user.language === 'en' ? 'en' : 'zh'
        this.globalData.theme = user.theme || 'dark'
      }
    } catch (e) {}
  }
})
