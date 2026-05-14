const app = getApp()
const { BASE } = require('../../utils/config.js')

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

function _scoreSleep(h) {
  if (h >= 7 && h <= 9) return Math.min(100, Math.round(80 + (h - 7) / 2 * 20))
  if (h > 9) return Math.max(50, Math.round(100 - (h - 9) * 25))
  if (h >= 6) return Math.round(50 + (h - 6) * 30)
  return Math.max(10, Math.round(h / 6 * 50))
}
function _scoreHrv(ms) {
  if (ms >= 80) return 100
  if (ms >= 50) return Math.round(75 + (ms - 50) / 30 * 25)
  if (ms >= 30) return Math.round(45 + (ms - 30) / 20 * 30)
  return Math.max(10, Math.round(ms / 30 * 45))
}
function _scoreRestHr(bpm) {
  if (bpm <= 52) return 100
  if (bpm <= 65) return Math.round(100 - (bpm - 52) / 13 * 20)
  if (bpm <= 75) return Math.round(80 - (bpm - 65) / 10 * 20)
  if (bpm <= 90) return Math.round(60 - (bpm - 75) / 15 * 30)
  return Math.max(5, Math.round(30 - (bpm - 90) / 30 * 25))
}
function _scoreSpo2(pct) {
  if (pct >= 98) return 100
  if (pct >= 95) return Math.round(70 + (pct - 95) / 3 * 30)
  return Math.max(10, Math.round(30 + (pct - 90) / 5 * 40))
}
function _scoreSteps(steps) {
  if (steps >= 10000) return 100
  if (steps >= 7500) return Math.round(75 + (steps - 7500) / 2500 * 25)
  if (steps >= 5000) return Math.round(50 + (steps - 5000) / 2500 * 25)
  return Math.max(5, Math.round(steps / 5000 * 50))
}
function _scoreBmi(bmi) {
  if (bmi >= 18.5 && bmi <= 24.9) return 100
  if (bmi >= 25 && bmi <= 27.5) return Math.round(100 - (bmi - 24.9) / 2.6 * 30)
  if (bmi >= 17 && bmi < 18.5) return Math.round(70 + (bmi - 17) / 1.5 * 30)
  if (bmi > 27.5) return Math.max(10, Math.round(70 - (bmi - 27.5) / 10 * 60))
  return Math.max(10, Math.round(bmi / 17 * 70))
}

