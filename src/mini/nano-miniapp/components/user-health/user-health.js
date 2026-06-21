const app = getApp()
const { BASE } = require('../../utils/config.js')

const BM_META = [
  { key: 'hsCRP',     unit: 'mg/L',      color: '#f472b6' },
  { key: 'GDF15',     unit: 'pg/mL',     color: '#fb7185' },
  { key: 'IL6',       unit: 'pg/mL',     color: '#a855f7' },
  { key: 'GA',        unit: '%',         color: '#6375EC' },
  { key: 'CystatinC', unit: 'mg/L',      color: '#0ea5e9' },
  { key: 'CD38',      unit: 'xBaseline', color: '#e879f9' },
]

const SUB_AGE_META = [
  { key: 'ResilienceAge',    color: '#c084d4' },
  { key: 'CellularAge',      color: '#10b981' },
  { key: 'MetabolicAge',     color: '#6375EC' },
  { key: 'MicroVascularAge', color: '#0ea5e9' },
]

const SUB_AGE_KEYS = SUB_AGE_META.map(m => m.key)

function buildSubAgeLabels(base, overrides, lang) {
  if (!overrides) return base
  const result = { ...base }
  for (const key of SUB_AGE_KEYS) {
    const override = overrides[key]?.[lang]
    if (override && override.trim()) result[key] = override.trim()
  }
  return result
}

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

function _scoreBp(sys, dia) {
  if (sys == null || dia == null) return null
  if (sys >= 140 || dia >= 90) return 20
  if (sys >= 130 || dia >= 85) return 50
  if (sys >= 120 || dia >= 80) return 75
  if (sys < 85  || dia < 55)  return 60  // hypotension
  return 100
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
    trends: 'KINO', tests: '次检测',
    noBmData: '暂无生物标志物数据。', noHistory: '暂无检测记录。',
    guestHealthCta: '激活账户后，查看您的健康数据与生物年龄',
    guestJoinBtn: '激活账户',
    editProfile: '编辑资料', changeAvatar: '换头像', save: '保存', cancel: '取消',
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
    dtMonitoring: '实时健康数据',
    dtLabPanel: '快照', dtLabAbnormal: '项异常', dtLabAllNormal: '所有指标正常',
    healthReports: '实验室',
    noReports: '暂无检测报告。',
    reportTypeLabels: { annual_checkup: '年度体检', lab_panel: '化验报告', imaging: '影像检查', other: '其他' },
    reportSourceLabels: { lab_api: '实验室', manual_upload: '手动上传', fhir_import: 'FHIR' },
    reportItems: '项指标',
    rptNormal: '正常', rptHigh: '偏高', rptLow: '偏低',
    rptRefRange: '参考值',
    rptClose: '关闭',
    rptDiagTitle: '诊断意见',
    rptAdviceTitle: '医生建议',
    rptMarkersTitle: '检验指标',
    rptDoctorTitle: '医生评估',
    rptPhysician: '主诊医生',
    rptVitals: '生命体征',
    rptClinicalSummary: '临床概述',
    rptRecommendations: '建议方案',
    rptFollowUp: '随访计划',
    noHealthSignals: '暂无健康信号',
    bioAgeTrend: '生理年龄趋势',
    wearableDevice: '可穿戴设备',
    bindSmartRing: '绑定智能戒指',
    wearableConnected: '已连接',
    wearableDisconnected: '未连接',
    wearableBattery: '电量',
    wearableSyncNow: '立即同步',
    wearableUnbind: '解绑',
    x3SaveIntervals: '保存到戒指',
    x3IntervalLoading: '读取中...',
    wearableScanning: '正在搜索...',
    wearableNoDevices: '未找到设备，请确认戒指已开机',
    wearableConnecting: '正在同步...',
    wearableConnectFail: '连接失败，请重试',
    wearableSyncFail: '同步失败',
    ringSteps: '今日步数',
    ringSleep: '昨夜睡眠',
    ringHr: '最低心率',
    ringHrv: 'HRV',
    ringStress: '压力',
    metricBp: '血压',
    metricGlucose: '血糖',
    ringStressLevels: ['放松', '正常', '中等', '偏高'],
    wearableMeasuringHrv: '测量 HRV...',
    wearableMeasuringStress: '测量压力...',
    wearableMeasuringBg: '正在测量 HRV、压力和血氧... (约3分钟)',
    ringStepsChart: '步数分布',
    ringHrChart: '心率分布',
    ringSleepChart: '睡眠分期',
    ringDeep: '深睡', ringRem: 'REM', ringLight: '浅睡', ringAwake: '清醒',
    x3IntervalTitle: '测量间隔',
    metricHr: '心率', metricSpo2: 'SpO₂', metricTemp: '体温', metricHrv: 'HRV',
    x3IntervalUnit: '分钟',
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
    trends: 'KINO', tests: 'tests',
    noBmData: 'No biomarker data available yet.', noHistory: 'No test history yet.',
    guestHealthCta: 'Activate your account to view your health data and Bio Age',
    guestJoinBtn: 'Activate Account',
    editProfile: 'Edit Profile', changeAvatar: 'Photo', save: 'Save', cancel: 'Cancel',
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
    dtMonitoring: 'Real-time Health Data',
    dtLabPanel: 'Snapshot', dtLabAbnormal: 'abnormal', dtLabAllNormal: 'All markers normal',
    healthReports: 'Lab',
    noReports: 'No lab reports yet.',
    reportTypeLabels: { annual_checkup: 'Annual Checkup', lab_panel: 'Lab Panel', imaging: 'Imaging', other: 'Other' },
    reportSourceLabels: { lab_api: 'Lab', manual_upload: 'Uploaded', fhir_import: 'FHIR' },
    reportItems: 'markers',
    rptNormal: 'Normal', rptHigh: 'High', rptLow: 'Low',
    rptRefRange: 'Ref',
    rptClose: 'Close',
    rptDiagTitle: 'Diagnostics',
    rptAdviceTitle: "Doctor's Advice",
    rptMarkersTitle: 'Lab Markers',
    rptDoctorTitle: 'Doctor Assessment',
    rptPhysician: 'Physician',
    rptVitals: 'Vitals',
    rptClinicalSummary: 'Clinical Summary',
    rptRecommendations: 'Recommendations',
    rptFollowUp: 'Follow-up',
    noHealthSignals: 'No signals yet',
    bioAgeTrend: 'BioAge Trend',
    wearableDevice: 'Wearable Device',
    bindSmartRing: 'Bind Smart Ring',
    wearableConnected: 'Connected',
    wearableDisconnected: 'Disconnected',
    wearableBattery: 'Battery',
    wearableSyncNow: 'Sync Now',
    wearableUnbind: 'Unbind',
    x3SaveIntervals: 'Save to Ring',
    x3IntervalLoading: 'Reading...',
    wearableScanning: 'Scanning...',
    wearableNoDevices: 'No devices found. Make sure the ring is powered on.',
    wearableConnecting: 'Syncing...',
    wearableConnectFail: 'Connection failed. Please try again.',
    wearableSyncFail: 'Sync failed',
    ringSteps: "Today's Steps",
    ringSleep: 'Last Night',
    ringHr: 'Min HR',
    ringHrv: 'HRV',
    ringStress: 'Stress',
    metricBp: 'Blood Pressure',
    metricGlucose: 'Blood Glucose',
    ringStressLevels: ['Relaxed', 'Normal', 'Moderate', 'High'],
    wearableMeasuringHrv: 'Measuring HRV...',
    wearableMeasuringStress: 'Measuring stress...',
    wearableMeasuringBg: 'Measuring HRV, Stress & SpO₂... (~3 min)',
    ringStepsChart: 'Steps by Hour',
    ringHrChart: 'Heart Rate by Hour',
    ringSleepChart: 'Sleep Stages',
    ringDeep: 'Deep', ringRem: 'REM', ringLight: 'Light', ringAwake: 'Awake',
    x3IntervalTitle: 'Monitoring Intervals',
    metricHr: 'Heart Rate', metricSpo2: 'SpO₂', metricTemp: 'Temp', metricHrv: 'HRV',
    x3IntervalUnit: 'min',
  },
}

