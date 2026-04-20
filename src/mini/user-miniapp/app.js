App({
  globalData: {
    user: null,
    lang: 'zh'
  },
  onLaunch() {
    try {
      const user = wx.getStorageSync('nano_user')
      if (user) {
        this.globalData.user = user
        this.globalData.lang = user.language === 'en' ? 'en' : 'zh'
      }
    } catch (e) {}
  }
})