const TWIN_COV_LABELS = {
  zh: { sleep: '睡眠', activity: '活动', vitals: '体征', lab_result: '化验', body_composition: '体成分' },
  en: { sleep: 'Sleep', activity: 'Activity', vitals: 'Vitals', lab_result: 'Labs', body_composition: 'Body' },
}

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
    editProfile: '编辑资料', save: '保存', cancel: '取消',
    name: '姓名', otherPlaceholder: '请说明', saveOk: '已保存', saveFail: '保存失败',
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
    digitalTwin: '数字孪生',
    noTwinData: '暂无可穿戴设备数据。',
    dtSevenDay: '7天均值',
    dtSleepScore: '评分',
    dtResting: '静息',
    dtBody: '体成分',
    dtSources: '数据来源',
    dtFat: '体脂',
    dtLean: '瘦体重',
    healthScore: '健康评分',
    healthScoreGrades: { optimal: '优秀', good: '良好', fair: '一般', low: '偏低' },
    dtRecovery: '恢复力', dtCardio: '心血管', dtActivity: '活动量', dtBodyDomain: '体态',
    dtVitals: '生命体征',
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
    editProfile: 'Edit Profile', save: 'Save', cancel: 'Cancel',
    name: 'Name', otherPlaceholder: 'Please specify', saveOk: 'Saved', saveFail: 'Save failed',
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
    digitalTwin: 'Digital Twin',
    noTwinData: 'No wearable data yet.',
    dtSevenDay: '7-day avg',
    dtSleepScore: 'score',
    dtResting: 'resting',
    dtBody: 'Body Comp.',
    dtSources: 'Sources',
    dtFat: 'Fat',
    dtLean: 'Lean',
    healthScore: 'Health Score',
    healthScoreGrades: { optimal: 'Optimal', good: 'Good', fair: 'Fair', low: 'Low' },
    dtRecovery: 'Recovery', dtCardio: 'Cardio', dtActivity: 'Activity', dtBodyDomain: 'Body',
    dtVitals: 'Vitals',
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
    rawHeight: null,
    rawWeight: null,
    editing: false,
    editSaving: false,
    editOtherSelected: false,
    editForm: {
      nickname: '', gender: '', birth_date: '',
      height: '', weight: '',
      health_conditions: [], health_conditions_other: '',
    },
    editConditionOptions: [],
    // Digital twin
    twinLoading: true,
    hasTwinData: false,
    twinMetrics: [],
    twinBody: null,
    twinCoverage: [],
    healthScore: null,
    healthScoreColor: '#A6C4E5',
    healthScoreGrade: '',
    healthDomains: [],
    vitalGauges: [],
    twinBodyBar: null,
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
      this._loadHealthTwin()
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

        if ((mode === 'self' || mode === 'coach') && user) {
          const bodyRecords = records.filter(r => r.test_type === 'body_composition').slice().reverse()
          const heightVal = bodyRecords.find(r => r.data?.actual?.height != null)?.data?.actual?.height
            ?? user.bio_data?.height ?? null
          const weightVal = bodyRecords.find(r => r.data?.actual?.weight != null)?.data?.actual?.weight
            ?? user.bio_data?.weight ?? null

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
            rawHeight: heightVal,
            rawWeight: weightVal,
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

    startEdit() {
      const { user, lang } = this.properties
      const t = T[lang] || T.zh
      const bioData = user?.bio_data || {}
      const currentConditions = bioData.health_conditions || []
      const birthDate = user?.birth_date ? String(user.birth_date).substring(0, 10) : ''
      const rawH = this.data.rawHeight ?? bioData.height
      const rawW = this.data.rawWeight ?? bioData.weight
      const options = CONDITION_KEYS.map(key => ({
        key,
        label: t.conditionLabels[key] || key,
        checked: currentConditions.includes(key),
      }))
      this.setData({
        editing: true,
        editOtherSelected: currentConditions.includes('other'),
        editConditionOptions: options,
        editForm: {
          nickname: user?.nickname || '',
          gender: user?.gender || '',
          birth_date: birthDate,
          height: rawH != null ? String(rawH) : '',
          weight: rawW != null ? String(rawW) : '',
          health_conditions: [...currentConditions],
          health_conditions_other: bioData.health_conditions_other || '',
        },
      })
    },

    cancelEdit() {
      this.setData({ editing: false })
    },

    onEditField(e) {
      const field = e.currentTarget.dataset.field
      this.setData({ [`editForm.${field}`]: e.detail.value })
    },

    onBirthDateChange(e) {
      this.setData({ 'editForm.birth_date': e.detail.value })
    },

    onGenderSelect(e) {
      this.setData({ 'editForm.gender': e.currentTarget.dataset.value })
    },

    onConditionToggle(e) {
      const key = e.currentTarget.dataset.key
      const { editConditionOptions } = this.data
      const newOptions = editConditionOptions.map(o =>
        o.key === key ? { ...o, checked: !o.checked } : o
      )
      const newConditions = newOptions.filter(o => o.checked).map(o => o.key)
      this.setData({
        editConditionOptions: newOptions,
        'editForm.health_conditions': newConditions,
        editOtherSelected: newConditions.includes('other'),
      })
    },

    async saveEdit() {
      if (this.data.editSaving) return
      const lang = this.properties.lang || 'zh'
      const t = T[lang] || T.zh
      const { editForm } = this.data
      const user = this.properties.user
      this.setData({ editSaving: true })
      try {
        const { nickname, gender, birth_date, height, weight, health_conditions, health_conditions_other } = editForm
        const bio_data_update = {
          health_conditions,
          health_conditions_other: health_conditions_other || '',
        }
        if (height !== '' && height != null) bio_data_update.height = Number(height)
        if (weight !== '' && weight != null) bio_data_update.weight = Number(weight)

        await this._req(`${BASE}/api/users/${user.user_id}`, 'PUT', {
          nickname, gender, birth_date, bio_data: bio_data_update,
        })

        const newBioData = { ...(user.bio_data || {}), ...bio_data_update }
        const updatedUser = { ...user, nickname, gender, birth_date, bio_data: newBioData }

        const hVal = height !== '' ? Number(height) : (newBioData.height ?? null)
        const wVal = weight !== '' ? Number(weight) : (newBioData.weight ?? null)

        const profileInfoExtra = [
          { label: t.gender,   val: t.genderMap[gender] || gender || '—' },
          { label: t.born,     val: fmtDate(birth_date, lang) },
          { label: t.height,   val: hVal != null ? `${hVal} ${t.bsCm}` : '—' },
          { label: t.language, val: t.langMap[user.language] || user.language || '—' },
          { label: t.coach,    val: user.coach_name || '—' },
          { label: t.joined,   val: fmtDate(user.created_at, lang) },
          { label: t.phone,    val: user.phone || '—' },
          { label: t.email,    val: user.email || '—' },
        ]
        const healthConditionsList = health_conditions.map(key => ({
          key,
          label: key === 'other' && health_conditions_other
            ? `${t.conditionLabels[key]}（${health_conditions_other}）`
            : (t.conditionLabels[key] || key),
        }))
        const cAge = chronoAge(birth_date)

        this.setData({
          editing: false,
          editSaving: false,
          profileInfoExtra,
          healthConditionsList,
          hasConditionsData: true,
          cAge,
          bAgeColor: bioAgeColor(this.data.bAge, cAge),
          avatarLetter: (nickname || 'U').slice(-1).toUpperCase(),
          rawHeight: hVal,
          rawWeight: wVal,
        })
        this.triggerEvent('profileUpdated', updatedUser)
        wx.showToast({ title: t.saveOk, icon: 'success', duration: 1500 })
      } catch (e) {
        this.setData({ editSaving: false })
        wx.showToast({ title: t.saveFail, icon: 'error', duration: 2000 })
      }
    },

    async _loadHealthTwin() {
      const { userId, lang } = this.properties
      if (!userId) return
      const isZh = (lang || 'zh') !== 'en'
      const t = T[isZh ? 'zh' : 'en']
      const covLabels = TWIN_COV_LABELS[isZh ? 'zh' : 'en']
      try {
        const res = await this._req(`${BASE}/api/health-twin?openid=${encodeURIComponent(userId)}`)
        const twin = res.data?.twin
        if (!twin) { this.setData({ hasTwinData: false, twinLoading: false }); return }

        const trendIcon  = v => v === 'improving' ? '↑' : v === 'declining' ? '↓' : v === 'stable' ? '→' : ''
        const trendColor = v => v === 'improving' ? '#10b981' : v === 'declining' ? '#ef4444' : 'rgba(166,196,229,0.35)'

        const metrics = []
        const td = twin.trend_data || {}

        if (twin.avg_sleep_hours != null) {
          const score = twin.avg_sleep_score != null
            ? `${t.dtSleepScore} ${Math.round(twin.avg_sleep_score)}`
            : t.dtSevenDay
          metrics.push({
            key: 'sleep', label: isZh ? '睡眠' : 'Sleep',
            val: twin.avg_sleep_hours.toFixed(1), unit: 'h', sub: score,
            deepPct: twin.avg_deep_sleep_pct != null ? Math.round(twin.avg_deep_sleep_pct) : null,
            trend: trendIcon(td.sleep_trend), trendColor: trendColor(td.sleep_trend),
            color: '#6375EC',
          })
        }

        if (twin.avg_hrv_ms != null) {
          metrics.push({
            key: 'hrv', label: 'HRV',
            val: Math.round(twin.avg_hrv_ms).toString(), unit: 'ms', sub: t.dtSevenDay,
            trend: trendIcon(td.hrv_trend), trendColor: trendColor(td.hrv_trend),
            color: '#10b981',
          })
        }

        if (twin.avg_daily_steps != null) {
          metrics.push({
            key: 'steps', label: isZh ? '步数' : 'Steps',
            val: twin.avg_daily_steps.toLocaleString(), unit: '', sub: t.dtSevenDay,
            trend: '', trendColor: '', color: '#0ea5e9',
          })
        }

        if (twin.avg_resting_hr != null) {
          metrics.push({
            key: 'hr', label: isZh ? '心率' : 'Resting HR',
            val: Math.round(twin.avg_resting_hr).toString(), unit: 'bpm', sub: t.dtResting,
            trend: '', trendColor: '', color: '#f97316',
          })
        }

        if (twin.avg_spo2 != null && metrics.length < 4) {
          metrics.push({
            key: 'spo2', label: 'SpO₂',
            val: twin.avg_spo2.toFixed(1), unit: '%', sub: t.dtSevenDay,
            trend: '', trendColor: '', color: '#a855f7',
          })
        }

        const bodyParts = []
        if (twin.latest_weight_kg != null) bodyParts.push(`${twin.latest_weight_kg} kg`)
        if (twin.latest_bmi != null) bodyParts.push(`BMI ${Number(twin.latest_bmi).toFixed(1)}`)
        if (twin.latest_body_fat_pct != null) bodyParts.push(`${t.dtFat} ${Number(twin.latest_body_fat_pct).toFixed(1)}%`)
        const twinBody = bodyParts.length ? bodyParts.join('  ·  ') : null

        const cov = twin.data_coverage || {}
        const twinCoverage = Object.keys(covLabels).map(key => ({
          key, label: covLabels[key],
          hasData: !!cov[key],
          lastDate: cov[key] ? cov[key].substring(5) : null,
        }))

        const visuals = this._buildTwinVisuals(twin, t, isZh)
        this.setData({
          twinLoading: false,
          hasTwinData: metrics.length > 0 || twinBody != null,
          twinMetrics: metrics,
          twinBody,
          twinCoverage,
          ...visuals,
        })
      } catch (e) {
        this.setData({ hasTwinData: false, twinLoading: false })
      }
    },

    _buildTwinVisuals(twin, t, isZh) {
      const td = twin.trend_data || {}
      const trendIcon  = v => v === 'improving' ? '↑' : v === 'declining' ? '↓' : v === 'stable' ? '→' : ''
      const trendColor = v => v === 'improving' ? '#10b981' : v === 'declining' ? '#ef4444' : 'rgba(166,196,229,0.35)'

      const domainScores = {}
      const vitalGauges = []

      if (twin.avg_sleep_hours != null) {
        const h = twin.avg_sleep_hours
        domainScores.sleep = _scoreSleep(h)
        vitalGauges.push({
          key: 'sleep',
          label: isZh ? '睡眠时长' : 'Sleep',
          val: h.toFixed(1), unit: 'h',
          score: domainScores.sleep, color: '#6375EC',
          trend: trendIcon(td.sleep_trend), trendColor: trendColor(td.sleep_trend),
          markerPct: Math.min(97, Math.max(2, Math.round(h / 12 * 100))),
          zones: [
            { width: 50, color: '#ef4444' },
            { width: 8,  color: '#f97316' },
            { width: 17, color: '#10b981' },
            { width: 8,  color: '#f97316' },
            { width: 17, color: '#ef4444' },
          ],
          sublabel: isZh ? '最优: 7–9h' : 'Optimal: 7–9h',
        })
      }

      if (twin.avg_hrv_ms != null) {
        const ms = twin.avg_hrv_ms
        domainScores.hrv = _scoreHrv(ms)
        vitalGauges.push({
          key: 'hrv', label: 'HRV',
          val: Math.round(ms).toString(), unit: 'ms',
          score: domainScores.hrv, color: '#10b981',
          trend: trendIcon(td.hrv_trend), trendColor: trendColor(td.hrv_trend),
          markerPct: Math.min(97, Math.max(2, Math.round(ms))),
          zones: [
            { width: 20, color: '#ef4444' },
            { width: 20, color: '#f97316' },
            { width: 30, color: '#10b981' },
            { width: 30, color: '#0ea5e9' },
          ],
          sublabel: isZh ? '越高越好' : 'Higher is better',
        })
      }

      if (twin.avg_resting_hr != null) {
        const bpm = twin.avg_resting_hr
        domainScores.hr = _scoreRestHr(bpm)
        vitalGauges.push({
          key: 'hr', label: isZh ? '静息心率' : 'Resting HR',
          val: Math.round(bpm).toString(), unit: 'bpm',
          score: domainScores.hr, color: '#f97316',
          trend: '', trendColor: '',
          markerPct: Math.min(97, Math.max(2, Math.round((bpm - 40) / 80 * 100))),
          zones: [
            { width: 15, color: '#0ea5e9' },
            { width: 16, color: '#10b981' },
            { width: 13, color: '#10b981' },
            { width: 19, color: '#f97316' },
            { width: 37, color: '#ef4444' },
          ],
          sublabel: isZh ? '最优: 50–65 bpm' : 'Optimal: 50–65 bpm',
        })
      }

      if (twin.avg_spo2 != null) {
        const pct = twin.avg_spo2
        domainScores.spo2 = _scoreSpo2(pct)
        vitalGauges.push({
          key: 'spo2', label: 'SpO₂',
          val: pct.toFixed(1), unit: '%',
          score: domainScores.spo2, color: '#a855f7',
          trend: '', trendColor: '',
          markerPct: Math.min(97, Math.max(2, Math.round((pct - 90) / 10 * 100))),
          zones: [
            { width: 50, color: '#ef4444' },
            { width: 20, color: '#f97316' },
            { width: 10, color: '#10b981' },
            { width: 20, color: '#0ea5e9' },
          ],
          sublabel: isZh ? '最优: ≥98%' : 'Optimal: ≥98%',
        })
      }

      if (twin.avg_daily_steps != null) {
        const steps = twin.avg_daily_steps
        domainScores.steps = _scoreSteps(steps)
        vitalGauges.push({
          key: 'steps', label: isZh ? '日均步数' : 'Daily Steps',
          val: steps >= 10000 ? `${(steps / 1000).toFixed(1)}k` : steps.toLocaleString(), unit: '',
          score: domainScores.steps, color: '#0ea5e9',
          trend: '', trendColor: '',
          markerPct: Math.min(97, Math.max(2, Math.round(steps / 12000 * 100))),
          zones: [
            { width: 42, color: '#ef4444' },
            { width: 21, color: '#f97316' },
            { width: 21, color: '#10b981' },
            { width: 16, color: '#0ea5e9' },
          ],
          sublabel: isZh ? '目标: 7,500+ 步' : 'Goal: 7,500+ steps',
        })
      }

      if (twin.latest_bmi != null) {
        domainScores.bmi = _scoreBmi(twin.latest_bmi)
      }

      // Domain aggregate scores
      const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null
      const healthDomains = []
      const recoveryS = avg([domainScores.sleep, domainScores.hrv].filter(v => v != null))
      const cardioS   = avg([domainScores.hr, domainScores.spo2].filter(v => v != null))
      const activityS = avg([domainScores.steps].filter(v => v != null))
      const bodyS     = avg([domainScores.bmi].filter(v => v != null))

      if (recoveryS != null) healthDomains.push({ key: 'recovery', label: t.dtRecovery, score: recoveryS, color: '#6375EC' })
      if (cardioS   != null) healthDomains.push({ key: 'cardio',   label: t.dtCardio,   score: cardioS,   color: '#f97316' })
      if (activityS != null) healthDomains.push({ key: 'activity', label: t.dtActivity, score: activityS, color: '#0ea5e9' })
      if (bodyS     != null) healthDomains.push({ key: 'body',     label: t.dtBodyDomain, score: bodyS,  color: '#a855f7' })

      const allScores = [recoveryS, cardioS, activityS, bodyS].filter(v => v != null)
      const healthScore = allScores.length ? avg(allScores) : null
      const healthScoreColor = healthScore == null ? '#A6C4E5'
        : healthScore >= 80 ? '#10b981'
        : healthScore >= 65 ? '#6375EC'
        : healthScore >= 50 ? '#f97316'
        : '#ef4444'
      const grades = t.healthScoreGrades
      const healthScoreGrade = healthScore == null ? ''
        : healthScore >= 80 ? grades.optimal
        : healthScore >= 65 ? grades.good
        : healthScore >= 50 ? grades.fair
        : grades.low

      // Body composition visual bar
      let twinBodyBar = null
      if (twin.latest_body_fat_pct != null) {
        const fat = Math.min(60, Math.max(5, Math.round(twin.latest_body_fat_pct)))
        twinBodyBar = { fatPct: fat, leanPct: 100 - fat }
      }

      return { healthScore, healthScoreColor, healthScoreGrade, healthDomains, vitalGauges, twinBodyBar }
    },

    noop() {},
  },
})
