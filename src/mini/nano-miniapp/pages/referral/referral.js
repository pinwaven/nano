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
    creditBalance: '积分余额',
    withdraw: '申请提现',
    withdrawTitle: '积分提现',
    withdrawCredits: '提现积分数',
    withdrawAccount: '收款账号（微信号/手机号）',
    withdrawSubmit: '提交申请',
    withdrawCancel: '取消',
    withdrawSuccess: '提现申请已提交',
    withdrawError: '提交失败，请重试',
    withdrawInsufficient: '积分余额不足',
    withdrawAmountRequired: '请输入提现积分数',
    withdrawAccountRequired: '请填写收款账号',
    withdrawHistory: '提现记录',
    noWithdrawals: '暂无提现记录',
    wdPending: '审核中', wdApproved: '已审批', wdRejected: '已拒绝', wdCompleted: '已完成',
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
    stats: 'Referral Stats',
    totalReferred: 'Friends Referred',
    totalEarned: 'Commission Earned',
    creditBalance: 'Credit Balance',
    withdraw: 'Withdraw',
    withdrawTitle: 'Credit Withdrawal',
    withdrawCredits: 'Credits to withdraw',
    withdrawAccount: 'Payment account (WeChat / phone)',
    withdrawSubmit: 'Submit',
    withdrawCancel: 'Cancel',
    withdrawSuccess: 'Withdrawal request submitted',
    withdrawError: 'Submit failed, please retry',
    withdrawInsufficient: 'Insufficient credit balance',
    withdrawAmountRequired: 'Enter credits amount',
    withdrawAccountRequired: 'Enter payment account',
    withdrawHistory: 'Withdrawal History',
    noWithdrawals: 'No withdrawal history',
    wdPending: 'Pending', wdApproved: 'Approved', wdRejected: 'Rejected', wdCompleted: 'Completed',
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
    how3: 'You earn credits whenever your friend makes a purchase. Credits can be withdrawn as cash.',
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
    user: null,
    referralCode: '',
    totalReferred: 0,
    totalEarned: 0,
    referrals: [],
    creditBalance: 0,
    creditCurrency: 'CNY',
    creditExchangeRate: 1.0,
    withdrawals: [],
    showWithdrawForm: false,
    withdrawCreditsInput: '',
    withdrawAccountInput: '',
    withdrawSubmitting: false,
  },

  onLoad() {
    const user = app.globalData.user || wx.getStorageSync('nano_user')
    const lang = app.globalData.lang || (user?.language === 'en' ? 'en' : 'zh')
    const theme = app.globalData.theme || wx.getStorageSync('nano_theme') || 'dark'
    const { statusBarHeight } = wx.getSystemInfoSync()
    this.setData({ user, lang, t: T[lang] || T.zh, theme, statusBarHeight, referralCode: user?.user_id || '' })
    this._loadAll(user?.user_id)
  },

  async _loadAll(userId) {
    if (!userId) { this.setData({ loading: false }); return }
    this.setData({ loading: true, error: '' })
    try {
      const headers = { 'Authorization': `Bearer ${app.globalData.apiToken}` }
      const uidQ = `user_id=${encodeURIComponent(userId)}`
      const [statsRes, balRes, wdRes] = await Promise.all([
        this._req(`${BASE}/api/my-referrals?${uidQ}`, headers),
        this._req(`${BASE}/api/credits/balance?${uidQ}`, headers),
        this._req(`${BASE}/api/credits/withdrawals?${uidQ}`, headers),
      ])
      const stats = statsRes.data || {}
      const bal = balRes.data || {}
      const wd = wdRes.data || {}
      if (!stats.success) throw new Error(stats.error || 'failed')
      this.setData({
        loading: false,
        totalReferred: stats.total_referred || 0,
        totalEarned: stats.total_commission_earned || 0,
        referrals: (stats.referrals || []).map(r => ({
          ...r,
          _joinedFmt: r.joined_at ? new Date(r.joined_at).toLocaleDateString('zh-CN') : '—',
          _avatarLetter: (r.nickname || '?')[0].toUpperCase(),
        })),
        creditBalance: bal.balance || 0,
        creditCurrency: bal.currency || 'CNY',
        creditExchangeRate: bal.exchange_rate || 1.0,
        withdrawals: (wd.withdrawals || []).map(w => ({
          ...w,
          _dateFmt: w.requested_at ? new Date(w.requested_at).toLocaleDateString('zh-CN') : '—',
        })),
      })
    } catch (e) {
      this.setData({ loading: false, error: this.data.t.errLoad })
    }
  },

  _req(url, headers) {
    return new Promise((resolve, reject) => {
      wx.request({ url, method: 'GET', header: headers, success: resolve, fail: reject })
    })
  },

  copyCode() {
    wx.setClipboardData({
      data: this.data.referralCode,
      success: () => wx.showToast({ title: this.data.t.copied, icon: 'success' }),
    })
  },

  openWithdrawForm() {
    this.setData({ showWithdrawForm: true, withdrawCreditsInput: '', withdrawAccountInput: '' })
  },

  closeWithdrawForm() {
    this.setData({ showWithdrawForm: false })
  },

  onWithdrawCreditsInput(e) {
    this.setData({ withdrawCreditsInput: e.detail.value })
  },

  onWithdrawAccountInput(e) {
    this.setData({ withdrawAccountInput: e.detail.value })
  },

  async submitWithdraw() {
    const t = this.data.t
    const credits = parseFloat(this.data.withdrawCreditsInput)
    const account = this.data.withdrawAccountInput.trim()
    if (!credits || credits <= 0) { wx.showToast({ title: t.withdrawAmountRequired, icon: 'none' }); return }
    if (!account) { wx.showToast({ title: t.withdrawAccountRequired, icon: 'none' }); return }
    if (credits > this.data.creditBalance) { wx.showToast({ title: t.withdrawInsufficient, icon: 'none' }); return }
    this.setData({ withdrawSubmitting: true })
    try {
      const res = await new Promise((resolve, reject) => {
        wx.request({
          url: `${BASE}/api/credits/withdraw`,
          method: 'POST',
          header: { 'Authorization': `Bearer ${app.globalData.apiToken}`, 'Content-Type': 'application/json' },
          data: { user_id: this.data.user?.user_id, credits_amount: credits, payment_method: 'wechat_pay', payment_account: account },
          success: resolve,
          fail: reject,
        })
      })
      if (!res.data?.success) throw new Error(res.data?.error || 'failed')
      wx.showToast({ title: t.withdrawSuccess, icon: 'success' })
      this.setData({ showWithdrawForm: false })
      this._loadAll(this.data.user?.user_id)
    } catch {
      wx.showToast({ title: t.withdrawError, icon: 'none' })
    } finally {
      this.setData({ withdrawSubmitting: false })
    }
  },

  wdStatusLabel(status) {
    const t = this.data.t
    return { pending: t.wdPending, approved: t.wdApproved, rejected: t.wdRejected, completed: t.wdCompleted }[status] || status
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
