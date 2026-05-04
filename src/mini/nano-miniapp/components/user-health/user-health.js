const app = getApp()
const BASE = 'https://nano.fros.cc'

const BM_META = [
  { key: 'hsCRP',     unit: 'mg/L',      color: '#ef4444' },
  { key: 'GDF15',     unit: 'pg/mL',     color: '#f97316' },
  { key: 'IL6',       unit: 'pg/mL',     color: '#a855f7' },
  { key: 'GA',        unit: '%',         color: '#6375EC' },
  { key: 'CystatinC', unit: 'mg/L',      color: '#0ea5e9' },
  { key: 'CD38',      unit: 'xBaseline', color: '#10b981' },
]

const SUB_AGE_META = [
  { key: 'ResilienceAge',    color: '#c084d4' },
  { key: 'CellularAge',      color: '#10b981' },
  { key: 'MetabolicAge',     color: '#6375EC' },
  { key: 'MicroVascularAge', color: '#0ea5e9' },
]

const CONDITION_KEYS = [
  'blood_sugar_high', 'blood_pressure_high', 'blood_lipids_high',
  'cholesterol_high', 'heart_issues', 'gout_uric_acid',
  'kidney_disease', 'sleep_deficiency', 'other',
]

const T = {
  zh: {
    bioAge: '生理年龄', chronoAge: '实际年龄',
    profile: '个人信息', showMore: '更多', showLess: '收起',
    gender: '性别', born: '出生日期', language: '语言',
    height: '身高', weight: '体重', bmi: 'BMI', weightTrend: '体重趋势',
    coach: 'Coach', joined: '注册时间', phone: '手机', email: '邮箱',
    bsKg: 'kg', bsCm: 'cm',
    healthConditions: '健康状况', noConditions: '无特殊健康状况',
    latestBm: '最新生物标志物',
    trends: '趋势', tests: '次检测',
    noBmData: '暂无生物标志物数据。', noHistory: '暂无检测记录。',
    guestHealthCta: '激活账户后，查看您的健康数据与生物年龄',
    guestJoinBtn: '激活账户',
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
    bioAge: 'Bio Age', chronoAge: 'Chrono Age',
    profile: 'Profile', showMore: 'More', showLess: 'Less',
    gender: 'Gender', born: 'Born', language: 'Language',
    height: 'Height', weight: 'Weight', bmi: 'BMI', weightTrend: 'Weight Trend',
    coach: 'Coach', joined: 'Joined', phone: 'Phone', email: 'Email',
    bsKg: 'kg', bsCm: 'cm',
    healthConditions: 'Health Conditions', noConditions: 'No known health conditions',
    latestBm: 'Latest Biomarkers',
    trends: 'Trends', tests: 'tests',
    noBmData: 'No biomarker data available yet.', noHistory: 'No test history yet.',
    guestHealthCta: 'Activate your account to view your health data and Bio Age',
    guestJoinBtn: 'Activate Account',
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
  },
}

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
  if (!bio || !chrono) return '#A6C4E5'
  return Number(bio) <= Number(chrono) ? '#10b981' : '#ef4444'
}

