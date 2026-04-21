const app = getApp()
const BASE = 'https://nano.fros.cc'

// ── i18n ──────────────────────────────────────────────────────────────────────

const T = {
  zh: {
    tabChat: '对话', tabHealth: '健康', tabDots: '营养',
    logout: '退出',
    initMsg: '您好！我是 Nano，您的个人健康伴侣。今天有什么可以帮您的？',
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
    coach: 'Coach', joined: '注册时间', phone: '手机', email: '邮箱',
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
  },
  en: {
    tabChat: 'Chat', tabHealth: 'Health', tabDots: 'Dots',
    logout: 'Logout',
    initMsg: 'Hello! I am Nano, your personal health companion. How can I help you today?',
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
    coach: 'Coach', joined: 'Joined', phone: 'Phone', email: 'Email',
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
  ResilienceAge: '#ef4444', CellularAge: '#10b981',
  MetabolicAge: '#6375EC', MicroVascularAge: '#0ea5e9',
}

const MONTH_EN = ['January','February','March','April','May','June',
  'July','August','September','October','November','December']

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
    obStep: null,   // 'name'|'gender'|'birthday'|'body'|'done'|null
    obName: '',
    obBirthday: '',
    obHeight: 165,
    obWeight: 65,
    scrollToId: '',

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

    // Dots
    dotsLoading: true,
    dotsDays: [],
    hasPlan: false,
  },

  _pollingTimer: null,
  _seenIds: null,

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
    this.setData({ user: { ...user }, lang, t: T[lang], statusBarHeight, capsuleRightPad, menuTop, menuOpen: false })
    this._initChat(user, lang)
    this._loadHealth(user, lang)
    this._loadDots(user, lang)
  },

  onUnload() {
    this._stopPolling()
  },

  // ── Tab navigation ──────────────────────────────────────────────────────────

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  // ── Logo menu ───────────────────────────────────────────────────────────────

  toggleMenu() { this.setData({ menuOpen: !this.data.menuOpen }) },
  closeMenu()  { this.setData({ menuOpen: false }) },
  noop()       {},

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
    const n = this.data.messages.length
    if (n > 0) this.setData({ scrollToId: `msg${n - 1}` })
  },

  onChatInput(e) {
    this.setData({ chatInput: e.detail.value })
  },

  async handleSend() {
    const { chatInput, typing, obStep, user } = this.data
    const text = chatInput.trim()
    if (!text || typing || obStep !== 'done') return

    this._addMsg('user', text)
    this.setData({ chatInput: '', typing: true })

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
  onWeightChange(e) { this.setData({ obWeight: e.detail.value }) },

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
      this._addMsg('ai', t.obComplete)
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
      const latest = records.length > 0 ? records[records.length - 1] : null
      const latestBm = latest?.data?.estimated || null
      const subAgesRaw = latest?.data?.bioage_profile?.SubAges || null

      const bmList = BM_META.map(({ key, unit, color }) => ({
        key, label: t.bmLabels[key], unit, color,
        value: latestBm?.[key] != null ? latestBm[key] : null,
      }))

      const trendList = BM_META.map(({ key, unit, color }) => {
        const vals = records.map(r => r.data?.estimated?.[key]).filter(v => v != null)
        return { key, label: t.bmLabels[key], unit, color, lastVal: vals[vals.length - 1] ?? null }
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
      const bAge = user.bio_age ? Number(user.bio_age).toFixed(1) : null

      const profileInfo = [
        { label: t.gender,   val: t.genderMap[user.gender] || user.gender || '—' },
        { label: t.born,     val: fmtDate(user.birth_date, lang) },
        { label: t.language, val: t.langMap[user.language] || user.language || '—' },
        { label: t.coach,    val: user.coach_name || '—' },
        { label: t.joined,   val: fmtDate(user.created_at, lang) },
        { label: t.phone,    val: user.phone || '—' },
        { label: t.email,    val: user.email || '—' },
      ]

      this.setData({
        bioLoading: false,
        subAgeList, bmList, trendList,
        cAge, bAge,
        bAgeColor: bioAgeColor(user.bio_age, cAge),
        profileInfo,
        recordCount: records.length,
        hasBm: latestBm !== null,
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
