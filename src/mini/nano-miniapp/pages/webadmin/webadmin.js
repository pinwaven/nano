const app = getApp()

const T = {
  zh: { title: '网页后台', back: '返回' },
  en: { title: 'Web Admin', back: 'Back' },
}

Page({
  data: {
    lang: 'zh',
    t: T.zh,
    statusBarHeight: 44,
  },

  onLoad() {
    const user = app.globalData.user || wx.getStorageSync('nano_user')
    const lang = app.globalData.lang || (user?.language === 'en' ? 'en' : 'zh')
    const { statusBarHeight } = wx.getSystemInfoSync()
    this.setData({ lang, t: T[lang] || T.zh, statusBarHeight })
  },

  goBack() {
    wx.navigateBack()
  },
})
