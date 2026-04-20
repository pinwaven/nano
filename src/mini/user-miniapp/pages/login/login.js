const app = getApp()
const BASE = 'https://nano.fros.cc'

const T = {
  zh: {
    subtitle:     '您的精准健康伴侣',
    signIn:       '登录您的账户',
    phoneLabel:   '手机号码',
    phonePh:      '138 0000 0000',
    continue:     '继续',
    verifying:    '验证中…',
    errNotFound:  '未找到该手机号对应的账户，请联系您的 Coach。',
    errNetwork:   '连接失败，请检查网络后重试。',
    footerBrand:  '哈佛大学创新实验室',
    footerTag:    '成员企业',
  },
  en: {
    subtitle:     'Your Precision Health Companion',
    signIn:       'Sign in to your account',
    phoneLabel:   'Phone Number',
    phonePh:      '138 0000 0000',
    continue:     'Continue',
    verifying:    'Verifying…',
    errNotFound:  'No account found with this phone number. Please contact your coach.',
    errNetwork:   'Connection failed. Please check your network and try again.',
    footerBrand:  'Harvard Innovation Labs',
    footerTag:    'Member Company',
  }
}

Page({
  data: {
    phone: '',
    error: '',
    loading: false,
    lang: 'zh',
    t: T.zh,
  },

  onLoad() {
    const lang = app.globalData.lang || 'zh'
    this.setData({ lang, t: T[lang] })
    if (app.globalData.user) {
      wx.reLaunch({ url: '/pages/main/main' })
    }
  },

  toggleLang() {
    const lang = this.data.lang === 'zh' ? 'en' : 'zh'
    app.globalData.lang = lang
    this.setData({ lang, t: T[lang], error: '' })
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value, error: '' })
  },

  handleLogin() {
    const { phone, loading, t } = this.data
    const cleaned = phone.trim().replace(/[\s\-()]/g, '')
    if (!cleaned || loading) return

    this.setData({ loading: true, error: '' })

    wx.request({
      url: `${BASE}/api/users`,
      method: 'GET',
      success: (res) => {
        const users = res.data?.users || []
        const found = users.find(u =>
          u.phone && u.phone.replace(/[\s\-()]/g, '') === cleaned
        )
        if (found) {
          const lang = found.language === 'en' ? 'en' : 'zh'
          app.globalData.user = found
          app.globalData.lang = lang
          wx.setStorageSync('nano_user', found)
          wx.reLaunch({ url: '/pages/main/main' })
        } else {
          this.setData({ error: t.errNotFound, loading: false })
        }
      },
      fail: (err) => {
        console.error('wx.request fail', JSON.stringify(err))
        this.setData({ error: `${t.errNetwork} (${err.errMsg || ''})`, loading: false })
      }
    })
  }
})
