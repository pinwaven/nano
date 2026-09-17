const app = getApp()

// The store's payment 收款码, handed over from the GCN storefront page running inside
// pages/appview's <web-view> (dashboard.html → wx.miniProgram.navigateTo). A <web-view> cannot
// save an image, so the page hands the signed OSS URL of the code to this native page, whose
// whole job is one tap: 保存到相册. The buyer then opens WeChat's or Alipay's 扫一扫 and picks it
// from the album.
//
// That is the ceiling, and it was measured (dev, 2026-09-15, order df25055b): a Mini Program's
// wx.previewImage long-press menu only recognises 小程序码 / 公众号 / 群 / 名片 codes — a
// wxp:// 收款码 decodes fine locally but WeChat shows no 识别图中二维码 for it — and Alipay
// cannot be launched from inside WeChat at all (alipays:// and alipay.com are blocked). Don't
// bring previewImage back as a "pay directly" path; the only thing that removes the scan is a
// real wx.requestPayment merchant integration, which is a business change, not a page.
//
// Nothing here talks to a backend: the QR is an image the store uploaded, and the payment
// itself is still confirmed by the store (or by receipt OCR) exactly as before.

const T = {
  zh: {
    title: '扫码支付',
    back: '返回商城',
    amount: '订单金额',
    payee: '收款方',
    method_wechat_pay: '微信支付',
    method_alipay: '支付宝',
    method_aggregated_pay: '聚合支付',
    save: '保存二维码到相册',
    hintWechat: '小程序内无法直接识别收款码。保存二维码后，打开微信「扫一扫」→ 右上角「相册」选择该图片即可付款',
    hintAlipay: '微信内无法直接打开支付宝。保存二维码后，打开支付宝「扫一扫」→ 右上角「相册」选择该图片付款',
    hintAfter: '付款完成后返回商城，可上传付款截图由系统自动核对',
    saved: '已保存到相册',
    saveFailed: '保存失败，请长按图片手动保存',
    loadFailed: '二维码加载失败，请返回商城重试',
    albumTitle: '需要相册权限',
    albumContent: '请在设置中允许保存到相册，以保存收款二维码',
    goSettings: '去设置',
    cancel: '取消',
  },
  en: {
    title: 'Scan to Pay',
    back: 'Back to store',
    amount: 'Order total',
    payee: 'Pay to',
    method_wechat_pay: 'WeChat Pay',
    method_alipay: 'Alipay',
    method_aggregated_pay: 'Aggregated Pay',
    save: 'Save QR to album',
    hintWechat: 'A Mini Program cannot recognise a payment code directly. Save the QR code, then open WeChat → Scan → Album and pick this image.',
    hintAlipay: 'Alipay cannot be opened from inside WeChat. Save the QR code, then open Alipay → Scan → Album and pick this image.',
    hintAfter: 'Once paid, return to the store and upload your payment screenshot for automatic verification.',
    saved: 'Saved to album',
    saveFailed: 'Save failed — long-press the image to save it manually',
    loadFailed: 'Could not load the QR code. Please go back and try again.',
    albumTitle: 'Album access needed',
    albumContent: 'Please allow saving to your album in Settings so the QR code can be saved.',
    goSettings: 'Settings',
    cancel: 'Cancel',
  },
}

const METHODS = new Set(['wechat_pay', 'alipay', 'aggregated_pay'])

// options.* auto-decoding is unreliable (see pages/appview/appview.js). Decoding twice would
// corrupt a signed OSS URL — its Signature is percent-encoded base64 (`%2B`, `%3D`) and a
// second pass turns those into `+`/`=`, which OSS then refuses. So decode only if the value
// still carries its outer encoding.
function decodeOnce(v) {
  if (!v) return ''
  if (/^https?:\/\//i.test(v)) return v
  try { return decodeURIComponent(v) } catch (e) { return v }
}

Page({
  data: {
    lang: 'zh',
    t: T.zh,
    theme: 'dark',
    statusBarHeight: 44,
    qr: '',
    method: 'wechat_pay',
    methodLabel: '',
    isAlipay: false,
    amount: '',
    payee: '',
    saving: false,
    loadError: false,
  },

  onLoad(options) {
    const user = app.globalData.user || wx.getStorageSync('nano_user')
    const langParam = options.lang === 'en' || options.lang === 'zh' ? options.lang : null
    const lang = langParam || app.globalData.lang || (user?.language === 'en' ? 'en' : 'zh')
    const theme = app.globalData.theme || wx.getStorageSync('nano_theme') || 'dark'
    const { statusBarHeight } = wx.getSystemInfoSync()
    const t = T[lang] || T.zh

    const qr = decodeOnce(options.qr)
    const method = METHODS.has(options.method) ? options.method : 'wechat_pay'
    let payee = ''
    try { payee = options.payee ? decodeURIComponent(options.payee) : '' } catch (e) { payee = options.payee || '' }
    const amount = /^\d+(\.\d+)?$/.test(options.amount || '') ? Number(options.amount).toFixed(2) : ''

    this.setData({
      lang, t, theme, statusBarHeight,
      qr: /^https:\/\//i.test(qr) ? qr : '',
      method,
      methodLabel: t['method_' + method],
      isAlipay: method === 'alipay',
      amount,
      payee,
      loadError: !/^https:\/\//i.test(qr),
    })
  },

  // Full-screen view only. Its long-press menu offers 保存图片 too, but never 识别 for a
  // payment code (see the header), so the button below stays the primary action.
  handlePreview() {
    if (!this.data.qr) return
    wx.previewImage({ urls: [this.data.qr], current: this.data.qr })
  },

  onQrError() {
    this.setData({ loadError: true })
  },

  async handleSave() {
    const { qr, t, saving } = this.data
    if (!qr || saving) return
    this.setData({ saving: true })
    try {
      const ok = await this._ensureAlbumScope()
      if (!ok) return
      const { tempFilePath } = await new Promise((resolve, reject) => {
        wx.downloadFile({ url: qr, success: resolve, fail: reject })
      })
      await new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({ filePath: tempFilePath, success: resolve, fail: reject })
      })
      wx.showToast({ title: t.saved, icon: 'success' })
    } catch (err) {
      console.error('[pay-qr] save failed', err)
      wx.showToast({ title: t.saveFailed, icon: 'none', duration: 2500 })
    } finally {
      this.setData({ saving: false })
    }
  },

  // Same shape as pages/main/main.js's _checkRecordAuth: a previously denied scope makes
  // wx.authorize fail silently, so it has to route through Settings.
  _ensureAlbumScope() {
    return new Promise((resolve) => {
      wx.getSetting({
        success: (res) => {
          const state = res.authSetting['scope.writePhotosAlbum']
          if (state === true) { resolve(true); return }
          if (state === false) { this._promptOpenSetting(); resolve(false); return }
          wx.authorize({
            scope: 'scope.writePhotosAlbum',
            success: () => resolve(true),
            fail: () => { this._promptOpenSetting(); resolve(false) },
          })
        },
        fail: () => resolve(false),
      })
    })
  },

  _promptOpenSetting() {
    const { t } = this.data
    wx.showModal({
      title: t.albumTitle,
      content: t.albumContent,
      confirmText: t.goSettings,
      cancelText: t.cancel,
      success: (r) => { if (r.confirm) wx.openSetting() },
    })
  },

  goBack() {
    wx.navigateBack()
  },
})
