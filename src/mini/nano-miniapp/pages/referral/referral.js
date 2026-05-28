const app = getApp()
const { BASE } = require('../../utils/config.js')

const T = {
  zh: {
    title: '邀请好友',
    back: '返回',
    yourCode: '您的专属邀请码',
    copyCode: '复制邀请码',
    copied: '已复制',
    shareCard: '分享给好友',
    shareTitle: '加入 Waven Nano，开启精准健康之旅',
    stats: '邀请统计',
    totalReferred: '已邀请好友',
    totalEarned: '累计佣金',
    friendList: '好友列表',
    noFriends: '暂无邀请记录，快去邀请好友吧！',
    joined: '加入时间',
    earned: '产生佣金',
    unit: '人',
    cnyUnit: '元',
    loading: '加载中…',
    errLoad: '加载失败，请重试',
    howTitle: '如何邀请？',
    how1: '点击「分享给好友」，将邀请卡片发送给微信好友或群。',
    how2: '好友通过您的链接注册后，即成功绑定邀请关系。',
    how3: '好友购买商品时，您将获得对应佣金。',
  },
  en: {
    title: 'Invite Friends',
    back: 'Back',
    yourCode: 'Your Referral Code',
    copyCode: 'Copy Code',
    copied: 'Copied',
    shareCard: 'Share with Friends',
    shareTitle: 'Join Waven Nano — precision health for your biology',
    stats: 'Referral Stats',
    totalReferred: 'Friends Referred',
    totalEarned: 'Commission Earned',
    friendList: 'Referred Friends',
    noFriends: 'No referrals yet — share your link to get started!',
    joined: 'Joined',
    earned: 'Commission',
    unit: '',
    cnyUnit: '¥',
    loading: 'Loading…',
    errLoad: 'Failed to load, please retry',
    howTitle: 'How it works',
    how1: 'Tap "Share with Friends" to send your invite card via WeChat.',
    how2: 'When your friend registers through your link, they\'re linked to you.',
    how3: 'You earn a commission whenever your friend makes a purchase.',
  },
}

Page({
  data: {
    loading: true,
    error: '',
    lang: 'zh',
    t: T.zh,
    theme: 'dark',
    statusBarHeight: 44,
    capsuleRightPad: 100,
    user: null,
    referralCode: '',
    totalReferred: 0,
    totalEarned: 0,
    referrals: [],
  },

  onLoad() {
    const user = app.globalData.user || wx.getStorageSync('nano_user')
    const lang = app.globalData.lang || (user?.language === 'en' ? 'en' : 'zh')
    const theme = app.globalData.theme || wx.getStorageSync('nano_theme') || 'dark'
    const { statusBarHeight } = wx.getSystemInfoSync()

    this.setData({
      user,
      lang,
      t: T[lang] || T.zh,
      theme,
      statusBarHeight,
      referralCode: user?.user_id || '',
    })

    this._loadStats(user?.user_id)
  },

  async _loadStats(userId) {
    if (!userId) { this.setData({ loading: false }); return }
    this.setData({ loading: true, error: '' })
    try {
      const res = await new Promise((resolve, reject) => {
        wx.request({
          url: `${BASE}/api/my-referrals?user_id=${encodeURIComponent(userId)}`,
          method: 'GET',
          header: { 'Authorization': `Bearer ${app.globalData.apiToken}` },
          success: resolve,
          fail: reject,
        })
      })
      const data = res.data || {}
      if (!data.success) throw new Error(data.error || 'failed')
      this.setData({
        loading: false,
        totalReferred: data.total_referred || 0,
        totalEarned: data.total_commission_earned || 0,
        referrals: (data.referrals || []).map(r => ({
          ...r,
          _joinedFmt: r.joined_at ? new Date(r.joined_at).toLocaleDateString('zh-CN') : '—',
          _avatarLetter: (r.nickname || '?')[0].toUpperCase(),
        })),
      })
    } catch (e) {
      this.setData({ loading: false, error: this.data.t.errLoad })
    }
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
      path: `pages/login/login?ref=${user?.user_id || ''}`,
    }
  },

  goBack() {
    wx.navigateBack()
  },
})
