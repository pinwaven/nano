const app = getApp()

const T = {
  zh: {
    title: '邀请好友',
    back: '返回',
    yourCode: '您的专属邀请码',
    copyCode: '复制邀请码',
    copied: '已复制',
    shareCard: '分享给好友',
    shareTitle: '加入 Waven Nano，开启精准健康之旅',
    howTitle: '如何邀请？',
    how1: '点击「分享给好友」，将邀请卡片发送给微信好友或群。',
    how2: '好友通过您的链接注册后，即成功绑定邀请关系。',
    how3: '好友购买商品时，您将获得对应佣金，积分可申请提现。',
  },
  en: {
    title: 'Invite Friends',
    back: 'Back',
    yourCode: 'Your Referral Code',
    copyCode: 'Copy Code',
    copied: 'Copied',
    shareCard: 'Share with Friends',
    shareTitle: 'Join Waven Nano — precision health for your biology',
    howTitle: 'How it works',
    how1: 'Tap "Share with Friends" to send your invite card via WeChat.',
    how2: 'When your friend registers through your link, they\'re linked to you.',
    how3: 'You earn credits whenever your friend makes a purchase. Credits can be withdrawn as cash.',
  },
}

Page({
  data: {
    lang: 'zh',
    t: T.zh,
    theme: 'dark',
    statusBarHeight: 44,
    user: null,
    referralCode: '',
  },

  onLoad() {
    const user = app.globalData.user || wx.getStorageSync('nano_user')
    const lang = app.globalData.lang || (user?.language === 'en' ? 'en' : 'zh')
    const theme = app.globalData.theme || wx.getStorageSync('nano_theme') || 'dark'
    const { statusBarHeight } = wx.getSystemInfoSync()
    this.setData({ user, lang, t: T[lang] || T.zh, theme, statusBarHeight, referralCode: user?.referral_code || user?.user_id || '' })
  },

  copyCode() {
    wx.setClipboardData({
      data: this.data.referralCode,
      success: () => wx.showToast({ title: this.data.t.copied, icon: 'success' }),
    })
  },

  onShareAppMessage() {
    const user = this.data.user
    const t = this.data.t
    return {
      title: t.shareTitle,
      path: `pages/login/login?invite=${user?.referral_code || user?.user_id || ''}`,
    }
  },

  goBack() {
    wx.navigateBack()
  },
})
