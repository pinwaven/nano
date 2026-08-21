const app = getApp()
const { BASE } = require('../../utils/config')

const T = {
  zh: { title: 'NANO', back: '退出' },
  en: { title: 'NANO', back: 'Exit' },
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

    // Optional caller-supplied intent payload (e.g. "open the store to buy this specific
    // committed dot formulation") — passed through navigateTo as a JSON-stringified query
    // param, same decode-then-parse treatment as options.url above since it goes through the
    // same unreliable auto-decode. Carried server-side via /api/webview-token's `context`
    // field and returned verbatim to the target page on exchange (handlers/login.js).
    let context = null
    if (options.context) {
      try {
        let rawContext = options.context
        try { rawContext = decodeURIComponent(rawContext) } catch (e) {}
        context = JSON.parse(rawContext)
      } catch (e) {
        context = null
      }
    }

    if (!openid) {
      this.setData({ url: target })
      return
    }

    const apiToken = app.globalData.apiToken
    wx.request({
      url: `${BASE}/api/webview-token`,
      method: 'POST',
      header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiToken}` },
      data: context ? { openid, context } : { openid },
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