function _buildRingDisplayData(raw, isZh) {
  const syncLabel = isZh ? `已同步 ${_shanghaiTimeStr(raw.syncedAt)}` : `Synced ${_shanghaiTimeStr(raw.syncedAt)}`

  let sleepStr = null, sleepDeepPct = 0, sleepLightPct = 0, sleepRemPct = 0, sleepAwakePct = 0
  if (raw.sleepMinutes != null && raw.sleepMinutes > 0) {
    const h = Math.floor(raw.sleepMinutes / 60)
    const m = raw.sleepMinutes % 60
    sleepStr = isZh ? `${h}时${m}分` : `${h}h ${m}m`
    const total = raw.sleepMinutes
    sleepDeepPct  = Math.round((raw.sleepDeep  || 0) / total * 100)
    sleepRemPct   = Math.round((raw.sleepRem   || 0) / total * 100)
    sleepLightPct = Math.round((raw.sleepLight || 0) / total * 100)
    sleepAwakePct = Math.max(0, 100 - sleepDeepPct - sleepRemPct - sleepLightPct)
  }

  let stepsStr = null, stepsPct = 0
  if (raw.steps != null) {
    const s = raw.steps
    stepsStr = s >= 10000 ? `${(s / 1000).toFixed(1)}k`
      : s >= 1000 ? `${Math.floor(s / 1000)},${String(s % 1000).padStart(3, '0')}`
      : String(s)
    stepsPct = Math.min(100, Math.round(s / 10000 * 100))
  }

  // HRV color by quality zone (ms)
  let hrvColor = '#A6C4E5'
  if (raw.hrv != null) {
    if (raw.hrv >= 80)      hrvColor = '#0ea5e9'
    else if (raw.hrv >= 50) hrvColor = '#10b981'
    else if (raw.hrv >= 30) hrvColor = '#f97316'
    else                    hrvColor = '#ef4444'
  }
  const hrvPct = raw.hrv != null ? Math.min(100, Math.max(2, Math.round((raw.hrv - 20) / 80 * 100))) : 0

  // Stress color + label (0-100 scale)
  let stressLabel = null, stressColor = '#A6C4E5'
  if (raw.stress != null) {
    const levels = isZh
      ? ['放松', '正常', '中等', '偏高']
      : ['Relaxed', 'Normal', 'Moderate', 'High']
    const colors = ['#10b981', '#6375EC', '#f97316', '#ef4444']
    const idx = raw.stress <= 25 ? 0 : raw.stress <= 50 ? 1 : raw.stress <= 75 ? 2 : 3
    stressLabel = levels[idx]
    stressColor = colors[idx]
  }

  // SpO2 color
  let spo2Color = '#A6C4E5'
  if (raw.spo2 != null) {
    spo2Color = raw.spo2 >= 98 ? '#0ea5e9' : raw.spo2 >= 95 ? '#10b981' : raw.spo2 >= 90 ? '#f97316' : '#ef4444'
  }
  const spo2Pct = raw.spo2 != null ? Math.min(100, Math.max(2, Math.round((raw.spo2 - 90) / 10 * 100))) : 0

  // Blood pressure (X3 HRV measurement) + breath rate
  let bpStr = null, bpColor = '#A6C4E5'
  if (raw.systolicBP != null && raw.diastolicBP != null) {
    bpStr = `${raw.systolicBP}/${raw.diastolicBP}`
    bpColor = raw.systolicBP >= 140 ? '#ef4444' : raw.systolicBP >= 130 ? '#f97316' : raw.systolicBP >= 120 ? '#f97316' : '#10b981'
  }
  const breathRateStr = raw.breathRate != null ? String(raw.breathRate) : null

  // ── Slot charts ──
  const CHART_H = 72  // rpx height of bar chart area

  // Steps: aggregate 15-min slots → 24 hourly bars
  let stepsBars = null
  if (raw.stepSlots && raw.stepSlots.length > 0) {
    const hrSteps = new Array(24).fill(0)
    for (const s of raw.stepSlots) {
      hrSteps[_shanghaiHour(s.t)] += s.steps
    }
    const maxS = Math.max(...hrSteps, 1)
    stepsBars = hrSteps.map((steps, h) => ({
      h: h % 6 === 0 ? String(h) : '',
      heightRpx: Math.round(steps / maxS * CHART_H),
      active: steps > 0,
    }))
  }

  // HR: aggregate 5-min slots → 24 hourly avg bars
  let hrBars = null
  if (raw.hrSlots && raw.hrSlots.length > 0) {
    const hrMap = {}
    for (const r of raw.hrSlots) {
      const h = _shanghaiHour(r.t)
      if (!hrMap[h]) hrMap[h] = []
      hrMap[h].push(r.bpm)
    }
    hrBars = new Array(24).fill(0).map((_, h) => {
      const arr = hrMap[h]
      if (!arr) return { h: h % 6 === 0 ? String(h) : '', heightRpx: 3, color: 'rgba(99,117,236,0.08)', bpm: 0 }
      const bpm = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
      const color = bpm < 60 ? '#0ea5e9' : bpm < 75 ? '#10b981' : bpm < 90 ? '#f97316' : '#ef4444'
      const heightRpx = Math.round(Math.max(6, Math.min(CHART_H, (bpm - 40) / 80 * CHART_H)))
      return { h: h % 6 === 0 ? String(h) : '', heightRpx, color, bpm }
    })
  }

  // Sleep: consecutive stage segments as % widths
  let sleepSegs = null, sleepTimeRange = null
  if (raw.sleepSlots && raw.sleepSlots.length > 0) {
    const totalMin = raw.sleepSlots.reduce((s, p) => s + p.min, 0)
    const segColors = { deep: '#6375EC', rem: '#a855f7', light: '#0ea5e9', awake: 'rgba(166,196,229,0.18)' }
    sleepSegs = raw.sleepSlots.map(p => ({
      widthPct: Math.round(p.min / totalMin * 100),
      color: segColors[p.type] || '#6375EC',
    }))
    if (raw.sleepStart != null && raw.sleepEnd != null) {
      const fmtMins = (m) => { const a = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}` }
      sleepTimeRange = `${fmtMins(raw.sleepStart)} → ${fmtMins(raw.sleepEnd)}`
    }
  }

  return {
    ...raw,
    sleepStr, sleepDeepPct, sleepLightPct, sleepRemPct, sleepAwakePct,
    stepsStr, stepsPct,
    syncLabel,
    hasSteps:      raw.steps        != null,
    hasSleep:      raw.sleepMinutes != null && raw.sleepMinutes > 0,
    hasHr:         raw.restingHr    != null,
    hasHrv:        raw.hrv          != null,
    hasStress:     raw.stress       != null,
    hasSpo2:       raw.spo2         != null,
    hasBp:         raw.systolicBP   != null && raw.diastolicBP != null,
    hasBreathRate: raw.breathRate   != null,
    hrvColor, hrvPct,
    stressLabel, stressColor,
    spo2Color, spo2Pct,
    bpStr, bpColor, breathRateStr,
    stepsBars, hrBars, sleepSegs, sleepTimeRange,
    hasSlotCharts: !!(stepsBars || hrBars || sleepSegs),
  }
}

const _CST_MS = 8 * 60 * 60 * 1000

function _shanghaiDateStr(ts) {
  const d = new Date((ts || Date.now()) + _CST_MS)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// Converts any timestamp (Unix ms or ISO string) to Shanghai (UTC+8) HH:MM string
function _shanghaiTimeStr(t) {
  const d = new Date(new Date(t).getTime() + _CST_MS)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

// Returns the Shanghai (UTC+8) hour (0–23) from any timestamp or ISO string
function _shanghaiHour(t) {
  return new Date(new Date(t).getTime() + _CST_MS).getUTCHours()
}

function _getRealtimeReadings(syncedAt) {
  try {
    const todayStr = _shanghaiDateStr(syncedAt)
    const stored = wx.getStorageSync('wearable_realtime_today')
    if (!stored || stored.date !== todayStr) return []
    return (stored.readings || []).slice().reverse()
  } catch (_) { return [] }
}

// Merge X3 HRV+SpO2 slot arrays into the same reading shape _fmtRealtimeReadings expects.
// Ring timestamps ('2026-06-20 14:30:12') are CST, so append +08:00 before parsing.
function _slotsToReadings(hrvSlots, spo2Slots) {
  const byTs = {}
  for (const s of (spo2Slots || [])) {
    byTs[s.timestamp] = byTs[s.timestamp] || {}
    byTs[s.timestamp].spo2 = s.spo2
  }
  for (const s of (hrvSlots || [])) {
    byTs[s.timestamp] = byTs[s.timestamp] || {}
    Object.assign(byTs[s.timestamp], {
      hrv: s.hrv ?? null, stress: s.stress ?? null,
      breathRate: s.breath ?? null,
      systolicBP: s.highBP ?? null, diastolicBP: s.lowBP ?? null,
    })
  }
  return Object.keys(byTs).sort().reverse().map(ts => ({
    t: new Date(ts.replace(' ', 'T') + '+08:00').getTime(),
    ...byTs[ts],
  }))
}

function _fmtRealtimeReadings(readings) {
  const todayStr = _shanghaiDateStr(Date.now())
  const yesterStr = _shanghaiDateStr(Date.now() - 86400000)
  return readings.map(r => {
    const time = _shanghaiTimeStr(r.t)
    const dateStr = _shanghaiDateStr(r.t)
    const dateLabel = dateStr === todayStr ? null : dateStr === yesterStr ? '昨天' : dateStr.slice(5).replace('-', '/')
    const hrvColor    = r.hrv    == null ? null : r.hrv >= 80 ? '#0ea5e9' : r.hrv >= 50 ? '#10b981' : r.hrv >= 30 ? '#f97316' : '#ef4444'
    const spo2Color   = r.spo2   == null ? null : r.spo2 >= 98 ? '#0ea5e9' : r.spo2 >= 95 ? '#10b981' : r.spo2 >= 90 ? '#f97316' : '#ef4444'
    const stressColor = r.stress == null ? null : r.stress <= 25 ? '#10b981' : r.stress <= 50 ? '#6375EC' : r.stress <= 75 ? '#f97316' : '#ef4444'
    const bpStr   = r.systolicBP != null && r.diastolicBP != null ? `${r.systolicBP}/${r.diastolicBP}` : null
    const bpColor = r.systolicBP == null ? null : r.systolicBP >= 140 ? '#ef4444' : r.systolicBP >= 130 ? '#f97316' : r.systolicBP >= 120 ? '#f97316' : '#10b981'
    return { time, dateLabel, hrv: r.hrv, stress: r.stress, spo2: r.spo2, hrvColor, spo2Color, stressColor, bpStr, bpColor, breathRate: r.breathRate ?? null }
  })
}

function _isPrivacyError(e) {
  const msg = e?.message || e?.errMsg || ''
  return msg.includes('privacy api banned') || msg.includes('privacy')
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

// ref ranges: [low, high, higherIsBetter]
const BIO_REF = {
  hsCRP:          [null, 1.0,   false],
  IL6:            [null, 3.0,   false],
  GDF15:          [null, 750,   false],
  GA:             [11.0, 15.0,  false],
  CystatinC:      [0.51, 0.95,  false],
  HbA1c:          [null, 5.7,   false],
  FPG:            [3.9,  6.1,   false],
  Triglycerides:  [null, 1.7,   false],
  ALT:            [null, 40,    false],
  AST:            [null, 40,    false],
  GGT:            [null, 50,    false],
  TSH:            [0.35, 4.5,   false],
  TotalCholesterol:[null, 5.2,  false],
  LDL:            [null, 3.4,   false],
  HDL:            [1.0,  null,  true ],
  Creatinine:     [53,   115,   false],
  eGFR:           [90,   null,  true ],
  BUN:            [1.7,  8.3,   false],
  UricAcid:       [null, 416,   false],
  CRP:            [null, 10,    false],
  VitaminD:       [50,   150,   false],
  WBC:            [4.0,  10.0,  false],
  Ferritin:       [13,   150,   false],
  Hemoglobin:     [115,  175,   false],
}

const REF_DISPLAY = {
  hsCRP: '< 1.0 mg/L', IL6: '< 3.0 pg/mL', GDF15: '< 750 pg/mL',
  GA: '11–15 %', CystatinC: '0.51–0.95 mg/L', HbA1c: '< 5.7 %',
  FPG: '3.9–6.1 mmol/L', Triglycerides: '< 1.7 mmol/L',
  ALT: '< 40 U/L', AST: '< 40 U/L', GGT: '< 50 U/L',
  TSH: '0.35–4.5 mIU/L', TotalCholesterol: '< 5.2 mmol/L',
  LDL: '< 3.4 mmol/L', HDL: '> 1.0 mmol/L',
  Creatinine: '53–115 μmol/L', eGFR: '> 90', BUN: '1.7–8.3 mmol/L',
  UricAcid: '< 416 μmol/L', CRP: '< 10 mg/L', VitaminD: '50–150 nmol/L',
  WBC: '4–10 ×10⁹/L', Ferritin: '13–150 μg/L', Hemoglobin: '115–175 g/L',
}

function _bioStatus(keyName, value) {
  if (value == null || !keyName) return 'normal'
  const ref = BIO_REF[keyName]
  if (!ref) return 'normal'
  const [lo, hi, higherBetter] = ref
  const v = parseFloat(value)
  if (higherBetter) {
    if (lo != null && v < lo) return 'low'
    return 'normal'
  }
  if (hi != null && v > hi) return 'high'
  if (lo != null && v < lo) return 'low'
  return 'normal'
}

function _refText(keyName) {
  return REF_DISPLAY[keyName] || ''
}

// Maps legacy (US-unit, snake_case) lab keys → catalog key_name for status lookup
const LEGACY_KEY_MAP = {
  ldl: 'LDL', hdl: 'HDL', alt: 'ALT', ast: 'AST', tsh: 'TSH',
  hba1c: 'HbA1c', ferritin: 'Ferritin', uric_acid: 'UricAcid',
  vitamin_d: 'VitaminD', creatinine: 'Creatinine',
  triglycerides: 'Triglycerides', glucose_fasting: 'FPG',
  total_cholesterol: 'TotalCholesterol', hsCRP: 'hsCRP', il6: 'IL6',
}

// Display label overrides for compact rendering
const LAB_DISPLAY_NAME = {
  TotalCholesterol: 'Chol', MicroVascularAge: 'µVasc',
  total_cholesterol: 'Chol', uric_acid: 'UA', glucose_fasting: 'Gluc',
  vitamin_d: 'VitD', vitamin_b12: 'B12',
}

function _buildLabPanel(twin, lang) {
  const labData = twin.latest_lab_data
  const labDate = twin.latest_lab_date
  if (!labData || !labDate) return { labPanel: [], labPanelDate: '', labPanelAbnormal: 0 }

  const labPanelDate = fmtDate(labDate, lang || 'zh')
  const items = []

  if (labData.markers) {
    // New aggregated format: { markers: { LDL: { value, unit }, ... } }
    for (const [key, info] of Object.entries(labData.markers)) {
      const v = parseFloat(info.value)
      const status = _bioStatus(key, v)
      const statusColor = status === 'high' ? '#ef4444' : status === 'low' ? '#60a5fa' : '#10b981'
      items.push({ key, displayName: LAB_DISPLAY_NAME[key] || key, value: String(v), unit: info.unit || '', status, statusColor })
    }
  } else if (labData.results) {
    // Legacy format: { results: { ldl: { value, unit, ref_high, ref_low }, ... } }
    for (const [legacyKey, info] of Object.entries(labData.results)) {
      const catalogKey = LEGACY_KEY_MAP[legacyKey] || legacyKey
      const v = parseFloat(info.value)
      // Use embedded ref ranges for legacy US-unit data
      let status = 'normal'
      if (info.ref_high != null && v > info.ref_high) status = 'high'
      else if (info.ref_low != null && v < info.ref_low) status = 'low'
      const statusColor = status === 'high' ? '#ef4444' : status === 'low' ? '#60a5fa' : '#10b981'
      const displayName = LAB_DISPLAY_NAME[legacyKey] || legacyKey.replace(/_/g, ' ')
      items.push({ key: legacyKey, displayName, value: String(v), unit: info.unit || '', status, statusColor })
    }
  }

  // Sort: abnormal first, then alphabetical
  items.sort((a, b) => {
    const aAbn = a.status !== 'normal' ? 0 : 1
    const bAbn = b.status !== 'normal' ? 0 : 1
    return aAbn !== bAbn ? aAbn - bAbn : a.key.localeCompare(b.key)
  })

  const labPanelAbnormal = items.filter(i => i.status !== 'normal').length
  return { labPanel: items, labPanelDate, labPanelAbnormal }
}

function _reportTypeColor(type) {
  if (type === 'annual_checkup') return '#a855f7'
  if (type === 'lab_panel')      return '#0ea5e9'
  if (type === 'imaging')        return '#14b8a6'
  return '#6375EC'
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
    isZh: true,
    bioLoading: true,
    bAge: null,
    cAge: null,
    bAgeColor: '#A6C4E5',
    subAgeList: [],
    subAgeZ: {},
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
    bmiHistory: [],
    bmiChartOpen: false,
    bmiChartW: 300,
    stepsHistory: [],
    stepsChartOpen: false,
    stepsChartW: 300,
    hrvHistory: [],
    hrvChartOpen: false,
    hrvChartW: 300,
    stressHistory: [],
    stressChartOpen: false,
    stressChartW: 300,
    bpHistory: [],
    bpChartOpen: false,
    bpChartW: 300,
    latestBp: null,
    glucoseHistory: [],
    glucoseChartOpen: false,
    glucoseChartW: 300,
    latestGlucose: null,
    bioAgeHistory: [],
    bioAgeChartW: 0,
    bioAgeTrendOpen: false,
    flashSubAge: '',
    healthConditionsList: [],
    hasConditionsData: false,
    avatarUpdating: false,
    avatarLetter: 'U',
    avatarPillsVisible: false,
    rawHeight: null,
    rawWeight: null,
    rawBmi: null,
    editing: false,
    editSaving: false,
    editOtherSelected: false,
    editForm: {
      nickname: '', gender: '', birth_date: '',
      height: '', weight: '',
      health_conditions: [], health_conditions_other: '',
    },
    editConditionOptions: [],
    // Health reports
    healthReports: [],
    reportsLoading: false,
    activeReport: null,
    activeReportEvents: [],
    activeReportDiag: [],
    activeReportAdvice: [],
    activeReportDoctorNotes: null,
    reportDetailLoading: false,
    // Health tags (populated from /api/health-twin response)
    healthTags: [],
    // Lab panel (from digital twin)
    labPanel: [],
    labPanelDate: '',
    labPanelAbnormal: 0,
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
    // Wearable device
    wearableId: '',
    wearableName: '',
    wearableBrand: '',   // 'x3' | 'colmi'
    wearableConnected: false,
    wearableBattery: 0,
    wearableBusy: false,
    ringMeasuring: false,
    showPrivacyPopup: false,
    ringSettingsOpen: false,
    ringSettingsBusy: false,
    ringData: null,
    // X3 background-measurement intervals (minutes per metric type)
    x3Intervals: { hr: 10, spo2: 30, temp: 30, hrv: 60 },
    x3IntervalOpts: { hr: [5, 10, 15, 30], spo2: [5, 15, 30, 60], temp: [15, 30, 60], hrv: [30, 60, 120] },
    x3IntervalsChanged: false,
  },

  observers: {
    'userId': function(newId) {
      if (newId) this._loadHealth()
    },
    'lang': function(newLang) {
      const isZh = newLang !== 'en'
      this.setData({ t: T[newLang] || T.zh, isZh })
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
      this.setData({ t: T[lang] || T.zh, isZh: lang !== 'en' })
      const user = this.properties.user
      if (user) {
        const letter = (user.nickname || 'U').slice(-1).toUpperCase()
        this.setData({ avatarLetter: letter })
      }
      if (this.properties.userId) this._loadHealth()
      this._loadWearableFromStorage()

      // Register with app so onNeedPrivacyAuthorization can notify this component
      const _app = getApp()
      _app._onPrivacyRequest = () => this.setData({ showPrivacyPopup: true })
    },
    detached() {
      const _app = getApp()
      if (_app._onPrivacyRequest) _app._onPrivacyRequest = null
    },
  },

  methods: {
    refresh() {
      this._loadHealth()
    },

    async _loadHealth() {
      const { userId, user, lang, mode } = this.properties
      if (!userId) return
      const rawT = T[lang] || T.zh
      const channelOverrides = app.globalData.channel?.sub_age_display_names || null
      const t = { ...rawT, subAgeLabels: buildSubAgeLabels(rawT.subAgeLabels, channelOverrides, lang) }
      this.setData({ bioLoading: true })
      this._loadHealthTwin()
      this._loadHealthReports()
      this._loadMetricHistory()
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
                color,
                value: valStr,
                score,
              }
            })
          : []

        const _baDateMap = new Map()
        kinoRecords.forEach(r => {
          if (r.bio_age != null) {
            const d = (r.tested_at || '').substring(0, 10)
            _baDateMap.set(d, r)
          }
        })
        const bioAgeHistory = [..._baDateMap.values()]
          .sort((a, b) => (a.tested_at < b.tested_at ? -1 : 1))
          .map(r => ({
            date: (r.tested_at || '').substring(0, 10),
            bioAge: Number(r.bio_age),
            chronoAge: r.data?.bioage_profile?.ChronoAge ?? null,
          }))
        const bioAgeChartW = Math.round(wx.getSystemInfoSync().windowWidth * 330 / 750)

        const rawBioAge = latestAnalyzed?.bio_age ?? (kinoRecords.length > 0 ? kinoRecords[kinoRecords.length - 1]?.bio_age : null) ?? user?.bio_age
        const bAge = rawBioAge ? Number(rawBioAge).toFixed(1) : null

        const slMap = {}
        subAgeList.forEach(s => { slMap[s.key] = s })
        const subAgeZ = {}
        for (const { key } of SUB_AGE_META) {
          const sa = slMap[key]
          const score = sa?.score ?? 50
          const color = !sa ? '#2a3550' : score >= 60 ? '#10b981' : score >= 35 ? '#6375EC' : '#f97316'
          const alpha = !sa ? 0.2 : score >= 60 ? 0.16 : score >= 35 ? 0.22 : 0.35
          const n = parseInt(color.slice(1), 16)
          const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
          subAgeZ[key] = { color, fill: `rgba(${r},${g},${b},${alpha})`, glow: score < 35 ? 14 : 6, pulse: !!sa }
        }

        const newData = {
          bioLoading: false,
          subAgeList, subAgeZ, bmList, trendList,
          cAge, bAge,
          bAgeColor: bioAgeColor(rawBioAge, cAge),
          recordCount: kinoRecords.length,
          hasBm: latestBm !== null,
          bioAgeHistory, bioAgeChartW,
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

          const bmiHistory = (heightVal != null && heightVal > 0)
            ? weightHistory.map(r => ({
                date: r.date,
                bmi: parseFloat((r.weight / Math.pow(heightVal / 100, 2)).toFixed(1)),
              }))
            : []

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
            bmiHistory,
            profileInfoVisible, profileInfoExtra,
            healthConditionsList,
            hasConditionsData: condKeys !== null,
            rawHeight: heightVal,
            rawWeight: weightVal,
            rawBmi: bmiVal,
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



    _drawBioAgeChart() {
      const { bioAgeHistory, bioAgeChartW, bAge, cAge, bAgeColor, t } = this.data
      if (!bioAgeChartW) return
      const W = bioAgeChartW, H = 200
      const headerH = 62
      const pL = 28, pR = 10, pT = headerH + 12, pB = 24
      const plotW = W - pL - pR, plotH = H - pT - pB

      const ctx = wx.createCanvasContext('dt-bioage-chart', this)
      ctx.clearRect(0, 0, W, H)
      ctx.setFillStyle('#0a1228')
      ctx.fillRect(0, 0, W, H)

      // ── Header: BioAge (left) + ChronoAge (right) ──
      ctx.setTextAlign('left')
      ctx.setFontSize(30)
      ctx.setFillStyle(bAgeColor || '#6375EC')
      ctx.fillText(bAge || '—', 14, 34)
      ctx.setFontSize(10)
      ctx.setFillStyle('rgba(166,196,229,0.55)')
      ctx.fillText((t.bioAge || 'Bio Age').toUpperCase(), 14, 52)

      ctx.setTextAlign('right')
      ctx.setFontSize(22)
      ctx.setFillStyle('rgba(166,196,229,0.75)')
      ctx.fillText(cAge || '—', W - 14, 32)
      ctx.setFontSize(10)
      ctx.setFillStyle('rgba(166,196,229,0.45)')
      ctx.fillText((t.chronoAge || 'Chrono Age').toUpperCase(), W - 14, 52)


      // Separator
      ctx.beginPath()
      ctx.setStrokeStyle('rgba(99,117,236,0.18)')
      ctx.setLineWidth(0.5)
      ctx.moveTo(0, headerH); ctx.lineTo(W, headerH)
      ctx.stroke()

      // Rounded-rect border drawn on canvas (CSS border is hidden under native canvas layer)
      const cr = 11
      const drawGlowBorder = () => {
        const rrPath = (inset, r) => {
          const x = inset, y = inset, w = W - inset * 2, h = H - inset * 2
          ctx.beginPath()
          ctx.moveTo(x + r, y)
          ctx.lineTo(x + w - r, y)
          ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0)
          ctx.lineTo(x + w, y + h - r)
          ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2)
          ctx.lineTo(x + r, y + h)
          ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI)
          ctx.lineTo(x, y + r)
          ctx.arc(x + r, y + r, r, Math.PI, 3 * Math.PI / 2)
          ctx.closePath()
        }
        rrPath(4, cr - 3); ctx.setStrokeStyle('rgba(99,117,236,0.10)'); ctx.setLineWidth(10); ctx.stroke()
        rrPath(2, cr - 1); ctx.setStrokeStyle('rgba(99,117,236,0.22)'); ctx.setLineWidth(5);  ctx.stroke()
        rrPath(1, cr);     ctx.setStrokeStyle('rgba(99,117,236,0.60)'); ctx.setLineWidth(1.5); ctx.stroke()
      }

      if (bioAgeHistory.length < 2) { drawGlowBorder(); ctx.draw(); return }

      const bioAges = bioAgeHistory.map(r => r.bioAge)
      const allVals = [...bioAges]
      bioAgeHistory.forEach(r => { if (r.chronoAge != null) allVals.push(r.chronoAge) })
      const minV = Math.floor(Math.min(...allVals)) - 2
      const maxV = Math.ceil(Math.max(...allVals)) + 2
      const range = maxV - minV || 1

      const toX = i => pL + (i / Math.max(bioAgeHistory.length - 1, 1)) * plotW
      const toY = v => pT + ((maxV - v) / range) * plotH
      const pts = bioAgeHistory.map((r, i) => ({ x: toX(i), y: toY(r.bioAge) }))

      // Filled area
      ctx.beginPath()
      ctx.setFillStyle('rgba(99,117,236,0.22)')
      ctx.moveTo(pts[0].x, pT + plotH)
      pts.forEach(p => ctx.lineTo(p.x, p.y))
      ctx.lineTo(pts[pts.length - 1].x, pT + plotH)
      ctx.closePath(); ctx.fill()

      // ChronoAge dashed reference
      const cPts = bioAgeHistory.map((r, i) => r.chronoAge != null ? { x: toX(i), y: toY(r.chronoAge) } : null).filter(Boolean)
      for (let i = 0; i < cPts.length - 1; i++) {
        const x1 = cPts[i].x, y1 = cPts[i].y, x2 = cPts[i + 1].x, y2 = cPts[i + 1].y
        const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
        let d = 0
        while (d < len) {
          const t1 = d / len, t2 = Math.min((d + 3) / len, 1)
          ctx.beginPath()
          ctx.setStrokeStyle('rgba(166,196,229,0.28)')
          ctx.setLineWidth(1)
          ctx.moveTo(x1 + t1 * (x2 - x1), y1 + t1 * (y2 - y1))
          ctx.lineTo(x1 + t2 * (x2 - x1), y1 + t2 * (y2 - y1))
          ctx.stroke()
          d += 6
        }
      }

      // BioAge line
      ctx.beginPath()
      ctx.setStrokeStyle('#6375EC')
      ctx.setLineWidth(2)
      ctx.moveTo(pts[0].x, pts[0].y)
      pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
      ctx.stroke()

      // Dots
      ctx.setFillStyle('#6375EC')
      ctx.setStrokeStyle('rgba(10,15,30,0.9)')
      ctx.setLineWidth(1.5)
      pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke() })

      // X-axis labels
      const step = Math.max(1, Math.floor(bioAgeHistory.length / 4))
      ctx.setFontSize(9)
      ctx.setFillStyle('rgba(166,196,229,0.45)')
      ctx.setTextAlign('center')
      bioAgeHistory.forEach((r, i) => {
        if (i % step === 0 || i === bioAgeHistory.length - 1)
          ctx.fillText(r.date.substring(5), pts[i].x, H - pB + 14)
      })

      // Y-axis labels
      ctx.setTextAlign('right')
      ctx.fillText(maxV, pL - 4, pT + 9)
      ctx.fillText(minV, pL - 4, pT + plotH + 4)

      drawGlowBorder()
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

    toggleBioAgeTrend() {
      const open = !this.data.bioAgeTrendOpen
      if (!open) {
        const ctx = wx.createCanvasContext('dt-bioage-chart', this)
        ctx.clearRect(0, 0, 9999, 9999)
        ctx.draw()
      }
      this.setData({ bioAgeTrendOpen: open }, () => {
        if (open && this.data.bioAgeHistory.length > 1) {
          setTimeout(() => this._drawBioAgeChart(), 50)
        }
      })
    },

    onAvatarTap() {
      if (this._avatarPillTimer) clearTimeout(this._avatarPillTimer)
      this.setData({ avatarPillsVisible: true })
      this._avatarPillTimer = setTimeout(() => {
        this.setData({ avatarPillsVisible: false })
        this._avatarPillTimer = null
      }, 5000)
    },

    onEditProfilePill() {
      if (this._avatarPillTimer) { clearTimeout(this._avatarPillTimer); this._avatarPillTimer = null }
      this.setData({ avatarPillsVisible: false })
      this.startEdit()
    },

    onZoneTap(e) {
      const key = e.currentTarget.dataset.key
      if (!key || this.data.bioAgeTrendOpen) return
      this.setData({ flashSubAge: key })
      setTimeout(() => this.setData({ flashSubAge: '' }), 1400)
    },

    closeBioAgeTrend() {
      if (this.data.bioAgeTrendOpen) {
        const ctx = wx.createCanvasContext('dt-bioage-chart', this)
        ctx.clearRect(0, 0, 9999, 9999)
        ctx.draw()
        this.setData({ bioAgeTrendOpen: false })
      }
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

    async _loadMetricHistory() {
      const { userId } = this.properties
      if (!userId) return
      try {
        const res = await this._req(`${BASE}/api/health-events?openid=${encodeURIComponent(userId)}&limit=60`)
        const events = res.data?.events || []
        const seenSteps = new Set(), seenHrv = new Set(), seenStress = new Set()
        const seenBp = new Set(), seenGlucose = new Set()
        const stepsHistory = [], hrvHistory = [], stressHistory = [], bpHistory = [], glucoseHistory = []
        for (const ev of events) {
          const date = (ev.data_date || '').substring(0, 10)
          if (!date) continue
          const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data
          if (ev.category === 'activity' && !seenSteps.has(date) && d?.steps != null) {
            stepsHistory.push({ date, steps: d.steps }); seenSteps.add(date)
          } else if (ev.category === 'vitals') {
            if (!seenHrv.has(date) && d?.hrv_ms != null) {
              hrvHistory.push({ date, hrv: d.hrv_ms }); seenHrv.add(date)
            }
            if (!seenStress.has(date) && d?.stress != null) {
              stressHistory.push({ date, stress: d.stress }); seenStress.add(date)
            }
            if (!seenBp.has(date) && d?.bp_systolic != null && d?.bp_diastolic != null) {
              bpHistory.push({ date, systolic: d.bp_systolic, diastolic: d.bp_diastolic, pulse: d.bp_pulse || null })
              seenBp.add(date)
            }
            if (!seenGlucose.has(date) && d?.glucose_mmol != null) {
              glucoseHistory.push({ date, glucose: d.glucose_mmol }); seenGlucose.add(date)
            }
          }
        }
        const bpHistoryRev = bpHistory.reverse()
        const glucoseHistoryRev = glucoseHistory.reverse()
        this.setData({
          stepsHistory:   stepsHistory.reverse(),
          hrvHistory:     hrvHistory.reverse(),
          stressHistory:  stressHistory.reverse(),
          bpHistory:      bpHistoryRev,
          latestBp:       bpHistoryRev.length ? bpHistoryRev[bpHistoryRev.length - 1] : null,
          glucoseHistory: glucoseHistoryRev,
          latestGlucose:  glucoseHistoryRev.length ? glucoseHistoryRev[glucoseHistoryRev.length - 1] : null,
        })
      } catch (e) { /* non-critical */ }
    },

    _drawGenericChart(canvasId, history, valKey, unit, color) {
      const W = wx.getSystemInfoSync().windowWidth - 72
      const H = 200, pL = 44, pR = 16, pT = 20, pB = 44
      const plotW = W - pL - pR, plotH = H - pT - pB
      const vals = history.map(r => r[valKey])
      const minV = Math.floor(Math.min(...vals))
      const maxV = Math.ceil(Math.max(...vals))
      const range = maxV - minV || 1
      const toX = i => pL + (i / Math.max(history.length - 1, 1)) * plotW
      const toY = v => pT + ((maxV - v) / range) * plotH
      const pts = history.map((r, i) => ({ x: toX(i), y: toY(r[valKey]) }))
      const ctx = wx.createCanvasContext(canvasId, this)
      ctx.clearRect(0, 0, W, H)
      const hex = parseInt(color.replace('#', ''), 16)
      const [cr, cg, cb] = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
      for (let i = 0; i <= 4; i++) {
        const y = pT + (i / 4) * plotH
        const val = maxV - (i / 4) * range
        ctx.setStrokeStyle('rgba(99,117,236,0.12)'); ctx.setLineWidth(0.5)
        ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pL + plotW, y); ctx.stroke()
        ctx.setFillStyle('rgba(166,196,229,0.45)'); ctx.setFontSize(10)
        ctx.fillText(Number.isInteger(val) ? val : val.toFixed(1), 0, y + 4)
      }
      ctx.beginPath(); ctx.setFillStyle(`rgba(${cr},${cg},${cb},0.1)`)
      ctx.moveTo(pts[0].x, pT + plotH)
      pts.forEach(p => ctx.lineTo(p.x, p.y))
      ctx.lineTo(pts[pts.length - 1].x, pT + plotH)
      ctx.closePath(); ctx.fill()
      ctx.beginPath(); ctx.setStrokeStyle(color); ctx.setLineWidth(2)
      ctx.moveTo(pts[0].x, pts[0].y)
      pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
      ctx.stroke()
      const labelStep = Math.max(1, Math.floor(history.length / 5))
      ctx.setFontSize(10); ctx.setFillStyle('rgba(166,196,229,0.5)')
      history.forEach((r, i) => {
        if (i % labelStep === 0 || i === history.length - 1)
          ctx.fillText(r.date.substring(5), pts[i].x - 14, H - pB + 16)
      })
      ctx.setFillStyle('#EEF2FF'); ctx.setStrokeStyle(color); ctx.setLineWidth(1.5)
      pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke() })
      ctx.setStrokeStyle('rgba(99,117,236,0.3)'); ctx.setLineWidth(1)
      ctx.beginPath(); ctx.moveTo(pL, pT); ctx.lineTo(pL, pT + plotH); ctx.lineTo(pL + plotW, pT + plotH); ctx.stroke()
      ctx.draw()
    },

    openBmiChart() {
      const W = wx.getSystemInfoSync().windowWidth - 72
      this.setData({ bmiChartOpen: true, bmiChartW: W }, () => {
        this._drawGenericChart('uh-bmi-chart', this.data.bmiHistory, 'bmi', '', '#6375EC')
      })
    },
    closeBmiChart() { this.setData({ bmiChartOpen: false }) },

    openStepsChart() {
      const W = wx.getSystemInfoSync().windowWidth - 72
      this.setData({ stepsChartOpen: true, stepsChartW: W }, () => {
        this._drawGenericChart('uh-steps-chart', this.data.stepsHistory, 'steps', '', '#0ea5e9')
      })
    },
    closeStepsChart() { this.setData({ stepsChartOpen: false }) },

    openHrvChart() {
      const W = wx.getSystemInfoSync().windowWidth - 72
      this.setData({ hrvChartOpen: true, hrvChartW: W }, () => {
        this._drawGenericChart('uh-hrv-chart', this.data.hrvHistory, 'hrv', 'ms', '#10b981')
      })
    },
    closeHrvChart() { this.setData({ hrvChartOpen: false }) },

    openStressChart() {
      const W = wx.getSystemInfoSync().windowWidth - 72
      this.setData({ stressChartOpen: true, stressChartW: W }, () => {
        this._drawGenericChart('uh-stress-chart', this.data.stressHistory, 'stress', '', '#f97316')
      })
    },
    closeStressChart() { this.setData({ stressChartOpen: false }) },

    openBpChart() {
      const W = wx.getSystemInfoSync().windowWidth - 72
      this.setData({ bpChartOpen: true, bpChartW: W }, () => { this._drawBpChart(W) })
    },
    closeBpChart() { this.setData({ bpChartOpen: false }) },

    _drawBpChart(W) {
      const { bpHistory } = this.data
      if (bpHistory.length < 1) return
      const H = 200, pL = 44, pR = 16, pT = 20, pB = 44
      const plotW = W - pL - pR, plotH = H - pT - pB
      const allVals = bpHistory.flatMap(r => [r.systolic, r.diastolic])
      const minV = Math.floor(Math.min(...allVals)) - 5
      const maxV = Math.ceil(Math.max(...allVals)) + 5
      const range = maxV - minV || 1
      const toX = i => pL + (i / Math.max(bpHistory.length - 1, 1)) * plotW
      const toY = v => pT + ((maxV - v) / range) * plotH
      const sysPts  = bpHistory.map((r, i) => ({ x: toX(i), y: toY(r.systolic) }))
      const diaPts  = bpHistory.map((r, i) => ({ x: toX(i), y: toY(r.diastolic) }))
      const ctx = wx.createCanvasContext('uh-bp-chart', this)
      ctx.clearRect(0, 0, W, H)
      for (let i = 0; i <= 4; i++) {
        const y = pT + (i / 4) * plotH
        const val = maxV - (i / 4) * range
        ctx.setStrokeStyle('rgba(99,117,236,0.12)'); ctx.setLineWidth(0.5)
        ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pL + plotW, y); ctx.stroke()
        ctx.setFillStyle('rgba(166,196,229,0.45)'); ctx.setFontSize(10)
        ctx.fillText(Math.round(val), 0, y + 4)
      }
      const drawLine = (pts, color) => {
        ctx.beginPath(); ctx.setStrokeStyle(color); ctx.setLineWidth(2)
        ctx.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke()
        ctx.setFillStyle('#EEF2FF'); ctx.setStrokeStyle(color); ctx.setLineWidth(1.5)
        pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke() })
      }
      drawLine(sysPts, '#ef4444')
      drawLine(diaPts, '#6375EC')
      ctx.setFontSize(10); ctx.setFillStyle('rgba(166,196,229,0.5)')
      const labelStep = Math.max(1, Math.floor(bpHistory.length / 5))
      bpHistory.forEach((r, i) => {
        if (i % labelStep === 0 || i === bpHistory.length - 1)
          ctx.fillText(r.date.substring(5), sysPts[i].x - 14, H - pB + 16)
      })
      ctx.setStrokeStyle('rgba(99,117,236,0.3)'); ctx.setLineWidth(1)
      ctx.beginPath(); ctx.moveTo(pL, pT); ctx.lineTo(pL, pT + plotH); ctx.lineTo(pL + plotW, pT + plotH); ctx.stroke()
      ctx.draw()
    },

    openGlucoseChart() {
      const W = wx.getSystemInfoSync().windowWidth - 72
      this.setData({ glucoseChartOpen: true, glucoseChartW: W }, () => {
        this._drawGenericChart('uh-glucose-chart', this.data.glucoseHistory, 'glucose', 'mmol/L', '#a855f7')
      })
    },
    closeGlucoseChart() { this.setData({ glucoseChartOpen: false }) },

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
          rawBmi: (hVal && wVal) ? Number((wVal / Math.pow(hVal / 100, 2)).toFixed(1)) : null,
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

        // Build lab panel from latest_lab_data
        const { labPanel, labPanelDate, labPanelAbnormal } = _buildLabPanel(twin, lang)

        // Tags generated server-side; pick label by language
        const healthTags = (twin.tags || []).map(tag => ({
          ...tag,
          label: isZh ? tag.labelZh : tag.labelEn,
        }))

        // Only use server twin for gauge visuals when no ring data exists.
        // If ring data is present it already populated the gauges with today's readings —
        // overwriting them with server 7-day averages would show stale/mock data.
        const ringData = this.data.ringData
        const serverVisuals = ringData ? {} : this._buildTwinVisuals(twin, t, isZh)

        this.setData({
          twinLoading: false,
          hasTwinData: !ringData ? (metrics.length > 0 || twinBody != null || labPanel.length > 0) : this.data.hasTwinData,
          twinMetrics: metrics,
          twinBody,
          twinCoverage,
          labPanel,
          labPanelDate,
          labPanelAbnormal,
          healthTags,
          ...serverVisuals,
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


      if (twin.avg_systolic_bp != null && twin.avg_diastolic_bp != null) {
        const sys = Math.round(twin.avg_systolic_bp)
        const dia = Math.round(twin.avg_diastolic_bp)
        domainScores.bp = _scoreBp(sys, dia)
        vitalGauges.push({
          key: 'bp', label: isZh ? '血压' : 'Blood Pressure',
          val: `${sys}/${dia}`, unit: 'mmHg',
          score: domainScores.bp, color: '#ef4444',
          trend: '', trendColor: '',
          markerPct: Math.min(97, Math.max(2, Math.round((sys - 80) / 80 * 100))),
          zones: [
            { width: 12, color: '#0ea5e9' },
            { width: 38, color: '#10b981' },
            { width: 12, color: '#f97316' },
            { width: 13, color: '#ef4444' },
            { width: 25, color: '#7f1d1d' },
          ],
          sublabel: isZh ? '最优: <120/80' : 'Optimal: <120/80',
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
      const cardioS   = avg([domainScores.hr, domainScores.spo2, domainScores.bp].filter(v => v != null))
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

    async _loadHealthReports() {
      const { userId } = this.properties
      if (!userId) return
      this.setData({ reportsLoading: true })
      try {
        const res = await this._req(`${BASE}/api/health-reports?openid=${encodeURIComponent(userId)}`)
        const raw = res.data?.reports || []
        const lang = this.properties.lang || 'zh'
        const t = T[lang] || T.zh
        const reports = raw.map(r => ({
          id: r.id,
          institution: r.institution || '—',
          report_date: fmtDate(r.report_date, lang),
          report_type: t.reportTypeLabels[r.report_type] || r.report_type,
          source_label: t.reportSourceLabels[r.source] || r.source,
          type_color: _reportTypeColor(r.report_type),
        }))
        this.setData({ healthReports: reports, reportsLoading: false })
      } catch (_) {
        this.setData({ reportsLoading: false })
      }
    },

    async onReportTap(e) {
      const id = e.currentTarget.dataset.id
      if (!id) return
      const { userId } = this.properties
      const lang = this.properties.lang || 'zh'
      const t = T[lang] || T.zh
      this.setData({ activeReport: { id, loading: true }, activeReportEvents: [], activeReportDiag: [], activeReportAdvice: [], reportDetailLoading: true })
      try {
        const res = await this._req(`${BASE}/api/health-reports/${id}?openid=${encodeURIComponent(userId)}`)
        const report = res.data?.report || {}
        const events = res.data?.events || []
        const raw = report.raw_data || {}
        const enriched = events.map(ev => {
          const d = ev.data || {}
          const v = d.value != null ? d.value : null
          const status = _bioStatus(d.key_name, v)
          return {
            key_name: d.key_name || '—',
            value: v != null ? String(v) : '—',
            unit: d.unit || '',
            status,
            statusLabel: status === 'high' ? t.rptHigh : status === 'low' ? t.rptLow : t.rptNormal,
            statusColor: status === 'high' ? '#ef4444' : status === 'low' ? '#0ea5e9' : '#10b981',
            refText: _refText(d.key_name),
          }
        })
        // Parse doctor_notes format (admin panel / liangkang reports)
        const dnRaw = raw.doctor_notes || null
        let activeReportDoctorNotes = null
        if (dnRaw) {
          const vitals = dnRaw.vital_summary
            ? Object.entries(dnRaw.vital_summary).map(([k, v]) => ({ key: k, value: String(v) }))
            : []
          activeReportDoctorNotes = {
            physician: dnRaw.physician || '',
            department: dnRaw.department || '',
            vitals,
            clinical_summary: dnRaw.clinical_summary || '',
            recommendations: Array.isArray(dnRaw.recommendations) ? dnRaw.recommendations : [],
            follow_up: dnRaw.follow_up || '',
          }
        }
        const activeReport = {
          id,
          institution: report.institution || '—',
          report_date: fmtDate(report.report_date, lang),
          report_type: t.reportTypeLabels[report.report_type] || report.report_type,
          type_color: _reportTypeColor(report.report_type),
          hasDiag: Array.isArray(raw.diagnostics) && raw.diagnostics.length > 0,
          hasAdvice: Array.isArray(raw.doctor_advice) && raw.doctor_advice.length > 0,
          hasDoctorNotes: !!activeReportDoctorNotes,
          loading: false,
        }
        this.setData({
          activeReport,
          activeReportEvents: enriched,
          activeReportDiag: raw.diagnostics || [],
          activeReportAdvice: raw.doctor_advice || [],
          activeReportDoctorNotes,
          reportDetailLoading: false,
        })
      } catch (_) {
        this.setData({ reportDetailLoading: false })
      }
    },

    onCloseReport() {
      this.setData({ activeReport: null, activeReportEvents: [], activeReportDiag: [], activeReportAdvice: [], activeReportDoctorNotes: null })
    },

    // --- Wearable (Smart Ring) ---

    _loadWearableFromStorage() {
      try {
        const saved = wx.getStorageSync('wearable_device')
        if (saved && saved.deviceId) {
          const fallbackName = saved.brand === 'x3' ? 'X3 Ring' : saved.brand === 'aizo' ? 'Aizo Ring' : 'Colmi Ring'
          const x3Saved = wx.getStorageSync('x3_interval_settings')
          const x3Intervals = x3Saved ? { ...this.data.x3Intervals, ...x3Saved } : this.data.x3Intervals
          this.setData({ wearableId: saved.deviceId, wearableName: saved.name || fallbackName, wearableConnected: false, wearableBrand: saved.brand || 'colmi', x3Intervals })
        }
        const rawRing = wx.getStorageSync('wearable_ring_data')
        if (rawRing && rawRing.syncedAt) {
          const lang = this.properties.lang || 'zh'
          const isZh = lang !== 'en'
          const _rawReads = rawRing.hrvSlots != null
            ? _slotsToReadings(rawRing.hrvSlots, rawRing.spo2Slots)
            : _getRealtimeReadings(rawRing.syncedAt)
          const realtimeReadings = _fmtRealtimeReadings(_rawReads)
          const ringData = { ..._buildRingDisplayData(rawRing, isZh), realtimeReadings, hasRealtimeReadings: realtimeReadings.length > 0 }
          const virtualTwin = {
            avg_daily_steps: rawRing.steps,
            avg_sleep_hours: rawRing.sleepMinutes != null ? rawRing.sleepMinutes / 60 : null,
            avg_resting_hr:  rawRing.restingHr,
            avg_hrv_ms:      rawRing.hrv,
            avg_spo2:        rawRing.spo2 ?? null,
            latest_bmi: null, trend_data: {},
          }
          const visuals = this._buildTwinVisuals(virtualTwin, T[isZh ? 'zh' : 'en'], isZh)
          this.setData({
            ringData,
            hasTwinData: visuals.vitalGauges.length > 0,
            twinLoading: false,
            ...visuals,
          })
        }
      } catch (_) {}
    },

    onPrivacyAgree(e) {
      const _app = getApp()
      if (_app._privacyResolve) {
        _app._privacyResolve({ event: e, buttonId: 'privacy-agree-btn' })
        _app._privacyResolve = null
      }
      this.setData({ showPrivacyPopup: false })
      if (this._privacyDone) { this._privacyDone(true); this._privacyDone = null }
    },

    onPrivacyCancel() {
      const _app = getApp()
      if (_app._privacyResolve) {
        _app._privacyResolve({ event: null })
        _app._privacyResolve = null
      }
      this.setData({ showPrivacyPopup: false })
      if (this._privacyDone) { this._privacyDone(false); this._privacyDone = null }
    },

    async handleBindWearable() {
      if (this.data.wearableBusy) return
      const t = this.data.t
      this.setData({ wearableBusy: true })
      try {
        const { BLEManager } = require('../../utils/wearable/ble-manager.js')
        const { COLMI_NAME_PREFIXES } = require('../../utils/wearable/colmi/protocol.js')
        const { X3_NAME_PREFIXES } = require('../../utils/wearable/x3/protocol.js')
        const { BLE_SERVICE_UUID: AIZO_SVC_UUID, AIZO_NAME_PREFIXES } = require('../../utils/wearable/aizo/protocol.js')
        const { createWearable } = require('../../utils/wearable/index.js')
        const ALL_PREFIXES = [...COLMI_NAME_PREFIXES, ...X3_NAME_PREFIXES]
        const AIZO_SVC_NORM = AIZO_SVC_UUID.replace(/-/g, '').toLowerCase()

        // Open BLE adapter — this prompts the user to enable Bluetooth if off
        const mgr = new BLEManager()
        await mgr.openAdapter()

        // Scan with live updates every second so the user sees progress
        const found = new Map()
        wx.showLoading({ title: t.wearableScanning, mask: false })

        await new Promise((resolve) => {
          wx.onBluetoothDeviceFound((res) => {
            for (const d of res.devices) {
              const name = d.name || d.localName || ''
              const nameLower = name.toLowerCase()
              const advUUIDs  = (d.advertisServiceUUIDs || []).map(u => u.replace(/-/g, '').toLowerCase())
              const isAizoSvc  = advUUIDs.includes(AIZO_SVC_NORM)
              const isAizoName = nameLower && AIZO_NAME_PREFIXES.some((p) => nameLower.startsWith(p.toLowerCase()))
              const isAizo     = isAizoSvc || isAizoName
              const isNamed    = nameLower && ALL_PREFIXES.some((p) => nameLower.startsWith(p.toLowerCase()))
              if (!isAizo && !isNamed) continue
              const brand = isAizo ? 'aizo' : (nameLower.startsWith('x3') ? 'x3' : 'colmi')
              found.set(d.deviceId, { deviceId: d.deviceId, name: name || (brand === 'aizo' ? 'Aizo Ring' : brand === 'x3' ? 'X3 Ring' : 'Colmi Ring'), rssi: d.RSSI, brand })
            }
          })
          wx.startBluetoothDevicesDiscovery({
            allowDuplicatesKey: false,
            success: () => setTimeout(() => {
              wx.stopBluetoothDevicesDiscovery({})
              wx.offBluetoothDeviceFound()
              resolve()
            }, 6000),
            fail: () => resolve(),
          })
        })

        wx.hideLoading()
        const devices = Array.from(found.values())

        if (!devices.length) {
          wx.showToast({ title: t.wearableNoDevices, icon: 'none', duration: 3000 })
          this.setData({ wearableBusy: false })
          return
        }

        // Show device picker (action sheet)
        const chosen = await new Promise((resolve, reject) => {
          wx.showActionSheet({
            itemList: devices.map((d) => `${d.name}  (RSSI ${d.rssi})`),
            success: (res) => resolve(devices[res.tapIndex]),
            fail: reject,
          })
        })

        wx.showLoading({ title: t.wearableConnecting, mask: true })
        const brand = chosen.brand
        const ring = createWearable(brand)
        await ring.connect(chosen.deviceId, { syncTime: true, name: chosen.name })
        const battery = await ring.getBattery()
        await ring.disconnect()
        wx.hideLoading()

        const saved = { deviceId: chosen.deviceId, name: chosen.name, brand }
        wx.setStorageSync('wearable_device', saved)
        this.setData({
          wearableId: chosen.deviceId,
          wearableName: chosen.name,
          wearableBrand: brand,
          wearableConnected: true,
          wearableBattery: battery.level,
          wearableBusy: false,
        })
      } catch (e) {
        wx.hideLoading()
        console.error('[BLE][bind]', e?.message || e?.errMsg || e)
        if (!_isPrivacyError(e)) wx.showToast({ title: t.wearableConnectFail, icon: 'none', duration: 2500 })
        this.setData({ wearableBusy: false })
      }
    },

    async handleSyncWearable() {
      if (this.data.wearableBusy || !this.data.wearableId) return
      const t = this.data.t
      const lang = this.properties.lang || 'zh'
      const isZh = lang !== 'en'
      this.setData({ wearableBusy: true, ringMeasuring: false })
      const { createWearable } = require('../../utils/wearable/index.js')
      const _savedDev = wx.getStorageSync('wearable_device') || {}
      const brand = _savedDev.brand || 'colmi'
      const ring = createWearable(brand)

      // ── X3: single-phase sync — all data is historical, no real-time measurement needed ──
      if (brand === 'x3') {
        try {
          wx.showLoading({ title: t.wearableConnecting, mask: true })
          await ring.connect(this.data.wearableId)
          // Apply background measurement intervals (silently, failures are non-fatal)
          const _ivals = this.data.x3Intervals
          const _baseOpts = { workMode: 1, startHour: 0, startMinute: 0, endHour: 23, endMinute: 59, weekdays: 0x7F }
          await ring.setAutoMonitoring({ ..._baseOpts, intervalMinutes: _ivals.hr,   type: 1 }).catch(() => {})
          await ring.setAutoMonitoring({ ..._baseOpts, intervalMinutes: _ivals.spo2, type: 2 }).catch(() => {})
          await ring.setAutoMonitoring({ ..._baseOpts, intervalMinutes: _ivals.temp, type: 3 }).catch(() => {})
          await ring.setAutoMonitoring({ ..._baseOpts, intervalMinutes: _ivals.hrv,  type: 4 }).catch(() => {})
          const battery = await ring.getBattery()
          const steps   = await ring.getSteps().catch(() => null)
          const sleep   = await ring.getSleep().catch(() => null)
          const hrLog   = await ring.getHeartRateLog().catch(() => null)
          const hrvLog  = await ring.getHrvHistory().catch(() => [])       // all cached days [{timestamp, hrv, stress, breath, heartRate, highBP, lowBP}]
          const spo2Log = await ring.getAutoSpo2History().catch(() => [])  // all cached days [{timestamp, spo2}]
          await ring.disconnect()
          wx.hideLoading()

          const hrEntries  = (hrLog || []).filter(r => r.value > 0)
          const restingHr  = hrEntries.length ? Math.min(...hrEntries.map(r => r.value)) : null
          const latestHrv  = hrvLog.length  ? hrvLog[hrvLog.length - 1]   : {}
          const latestSpo2 = spo2Log.length ? spo2Log[spo2Log.length - 1] : {}
          const raw = {
            steps:        steps?.steps       ?? null,
            calories:     steps?.calories    ?? null,
            distance:     steps?.distance    ?? null,
            stepSlots:    steps?.slots       ?? null,
            sleepMinutes: (sleep?.totalMinutes > 0) ? sleep.totalMinutes : null,
            sleepDeep:    sleep?.deep        ?? null,
            sleepLight:   sleep?.light       ?? null,
            sleepRem:     sleep?.rem         ?? null,
            sleepAwake:   sleep?.awake       ?? null,
            sleepStart:   sleep?.sleepStart  ?? null,
            sleepEnd:     sleep?.sleepEnd    ?? null,
            sleepSlots:   sleep?.periods?.map(p => ({ type: p.typeName, min: p.minutes })) ?? null,
            hrSlots:         hrEntries.map(r => ({ t: r.timestamp.toISOString(), bpm: r.value })),
            restingHr,
            hrv:             latestHrv.hrv       ?? null,
            stress:          latestHrv.stress    ?? null,
            spo2:            latestSpo2.spo2     ?? null,
            breathRate:      latestHrv.breath    ?? null,
            heartRateFromHrv: latestHrv.heartRate ?? null,
            systolicBP:      latestHrv.highBP   ?? null,
            diastolicBP:     latestHrv.lowBP    ?? null,
            hrvMeasuredAt:   latestHrv.timestamp ?? null,
            hrvSlots:  hrvLog.length  > 0 ? hrvLog  : null,
            spo2Slots: spo2Log.length > 0 ? spo2Log : null,
            syncedAt: Date.now(),
          }
          this._commitRingData(raw, battery.level, isZh, false)
        } catch (e) {
          wx.hideLoading()
          await ring.disconnect().catch(() => {})
          console.error('[BLE][sync:x3]', e?.message || e?.errMsg || e)
          if (!_isPrivacyError(e)) wx.showToast({ title: t.wearableSyncFail, icon: 'none' })
          this.setData({ wearableConnected: false, wearableBusy: false })
        } finally {
          this.setData({ wearableBusy: false, ringMeasuring: false })
        }
        return
      }

      // ── Aizo: single-phase sync — historical data via syncAll() ──
      if (brand === 'aizo') {
        try {
          wx.showLoading({ title: t.wearableConnecting, mask: true })
          const savedDev = wx.getStorageSync('wearable_device') || {}
          await ring.connect(this.data.wearableId, { name: savedDev.name || '' })
          const battery  = await ring.getBattery()
          const snapshot = await ring.syncAll()
          await ring.disconnect()
          wx.hideLoading()
          const raw = {
            steps:        snapshot.steps        ?? null,
            calories:     snapshot.calories     ?? null,
            distance:     snapshot.distance     ?? null,
            stepSlots:    snapshot.stepSlots    ?? null,
            sleepMinutes: (snapshot.sleepMinutes > 0) ? snapshot.sleepMinutes : null,
            sleepDeep:    snapshot.sleepDeep    ?? null,
            sleepLight:   snapshot.sleepLight   ?? null,
            sleepRem:     snapshot.sleepRem     ?? null,
            sleepAwake:   snapshot.sleepAwake   ?? null,
            sleepStart:   snapshot.sleepStart   ?? null,
            sleepEnd:     snapshot.sleepEnd     ?? null,
            sleepSlots:   snapshot.sleepSlots?.map(p => ({ type: p.typeName, min: p.minutes })) ?? null,
            hrSlots:      [],
            restingHr:    null,
            hrv:          null,
            stress:       snapshot.stress       ?? null,
            spo2:         null,
            syncedAt:     Date.now(),
          }
          this._commitRingData(raw, battery.level, isZh, false)
        } catch (e) {
          wx.hideLoading()
          await ring.disconnect().catch(() => {})
          console.error('[BLE][sync:aizo]', e?.message || e?.errMsg || e)
          if (!_isPrivacyError(e)) wx.showToast({ title: t.wearableSyncFail, icon: 'none' })
          this.setData({ wearableConnected: false, wearableBusy: false })
        } finally {
          this.setData({ wearableBusy: false, ringMeasuring: false })
        }
        return
      }

      // ── Colmi: two-phase sync ──
      // Phase 1: connect + read stored data (few seconds, blocking modal)
      let battery, steps, sleep, hrLog
      try {
        wx.showLoading({ title: t.wearableConnecting, mask: true })
        await ring.connect(this.data.wearableId, { name: this.data.wearableName || '' })
        battery = await ring.getBattery()
        steps   = await ring.getSteps().catch(() => null)
        sleep   = await ring.getSleep().catch(() => null)
        hrLog   = await ring.getHeartRateLog().catch(() => null)
        wx.hideLoading()
      } catch (e) {
        wx.hideLoading()
        await ring.disconnect().catch(() => {})
        console.error('[BLE][sync:colmi]', e?.message || e?.errMsg || e)
        if (!_isPrivacyError(e)) wx.showToast({ title: t.wearableSyncFail, icon: 'none' })
        this.setData({ wearableConnected: false, wearableBusy: false })
        return
      }

      // Commit phase-1 data immediately so the user sees results now
      const hrEntries = (hrLog || []).filter(r => r.value > 0)
      const restingHr = hrEntries.length ? Math.min(...hrEntries.map(r => r.value)) : null
      const rawPhase1 = {
        steps:        steps?.steps     ?? null,
        calories:     steps?.calories  ?? null,
        distance:     steps?.distance  ?? null,
        stepSlots:    steps?.slots     ?? null,
        sleepMinutes: (sleep?.totalMinutes > 0) ? sleep.totalMinutes : null,
        sleepDeep:    sleep?.deep      ?? null,
        sleepLight:   sleep?.light     ?? null,
        sleepRem:     sleep?.rem       ?? null,
        sleepAwake:   sleep?.awake     ?? null,
        sleepStart:   sleep?.sleepStart ?? null,
        sleepEnd:     sleep?.sleepEnd   ?? null,
        sleepSlots:   sleep?.periods?.map(p => ({ type: p.typeName, min: p.minutes })) ?? null,
        hrSlots:      hrEntries.map(r => ({ t: r.timestamp.toISOString(), bpm: r.value })),
        restingHr,
        hrv: null, stress: null, spo2: null,
        syncedAt: Date.now(),
      }
      this._commitRingData(rawPhase1, battery.level, isZh, true)

      // Phase 2: HRV + stress + SpO2 (background — no blocking modal)
      this.setData({ wearableBusy: false, ringMeasuring: true })
      try {
        const spo2   = await ring.getRealtime('spo2',      60000).catch(() => null)
        const stress = await ring.getRealtime('pressure',  30000).catch(() => null)
        const hrv    = await ring.getRealtime('hrv',      110000).catch(() => null)
        await ring.disconnect()
        const raw = { ...rawPhase1, hrv: hrv ?? null, stress: stress ?? null, spo2: spo2 ?? null, syncedAt: Date.now() }
        this._commitRingData(raw, battery.level, isZh, false)
      } catch (e) {
        await ring.disconnect().catch(() => {})
      } finally {
        this.setData({ ringMeasuring: false })
      }
    },

    _commitRingData(raw, batteryLevel, isZh, isPartial) {
      wx.setStorageSync('wearable_ring_data', raw)
      const { syncWearableData } = require('../../utils/wearable/sync.js')
      const app = getApp()
      syncWearableData(this.properties.userId, { source: 'smart_ring', ...raw }, app?.globalData?.apiToken).catch(() => {})

      // Accumulate today's realtime (Phase 2) readings for Colmi on-demand measurements.
      // X3 uses ring.hrvSlots / spo2Slots from its auto-monitoring buffer — skip accumulation
      // so repeated syncs don't push the same latest ring reading into the list every time.
      if (!isPartial && !raw.hrvSlots && (raw.hrv != null || raw.stress != null || raw.spo2 != null || raw.systolicBP != null)) {
        const todayStr = _shanghaiDateStr(raw.syncedAt)
        let stored = wx.getStorageSync('wearable_realtime_today') || { date: todayStr, readings: [] }
        if (stored.date !== todayStr) stored = { date: todayStr, readings: [] }
        stored.readings.push({
          t: raw.syncedAt, hrv: raw.hrv, stress: raw.stress, spo2: raw.spo2,
          systolicBP: raw.systolicBP ?? null, diastolicBP: raw.diastolicBP ?? null,
          breathRate: raw.breathRate ?? null,
        })
        wx.setStorageSync('wearable_realtime_today', stored)
      }

      const rawReadings = raw.hrvSlots != null
        ? _slotsToReadings(raw.hrvSlots, raw.spo2Slots)
        : _getRealtimeReadings(raw.syncedAt)
      const realtimeReadings = _fmtRealtimeReadings(rawReadings)
      const ringData = { ..._buildRingDisplayData(raw, isZh), realtimeReadings, hasRealtimeReadings: realtimeReadings.length > 0 }
      const virtualTwin = {
        avg_daily_steps:  raw.steps,
        avg_sleep_hours:  raw.sleepMinutes != null ? raw.sleepMinutes / 60 : null,
        avg_resting_hr:   raw.restingHr,
        avg_hrv_ms:       raw.hrv,
        avg_spo2:         raw.spo2 ?? null,
        latest_bmi: null, trend_data: {},
      }
      const visuals = this._buildTwinVisuals(virtualTwin, T[isZh ? 'zh' : 'en'], isZh)
      this.setData({
        wearableConnected: true,
        wearableBattery: batteryLevel,
        ringData,
        hasTwinData: visuals.vitalGauges.length > 0,
        twinLoading: false,
        ...visuals,
      })
    },

    async toggleRingSettings() {
      if (this.data.ringSettingsOpen) {
        this.setData({ ringSettingsOpen: false, x3IntervalsChanged: false })
        return
      }
      if (this.data.wearableBusy || this.data.ringSettingsBusy) return

      // Non-X3 brands have no interval settings — just open the panel
      if (this.data.wearableBrand !== 'x3') {
        this.setData({ ringSettingsOpen: true })
        return
      }

      this.setData({ ringSettingsOpen: true, ringSettingsBusy: true })
      const { createWearable } = require('../../utils/wearable/index.js')
      const ring = createWearable('x3')
      try {
        await ring.connect(this.data.wearableId)
        const s1 = await ring.getAutoMonitoring(1)
        const s2 = await ring.getAutoMonitoring(2)
        const s3 = await ring.getAutoMonitoring(3)
        const s4 = await ring.getAutoMonitoring(4)
        this.setData({
          x3Intervals: { hr: s1.intervalMinutes, spo2: s2.intervalMinutes, temp: s3.intervalMinutes, hrv: s4.intervalMinutes },
          x3IntervalsChanged: false,
        })
      } catch (_) {
        // fall back to locally cached values silently
      } finally {
        ring.disconnect().catch(() => {})
        this.setData({ ringSettingsBusy: false })
      }
    },

    handleIntervalChange(e) {
      const { type, min } = e.currentTarget.dataset
      this.setData({ x3Intervals: { ...this.data.x3Intervals, [type]: min }, x3IntervalsChanged: true })
    },

    async saveRingIntervals() {
      if (this.data.ringSettingsBusy || this.data.wearableBusy) return
      this.setData({ ringSettingsBusy: true })
      const ivals = this.data.x3Intervals
      const baseOpts = { workMode: 1, startHour: 0, startMinute: 0, endHour: 23, endMinute: 59, weekdays: 0x7F }
      const { createWearable } = require('../../utils/wearable/index.js')
      const ring = createWearable('x3')
      try {
        await ring.connect(this.data.wearableId)
        await ring.setAutoMonitoring({ ...baseOpts, intervalMinutes: ivals.hr,   type: 1 })
        await ring.setAutoMonitoring({ ...baseOpts, intervalMinutes: ivals.spo2, type: 2 })
        await ring.setAutoMonitoring({ ...baseOpts, intervalMinutes: ivals.temp, type: 3 })
        await ring.setAutoMonitoring({ ...baseOpts, intervalMinutes: ivals.hrv,  type: 4 })
        wx.setStorageSync('x3_interval_settings', ivals)
        this.setData({ x3IntervalsChanged: false })
      } catch (e) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'saveRingIntervals failed', err: e?.message }))
        wx.showToast({ title: this.data.t.wearableSyncFail, icon: 'none' })
      } finally {
        ring.disconnect().catch(() => {})
        this.setData({ ringSettingsBusy: false })
      }
    },

    handleUnbindWearable() {
      this.setData({ ringSettingsOpen: false })
      const t = this.data.t
      wx.showModal({
        title: t.wearableUnbind,
        content: this.data.wearableName,
        confirmColor: '#ef4444',
        success: (res) => {
          if (res.confirm) {
            wx.removeStorageSync('wearable_device')
            wx.removeStorageSync('wearable_ring_data')
            wx.removeStorageSync('x3_interval_settings')
            this.setData({ wearableId: '', wearableName: '', wearableBrand: '', wearableConnected: false, wearableBattery: 0, ringData: null })
          }
        },
      })
    },

    noop() {},
  },
})
