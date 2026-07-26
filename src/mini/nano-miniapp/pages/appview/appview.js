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

    // options.url: either a /app/... path (relative to nano's own domain) or an absolute
    // external URL (e.g. an aeviva.gcn.net storefront page — must be a WeChat-verified
    // business domain, see docs/wechat-domain-setup.md). Either way we generate a webview
    // token so the target page can identify this user without its own login.
    // WeChat's onLoad options are supposed to auto-decode, but in practice a value that's
    // itself a full URL (with its own '://', '?', '&') isn't reliably decoded before this
    // fires — leaving e.g. "https%3A%2F%2Faeviva-dev.gcn.net%2F..." intact, which then fails
    // the isExternal check below and gets mistaken for a relative path. Decode explicitly.
    let rawUrl = options.url || '/app'
    try { rawUrl = decodeURIComponent(rawUrl) } catch (e) {}
    const path = rawUrl
    const isExternal = /^https?:\/\//i.test(path)
    const target = isExternal ? path : `${BASE}${path}`
    const openid = user?.user_id || user?.openid
    if (!openid) {
      this.setData({ url: target })
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
        const sep = target.includes('?') ? '&' : '?'
        this.setData({ url: `${target}${wvt ? `${sep}wvt=${wvt}` : ''}` })
      },
      fail: () => {
        this.setData({ url: target })
      },
    })
  },

  goBack() {
    wx.navigateBack()
  },
})
