const app = getApp()
const { BASE } = require('../../utils/config')

const T = {
  zh: { title: 'NANO', back: '返回' },
  en: { title: 'NANO', back: 'Back' },
}

Page({
  data: {
    url: '',
    lang: 'zh',
    t: T.zh,
    statusBarHeight: 44,
  },

  onLoad(options) {
    const user = app.globalData.user || wx.getStorageSync('nano_user')
    const lang = app.globalData.lang || (user?.language === 'en' ? 'en' : 'zh')
    const { statusBarHeight } = wx.getSystemInfoSync()
    this.setData({ lang, t: T[lang] || T.zh, statusBarHeight })

    // options.url: a /app/... path (without domain). We generate a webview token
    // so the web app can identify this user without a phone login.
    const path = options.url || '/app'
    const openid = user?.user_id || user?.openid
    if (!openid) {
      this.setData({ url: `${BASE}${path}` })
      return
    }

    const apiToken = app.globalData.apiToken
    wx.request({
      url: `${BASE}/api/webview-token`,
      method: 'POST',
      header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
      data: { openid },
      success: (res) => {
        const wvt = res.data?.wvt
        const sep = path.includes('?') ? '&' : '?'
        this.setData({ url: `${BASE}${path}${wvt ? `${sep}wvt=${wvt}` : ''}` })
      },
      fail: () => {
        this.setData({ url: `${BASE}${path}` })
      },
    })
  },

  goBack() {
    wx.navigateBack()
  },
})
