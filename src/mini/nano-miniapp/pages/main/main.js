const app = getApp()
const BASE = 'https://nano.fros.cc'

// ── i18n ──────────────────────────────────────────────────────────────────────

const T = {
  zh: {
    tabChat: '对话', tabHealth: '健康', tabDots: '原粒', tabStore: '商城',
    logout: '退出',
    initMsg: '您好！我是 Nano，您的AI健康伴侣。今天有什么可以帮您的？',
    inputPh: '输入消息…',
    errServer: '无法连接服务器，请重试。',
    obNamePrompt: '在开始之前，需要了解一些基本信息来个性化您的健康洞察。请问您的姓名是？',
    obNameOnly: '有一件小事——请问您叫什么名字？',
    obNamePh: '您的姓名',
    obGenderPrompt: '好的！请问您的性别是？',
    obGenderOnly: '为了个性化您的体验，请问您的性别是？',
    obBirthdayPrompt: '请问您的出生日期是？',
    obBirthdayOnly: '还有一件事——请告诉我您的出生日期？',
    obBodyPrompt: '最后一步——请告诉我您的身高和体重，帮助计算您的健康指标。',
    obBodyOnly: '还有一件事——请告诉我您的身高和体重？',
    obComplete: '您的个人信息已完善！今天有什么可以帮您的？',
    confirm: '确认',
    bsHeight: '身高', bsWeight: '体重', bsCm: 'cm', bsKg: 'kg',
    male: '男', female: '女',
    selectBirthday: '选择出生日期',
    profile: '个人信息',
    gender: '性别', born: '出生日期', language: '语言',
    height: '身高', weight: '体重',
    coach: 'Coach', joined: '注册时间', phone: '手机', email: '邮箱',
    healthConditions: '健康状况', noConditions: '无特殊健康状况',
    bioAge: '生物年龄', chronoAge: '实际年龄',
    latestBm: '最新生物标志物',
    trends: '趋势',
    tests: '次检测',
    noBmData: '暂无生物标志物数据。',
    noHistory: '暂无检测记录。',
    genderMap: { male: '男', female: '女' },
    langMap: { zh: '中文', en: 'English' },
    subAgeLabels: {
      ResilienceAge: '抗压年龄', CellularAge: '细胞年龄',
      MetabolicAge: '代谢年龄', MicroVascularAge: '微血管年龄',
    },
    subAgeDesc: {
      ResilienceAge: '衡量你的身体抵御和缓冲压力的能力。',
      CellularAge: '衡量你细胞底层的原生生命力。',
      MetabolicAge: '衡量你的身体燃烧能量的洁净度与效率。',
      MicroVascularAge: '衡量你输送营养与氧气的微循环能力。',
    },
    bmLabels: {
      hsCRP: 'hsCRP', GDF15: 'GDF-15', IL6: 'IL-6',
      GA: '糖化白蛋白', CystatinC: '胱抑素 C', CD38: 'CD38',
    },
    dotsTitle: '营养方案',
    noPlan: '暂无营养方案。完成 Kino 生物标志物检测后，系统将为您生成个性化方案。',
    morning: '早上', evening: '晚上', today: '今天', tomorrow: '明天',
    obConditionsPrompt: '您是否曾被诊断/体检出以下方面的问题？（可多选）',
    obConditionsNone: '以上均无',
    obConditionsOtherPh: '请描述您的其他健康状况',
    storeTitle: '健康商城',
    storeBuy: '立即订购',
    storeOrderSent: '订单已提交！我们的健康顾问将尽快与您联系。',
    storeConfirmTitle: '确认订单',
    storeBestseller: '热销', storeValue: '超值',
    storeEmpty: '暂无商品。',
    storeSubProducts: '商品', storeSubOrders: '我的订单',
    noOrders: '暂无订单记录。',
    toolFormulaDots: '配制 DOTS',
    toolTestChip: '使用芯片',
    toolFormulaDotMsg: '请帮我配制我的 DOTS 方案',
    toolTestChipMsg: '我想使用 Kino 芯片',
    formulaGenerating: '正在根据您的生物标志物生成7天营养方案…',
    formulaComplete: '您的7天营养方案已生成！',
    formulaViewDots: '查看营养方案 →',
    formulaError: '方案生成失败，请重试。',
    adminMenu: '渠道管理',
    coachMenu: '教练面板',
    superadminMenu: '超管面板',
    kinoSimMenu: 'Kino 模拟器',
    kinoSimPassTitle: '输入密码',
    kinoSimPassError: '密码错误',
    kinoSimTitle: 'KINO 模拟器',
    kinoSimStatusReady: '就绪',
    kinoSimStatusAnalyzing: '分析中…',
    kinoSimStatusComplete: '完成',
    kinoSimStatusFailed: '失败',
    kinoSimBtnStart: '开始生物标志物检测',
    kinoSimBtnRunAnother: '再次检测',
    kinoSimQuit: '退出模拟器',
    kinoSimTabBioAge: '生物年龄',
    kinoSimTabBm: '生物标志物',
    kinoSimBioAgeLabel: '生物年龄',
    kinoSimChronoLabel: '实际年龄',
    kinoScanPrompt: '请扫描您 Kino 芯片上的二维码，以登记您的样本。',
    kinoScanBtn: '扫描二维码',
    kinoScanSuccess: '您的 Kino 芯片已成功登记！我们将处理您的样本，完成后会通知您结果。',
    kinoScanError: '登记失败，请重试。',
    orderStatus: {
      pending: '待处理', confirmed: '已确认', shipped: '已发货',
      delivered: '已送达', cancelled: '已取消',
    },
    conditionLabels: {
      blood_sugar_high:    '血糖高',
      blood_pressure_high: '血压高',
      blood_lipids_high:   '血脂高',
      cholesterol_high:    '胆固醇高',
      heart_issues:        '心脏问题',
      gout_uric_acid:      '痛风或尿酸高',
      kidney_disease:      '肾病',
      sleep_deficiency:    '睡眠不足',
      other:               '其他',
    },
  },
  en: {
    tabChat: 'Chat', tabHealth: 'Health', tabDots: 'Dots', tabStore: 'Store',
    logout: 'Logout',
    initMsg: 'Hello! I am Nano, your AI health companion. How can I help you today?',
    inputPh: 'Type a message…',
    errServer: 'Could not reach the server. Please try again.',
    obNamePrompt: 'Before we start, I need a couple of quick details to personalize your health insights. What should I call you?',
    obNameOnly: 'One quick thing — what is your name?',
    obNamePh: 'Your name',
    obGenderPrompt: 'Great! And what is your gender?',
    obGenderOnly: 'To personalize your experience, could you share your gender?',
    obBirthdayPrompt: 'What is your date of birth?',
    obBirthdayOnly: 'One quick thing — could you share your date of birth?',
    obBodyPrompt: 'Last step — could you share your height and weight? This helps calculate your health metrics.',
    obBodyOnly: 'One more thing — could you share your height and weight?',
    obComplete: 'Your profile is all set! How can I help you today?',
    confirm: 'Confirm',
    bsHeight: 'Height', bsWeight: 'Weight', bsCm: 'cm', bsKg: 'kg',
    male: 'Male', female: 'Female',
    selectBirthday: 'Select Birthday',
    profile: 'Profile',
    gender: 'Gender', born: 'Born', language: 'Language',
    height: 'Height', weight: 'Weight',
    coach: 'Coach', joined: 'Joined', phone: 'Phone', email: 'Email',
    healthConditions: 'Health Conditions', noConditions: 'No known health conditions',
    bioAge: 'Bio Age', chronoAge: 'Chrono Age',
    latestBm: 'Latest Biomarkers',
    trends: 'Trends',
    tests: 'tests',
    noBmData: 'No biomarker data available yet.',
    noHistory: 'No test history yet.',
    genderMap: { male: 'Male', female: 'Female' },
    langMap: { zh: 'Chinese', en: 'English' },
    subAgeLabels: {
      ResilienceAge: 'Resilience Age', CellularAge: 'Cellular Age',
      MetabolicAge: 'Metabolic Age', MicroVascularAge: 'Micro-Vascular Age',
    },
    subAgeDesc: {
      ResilienceAge: 'How well you buffer stress.',
      CellularAge: 'How much raw life-force your cells have.',
      MetabolicAge: 'How cleanly you burn fuel.',
      MicroVascularAge: 'How well you deliver nutrients and oxygen.',
    },
    bmLabels: {
      hsCRP: 'hsCRP', GDF15: 'GDF-15', IL6: 'IL-6',
      GA: 'Glycated Albumin', CystatinC: 'Cystatin C', CD38: 'CD38',
    },
    dotsTitle: 'Nutrition Plan',
    noPlan: 'No nutrition plan yet. Complete a Kino biomarker test to generate your personalized plan.',
    morning: 'Morning', evening: 'Evening', today: 'Today', tomorrow: 'Tomorrow',
    obConditionsPrompt: 'Have you ever been diagnosed with or identified any of the following? (Select all that apply)',
    obConditionsNone: 'None of the above',
    obConditionsOtherPh: 'Please describe your other health condition',
    storeTitle: 'Health Store',
    storeBuy: 'Order Now',
    storeOrderSent: 'Order placed! Our health advisor will reach out shortly.',
    storeConfirmTitle: 'Confirm Order',
    storeBestseller: 'Best Seller', storeValue: 'Value Pack',
    storeEmpty: 'No products available.',
    storeSubProducts: 'Products', storeSubOrders: 'My Orders',
    noOrders: 'No orders yet.',
    toolFormulaDots: 'Formula my dots',
    toolTestChip: 'Use Kino Chip',
    toolFormulaDotMsg: 'Please formula my dots plan',
    toolTestChipMsg: 'I want to use a Kino chip',
    formulaGenerating: 'Generating your 7-day nutrition plan from your biomarkers…',
    formulaComplete: 'Your 7-day nutrition plan is ready!',
    formulaViewDots: 'View Dots Plan →',
    formulaError: 'Plan generation failed. Please try again.',
    adminMenu: 'Channel Admin',
    coachMenu: 'Coach Panel',
    superadminMenu: 'Super Admin',
    kinoSimMenu: 'Kino Simulator',
    kinoSimPassTitle: 'Enter Passcode',
    kinoSimPassError: 'Incorrect passcode',
    kinoSimTitle: 'KINO SIMULATOR',
    kinoSimStatusReady: 'Ready',
    kinoSimStatusAnalyzing: 'Analyzing...',
    kinoSimStatusComplete: 'Complete',
    kinoSimStatusFailed: 'Failed',
    kinoSimBtnStart: 'Start Biomarker Test',
    kinoSimBtnRunAnother: 'Run Another Test',
    kinoSimQuit: 'Quit Simulator',
    kinoSimTabBioAge: 'Bio Age',
    kinoSimTabBm: 'Biomarkers',
    kinoSimBioAgeLabel: 'BIO AGE',
    kinoSimChronoLabel: 'CHRONO AGE',
    kinoScanPrompt: 'Please scan the QR code on your Kino chip to register your sample.',
    kinoScanBtn: 'Scan QR Code',
    kinoScanSuccess: 'Your Kino chip has been registered! We\'ll process your sample and notify you with the results.',
    kinoScanError: 'Registration failed. Please try again.',
    orderStatus: {
      pending: 'Pending', confirmed: 'Confirmed', shipped: 'Shipped',
      delivered: 'Delivered', cancelled: 'Cancelled',
    },
    conditionLabels: {
      blood_sugar_high:    'High Blood Sugar',
      blood_pressure_high: 'High Blood Pressure',
      blood_lipids_high:   'High Blood Lipids',
      cholesterol_high:    'High Cholesterol',
      heart_issues:        'Heart Problems',
      gout_uric_acid:      'Gout / High Uric Acid',
      kidney_disease:      'Kidney Disease',
      sleep_deficiency:    'Sleep Deficiency',
      other:               'Other',
    },
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BM_META = [
  { key: 'hsCRP',     unit: 'mg/L',      color: '#ef4444' },
  { key: 'GDF15',     unit: 'pg/mL',     color: '#f97316' },
  { key: 'IL6',       unit: 'pg/mL',     color: '#a855f7' },
  { key: 'GA',        unit: '%',         color: '#6375EC' },
  { key: 'CystatinC', unit: 'mg/L',      color: '#0ea5e9' },
  { key: 'CD38',      unit: 'xBaseline', color: '#10b981' },
]

const SUB_AGE_KEYS = ['ResilienceAge', 'CellularAge', 'MetabolicAge', 'MicroVascularAge']
const SUB_AGE_COLORS = {
  ResilienceAge: '#c084d4', CellularAge: '#10b981',
  MetabolicAge: '#6375EC', MicroVascularAge: '#0ea5e9',
}

const MONTH_EN = ['January','February','March','April','May','June',
  'July','August','September','October','November','December']

const CONDITION_KEYS = [
  'blood_sugar_high', 'blood_pressure_high', 'blood_lipids_high',
  'cholesterol_high', 'heart_issues', 'gout_uric_acid',
  'kidney_disease', 'sleep_deficiency', 'other',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function chronoAge(birthDate) {
  if (!birthDate) return null
  return Math.floor((Date.now() - new Date(birthDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
}

function fmtDate(d, lang) {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return String(d)
  const y = date.getFullYear()
  const m = date.getMonth() + 1
  const day = date.getDate()
  if (lang === 'zh') return `${y}年${m}月${day}日`
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[date.getMonth()]} ${day}, ${y}`
}

function bioAgeColor(bio, chrono) {
  if (!bio || !chrono) return '#EEF2FF'
  const diff = Number(bio) - Number(chrono)
  if (diff > 2) return '#ef4444'
  if (diff < -2) return '#10b981'
  return '#f59e0b'
}

function parsePlan(text, dotsMap, lang) {
  if (!text) return []
  const t = T[lang]
  const now = new Date()
  const todayM = now.getMonth() + 1
  const todayD = now.getDate()
  const tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const tmrM = tmr.getMonth() + 1
  const tmrD = tmr.getDate()

  return text.trim().split('\n').filter(Boolean).map(line => {
    const ci = line.indexOf(':')
    if (ci === -1) return null
    const dateText = line.slice(0, ci).trim()
    const rest = line.slice(ci + 1).trim()

    const mMatch = rest.match(/(?:早上|Morning)\s+((?:D\d{2}x\d+\s*)+)/i)
    const eMatch = rest.match(/(?:晚上|Evening)\s+((?:D\d{2}x\d+\s*)+)/i)

    const parseDots = (str) => {
      if (!str) return []
      return [...str.matchAll(/D(\d{2})x(\d+)/g)].map(m => {
        const dotKey = `DOT${m[1]}`
        const dot = dotsMap[dotKey] || {}
        return {
          displayKey: `D${m[1]}`,
          count: parseInt(m[2]),
          color: dot.color || '#6375EC',
        }
      })
    }

    const zhDate = dateText.match(/(\d+)月(\d+)日/)
    const enDate = dateText.match(/(\w+)\s+(\d+)/)
    let month = null, day = null
    if (zhDate) { month = parseInt(zhDate[1]); day = parseInt(zhDate[2]) }
    else if (enDate) {
      const mi = MONTH_EN.findIndex(mn => enDate[1].toLowerCase().startsWith(mn.toLowerCase().slice(0, 3)))
      if (mi !== -1) { month = mi + 1; day = parseInt(enDate[2]) }
    }

    let label = dateText
    if (month !== null && day !== null) {
      if (month === todayM && day === todayD) label = t.today
      else if (month === tmrM && day === tmrD) label = t.tomorrow
    }

    return {
      label,
      isToday: month === todayM && day === todayD,
      morning: parseDots(mMatch?.[1]),
      evening: parseDots(eMatch?.[1]),
    }
  }).filter(Boolean)
}

function mapStoreItems(rawItems, lang) {
  const t = T[lang]
  const tagLabel = (tag) => {
    if (!tag) return null
    if (tag === 'bestseller') return t.storeBestseller
    if (tag === 'value') return t.storeValue
    return null
  }
  return rawItems.map(item => ({
    id: item.id,
    key: item.key_name,
    name: lang === 'zh' ? item.name_zh : item.name_en,
    desc: lang === 'zh' ? item.desc_zh : item.desc_en,
    unit: lang === 'zh' ? item.unit_zh : item.unit_en,
    price: lang === 'zh' ? `¥${item.price_cny}` : `$${item.price_usd}`,
    tagLabel: tagLabel(item.tag),
  }))
}

function mapStoreOrders(rawOrders, lang) {
  return rawOrders.map(o => ({
    id: o.id,
    shortId: o.id.slice(0, 8),
    name: lang === 'zh' ? (o.name_zh || o.item_key) : (o.name_en || o.item_key),
    unit: lang === 'zh' ? o.unit_zh : o.unit_en,
    quantity: o.quantity,
    price: lang === 'zh' ? `¥${o.price_cny}` : `$${o.price_usd}`,
    status: o.status,
    createdAt: new Date(o.created_at).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US'),
  }))
}

// ── Page ──────────────────────────────────────────────────────────────────────

Page({
  data: {
    user: null,
    lang: 'zh',
    t: T.zh,
    tab: 'chat',

    // Chat
    messages: [],
    chatInput: '',
    typing: false,
    toolboxOpen: false,
    kinoScanPending: false,

    // Kino Simulator passcode
    kinoPassOpen: false,
    kinoPassInput: '',
    kinoPassError: false,

    // Kino Simulator
    kinoSimOpen: false,
    kinoSimStatus: 'ready',
    kinoSimBmList: [],
    kinoSimSubAgeList: [],
    kinoSimBioAge: null,
    kinoSimChronoAge: null,
    kinoSimBioAgeColor: '#A6C4E5',
    kinoSimActiveTab: 'bioage',
    kinoSimSlideIndex: 0,
    kinoSimSlideVisible: true,
    obStep: null,   // 'name'|'gender'|'birthday'|'body'|'conditions'|'done'|null
    obName: '',
    obBirthday: '',
    obHeight: 165,
    obWeight: 65,
    obWeightDisplay: '65.0',
    obConditions: [],
    obConditionList: [],
    obOtherSelected: false,
    obConditionsOther: '',
    scrollTop: 0,

    // Health
    bioLoading: true,
    subAgeList: [],
    bmList: [],
    trendList: [],
    cAge: null,
    bAge: null,
    bAgeColor: '#EEF2FF',
    profileInfo: [],
    recordCount: 0,
    hasBm: false,
    healthConditionsList: [],
    hasConditionsData: false,

    // Channel
    channel: null,

    // Role menu flags
    menuOpen: false,
    isCoach: false,
    isAdmin: false,
    isSuperadmin: false,

    // Dots
    dotsLoading: true,
    dotsDays: [],
    hasPlan: false,

    // Store
    storeLoading: true,
    storeItems: [],
    storeOrders: [],
    storeSubTab: 'products',
  },

  _pollingTimer: null,
  _kinoSlideTimer: null,
  _seenIds: null,
  _rawStoreItems: null,
  _rawStoreOrders: null,

  onLoad() {
    this._seenIds = new Set()
    const user = app.globalData.user
    if (!user) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    const { statusBarHeight = 0, windowWidth = 375 } = wx.getSystemInfoSync()
    const capsule = wx.getMenuButtonBoundingClientRect()
    const capsuleRightPad = windowWidth - (capsule.left || windowWidth - 96) + 8
    const menuTop = statusBarHeight + 44
    const lang = app.globalData.lang || (user.language === 'en' ? 'en' : 'zh')
    const channel = app.globalData.channel || null
    const roles = user.roles || ['user']
    const isCoach = roles.includes('coach')
    const isAdmin = roles.includes('admin') || roles.includes('superadmin')
    const isSuperadmin = roles.includes('superadmin')
    this.setData({ user: { ...user }, channel, lang, t: T[lang], statusBarHeight, capsuleRightPad, menuTop, menuOpen: false, isCoach, isAdmin, isSuperadmin })
    this._initChat(user, lang)
    this._loadHealth(user, lang)
    this._loadDots(user, lang)
    this._loadStore(user, lang)
  },

  onShow() {
    const { user, lang } = this.data
    if (user) {
      this._loadHealth(user, lang)
      this._startPolling(user)
    }
  },

  onHide() {
    this._stopPolling()
    this._stopKinoSlide()
  },

  onUnload() {
    this._stopPolling()
    this._stopKinoSlide()
  },

  // ── Tab navigation ──────────────────────────────────────────────────────────

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ tab })
    if (tab === 'health') this._loadHealth(this.data.user, this.data.lang)
    if (tab === 'dots')   this._loadDots(this.data.user, this.data.lang)
  },

  // ── Logo menu ───────────────────────────────────────────────────────────────

  toggleMenu() { this.setData({ menuOpen: !this.data.menuOpen }) },
  closeMenu()  { this.setData({ menuOpen: false }) },
  noop()       {},

  toggleLang() {
    const lang = this.data.lang === 'zh' ? 'en' : 'zh'
    app.globalData.lang = lang
    const storeItems  = this._rawStoreItems  ? mapStoreItems(this._rawStoreItems, lang)   : []
    const storeOrders = this._rawStoreOrders ? mapStoreOrders(this._rawStoreOrders, lang) : []
    this.setData({ lang, t: T[lang], menuOpen: false, storeItems, storeOrders })
    this._loadHealth(this.data.user, lang)
    this._loadDots(this.data.user, lang)
  },

  openCoach() {
    this.setData({ menuOpen: false })
    wx.navigateTo({ url: '/pages/coach/coach' })
  },

  openAdmin() {
    this.setData({ menuOpen: false })
    wx.navigateTo({ url: '/pages/admin/admin' })
  },

  openSuperadmin() {
    this.setData({ menuOpen: false })
    wx.navigateTo({ url: '/pages/superadmin/superadmin' })
  },

  // ── Kino Simulator ──────────────────────────────────────────────────────────

  openKinoSim() {
    if (this.data.isSuperadmin) {
      this.setData({ menuOpen: false, kinoSimOpen: true })
    } else {
      this.setData({ menuOpen: false, kinoPassOpen: true, kinoPassInput: '', kinoPassError: false })
    }
  },

  closeKinoPass() {
    this.setData({ kinoPassOpen: false, kinoPassInput: '', kinoPassError: false })
  },

  handlePassKey(e) {
    const { kinoPassInput, kinoPassError } = this.data
    if (kinoPassError || kinoPassInput.length >= 4) return
    const digit = e.currentTarget.dataset.digit
    const next = kinoPassInput + digit
    if (next.length < 4) {
      this.setData({ kinoPassInput: next })
      return
    }
    // 4th digit entered — check immediately
    if (next === '1709') {
      this.setData({ kinoPassInput: next })
      setTimeout(() => {
        this.setData({ kinoPassOpen: false, kinoPassInput: '', kinoSimOpen: true })
      }, 180)
    } else {
      this.setData({ kinoPassInput: next, kinoPassError: true })
      setTimeout(() => {
        this.setData({ kinoPassInput: '', kinoPassError: false })
      }, 900)
    }
  },

  handlePassDelete() {
    const { kinoPassInput } = this.data
    if (kinoPassInput.length === 0) return
    this.setData({ kinoPassInput: kinoPassInput.slice(0, -1), kinoPassError: false })
  },

  closeKinoSim() {
    this._stopKinoSlide()
    this.setData({
      kinoSimOpen: false, kinoSimStatus: 'ready',
      kinoSimBmList: [], kinoSimSubAgeList: [],
      kinoSimBioAge: null, kinoSimChronoAge: null, kinoSimBioAgeColor: '#A6C4E5',
      kinoSimActiveTab: 'bioage', kinoSimSlideIndex: 0, kinoSimSlideVisible: true,
    })
  },

  _stopKinoSlide() {
    if (this._kinoSlideTimer) { clearInterval(this._kinoSlideTimer); this._kinoSlideTimer = null }
  },

  _startKinoSlide() {
    this._stopKinoSlide()
    const len = BM_META.length
    this._kinoSlideTimer = setInterval(() => {
      this.setData({ kinoSimSlideVisible: false })
      setTimeout(() => {
        const next = (this.data.kinoSimSlideIndex + 1) % len
        this.setData({ kinoSimSlideIndex: next, kinoSimSlideVisible: true })
      }, 300)
    }, 2300)
  },

  onKinoSimTabChange(e) {
    this.setData({ kinoSimActiveTab: e.currentTarget.dataset.tab })
  },

  async handleKinoSimStart() {
    const { kinoSimStatus, user, lang } = this.data
    if (kinoSimStatus === 'analyzing') return
    if (kinoSimStatus === 'complete') {
      this._stopKinoSlide()
      this.setData({
        kinoSimStatus: 'ready', kinoSimBmList: [], kinoSimSubAgeList: [],
        kinoSimBioAge: null, kinoSimChronoAge: null, kinoSimBioAgeColor: '#A6C4E5',
        kinoSimActiveTab: 'bioage', kinoSimSlideIndex: 0, kinoSimSlideVisible: true,
      })
      return
    }
    const t = T[lang]
    this.setData({ kinoSimStatus: 'analyzing' })
    try {
      const randomCRP = Math.round((Math.random() * (3.5 - 0.2) + 0.2) * 100) / 100
      const res = await this._req(`${BASE}/api/chat`, 'POST', {
        openid: user.user_id,
        test_type: 'kino_chip',
        test_data: { hsCRP: randomCRP },
      })
      const biomarkers = res.data?.biomarkers || null
      let bioageProfile = res.data?.bioage_profile || null
      if (!bioageProfile) {
        try {
          const bmRes = await this._req(`${BASE}/api/biomarkers?openid=${encodeURIComponent(user.user_id)}`)
          const records = bmRes.data?.records || []
          const latest = records[records.length - 1]
          bioageProfile = latest?.data?.bioage_profile || null
        } catch (e) {}
      }
      const bmList = BM_META.map(({ key, unit }) => ({
        key, label: t.bmLabels[key] || key, unit,
        value: biomarkers?.[key] ?? null,
      }))
      const subAgeList = bioageProfile?.SubAges
        ? SUB_AGE_KEYS.map(key => ({
            key,
            label: t.subAgeLabels[key],
            color: SUB_AGE_COLORS[key],
            value: bioageProfile.SubAges[key] != null ? Number(bioageProfile.SubAges[key]).toFixed(1) : '—',
          }))
        : []
      const rawBioAge = bioageProfile?.BioAge ?? null
      const rawChronoAge = bioageProfile?.ChronoAge ?? null
      this.setData({
        kinoSimStatus: 'complete',
        kinoSimBmList: bmList,
        kinoSimSubAgeList: subAgeList,
        kinoSimBioAge: rawBioAge ? Number(rawBioAge).toFixed(1) : '—',
        kinoSimChronoAge: rawChronoAge ?? '—',
        kinoSimBioAgeColor: bioAgeColor(rawBioAge, rawChronoAge),
        kinoSimActiveTab: 'bioage',
        kinoSimSlideIndex: 0,
        kinoSimSlideVisible: true,
      })
      this._startKinoSlide()
    } catch (e) {
      this.setData({ kinoSimStatus: 'failed' })
      setTimeout(() => { if (this.data.kinoSimOpen) this.setData({ kinoSimStatus: 'ready' }) }, 3000)
    }
  },

  // ── Logout ──────────────────────────────────────────────────────────────────

  handleLogout() {
    this.setData({ menuOpen: false })
    this._stopPolling()
    wx.removeStorageSync('nano_user')
    app.globalData.user = null
    wx.reLaunch({ url: '/pages/login/login' })
  },

  // ── Chat init ───────────────────────────────────────────────────────────────

  async _initChat(user, lang) {
    const t = T[lang]
    const msgs = [{ id: 'init', role: 'ai', content: t.initMsg }]

    if (!user.nickname) {
      msgs.push({ id: 'ob-name', role: 'ai', content: t.obNamePrompt })
      this.setData({ messages: msgs, obStep: 'name' })
      return
    }
    if (!user.gender) {
      msgs.push({ id: 'ob-gender', role: 'ai', content: t.obGenderPrompt })
      this.setData({ messages: msgs, obStep: 'gender' })
      return
    }
    if (!user.birth_date) {
      msgs.push({ id: 'ob-bday', role: 'ai', content: t.obBirthdayOnly })
      this.setData({ messages: msgs, obStep: 'birthday' })
      return
    }

    try {
      const res = await this._req(`${BASE}/api/biomarkers?openid=${encodeURIComponent(user.user_id)}`)
      const records = res.data?.records || []
      const hasBody = records.some(r => r.test_type === 'body_composition' && r.data?.actual?.weight)
      if (!hasBody) {
        msgs.push({ id: 'ob-body', role: 'ai', content: t.obBodyOnly })
        this.setData({ messages: msgs, obStep: 'body' })
        return
      }
    } catch (e) {}

    if (user.bio_data?.health_conditions === undefined) {
      msgs.push({ id: 'ob-cond', role: 'ai', content: t.obConditionsPrompt })
      const list = CONDITION_KEYS.map(key => ({ key, label: t.conditionLabels[key], selected: false }))
      this.setData({ messages: msgs, obStep: 'conditions', obConditionList: list })
      return
    }

    this.setData({ messages: msgs })
    await this._loadHistory(user)
    this.setData({ obStep: 'done' })
    this._startPolling(user)
  },

  async _checkBodyStep(user, lang) {
    const t = T[lang]
    try {
      const res = await this._req(`${BASE}/api/biomarkers?openid=${encodeURIComponent(user.user_id)}`)
      const records = res.data?.records || []
      const hasBody = records.some(r => r.test_type === 'body_composition' && r.data?.actual?.weight)
      if (!hasBody) {
        this._addMsg('ai', t.obBodyPrompt)
        this.setData({ obStep: 'body', typing: false })
        return
      }
    } catch (e) {}

    if (user.bio_data?.health_conditions === undefined) {
      this._startConditionsStep(user, lang)
      return
    }

    this._addMsg('ai', t.obComplete)

    try {
      const res = await this._req(`${BASE}/api/chat-history?openid=${encodeURIComponent(user.user_id)}`)
      const history = res.data?.messages || []
      if (history.length > 0) {
        const msgs = history.map((m, i) => ({
          id: `h-${i}`,
          role: m.role === 'assistant' ? 'ai' : m.role,
          content: m.content
        }))
        this.setData({ messages: msgs })
        this._scrollBottom()
      }
    } catch (e) {}

    this.setData({ obStep: 'done', typing: false })
    this._startPolling(user)
  },

  async _loadHistory(user) {
    try {
      const res = await this._req(`${BASE}/api/chat-history?openid=${encodeURIComponent(user.user_id)}`)
      const history = res.data?.messages || []
      if (history.length > 0) {
        const msgs = history.map((m, i) => ({
          id: `h-${i}`,
          role: m.role === 'assistant' ? 'ai' : m.role,
          content: m.content
        }))
        this.setData({ messages: msgs })
        this._scrollBottom()
      }
    } catch (e) {}
  },

  // ── Chat messaging ──────────────────────────────────────────────────────────

  _addMsg(role, content) {
    const msg = { id: `${role}-${Date.now()}`, role, content }
    const messages = [...this.data.messages, msg]
    this.setData({ messages })
    this._scrollBottom()
  },

  _scrollBottom() {
    if (this.data.messages.length === 0) return
    wx.nextTick(() => {
      // Alternate between two large values so the binding always triggers a change
      this._scrollFlip = !this._scrollFlip
      this.setData({ scrollTop: this._scrollFlip ? 999998 : 999999 })
    })
  },

  onChatInput(e) {
    this.setData({ chatInput: e.detail.value })
  },

  toggleToolbox() {
    this.setData({ toolboxOpen: !this.data.toolboxOpen })
  },

  handleToolAction(e) {
    const action = e.currentTarget.dataset.action
    const { t, typing, obStep } = this.data
    if (typing || obStep !== 'done') return
    this.setData({ toolboxOpen: false })
    if (action === 'formula_dots') {
      this._requestFormula()
    } else if (action === 'test_chip') {
      this._addMsg('ai', t.kinoScanPrompt)
      this.setData({ kinoScanPending: true })
    }
  },

  async _requestFormula() {
    const { user, t } = this.data
    this._addMsg('ai', t.formulaGenerating)
    this.setData({ typing: true })
    try {
      await this._req(`${BASE}/api/formula-dots`, 'POST', { openid: user.user_id })
      this._addMsg('ai', t.formulaComplete)
      this._addActionMsg('view_dots', t.formulaViewDots)
    } catch (e) {
      this._addMsg('ai', t.formulaError)
    } finally {
      this.setData({ typing: false })
    }
  },

  _addActionMsg(action, label) {
    const msg = { id: `action-${Date.now()}`, role: 'action', action, label }
    const messages = [...this.data.messages, msg]
    this.setData({ messages })
    this._scrollBottom()
  },

  handleMsgAction(e) {
    const { action } = e.currentTarget.dataset
    if (action === 'view_dots') {
      const { user, lang } = this.data
      this.setData({ tab: 'dots', dotsLoading: true })
      this._loadDots(user, lang)
    }
  },

  handleKinoScan() {
    const { user, t } = this.data
    wx.scanCode({
      onlyFromCamera: false,
      success: async (res) => {
        const chip_id = res.result
        this.setData({ kinoScanPending: false })
        this._addMsg('user', chip_id)
        this.setData({ typing: true })
        try {
          await this._req(`${BASE}/api/kino-scan`, 'POST', { openid: user.user_id, chip_id })
          this._addMsg('ai', t.kinoScanSuccess)
        } catch (e) {
          this._addMsg('ai', t.kinoScanError)
        } finally {
          this.setData({ typing: false })
        }
      },
      fail: () => {},
    })
  },

  async handleSend() {
    const { chatInput, typing, obStep } = this.data
    const text = chatInput.trim()
    if (!text || typing || obStep !== 'done') return
    this.setData({ chatInput: '' })
    await this._sendMessage(text)
  },

  async _sendMessage(text) {
    const { user } = this.data
    this._addMsg('user', text)
    this.setData({ typing: true })
    try {
      await this._req(`${BASE}/api/chat`, 'POST', { openid: user.user_id, message: text })
    } catch (e) {
      this._addMsg('ai', this.data.t.errServer)
    } finally {
      this.setData({ typing: false })
    }
  },

  // ── Polling ─────────────────────────────────────────────────────────────────

  _startPolling(user) {
    this._stopPolling()
    this._poll(user)
    this._pollingTimer = setInterval(() => this._poll(user), 3000)
  },

  _stopPolling() {
    if (this._pollingTimer) { clearInterval(this._pollingTimer); this._pollingTimer = null }
  },

  async _poll(user) {
    if (this.data.obStep !== 'done') return
    try {
      const res = await this._req(`${BASE}/api/notifications?openid=${user.user_id}`)
      const notifications = res.data?.notifications || []
      const unseen = notifications.filter(n => !this._seenIds.has(n.id))
      if (unseen.length > 0) {
        unseen.forEach(n => this._seenIds.add(n.id))
        const newMsgs = unseen.map(n => ({ id: `n-${n.id}`, role: 'ai', content: n.content }))
        const messages = [...this.data.messages, ...newMsgs]
        this.setData({ messages, typing: false })
        this._scrollBottom()
      }
    } catch (e) {}
  },

  // ── Onboarding handlers ─────────────────────────────────────────────────────

  onObNameInput(e) { this.setData({ obName: e.detail.value }) },

  async handleSubmitName() {
    const { obName, user, lang } = this.data
    const name = obName.trim()
    if (!name) return

    this._addMsg('user', name)
    this.setData({ typing: true, obName: '' })

    try {
      await this._saveUser(user, { nickname: name })
      const updated = { ...user, nickname: name }
      this._updateUser(updated)

      if (!user.gender) {
        this._addMsg('ai', T[lang].obGenderOnly)
        this.setData({ obStep: 'gender', typing: false })
      } else if (!user.birth_date) {
        this._addMsg('ai', T[lang].obBirthdayOnly)
        this.setData({ obStep: 'birthday', typing: false })
      } else {
        await this._checkBodyStep(updated, lang)
      }
    } catch (e) {
      this._addMsg('ai', this.data.t.errServer)
      this.setData({ typing: false })
    }
  },

  async handleSelectGender(e) {
    const gender = e.currentTarget.dataset.gender
    const { user, lang } = this.data

    this._addMsg('user', T[lang][gender])
    this.setData({ typing: true })

    try {
      await this._saveUser(user, { gender })
      const updated = { ...user, gender }
      this._updateUser(updated)

      if (!user.birth_date) {
        this._addMsg('ai', T[lang].obBirthdayPrompt)
        this.setData({ obStep: 'birthday', typing: false })
      } else {
        await this._checkBodyStep(updated, lang)
      }
    } catch (e) {
      this._addMsg('ai', this.data.t.errServer)
      this.setData({ typing: false })
    }
  },

  onBirthdayChange(e) { this.setData({ obBirthday: e.detail.value }) },

  async handleSubmitBirthday() {
    const { obBirthday, user, lang } = this.data
    if (!obBirthday) return

    this._addMsg('user', obBirthday)
    this.setData({ typing: true })

    try {
      await this._saveUser(user, { birth_date: obBirthday })
      const updated = { ...user, birth_date: obBirthday }
      this._updateUser(updated)
      await this._checkBodyStep(updated, lang)
    } catch (e) {
      this._addMsg('ai', this.data.t.errServer)
      this.setData({ typing: false })
    }
  },

  onHeightChange(e) { this.setData({ obHeight: e.detail.value }) },
  onWeightChange(e) { this.setData({ obWeight: e.detail.value, obWeightDisplay: Number(e.detail.value).toFixed(1) }) },

  async handleSubmitBody() {
    const { obHeight, obWeight, user, t } = this.data

    this._addMsg('user', `${t.bsHeight}: ${obHeight}${t.bsCm}  ${t.bsWeight}: ${obWeight}${t.bsKg}`)
    this.setData({ typing: true })

    try {
      await this._req(`${BASE}/api/chat`, 'POST', {
        openid: user.user_id,
        test_type: 'body_composition',
        test_data: { height: obHeight, weight: obWeight },
        tested_at: new Date().toISOString()
      })
      this._startConditionsStep(user, this.data.lang)
    } catch (e) {
      this._addMsg('ai', t.errServer)
      this.setData({ typing: false })
    }
  },

  _startConditionsStep(user, lang) {
    const t = T[lang]
    const list = CONDITION_KEYS.map(key => ({ key, label: t.conditionLabels[key], selected: false }))
    this._addMsg('ai', t.obConditionsPrompt)
    this.setData({ obStep: 'conditions', obConditions: [], obConditionList: list, obOtherSelected: false, obConditionsOther: '', typing: false })
  },

  handleToggleCondition(e) {
    const key = e.currentTarget.dataset.key
    const list = this.data.obConditionList.map(item =>
      item.key === key ? { ...item, selected: !item.selected } : item
    )
    const otherSelected = list.some(i => i.key === 'other' && i.selected)
    this.setData({
      obConditionList: list,
      obConditions: list.filter(i => i.selected).map(i => i.key),
      obOtherSelected: otherSelected,
      obConditionsOther: otherSelected ? this.data.obConditionsOther : '',
    })
  },

  onObConditionsOtherInput(e) { this.setData({ obConditionsOther: e.detail.value }) },

  async handleSubmitConditions() {
    const { obConditions, obConditionList, obOtherSelected, obConditionsOther, user, lang, t } = this.data
    const otherText = obOtherSelected ? obConditionsOther.trim() : ''
    const sep = lang === 'zh' ? '、' : ', '
    const selectedLabels = obConditionList
      .filter(i => i.selected)
      .map(i => i.key === 'other' && otherText ? `${i.label}（${otherText}）` : i.label)
    const label = selectedLabels.length > 0 ? selectedLabels.join(sep) : t.obConditionsNone

    this._addMsg('user', label)
    this.setData({ typing: true })

    const bioDataUpdate = { health_conditions: obConditions }
    if (otherText) bioDataUpdate.health_conditions_other = otherText

    try {
      await this._saveUser(user, { bio_data: bioDataUpdate })
      const updated = { ...user, bio_data: { ...(user.bio_data || {}), ...bioDataUpdate } }
      this._updateUser(updated)
      this._addMsg('ai', t.obComplete)

      try {
        const res = await this._req(`${BASE}/api/chat-history?openid=${encodeURIComponent(user.user_id)}`)
        const history = res.data?.messages || []
        if (history.length > 0) {
          const msgs = history.map((m, i) => ({
            id: `h-${i}`,
            role: m.role === 'assistant' ? 'ai' : m.role,
            content: m.content
          }))
          this.setData({ messages: msgs })
          this._scrollBottom()
        }
      } catch (e) {}

      this.setData({ obStep: 'done', typing: false })
      this._startPolling(user)
    } catch (e) {
      this._addMsg('ai', t.errServer)
      this.setData({ typing: false })
    }
  },

  // ── User state ──────────────────────────────────────────────────────────────

  _updateUser(updated) {
    app.globalData.user = { ...updated }
    wx.setStorageSync('nano_user', updated)
    this.setData({ user: { ...updated } })
  },

  _saveUser(user, updates) {
    return this._req(`${BASE}/api/users/${user.user_id}`, 'PUT', {
      nickname: user.nickname, phone: user.phone, email: user.email,
      gender: user.gender, birth_date: user.birth_date,
      language: user.language, coach_id: user.coach_id,
      ...updates
    })
  },

  // ── Health tab ──────────────────────────────────────────────────────────────

  async _loadHealth(user, lang) {
    const t = T[lang]
    try {
      const res = await this._req(`${BASE}/api/biomarkers?openid=${encodeURIComponent(user.user_id)}`)
      const records = res.data?.records || []
      const kinoRecords = records.filter(r => r.test_type === 'kino_chip')
      const latest = kinoRecords.length > 0 ? kinoRecords[kinoRecords.length - 1] : null
      const latestBm = latest?.data?.estimated || null
      const subAgesRaw = latest?.data?.bioage_profile?.SubAges || null

      const bmList = BM_META.map(({ key, unit, color }) => ({
        key, label: t.bmLabels[key], unit, color,
        value: latestBm?.[key] != null ? latestBm[key] : null,
      }))

      const trendList = BM_META.map(({ key, unit, color }) => {
        const allVals = kinoRecords.slice(-10).map(r => r.data?.estimated?.[key] ?? null)
        const defined = allVals.filter(v => v != null)
        const min = defined.length ? Math.min(...defined) : 0
        const max = defined.length ? Math.max(...defined) : 1
        const range = max - min || 1
        const sparkBars = allVals.map(v => v != null
          ? { h: Math.round(6 + ((v - min) / range) * 26), color, empty: false }
          : { h: 6, color, empty: true }
        )
        const lastVal = defined[defined.length - 1] ?? null
        return { key, label: t.bmLabels[key], unit, color, lastVal, sparkBars }
      })

      const subAgeList = subAgesRaw
        ? SUB_AGE_KEYS.map(key => ({
            key,
            label: t.subAgeLabels[key],
            desc: t.subAgeDesc[key],
            color: SUB_AGE_COLORS[key],
            value: subAgesRaw[key] != null ? subAgesRaw[key].toFixed(1) : '—',
          }))
        : []

      const cAge = chronoAge(user.birth_date)
      const rawBioAge = latest?.bio_age ?? user.bio_age
      const bAge = rawBioAge ? Number(rawBioAge).toFixed(1) : null

      const bodyRecord = records.slice().reverse().find(r => r.test_type === 'body_composition')
      const heightVal = bodyRecord?.data?.actual?.height ?? null
      const weightVal = bodyRecord?.data?.actual?.weight ?? null

      const profileInfo = [
        { label: t.gender,   val: t.genderMap[user.gender] || user.gender || '—' },
        { label: t.born,     val: fmtDate(user.birth_date, lang) },
        { label: t.height,   val: heightVal != null ? `${heightVal} ${t.bsCm}` : '—' },
        { label: t.weight,   val: weightVal != null ? `${weightVal} ${t.bsKg}` : '—' },
        { label: t.language, val: t.langMap[user.language] || user.language || '—' },
        { label: t.coach,    val: user.coach_name || '—' },
        { label: t.joined,   val: fmtDate(user.created_at, lang) },
        { label: t.phone,    val: user.phone || '—' },
        { label: t.email,    val: user.email || '—' },
      ]

      const condKeys = user.bio_data?.health_conditions ?? null
      const otherText = user.bio_data?.health_conditions_other || ''
      const healthConditionsList = condKeys !== null
        ? condKeys.map(key => ({
            key,
            label: key === 'other' && otherText
              ? `${t.conditionLabels[key]}（${otherText}）`
              : (t.conditionLabels[key] || key),
          }))
        : []

      this.setData({
        bioLoading: false,
        subAgeList, bmList, trendList,
        cAge, bAge,
        bAgeColor: bioAgeColor(rawBioAge, cAge),
        profileInfo,
        recordCount: kinoRecords.length,
        hasBm: latestBm !== null,
        healthConditionsList,
        hasConditionsData: condKeys !== null,
      })
    } catch (e) {
      this.setData({ bioLoading: false })
    }
  },

  // ── Dots tab ────────────────────────────────────────────────────────────────

  async _loadDots(user, lang) {
    try {
      const res = await this._req(`${BASE}/api/nutrition-plan?openid=${encodeURIComponent(user.user_id)}`)
      const plan = res.data?.plan || null
      const dotsArr = res.data?.dots || []
      const dotsMap = {}
      dotsArr.forEach(d => { dotsMap[d.key_name] = d })
      const dotsDays = plan ? parsePlan(plan, dotsMap, lang) : []
      this.setData({ dotsLoading: false, dotsDays, hasPlan: plan !== null })
    } catch (e) {
      this.setData({ dotsLoading: false, hasPlan: false })
    }
  },

  // ── Store tab ───────────────────────────────────────────────────────────────

  async _loadStore(user, lang) {
    try {
      const res = await this._req(`${BASE}/api/store-items`)
      const raw = res.data?.items || []
      this._rawStoreItems = raw
      this.setData({ storeLoading: false, storeItems: mapStoreItems(raw, lang) })
    } catch (e) {
      this.setData({ storeLoading: false })
    }
    await this._loadStoreOrders(user, lang)
  },

  async _loadStoreOrders(user, lang) {
    try {
      const res = await this._req(`${BASE}/api/my-orders?openid=${encodeURIComponent(user.user_id)}`)
      const raw = res.data?.orders || []
      this._rawStoreOrders = raw
      this.setData({ storeOrders: mapStoreOrders(raw, lang) })
    } catch (e) {}
  },

  switchStoreTab(e) {
    this.setData({ storeSubTab: e.currentTarget.dataset.tab })
  },

  handleBuyItem(e) {
    const item = e.currentTarget.dataset.item
    const { t, user, lang } = this.data
    wx.showModal({
      title: t.storeConfirmTitle,
      content: `${item.name}\n${item.price}  ·  ${item.unit}`,
      confirmText: t.storeBuy,
      confirmColor: '#6375EC',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await this._req(`${BASE}/api/orders`, 'POST', {
            openid: user.user_id,
            item_id: item.id,
            quantity: 1,
          })
          wx.showToast({ title: t.storeOrderSent, icon: 'none', duration: 3000 })
          await this._loadStoreOrders(user, lang)
          this.setData({ storeSubTab: 'orders' })
        } catch (e) {
          wx.showToast({ title: t.errServer, icon: 'none', duration: 2500 })
        }
      }
    })
  },

  // ── HTTP helper ─────────────────────────────────────────────────────────────

  _req(url, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
      const opts = {
        url, method,
        header: { 'Content-Type': 'application/json' },
        success: resolve,
        fail: reject,
      }
      if (data) opts.data = data
      wx.request(opts)
    })
  },
})
