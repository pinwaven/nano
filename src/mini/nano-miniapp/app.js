App({
  globalData: {
    user: null,
    channel: null,
    coach: null,
    lang: 'zh'
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
      }
    } catch (e) {}
  }
})