Component({
  properties: {
    userId:  { type: String,  value: '' },
    user:    { type: Object,  value: null },
    lang:    { type: String,  value: 'zh' },
    mode:    { type: String,  value: 'self' },
    isGuest: { type: Boolean, value: false },
    theme:   { type: String,  value: 'dark' },
  },

  data: {
    t: {},
    bioLoading: true,
    bAge: null,
    cAge: null,
    bAgeColor: '#A6C4E5',
    subAgeList: [],
    bmList: [],
    trendList: [],
    recordCount: 0,
    hasBm: false,
    profileInfoVisible: [],
    profileInfoExtra: [],
    profileExpanded: false,
    weightHistory: [],
    weightChartOpen: false,
    weightChartW: 300,
    healthConditionsList: [],
    hasConditionsData: false,
    avatarUpdating: false,
    avatarLetter: 'U',
  },

  observers: {
    'userId': function(newId) {
      if (newId) this._loadHealth()
    },
    'lang': function(newLang) {
      this.setData({ t: T[newLang] || T.zh })
      if (this.properties.userId && !this.data.bioLoading) this._loadHealth()
    },
    'user': function(newUser) {
      if (newUser) {
        const letter = (newUser.nickname || 'U').slice(-1).toUpperCase()
        this.setData({ avatarLetter: letter })
      }
    },
  },

  lifetimes: {
    attached() {
      const lang = this.properties.lang || 'zh'
      this.setData({ t: T[lang] || T.zh })
      const user = this.properties.user
      if (user) {
        const letter = (user.nickname || 'U').slice(-1).toUpperCase()
        this.setData({ avatarLetter: letter })
      }
      if (this.properties.userId) this._loadHealth()
    },
  },

  methods: {
    refresh() {
      this._loadHealth()
    },

    async _loadHealth() {
      const { userId, user, lang, mode } = this.properties
      if (!userId) return
      const t = T[lang] || T.zh
      this.setData({ bioLoading: true })
      try {
        const res = await this._req(`${BASE}/api/biomarkers?openid=${encodeURIComponent(userId)}`)
        const records = res.data?.records || []
        const kinoRecords = records.filter(r => r.test_type === 'kino_chip')
        const latestAnalyzed = [...kinoRecords].reverse().find(r => r.data?.estimated) || null
        const latestBm = latestAnalyzed?.data?.estimated || null
        const subAgesRaw = latestAnalyzed?.data?.bioage_profile?.SubAges || null

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

        const cAge = user ? chronoAge(user.birth_date) : null

        const subAgeList = subAgesRaw
          ? SUB_AGE_META.map(({ key, color }) => {
              const rawVal = subAgesRaw[key]
              const valStr = rawVal != null ? rawVal.toFixed(1) : '—'
              const score = rawVal != null && cAge != null
                ? Math.max(5, Math.min(95, Math.round((cAge + 15 - rawVal) / 30 * 100)))
                : 50
              return {
                key,
                label: t.subAgeLabels[key],
                desc: t.subAgeDesc[key],
                color,
                value: valStr,
                score,
              }
            })
          : []

        const rawBioAge = latestAnalyzed?.bio_age ?? (kinoRecords.length > 0 ? kinoRecords[kinoRecords.length - 1]?.bio_age : null) ?? user?.bio_age
        const bAge = rawBioAge ? Number(rawBioAge).toFixed(1) : null

        const newData = {
          bioLoading: false,
          subAgeList, bmList, trendList,
          cAge, bAge,
          bAgeColor: bioAgeColor(rawBioAge, cAge),
          recordCount: kinoRecords.length,
          hasBm: latestBm !== null,
        }

        if (mode === 'self' && user) {
          const bodyRecords = records.filter(r => r.test_type === 'body_composition').slice().reverse()
          const heightVal = bodyRecords.find(r => r.data?.actual?.height != null)?.data?.actual?.height ?? null
          const weightVal = bodyRecords.find(r => r.data?.actual?.weight != null)?.data?.actual?.weight ?? null

          const weightHistory = records
            .filter(r => r.test_type === 'body_composition' && r.data?.actual?.weight != null)
            .map(r => ({ date: (r.tested_at || '').substring(0, 10), weight: r.data.actual.weight }))

          const bmiVal = (heightVal != null && weightVal != null && heightVal > 0)
            ? (weightVal / Math.pow(heightVal / 100, 2)).toFixed(1)
            : null

          const profileInfoVisible = [
            { label: t.weight, val: weightVal != null ? `${weightVal} ${t.bsKg}` : '—', hasSparkline: true },
            { label: t.bmi,    val: bmiVal != null ? bmiVal : '—' },
          ]
          const profileInfoExtra = [
            { label: t.gender,   val: t.genderMap[user.gender] || user.gender || '—' },
            { label: t.born,     val: fmtDate(user.birth_date, lang) },
            { label: t.height,   val: heightVal != null ? `${heightVal} ${t.bsCm}` : '—' },
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

          Object.assign(newData, {
            weightHistory,
            profileInfoVisible, profileInfoExtra,
            healthConditionsList,
            hasConditionsData: condKeys !== null,
          })
        }

        this.setData(newData, () => {
          if (mode === 'self' && (newData.weightHistory || []).length > 1) {
            this._drawWeightSparkline()
          }
        })
      } catch (e) {
        this.setData({ bioLoading: false })
      }
    },

    _drawWeightSparkline() {
      const { weightHistory } = this.data
      if (weightHistory.length < 2) return
      const W = 60, H = 22, pad = 2
      const weights = weightHistory.map(r => r.weight)
      const minW = Math.min(...weights), maxW = Math.max(...weights)
      const range = maxW - minW || 1
      const pts = weights.map((w, i) => ({
        x: pad + (i / (weights.length - 1)) * (W - pad * 2),
        y: pad + ((maxW - w) / range) * (H - pad * 2),
      }))
      const ctx = wx.createCanvasContext('uh-weight-sparkline', this)
      ctx.clearRect(0, 0, W, H)
      ctx.beginPath()
      ctx.setStrokeStyle('rgba(99,117,236,0.85)')
      ctx.setLineWidth(1.5)
      ctx.moveTo(pts[0].x, pts[0].y)
      pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
      ctx.stroke()
      ctx.setFillStyle('#6375EC')
      pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fill() })
      ctx.draw()
    },

    _drawWeightFullChart() {
      const { weightHistory, weightChartW } = this.data
      if (weightHistory.length < 1) return
      const W = weightChartW, H = 200
      const pL = 44, pR = 16, pT = 20, pB = 44
      const plotW = W - pL - pR, plotH = H - pT - pB
      const weights = weightHistory.map(r => r.weight)
      const minW = Math.floor(Math.min(...weights)) - 2
      const maxW = Math.ceil(Math.max(...weights)) + 2
      const range = maxW - minW
      const toX = i => pL + (i / Math.max(weightHistory.length - 1, 1)) * plotW
      const toY = w => pT + ((maxW - w) / range) * plotH
      const pts = weightHistory.map((r, i) => ({ x: toX(i), y: toY(r.weight) }))
      const ctx = wx.createCanvasContext('uh-weight-chart-full', this)
      ctx.clearRect(0, 0, W, H)
      const gridSteps = 4
      for (let i = 0; i <= gridSteps; i++) {
        const y = pT + (i / gridSteps) * plotH
        const val = maxW - (i / gridSteps) * range
        ctx.setStrokeStyle('rgba(99,117,236,0.12)')
        ctx.setLineWidth(0.5)
        ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pL + plotW, y); ctx.stroke()
        ctx.setFillStyle('rgba(166,196,229,0.45)')
        ctx.setFontSize(10)
        ctx.fillText(val.toFixed(1), 0, y + 4)
      }
      ctx.beginPath()
      ctx.setFillStyle('rgba(99,117,236,0.1)')
      ctx.moveTo(pts[0].x, pT + plotH)
      pts.forEach(p => ctx.lineTo(p.x, p.y))
      ctx.lineTo(pts[pts.length - 1].x, pT + plotH)
      ctx.closePath(); ctx.fill()
      ctx.beginPath()
      ctx.setStrokeStyle('#6375EC')
      ctx.setLineWidth(2)
      ctx.moveTo(pts[0].x, pts[0].y)
      pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
      ctx.stroke()
      const labelStep = Math.max(1, Math.floor(weightHistory.length / 5))
      ctx.setFontSize(10)
      ctx.setFillStyle('rgba(166,196,229,0.5)')
      weightHistory.forEach((r, i) => {
        if (i % labelStep === 0 || i === weightHistory.length - 1) {
          ctx.fillText(r.date.substring(5), pts[i].x - 14, H - pB + 16)
        }
      })
      ctx.setFillStyle('#EEF2FF')
      ctx.setStrokeStyle('#6375EC')
      ctx.setLineWidth(1.5)
      pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke() })
      ctx.setStrokeStyle('rgba(99,117,236,0.3)')
      ctx.setLineWidth(1)
      ctx.beginPath(); ctx.moveTo(pL, pT); ctx.lineTo(pL, pT + plotH); ctx.lineTo(pL + plotW, pT + plotH); ctx.stroke()
      ctx.draw()
    },

    toggleProfile() {
      this.setData({ profileExpanded: !this.data.profileExpanded })
    },

    openWeightChart() {
      const W = wx.getSystemInfoSync().windowWidth - 72
      this.setData({ weightChartOpen: true, weightChartW: W }, () => { this._drawWeightFullChart() })
    },

    closeWeightChart() {
      this.setData({ weightChartOpen: false })
    },

    onChooseAvatar(e) {
      const avatarUrl = e.detail?.avatarUrl
      if (!avatarUrl) return
      this.setData({ avatarUpdating: true })
      this.triggerEvent('chooseavatar', { avatarUrl })
    },

    onGuestTap() {
      this.triggerEvent('guesttap')
    },

    _req(url, method = 'GET', data = null) {
      return new Promise((resolve, reject) => {
        const opts = {
          url, method,
          header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.apiToken}` },
          success: resolve,
          fail: reject,
        }
        if (data) opts.data = data
        wx.request(opts)
      })
    },

    noop() {},
  },
})
