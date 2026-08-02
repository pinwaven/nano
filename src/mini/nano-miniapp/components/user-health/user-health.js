const app = getApp()
const { BASE, IS_DEV } = require('../../utils/config.js')
const { computeMood, resolveAvatarUrl, DEFAULT_MOOD } = require('../../utils/mood.js')

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

// health_events.source values that represent a real BP-device reading the user
// supplied themselves. Ring-derived sources (e.g. 'smart_ring') are excluded —
// the Halo ring estimates BP from HRV pulse-wave data, not a cuff, and is not
// accurate until calibrated against an actual BP device.
const USER_UPLOADED_BP_SOURCES = new Set(['manual_photo'])

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

// 'x3' is a legacy brand value from before the X3→Halo rename — still present
// in local storage / server rows for anyone bound before this change shipped.
function _normalizeBrand(brand) {
  return brand === 'x3' ? 'halo' : brand
}

// Halo and V8 share the same auto-monitoring config surface (0x2A/0x2B,
// confirmed identical) and the same single-phase "all historical, no
// realtime measurement" sync shape — see docs/architecture/v8-smart-band.md.
// Colmi and Aizo don't have either.
function _hasIntervalSettings(brand) {
  return brand === 'halo' || brand === 'v8'
}

// --- Sleep session helpers (shared by BLE-live sync, server hydration, and display prep) ---
// A "night" session starts in the 20:00–05:59 window; anything starting 06:00–19:59
// is a daytime nap. onset is a "YYYY-MM-DD HH:MM:SS" string.
function _isNightSession(onset) {
  const hour = parseInt(onset.slice(11, 13), 10)
  return hour >= 20 || hour < 6
}

// Minutes since the most recent noon (0 = noon, 720 = midnight, 1439 = 11:59am next day).
// Matches the noon-to-noon "night" bucket used by halo/index.js's _nightKey, so a session's
// position on a 24h axis lines up with the calendar day it's grouped under.
function _minutesSinceNoon(onset) {
  const hour = parseInt(onset.slice(11, 13), 10)
  const min  = parseInt(onset.slice(14, 16), 10)
  let mins = hour * 60 + min - 12 * 60
  if (mins < 0) mins += 1440
  return mins
}

// A long wake-up in the middle of the night splits one night's sleep into
// multiple discrete session records (see SPLIT_GAP_MINS in halo/index.js).
// Merges them into a single aggregate for the "Last Night" card, inserting a
// synthetic awake slot for the gap so the stage bar shows the time spent
// awake between segments instead of silently skipping it.
function _mergeNightSessions(sessions) {
  const ordered = sessions.slice().sort((a, b) => (a.onset < b.onset ? -1 : 1))
  const first = ordered[0], last = ordered[ordered.length - 1]
  let totalMinutes = 0, deep = 0, light = 0, rem = 0, awake = 0
  const slots = []
  let prevEndMins = null
  for (const s of ordered) {
    totalMinutes += s.totalMinutes || 0
    deep  += s.deep  || 0
    light += s.light || 0
    rem   += s.rem   || 0
    awake += s.awake || 0
    if (s.onset) {
      const startMins = _minutesSinceNoon(s.onset)
      if (prevEndMins != null && startMins > prevEndMins) slots.push({ type: 'awake', min: startMins - prevEndMins })
      prevEndMins = startMins + (s.totalMinutes || 0)
    }
    if (s.slots?.length) slots.push(...s.slots)
  }
  return {
    date: first.date, onset: first.onset,
    totalMinutes, deep, light, rem, awake,
    sleepStart: first.sleepStart, sleepEnd: last.sleepEnd,
    slots: slots.length ? slots : null,
  }
}

// Picks the most recent night's session(s) from a sleepHistory array (oldest
// first, each with a `date` = noon-to-noon night bucket) and merges them so a
// wake-interrupted night is represented as one session. `_isNightSession` is
// only used to pick WHICH date bucket is "last night" (so a trailing daytime
// nap doesn't take it over) — once chosen, every session sharing that date
// bucket is merged in, since a segment resumed after 6am still classifies as
// a "nap" by the hour heuristic even though it's a continuation of that same
// night (see the noon-to-noon bucketing in halo/index.js's _nightKey).
// Falls back to the single most recent session if no night session exists yet.
function _selectLastNight(sleepHistory) {
  if (!sleepHistory.length) return null
  const nightSessions = sleepHistory.filter(s => s.onset && _isNightSession(s.onset))
  if (!nightSessions.length) return sleepHistory[sleepHistory.length - 1]
  const lastDate = nightSessions.reduce((max, s) => (s.date > max ? s.date : max), nightSessions[0].date)
  const group = sleepHistory.filter(s => s.date === lastDate)
  return group.length > 1 ? _mergeNightSessions(group) : group[0]
}

function _dayQualityColor(totalMinutes) {
  return totalMinutes >= 420 ? '#10b981' : totalMinutes >= 360 ? '#0ea5e9' : totalMinutes >= 300 ? '#f97316' : '#ef4444'
}

function _fmtHM(totalMinutes, isZh) {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (isZh) return m > 0 ? `${h}时${m}分` : `${h}时`
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

// Reconstructs per-session sleep blocks from one health_events sleep row.
// Prefers the `sessions` array (added so distinct naps/night segments survive
// the per-date merge in sync.js); falls back to synthesizing a single session
// from the older aggregate-only shape for rows synced before that change.
function _sessionsFromEventData(date, d) {
  if (Array.isArray(d.sessions) && d.sessions.length) {
    return d.sessions.map(s => ({ ...s, date }))
  }
  if (!d.duration_minutes) return []
  let onset = null
  if (d.sleep_start_min != null) {
    const mins = ((d.sleep_start_min % 1440) + 1440) % 1440
    onset = `${date} ${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:00`
  }
  return [{
    date, onset,
    totalMinutes: d.duration_minutes,
    deep: d.deep_minutes ?? null, light: d.light_minutes ?? null, rem: d.rem_minutes ?? null, awake: d.awake_minutes ?? null,
    sleepStart: d.sleep_start_min ?? null, sleepEnd: d.sleep_end_min ?? null,
    slots: d.slots ?? null,
  }]
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
    wearableAlreadyBound: '此账号已绑定：',
    wearableConnected: '已连接',
    wearableDisconnected: '未连接',
    wearableBattery: '电量',
    wearableSyncNow: '立即同步',
    wearableUnbind: '解绑',
    haloSaveIntervals: '保存到戒指',
    haloIntervalLoading: '读取中...',
    wearableScanning: '正在搜索...',
    wearableNoDevices: '未找到设备，请确认戒指或手环已开机',
    wearableConnecting: '正在同步...',
    wearableConnectFail: '连接失败，请重试',
    wearableSyncFail: '智能可穿戴设备同步失败',
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
    haloIntervalTitle: '测量间隔',
    metricHr: '心率', metricSpo2: 'SpO₂', metricTemp: '体温', metricHrv: 'HRV',
    haloIntervalUnit: '分钟',
    haloWorkModeOff: '关闭', haloWorkModeAuto: '自动', haloWorkModeSched: '定时',
    haloRingTimeLabel: '戒指时间',
    ringHrvTrend: 'HRV 趋势', ringSpo2Trend: 'SpO₂ 趋势', ringBodyTemp: '体温',
    ringSleepWeek: '过去7天睡眠', ringNap: '小睡', ringNightSleep: '夜间睡眠', ringSleepNoBlocks: '暂无睡眠记录',
    ringSmoothedNote: '条读数已平滑处理',
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
    wearableAlreadyBound: 'Already bound on this account:',
    wearableConnected: 'Connected',
    wearableDisconnected: 'Disconnected',
    wearableBattery: 'Battery',
    wearableSyncNow: 'Sync Now',
    wearableUnbind: 'Unbind',
    haloSaveIntervals: 'Save to Ring',
    haloIntervalLoading: 'Reading...',
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
    haloIntervalTitle: 'Monitoring Intervals',
    metricHr: 'Heart Rate', metricSpo2: 'SpO₂', metricTemp: 'Temp', metricHrv: 'HRV',
    haloIntervalUnit: 'min',
    haloWorkModeOff: 'Off', haloWorkModeAuto: 'Auto', haloWorkModeSched: 'Sched',
    haloRingTimeLabel: 'Ring Time',
    ringHrvTrend: 'HRV Trend', ringSpo2Trend: 'SpO₂ Trend', ringBodyTemp: 'Body Temp',
    ringSleepWeek: '7-Day Sleep', ringNap: 'Nap', ringNightSleep: 'Night Sleep', ringSleepNoBlocks: 'No sleep recorded yet',
    ringSmoothedNote: ' readings smoothed',
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

  // Blood pressure (Halo HRV measurement) + breath rate
  let bpStr = null, bpColor = '#A6C4E5'
  if (raw.systolicBP != null && raw.diastolicBP != null) {
    bpStr = `${raw.systolicBP}/${raw.diastolicBP}`
    bpColor = raw.systolicBP >= 140 ? '#ef4444' : raw.systolicBP >= 130 ? '#f97316' : raw.systolicBP >= 120 ? '#f97316' : '#10b981'
  }
  const breathRateStr = raw.breathRate != null ? String(raw.breathRate) : null

  // ── Body temperature ──
  let tempColor = '#A6C4E5', tempPct = 0
  if (raw.bodyTempC != null) {
    tempColor = raw.bodyTempC >= 38 ? '#ef4444' : raw.bodyTempC >= 37.2 ? '#f97316' : '#10b981'
    tempPct   = Math.min(100, Math.max(2, Math.round((raw.bodyTempC - 35.5) / 3 * 100)))
  }

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

  // HRV daily trend bars (last 7 days)
  let hrvDayBars = null
  if (raw.hrvSlots?.length > 0) {
    const byDay = {}
    for (const s of raw.hrvSlots) {
      const d = s.timestamp.substring(0, 10)
      if (!byDay[d]) byDay[d] = []
      if (s.hrv != null) byDay[d].push(s.hrv)
    }
    const days = Object.keys(byDay).sort().slice(-7)
    const avgs = days.map(d => byDay[d].length ? Math.round(byDay[d].reduce((a, b) => a + b, 0) / byDay[d].length) : 0)
    const maxHrv = Math.max(...avgs, 1)
    hrvDayBars = days.map((d, i) => ({
      label: d.slice(5).replace('-', '/'),
      heightRpx: Math.round(Math.max(4, avgs[i] / maxHrv * CHART_H)),
      color: avgs[i] >= 80 ? '#0ea5e9' : avgs[i] >= 50 ? '#10b981' : avgs[i] >= 30 ? '#f97316' : '#ef4444',
      avg: avgs[i],
    }))
  }

  // SpO₂ daily trend bars (last 7 days)
  let spo2DayBars = null
  if (raw.spo2Slots?.length > 0) {
    const byDay = {}
    for (const s of raw.spo2Slots) {
      const d = s.timestamp.substring(0, 10)
      if (!byDay[d]) byDay[d] = []
      if (s.spo2 != null) byDay[d].push(s.spo2)
    }
    const days = Object.keys(byDay).sort().slice(-7)
    const avgs = days.map(d => byDay[d].length ? Math.round(byDay[d].reduce((a, b) => a + b, 0) / byDay[d].length * 10) / 10 : 0)
    const minSpo2 = 90, maxSpo2 = 100
    spo2DayBars = days.map((d, i) => ({
      label: d.slice(5).replace('-', '/'),
      heightRpx: Math.round(Math.max(4, (avgs[i] - minSpo2) / (maxSpo2 - minSpo2) * CHART_H)),
      color: avgs[i] >= 98 ? '#0ea5e9' : avgs[i] >= 95 ? '#10b981' : avgs[i] >= 90 ? '#f97316' : '#ef4444',
      avg: avgs[i],
    }))
  }

  // Weekly sleep timeline: every discrete block (naps kept separate from night
  // sleep, and a night interrupted by a long wake-up kept as separate segments)
  // positioned on a noon→noon 24h axis, up to the last 7 nights.
  const SLEEP_AXIS_H = 480 // rpx — represents the full 24h noon-to-noon window
  let sleepWeek = null
  if (raw.sleepHistory?.length > 0) {
    const byDate = {}
    for (const s of raw.sleepHistory) {
      if (!s.totalMinutes || !s.onset) continue
      ;(byDate[s.date] = byDate[s.date] || []).push(s)
    }
    const dates = Object.keys(byDate).sort().slice(-7)
    if (dates.length > 0) {
      sleepWeek = dates.map(date => {
        const sessions = byDate[date].slice().sort((a, b) => (a.onset < b.onset ? -1 : 1))
        const nightMins = sessions.filter(s => _isNightSession(s.onset)).reduce((sum, s) => sum + s.totalMinutes, 0)
        const napMins = sessions.filter(s => !_isNightSession(s.onset)).reduce((sum, s) => sum + s.totalMinutes, 0)
        // Color reflects the day's combined sleep total, not each segment's own
        // duration — a night interrupted into several short segments (or one that
        // resumes after 6am and gets bucketed as a "nap" by the hour heuristic,
        // see _selectLastNight's comment) previously colored red/orange per-piece
        // even when the day's actual total sleep was good.
        const dayColor = _dayQualityColor(nightMins + napMins)
        const blocks = sessions.map((s, i) => {
          const mins = _minutesSinceNoon(s.onset)
          return {
            key: `${date}-${i}`,
            topRpx: Math.round(mins / 1440 * SLEEP_AXIS_H),
            heightRpx: Math.max(6, Math.round(s.totalMinutes / 1440 * SLEEP_AXIS_H)),
            color: dayColor,
            isNap: !_isNightSession(s.onset),
            timeLabel: s.onset.slice(11, 16),
            durLabel: _fmtHM(s.totalMinutes, isZh),
          }
        })
        return {
          date,
          label: date.slice(5).replace('-', '/'),
          totalLabel: (nightMins + napMins) > 0 ? _fmtHM(nightMins + napMins, isZh) : '—',
          hasNap: napMins > 0,
          blocks,
        }
      })
    }
  }

  const sleepDateLabel = raw.sleepDate ? raw.sleepDate.slice(5).replace('-', '/') : null

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
    hasBodyTemp:   raw.bodyTempC    != null,
    hrvColor, hrvPct,
    stressLabel, stressColor,
    spo2Color, spo2Pct,
    bpStr, bpColor, breathRateStr,
    stepsBars, hrBars, sleepSegs, sleepTimeRange, sleepDateLabel,
    hrvDayBars, spo2DayBars, sleepWeek,
    sleepAxisHeightRpx: SLEEP_AXIS_H,
    bodyTempC: raw.bodyTempC != null ? raw.bodyTempC.toFixed(1) : null,
    tempPct, tempColor,
    hasSlotCharts: !!(stepsBars || hrBars || sleepSegs || hrvDayBars || spo2DayBars || sleepWeek),
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

// Merge Halo HRV+SpO2 slot arrays into the same reading shape _fmtRealtimeReadings expects.
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

// --- Incremental Halo/V8 sync: cursor derivation + merge (see
// docs/architecture/halo-smart-ring.md §9) ---
//
// The ring's own history commands support "since date" (protocol mode
// 0x01), but handleSyncWearable() otherwise re-fetches full history every
// sync. Rather than a dedicated "last sync" storage key, each type's cursor
// is derived from the max key field already present in the previously
// stored `wearable_ring_data` slot array — its lifecycle then automatically
// matches the data's own (cleared on unbind, advanced only on a successful
// commit), instead of needing separate upkeep.
//
// IMPORTANT — confirmed live against a real V8 band 2026-07-30 (see
// docs/architecture/v8-smart-band.md): mode 0x01 requires the `since` date
// to EXACTLY match one of the device's own stored record timestamps
// (inclusive — that exact record is included in the result). Any other
// value, even one second off, makes the device silently fall back to
// returning its FULL history instead of an empty/partial result. There is
// no safety margin here — subtracting any offset from the last-known
// timestamp would almost always miss the exact match and defeat the whole
// optimization. The cursor must be exactly the last-known timestamp, which
// is safe to reuse as-is (it's a real value the ring itself produced, not
// an independently-derived "now" subject to clock drift), and the inclusive
// boundary means it always returns at least that one (harmless, deduped by
// the merge step) record plus anything genuinely new.
const RING_CURSOR_STALE_MS = 4 * 24 * 60 * 60 * 1000  // heuristic only (see _deriveSinceDate) — not a correctness bound
const RING_SLOT_RETENTION_DAYS = 7                // local retention window after merging

// Returns the max `keyField` value across `slots` as a comparable string, or
// null if empty. `keyField` values are Date objects (hrSlots.t is an ISO
// string; hrLog's raw timestamp is a Date — normalized to ISO by the caller
// before storage) or "YYYY-MM-DD HH:MM:SS" strings, both lexicographically sortable.
function _lastSlotTimestamp(slots, keyField) {
  if (!slots || !slots.length) return null
  let max = null
  for (const s of slots) {
    const v = s[keyField]
    if (v != null && (max === null || v > max)) max = v
  }
  return max
}

// Derives a `sinceDate` (Date|null) to request incrementally from the ring,
// given the previous sync's slot array — exactly the last-known timestamp,
// no margin (see the block comment above for why). Returns null (→ full
// mode-0x00 fetch) when there's no previous data. RING_CURSOR_STALE_MS is
// purely a "don't bother attempting" heuristic to skip a fetch that's likely
// past the ring's actual retention and would just fall back to full history
// anyway (per the same confirmed behavior) — not a correctness requirement,
// since an exact-but-purged timestamp degrades gracefully to that same
// full-history fallback rather than losing or corrupting data.
function _deriveSinceDate(prevSlots, keyField) {
  const lastTs = _lastSlotTimestamp(prevSlots, keyField)
  if (!lastTs) return null
  const lastMs = new Date(String(lastTs).replace(' ', 'T') + (String(lastTs).includes('T') ? '' : '+08:00')).getTime()
  if (!lastMs || Date.now() - lastMs > RING_CURSOR_STALE_MS) return null
  return new Date(lastMs)
}

// Upserts `newSlots` over `prevSlots` keyed by `keyField` (new wins on
// collision), sorted ascending, trimmed to `retentionDays`. Runs even when
// `newSlots` is empty (incremental fetch found nothing new, or the fetch
// failed) — in that case this returns `prevSlots` trimmed, which is what
// keeps a single failed/empty per-type fetch from wiping out the
// previously-synced data that _commitRingData would otherwise overwrite.
function _mergeRingSlots(prevSlots, newSlots, keyField, retentionDays) {
  const byKey = new Map()
  for (const s of (prevSlots || [])) byKey.set(s[keyField], s)
  for (const s of (newSlots || [])) byKey.set(s[keyField], s)
  const merged = Array.from(byKey.values()).sort((a, b) => (a[keyField] < b[keyField] ? -1 : a[keyField] > b[keyField] ? 1 : 0))
  if (!retentionDays || !merged.length) return merged
  const cutoffStr = _shanghaiDateStr(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  return merged.filter(s => String(s[keyField]) >= cutoffStr)
}

function _fmtRealtimeReadings(readings) {
  const todayStr = _shanghaiDateStr(Date.now())
  const yesterStr = _shanghaiDateStr(Date.now() - 86400000)
  const sectionMap = {}
  const sectionOrder = []
  for (const r of readings) {
    const dateStr = _shanghaiDateStr(r.t)
    const sectionLabel = dateStr === todayStr ? '今天' : dateStr === yesterStr ? '昨天' : dateStr.slice(5).replace('-', '/')
    if (!sectionMap[dateStr]) {
      sectionMap[dateStr] = { dateLabel: sectionLabel, readings: [] }
      sectionOrder.push(dateStr)
    }
    const time = _shanghaiTimeStr(r.t)
    const hrvColor    = r.hrv    == null ? null : r.hrv >= 80 ? '#0ea5e9' : r.hrv >= 50 ? '#10b981' : r.hrv >= 30 ? '#f97316' : '#ef4444'
    const spo2Color   = r.spo2   == null ? null : r.spo2 >= 98 ? '#0ea5e9' : r.spo2 >= 95 ? '#10b981' : r.spo2 >= 90 ? '#f97316' : '#ef4444'
    const stressColor = r.stress == null ? null : r.stress <= 25 ? '#10b981' : r.stress <= 50 ? '#6375EC' : r.stress <= 75 ? '#f97316' : '#ef4444'
    const bpStr   = r.systolicBP != null && r.diastolicBP != null ? `${r.systolicBP}/${r.diastolicBP}` : null
    const bpColor = r.systolicBP == null ? null : r.systolicBP >= 140 ? '#ef4444' : r.systolicBP >= 130 ? '#f97316' : r.systolicBP >= 120 ? '#f97316' : '#10b981'
    sectionMap[dateStr].readings.push({ time, hrv: r.hrv, stress: r.stress, spo2: r.spo2, hrvColor, spo2Color, stressColor, bpStr, bpColor, breathRate: r.breathRate ?? null })
  }
  return sectionOrder.map(d => sectionMap[d])
}

// Bounds/MAD-multiplier per metric for signal-smoothing.flagOutliers — see
// utils/wearable/signal-smoothing.js and docs on _buildReadingLineCharts.
const _SMOOTHING_CONFIG = {
  hrv:    { min: 2,  max: 220, k: 2.5, window: 7, epsilon: 2 },
  spo2:   { min: 70, max: 100, k: 2.5, window: 7, epsilon: 0.8 },
  stress: { min: 0,  max: 100, k: 2.5, window: 7, epsilon: 3 },
}

function _buildReadingLineCharts(readings) {
  const pts = readings.slice().reverse()  // oldest → newest
  const { flagOutliers, interpolateFlagged } = require('../../utils/wearable/signal-smoothing.js')

  function _extract(key) { return pts.filter(r => r[key] != null).map(r => r[key]) }
  function _hrvColor(v)    { return v >= 80 ? '#0ea5e9' : v >= 50 ? '#10b981' : v >= 30 ? '#f97316' : '#ef4444' }
  function _spo2Color(v)   { return v >= 98 ? '#0ea5e9' : v >= 95 ? '#10b981' : v >= 90 ? '#f97316' : '#ef4444' }
  function _stressColor(v) { return v <= 25 ? '#10b981' : v <= 50 ? '#6375EC' : v <= 75 ? '#f97316' : '#ef4444' }

  // Detects likely sensor errors (ring off-wrist, poor contact, byte glitch)
  // and replaces them with an interpolated estimate for chart display only —
  // raw vals/readings are untouched, this never feeds back into stored data.
  function _smooth(vals, metricKey) {
    const flags = flagOutliers(vals, _SMOOTHING_CONFIG[metricKey])
    const corrected = interpolateFlagged(vals, flags)
    const validCount = flags.filter(f => !f).length
    return { corrected, validCount }
  }

  const CHART_H = 72, MAX_BARS = 48

  function _toBars(corrected, colorFn) {
    if (corrected.length < 2) return null
    const N = Math.min(corrected.length, MAX_BARS)
    const binned = []
    for (let i = 0; i < N; i++) {
      const s = Math.floor(i / N * corrected.length)
      const e = Math.floor((i + 1) / N * corrected.length)
      const slice = corrected.slice(s, e)
      binned.push({
        value: slice.reduce((a, b) => a + b.value, 0) / slice.length,
        estimated: slice.some(b => b.estimated),
      })
    }
    const min = Math.min(...binned.map(b => b.value)), max = Math.max(...binned.map(b => b.value))
    const range = max - min || 1
    return binned.map(b => ({
      heightRpx: Math.round(Math.max(4, (b.value - min) / range * CHART_H)),
      color: colorFn(b.value),
      estimated: b.estimated,
    }))
  }

  function _chart(vals, colorFn, metricKey) {
    const { corrected, validCount } = _smooth(vals, metricKey)
    const correctedVals = corrected.map(c => c.value)
    const latestRaw = vals.length ? vals[vals.length - 1] : null
    const latestEntry = corrected.length ? corrected[corrected.length - 1] : null
    const estimatedCount = corrected.filter(c => c.estimated).length
    return {
      hasData:         validCount >= 2,
      bars:            _toBars(corrected, colorFn),
      latestVal:       latestRaw,
      latestColor:     latestRaw != null ? colorFn(latestRaw) : 'rgba(166,196,229,0.5)',
      latestEstimated: !!(latestEntry && latestEntry.estimated),
      minVal:          correctedVals.length ? Math.round(Math.min(...correctedVals) * 10) / 10 : null,
      maxVal:          correctedVals.length ? Math.round(Math.max(...correctedVals) * 10) / 10 : null,
      count:           vals.length,
      estimatedCount,
    }
  }

  return {
    hrvChart:    _chart(_extract('hrv'),    _hrvColor,    'hrv'),
    spo2Chart:   _chart(_extract('spo2'),   _spo2Color,   'spo2'),
    stressChart: _chart(_extract('stress'), _stressColor, 'stress'),
  }
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
    avatarPickerVisible: false,
    avatarDisplayUrl: '',
    mood: DEFAULT_MOOD,
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
    wearableBrand: '',   // 'halo' | 'v8' | 'aizo' | 'colmi' (legacy stored value: 'x3')
    wearableConnected: false,
    wearableBattery: 0,
    wearableBusy: false,
    wearableServerHint: null, // { brand, mac, name, boundAt } — set when this device has no local binding but the account does
    ringMeasuring: false,
    showPrivacyPopup: false,
    ringSettingsOpen: false,
    ringSettingsBusy: false,
    ringData: null,
    // Halo background-measurement intervals (minutes per metric type)
    haloIntervals: { hr: 30, spo2: 60, temp: 60, hrv: 120 },
    haloIntervalOpts: { hr: [5, 10, 15, 30], spo2: [5, 15, 30, 60], temp: [15, 30, 60], hrv: [30, 60, 120] },
    haloWorkModes: { hr: 2, spo2: 2, temp: 2, hrv: 2 },
    haloIntervalsChanged: false,
    haloRingTime: null,
  },

  observers: {
    'userId': function(newId) {
      if (!newId) return
      this._loadHealth()
      // attached() calls _loadWearableFromStorage()/_loadRingDataFromServer()
      // unconditionally, but their server-dependent paths need userId, which
      // may not have been bound yet at that exact synchronous tick (a race
      // with the parent page's own async user-fetch/login). Retry once it's
      // actually available — safe to re-run, it just re-reads current state.
      if (this.properties.mode === 'coach') {
        this._loadRingDataFromServer()
      } else {
        this._loadWearableFromStorage()
      }
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
      this._refreshAvatarDisplay()
    },
    'mood': function() {
      this._refreshAvatarDisplay()
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
      if (this.properties.mode === 'coach') {
        this._loadRingDataFromServer()
      } else {
        this._loadWearableFromStorage()
      }

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
        const latestAnalyzed = [...kinoRecords].reverse().find(r => r.data?.validated) || null
        const latestBm = latestAnalyzed?.data?.validated || null
        const subAgesRaw = latestAnalyzed?.data?.bioage_profile?.SubAges || null

        const bmList = BM_META.map(({ key, unit, color }) => ({
          key, label: t.bmLabels[key], unit, color,
          value: latestBm?.[key] != null ? latestBm[key] : null,
        }))

        const trendList = BM_META.map(({ key, unit, color }) => {
          const allVals = kinoRecords.slice(-10).map(r => r.data?.validated?.[key] ?? null)
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

    // wx.createCanvasContext paints literal colors — CSS custom properties (var(--blue),
    // etc.) that theme the rest of this component don't reach canvas draw calls, so every
    // chart needs its own light/dark palette read from this.data.theme.
    _chartPalette() {
      const isLight = this.data.theme === 'light'
      return isLight ? {
        bg: '#FFFFFF',
        accent: '#C9956A',
        accentRgb: '201,149,106',
        textPrimary: '#2C2C2C',
        textMuted55: 'rgba(139,110,78,0.65)',
        textMuted75: 'rgba(139,110,78,0.8)',
        textMuted45: 'rgba(139,110,78,0.5)',
        textMuted50: 'rgba(139,110,78,0.55)',
        textMuted28: 'rgba(139,110,78,0.35)',
        gridLine: 'rgba(201,149,106,0.15)',
        fillLight: 'rgba(201,149,106,0.12)',
        fillMed: 'rgba(201,149,106,0.22)',
        dotRing: 'rgba(255,255,255,0.9)',
        glow10: 'rgba(201,149,106,0.12)',
        glow22: 'rgba(201,149,106,0.28)',
        glow60: 'rgba(201,149,106,0.7)',
        line85: 'rgba(201,149,106,0.85)',
      } : {
        bg: '#0a1228',
        accent: '#6375EC',
        accentRgb: '99,117,236',
        textPrimary: '#EEF2FF',
        textMuted55: 'rgba(166,196,229,0.55)',
        textMuted75: 'rgba(166,196,229,0.75)',
        textMuted45: 'rgba(166,196,229,0.45)',
        textMuted50: 'rgba(166,196,229,0.5)',
        textMuted28: 'rgba(166,196,229,0.28)',
        gridLine: 'rgba(99,117,236,0.12)',
        fillLight: 'rgba(99,117,236,0.1)',
        fillMed: 'rgba(99,117,236,0.22)',
        dotRing: 'rgba(10,15,30,0.9)',
        glow10: 'rgba(99,117,236,0.10)',
        glow22: 'rgba(99,117,236,0.22)',
        glow60: 'rgba(99,117,236,0.60)',
      }
    },

    _drawWeightSparkline() {
      const { weightHistory } = this.data
      if (weightHistory.length < 2) return
      const c = this._chartPalette()
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
      ctx.setStrokeStyle(c.line85)
      ctx.setLineWidth(1.5)
      ctx.moveTo(pts[0].x, pts[0].y)
      pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
      ctx.stroke()
      ctx.setFillStyle(c.accent)
      pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fill() })
      ctx.draw()
    },



    _drawBioAgeChart() {
      const { bioAgeHistory, bioAgeChartW, bAge, cAge, bAgeColor, t } = this.data
      if (!bioAgeChartW) return
      const c = this._chartPalette()
      const W = bioAgeChartW, H = 200
      const headerH = 62
      const pL = 28, pR = 10, pT = headerH + 12, pB = 24
      const plotW = W - pL - pR, plotH = H - pT - pB

      const ctx = wx.createCanvasContext('dt-bioage-chart', this)
      ctx.clearRect(0, 0, W, H)
      ctx.setFillStyle(c.bg)
      ctx.fillRect(0, 0, W, H)

      // ── Header: BioAge (left) + ChronoAge (right) ──
      ctx.setTextAlign('left')
      ctx.setFontSize(30)
      ctx.setFillStyle(bAgeColor || c.accent)
      ctx.fillText(bAge || '—', 14, 34)
      ctx.setFontSize(10)
      ctx.setFillStyle(c.textMuted55)
      ctx.fillText((t.bioAge || 'Bio Age').toUpperCase(), 14, 52)

      ctx.setTextAlign('right')
      ctx.setFontSize(22)
      ctx.setFillStyle(c.textMuted75)
      ctx.fillText(cAge || '—', W - 14, 32)
      ctx.setFontSize(10)
      ctx.setFillStyle(c.textMuted45)
      ctx.fillText((t.chronoAge || 'Chrono Age').toUpperCase(), W - 14, 52)


      // Separator
      ctx.beginPath()
      ctx.setStrokeStyle(c.gridLine)
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
        rrPath(4, cr - 3); ctx.setStrokeStyle(c.glow10); ctx.setLineWidth(10); ctx.stroke()
        rrPath(2, cr - 1); ctx.setStrokeStyle(c.glow22); ctx.setLineWidth(5);  ctx.stroke()
        rrPath(1, cr);     ctx.setStrokeStyle(c.glow60); ctx.setLineWidth(1.5); ctx.stroke()
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
      ctx.setFillStyle(c.fillMed)
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
          ctx.setStrokeStyle(c.textMuted28)
          ctx.setLineWidth(1)
          ctx.moveTo(x1 + t1 * (x2 - x1), y1 + t1 * (y2 - y1))
          ctx.lineTo(x1 + t2 * (x2 - x1), y1 + t2 * (y2 - y1))
          ctx.stroke()
          d += 6
        }
      }

      // BioAge line
      ctx.beginPath()
      ctx.setStrokeStyle(c.accent)
      ctx.setLineWidth(2)
      ctx.moveTo(pts[0].x, pts[0].y)
      pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
      ctx.stroke()

      // Dots
      ctx.setFillStyle(c.accent)
      ctx.setStrokeStyle(c.dotRing)
      ctx.setLineWidth(1.5)
      pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke() })

      // X-axis labels
      const step = Math.max(1, Math.floor(bioAgeHistory.length / 4))
      ctx.setFontSize(9)
      ctx.setFillStyle(c.textMuted45)
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
      const c = this._chartPalette()
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
        ctx.setStrokeStyle(c.gridLine)
        ctx.setLineWidth(0.5)
        ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pL + plotW, y); ctx.stroke()
        ctx.setFillStyle(c.textMuted45)
        ctx.setFontSize(10)
        ctx.fillText(val.toFixed(1), 0, y + 4)
      }
      ctx.beginPath()
      ctx.setFillStyle(c.fillLight)
      ctx.moveTo(pts[0].x, pT + plotH)
      pts.forEach(p => ctx.lineTo(p.x, p.y))
      ctx.lineTo(pts[pts.length - 1].x, pT + plotH)
      ctx.closePath(); ctx.fill()
      ctx.beginPath()
      ctx.setStrokeStyle(c.accent)
      ctx.setLineWidth(2)
      ctx.moveTo(pts[0].x, pts[0].y)
      pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
      ctx.stroke()
      const labelStep = Math.max(1, Math.floor(weightHistory.length / 5))
      ctx.setFontSize(10)
      ctx.setFillStyle(c.textMuted50)
      weightHistory.forEach((r, i) => {
        if (i % labelStep === 0 || i === weightHistory.length - 1) {
          ctx.fillText(r.date.substring(5), pts[i].x - 14, H - pB + 16)
        }
      })
      ctx.setFillStyle(c.textPrimary)
      ctx.setStrokeStyle(c.accent)
      ctx.setLineWidth(1.5)
      pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke() })
      ctx.setStrokeStyle(c.glow22)
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
            // Ring-derived BP (source 'smart_ring') is inferred from HRV pulse-wave data,
            // not a real cuff reading, and is unreliable until calibrated against an actual
            // BP device — only surface BP the user uploaded themselves (e.g. a cuff photo).
            if (!seenBp.has(date) && USER_UPLOADED_BP_SOURCES.has(ev.source) && d?.bp_systolic != null && d?.bp_diastolic != null) {
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
      const c = this._chartPalette()
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
        ctx.setStrokeStyle(c.gridLine); ctx.setLineWidth(0.5)
        ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pL + plotW, y); ctx.stroke()
        ctx.setFillStyle(c.textMuted45); ctx.setFontSize(10)
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
      ctx.setFontSize(10); ctx.setFillStyle(c.textMuted50)
      history.forEach((r, i) => {
        if (i % labelStep === 0 || i === history.length - 1)
          ctx.fillText(r.date.substring(5), pts[i].x - 14, H - pB + 16)
      })
      ctx.setFillStyle(c.textPrimary); ctx.setStrokeStyle(color); ctx.setLineWidth(1.5)
      pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke() })
      ctx.setStrokeStyle(c.glow22); ctx.setLineWidth(1)
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

    onOpenAvatarPicker() {
      if (this._avatarPillTimer) { clearTimeout(this._avatarPillTimer); this._avatarPillTimer = null }
      this.setData({ avatarPillsVisible: false, avatarPickerVisible: true })
    },

    onAvatarPickerClose() {
      this.setData({ avatarPickerVisible: false })
    },

    onAvatarSelect(e) {
      const { avatarId } = e.detail
      if (!avatarId) return
      this.setData({ avatarPickerVisible: false, avatarUpdating: true })
      this.triggerEvent('chooseavatar', { avatarId })
    },

    // Resolves the currently-displayed avatar image from the selected character
    // + live mood ('mood' data field). Runs for both self and coach mode: self
    // view computes mood from local BLE-synced ring data (_loadWearableFromStorage),
    // coach view computes it from that client's server-synced health-events
    // (_loadRingDataFromServer) — same computeMood()/resolveAvatarUrl() path either way.
    _refreshAvatarDisplay() {
      const character = this.properties.user?.avatar_character
      if (!character) { this.setData({ avatarDisplayUrl: '' }); return }
      const url = resolveAvatarUrl(character, this.data.mood)
      this.setData({ avatarDisplayUrl: url || '' })
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
          image_url: r.image_url || '',
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
          image_url: raw.image_url || '',
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

    // Public: called by the chat page after a lab report is saved, to refresh the list.
    refreshHealthReports() {
      this._loadHealthReports()
    },

    previewReportImage(e) {
      const url = e.currentTarget.dataset.url
      if (!url) return
      wx.previewImage({ urls: [url], current: url })
    },

    // --- Wearable (Smart Ring) ---

    _maybeAutoSync() {
      if (this.data.wearableBusy || !this.data.wearableId) return
      try {
        const raw = wx.getStorageSync('wearable_ring_data')
        const lastSync = raw?.syncedAt || 0
        if (Date.now() - lastSync > 30 * 60 * 1000) {
          this.handleSyncWearable()
        }
      } catch (_) {}
    },

    _loadWearableFromStorage() {
      try {
        const saved = wx.getStorageSync('wearable_device')
        const hasLocalDevice = !!(saved && saved.deviceId)
        if (hasLocalDevice) {
          const brand = _normalizeBrand(saved.brand) || 'colmi'
          const fallbackName = brand === 'halo' ? 'Halo Ring' : brand === 'aizo' ? 'Aizo Ring' : brand === 'v8' ? 'V8 Band' : 'Colmi Ring'
          const haloSaved = wx.getStorageSync('halo_interval_settings') || wx.getStorageSync('x3_interval_settings')
          const haloIntervals = haloSaved ? { ...this.data.haloIntervals, ...haloSaved } : this.data.haloIntervals
          const haloWmSaved = wx.getStorageSync('halo_work_mode_settings') || wx.getStorageSync('x3_work_mode_settings')
          const haloWorkModes = haloWmSaved ? { ...this.data.haloWorkModes, ...haloWmSaved } : this.data.haloWorkModes
          this.setData({ wearableId: saved.deviceId, wearableName: saved.name || fallbackName, wearableConnected: false, wearableBrand: brand, haloIntervals, haloWorkModes })
          // Delay auto-sync to let the BLE stack initialize on cold launch
          setTimeout(() => this._maybeAutoSync(), 2000)
          this._ensureWearableBindingSynced({ brand, mac: saved.mac || null, name: saved.name || fallbackName })
        } else {
          // No local binding on this device/install — check if the account already
          // has a ring registered from another client app (Android/iOS builds of
          // this same codebase, or a previous install) so we can hint the user
          // instead of them thinking they've never paired a ring.
          this._loadWearableHintFromServer()
        }
        // Chart/reading data always comes from the server (single source of
        // truth — a local wearable_ring_data snapshot can silently drift from
        // it, e.g. after a server-side data correction, with nothing to
        // invalidate the stale cache). Binding state above stays local since
        // BLE pairing is inherently device-specific.
        this._loadRingDataFromServer()
      } catch (_) {}
    },

    // Persists (or clears, when `wearable` is null) the wearable binding on the
    // user's account so other client apps built from this codebase can discover
    // it. Best-effort — failures here shouldn't block the local bind/unbind flow.
    async _syncWearableBindingToServer(wearable) {
      const { userId } = this.properties
      if (!userId) return
      try {
        await this._req(`${BASE}/api/users/${userId}`, 'PATCH', { wearable })
      } catch (e) {
        if (IS_DEV) console.error('[wearable][server-sync]', e?.message || e?.errMsg || e)
      }
    },

    // Called when this device/install DOES have a local wearable_device — the
    // initial bind-time push to the server (_syncWearableBindingToServer,
    // fire-and-forget) can silently fail, or the binding may predate that push
    // existing at all (confirmed: a real account synced ring data for months
    // with wearable_brand still NULL server-side). Self-heals by comparing
    // against the server record and only PATCHing when it's actually out of
    // sync — avoids bumping wearable_bound_at on every load once it matches.
    async _ensureWearableBindingSynced(saved) {
      const { userId } = this.properties
      if (!userId || !saved?.brand) return
      try {
        const res = await this._req(`${BASE}/api/users/${userId}`)
        const user = res.data?.user
        if (!user) return
        if (user.wearable_brand !== saved.brand || user.wearable_name !== saved.name) {
          await this._syncWearableBindingToServer({ brand: saved.brand, mac: saved.mac || null, name: saved.name })
        }
      } catch (e) {
        if (IS_DEV) console.error('[wearable][binding-selfheal]', e?.message || e?.errMsg || e)
      }
    },

    // Called when this device/install has no local wearable_device — checks
    // whether the account already has a ring bound (from another client app or
    // a previous install) so the UI can hint "you already have a ring, tap Scan
    // to reconnect" instead of looking like the user has never paired one.
    async _loadWearableHintFromServer() {
      const { userId } = this.properties
      if (!userId) return
      try {
        const res = await this._req(`${BASE}/api/users/${userId}`)
        const user = res.data?.user
        if (user?.wearable_brand) {
          this.setData({
            wearableServerHint: {
              brand: user.wearable_brand,
              mac: user.wearable_mac || null,
              name: user.wearable_name || null,
              boundAt: user.wearable_bound_at || null,
            },
          })
        }
      } catch (e) {
        if (IS_DEV) console.error('[wearable][server-hint]', e?.message || e?.errMsg || e)
      }
    },

    async _loadRingDataFromServer() {
      const { userId, lang } = this.properties
      if (!userId) return
      const isZh = (lang || 'zh') !== 'en'
      try {
        const [vitalsRes, activityRes, sleepRes] = await Promise.all([
          // 'vitals' bundles temp/hrv/spo2/resting_hr/realtime sub-streams sharing one
          // budget — temp samples more frequently than hrv on Halo, so 200 silently
          // crowded hrv/spo2 out of the "most recent N" window (confirmed: a 135-record
          // hrv sync only left 32 visible after reload). Matches the server's own raised cap.
          this._req(`${BASE}/api/health-events?openid=${encodeURIComponent(userId)}&category=vitals&limit=1000`),
          this._req(`${BASE}/api/health-events?openid=${encodeURIComponent(userId)}&category=activity&limit=14`),
          this._req(`${BASE}/api/health-events?openid=${encodeURIComponent(userId)}&category=sleep&limit=14`),
        ])
        // wx.request's success callback fires for ANY completed HTTP response
        // (2xx, 4xx, 5xx alike) — only a network-level failure hits `fail`. So an
        // auth error or 5xx here would otherwise silently look like "no events
        // yet" (data?.events defaults to []) instead of surfacing as a real error.
        for (const [label, res] of [['vitals', vitalsRes], ['activity', activityRes], ['sleep', sleepRes]]) {
          if (res.statusCode !== 200 || res.data?.success === false) {
            if (IS_DEV) console.error('[wearable][server-data]', label, res.statusCode, res.data)
          }
        }
        const vitalsEvents   = vitalsRes.data?.events   || []
        const activityEvents = activityRes.data?.events || []
        const sleepEvents    = sleepRes.data?.events    || []
        if (!vitalsEvents.length && !activityEvents.length && !sleepEvents.length) return

        const _pd = (data) => typeof data === 'string' ? JSON.parse(data) : (data || {})
        const _tsFromExtId = (extId) => {
          const ts = (extId || '').split('_').pop()
          if (!ts || ts.length !== 14 || !/^\d{14}$/.test(ts)) return null
          return `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)} ${ts.slice(8,10)}:${ts.slice(10,12)}:${ts.slice(12,14)}`
        }

        // Derive syncedAt from most recent ingested_at across all events
        let latestIngestedMs = 0
        for (const ev of [...vitalsEvents, ...activityEvents, ...sleepEvents]) {
          const t = ev.ingested_at ? new Date(ev.ingested_at).getTime() : 0
          if (t > latestIngestedMs) latestIngestedMs = t
        }
        const rawRing = { syncedAt: latestIngestedMs || Date.now() }

        // Activity
        const actEv = activityEvents[0]
        if (actEv) {
          const d = _pd(actEv.data)
          rawRing.steps     = d.steps      ?? null
          rawRing.calories  = d.calories   ?? null
          rawRing.distance  = d.distance_m ?? null
          rawRing.stepSlots = d.slots      ?? null
        }

        // Sleep: flatten every date's event into its individual sessions (naps kept
        // distinct from night sleep — see _sessionsFromEventData) for the weekly
        // multi-block timeline, then merge every session belonging to the most
        // recent night (see _selectLastNight) for the "Last Night" quick-glance card.
        rawRing.sleepHistory = sleepEvents
          .flatMap(ev => _sessionsFromEventData((ev.data_date || '').substring(0, 10), _pd(ev.data)))
          .filter(s => s.totalMinutes > 0)
          .sort((a, b) => (a.onset || a.date) < (b.onset || b.date) ? -1 : 1)

        const lastNight = _selectLastNight(rawRing.sleepHistory)
        if (lastNight) {
          rawRing.sleepMinutes = lastNight.totalMinutes ?? null
          rawRing.sleepDeep    = lastNight.deep         ?? null
          rawRing.sleepLight   = lastNight.light        ?? null
          rawRing.sleepRem     = lastNight.rem          ?? null
          rawRing.sleepAwake   = lastNight.awake        ?? null
          rawRing.sleepStart   = lastNight.sleepStart   ?? null
          rawRing.sleepEnd     = lastNight.sleepEnd     ?? null
          rawRing.sleepSlots   = lastNight.slots        ?? null
          rawRing.sleepOnset   = lastNight.onset        ?? null
          rawRing.sleepDate    = lastNight.date         ?? null
        }

        // Vitals: split into resting-HR, HRV slots, SpO2 slots, temp, realtime
        const hrvSlots = [], spo2Slots = []
        let latestHrv = null, latestSpo2 = null

        for (const ev of vitalsEvents) {
          const d = _pd(ev.data)
          const extId = ev.external_id || ''

          if (extId.includes('_resting_hr_')) {
            if (rawRing.restingHr == null) {
              rawRing.restingHr = d.resting_hr ?? null
              if (d.hr_slots) rawRing.hrSlots = d.hr_slots
            }
          } else if (extId.includes('_hrv_')) {
            const ts = _tsFromExtId(extId)
            if (ts) {
              hrvSlots.push({
                timestamp: ts,
                hrv:       d.hrv_ms          ?? null,
                stress:    d.stress          ?? null,
                breath:    d.breath_rate     ?? null,
                heartRate: d.heart_rate_hrv  ?? null,
                highBP:    d.bp_systolic     ?? null,
                lowBP:     d.bp_diastolic    ?? null,
              })
            }
            if (!latestHrv) latestHrv = d
          } else if (extId.includes('_spo2_')) {
            const ts = _tsFromExtId(extId)
            if (ts) spo2Slots.push({ timestamp: ts, spo2: d.spo2 ?? null })
            if (!latestSpo2 && d.spo2 != null) latestSpo2 = d
          } else if (extId.includes('_temp_')) {
            if (rawRing.bodyTempC == null && d.body_temp_c != null) rawRing.bodyTempC = d.body_temp_c
          } else if (extId.includes('_realtime_')) {
            if (!latestHrv) latestHrv = d
            if (!latestSpo2 && d.spo2 != null) latestSpo2 = d
          }
        }

        if (hrvSlots.length)  rawRing.hrvSlots  = hrvSlots.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
        if (spo2Slots.length) rawRing.spo2Slots = spo2Slots.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))

        if (latestHrv) {
          rawRing.hrv         = latestHrv.hrv_ms       ?? null
          rawRing.stress      = latestHrv.stress        ?? null
          rawRing.breathRate  = latestHrv.breath_rate   ?? null
          rawRing.systolicBP  = latestHrv.bp_systolic   ?? null
          rawRing.diastolicBP = latestHrv.bp_diastolic  ?? null
        }
        if (latestSpo2) rawRing.spo2 = latestSpo2.spo2

        // Same display pipeline as _loadWearableFromStorage
        const _rawReads = rawRing.hrvSlots?.length
          ? _slotsToReadings(rawRing.hrvSlots, rawRing.spo2Slots)
          : []
        const realtimeReadings = _fmtRealtimeReadings(_rawReads)
        const _charts = _buildReadingLineCharts(_rawReads)
        const _base = _buildRingDisplayData(rawRing, isZh)
        const ringData = {
          ..._base, realtimeReadings, hasRealtimeReadings: realtimeReadings.length > 0,
          ..._charts,
          hasSlotCharts: _base.hasSlotCharts || _charts.hrvChart.hasData || _charts.spo2Chart.hasData || _charts.stressChart.hasData,
        }
        const recentSync = (Date.now() - rawRing.syncedAt) < 24 * 60 * 60 * 1000
        // A real local BLE binding (set by _loadWearableFromStorage, self-view
        // only) must win here — overwriting it with the server-hydration
        // sentinel would break "Sync Now" for a device that's actually paired.
        const hasRealBinding = this.data.wearableId && this.data.wearableId !== '__server__'
        this.setData({
          ...(hasRealBinding ? {} : { wearableId: '__server__' }),
          wearableConnected: recentSync,
          ringData,
          mood: computeMood(ringData),
          twinLoading: false,
        })
      } catch (e) {
        if (IS_DEV) console.error('[wearable][server-data]', e?.message || e?.errMsg || e)
      }
    },

    onPrivacyAgree() {
      const _app = getApp()
      if (_app._privacyResolve) {
        _app._privacyResolve({ event: 'agree', buttonId: 'privacy-agree-btn' })
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
        const { HALO_NAME_PREFIXES } = require('../../utils/wearable/halo/protocol.js')
        const { V8_NAME_PREFIXES } = require('../../utils/wearable/v8/protocol.js')
        const { BLE_SERVICE_UUID: AIZO_SVC_UUID, AIZO_NAME_PREFIXES } = require('../../utils/wearable/aizo/protocol.js')
        const { createWearable } = require('../../utils/wearable/index.js')
        const ALL_PREFIXES = [...COLMI_NAME_PREFIXES, ...HALO_NAME_PREFIXES, ...V8_NAME_PREFIXES]
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
              const isHalo = nameLower && HALO_NAME_PREFIXES.some((p) => nameLower.startsWith(p.toLowerCase()))
              const isV8   = nameLower && V8_NAME_PREFIXES.some((p) => nameLower.startsWith(p.toLowerCase()))
              const brand = isAizo ? 'aizo' : (isHalo ? 'halo' : (isV8 ? 'v8' : 'colmi'))
              const fallbackNames = { aizo: 'Aizo Ring', halo: 'Halo Ring', v8: 'V8 Band', colmi: 'Colmi Ring' }
              found.set(d.deviceId, { deviceId: d.deviceId, name: name || fallbackNames[brand], rssi: d.RSSI, brand })
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
        // MAC is the ring's stable hardware identifier (unlike deviceId, which
        // is a per-OS/per-scan BLE handle) — only Halo currently exposes it.
        const mac = typeof ring.getMac === 'function' ? await ring.getMac().catch(() => null) : null

        // Halo/V8: apply default scheduled monitoring immediately on first bind
        const defaultIvals = { hr: 30, spo2: 60, temp: 60, hrv: 120 }
        const defaultWms   = { hr: 2, spo2: 2, temp: 2, hrv: 2 }
        if (_hasIntervalSettings(brand)) {
          const _opts = { workMode: 2, startHour: 0, startMinute: 0, endHour: 23, endMinute: 59, weekdays: 0x7F }
          await ring.setAutoMonitoring({ ..._opts, intervalMinutes: defaultIvals.hr,   type: 1 }).catch(() => {})
          await ring.setAutoMonitoring({ ..._opts, intervalMinutes: defaultIvals.spo2, type: 2 }).catch(() => {})
          await ring.setAutoMonitoring({ ..._opts, intervalMinutes: defaultIvals.temp, type: 3 }).catch(() => {})
          await ring.setAutoMonitoring({ ..._opts, intervalMinutes: defaultIvals.hrv,  type: 4 }).catch(() => {})
          wx.setStorageSync('halo_interval_settings', defaultIvals)
          wx.setStorageSync('halo_work_mode_settings', defaultWms)
        }

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
          wearableServerHint: null,
          ...(_hasIntervalSettings(brand) ? { haloIntervals: defaultIvals, haloWorkModes: defaultWms } : {}),
        })
        // Best-effort — so other client apps (Android/iOS builds of this same
        // codebase, or a miniapp reinstall) can discover the same ring later.
        this._syncWearableBindingToServer({ brand, mac, name: chosen.name })
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
      const brand = _normalizeBrand(_savedDev.brand) || 'colmi'
      const ring = createWearable(brand)

      // ── Halo / V8: single-phase sync — all data is historical, no real-time measurement needed ──
      if (_hasIntervalSettings(brand)) {
        try {
          // Incremental sync: derive a per-type "since" cursor from the previous
          // snapshot instead of re-fetching full history every time (see
          // docs/architecture/halo-smart-ring.md §9). Validated live on both
          // brands via tools/halo history (V8 unit "JCV8B DBE34D" 2026-07-30,
          // Halo X3 unit "X3B 53687" 2026-07-31 — see
          // docs/architecture/v8-smart-band.md §6-7 and halo-smart-ring.md
          // §9): HRV (0x56), SpO2 (0x66), and temperature (0x62) all
          // correctly honor mode 0x01 on both brands — but ONLY when `since`
          // exactly matches one of the device's own stored record
          // timestamps (inclusive boundary); any other value, even one
          // second off, silently falls back to returning full history.
          // _deriveSinceDate above always passes the exact last-known
          // timestamp for this reason. SpO2/temperature's full fetches had
          // in fact already been hitting the 8s stream timeout on both test
          // units before this change — exactly the case incremental fetch
          // fixes outright.
          //
          // steps (0x52 detail blocks) and sleep (0x53) — added 2026-07-31
          // after a real end-to-end sync still took ~30s post-fix: HRV/SpO2/
          // temp dropped to ~180ms combined as designed, but steps and sleep
          // (out of scope for the original pass, assumed "cheap, few
          // records") turned out to be the actual remaining bottleneck on a
          // real ring — steps-detail and sleep were both hitting their 8s/
          // 15s timeouts. Live-validated the same exact-match mode 0x01
          // mechanism works for both (0x52: 450→2 records; 0x53: a lone
          // flaky "zero data" result turned out to be BLE session strain
          // from stacking three heavy requests on one connection in the test
          // rig, not a real protocol limit — a clean single fresh-connection
          // request behaved identically to HRV/SpO2/temp). Steps enabled for
          // both brands from the start (same simple per-record shape as
          // HRV/SpO2/temp, no reassembly-model dependency).
          //
          // V8 sleep — enabled 2026-07-31 after live validation
          // (tools/halo --device v8, raw getSleepDataPacket(0x01, ...) calls):
          // exact-match since → 62ms, count=1, same pattern as every other
          // command. V8's per-notification reassembly model (see
          // docs/architecture/v8-smart-band.md §3) meant the raw-block
          // extraction couldn't just reuse Halo's code, but the split mirrors
          // it: v8/index.js's getSleepHistory() (grouping/session-split logic
          // previously inline) was extracted into a static
          // V8Band.summariseSleepBlocks(), paired with a new
          // getSleepBlocks(sinceDate) — same shape as Halo's equivalents,
          // wired through the same _mergeRingSlots() merge below.
          //
          // static HR (0x55) — enabled for Halo 2026-07-31 after re-testing.
          // Earlier "inconclusive, zero records" verdict was wrong: it was a
          // time-of-day test artifact, not a real limitation. 0x55 streams
          // newest-first same as the others; both test rounds happened to
          // run before the ring had logged its first static-HR sample of the
          // current calendar day, so an otherwise-full multi-day backlog
          // (1200 real records spanning 12 days, confirmed via raw
          // unfiltered bytes) got entirely zeroed out by the client-side
          // "today only" filter every time — nothing wrong with the fetch,
          // command, or parser. Re-tested once the ring had a real today
          // sample: exact match → 64ms, count=1 (inclusive boundary, same as
          // every other type); 1-second mismatch → full 8s timeout, 1200
          // records (same fallback pattern). V8 static HR was NOT retested
          // this round (same original test-timing artifact likely applies,
          // but unconfirmed) — stays on full fetch for V8 until re-checked.
          const INCREMENTAL_SUPPORT = {
            halo: { hr: true,  hrv: true, spo2: true, temp: true, steps: true, sleep: true },
            v8:   { hr: false, hrv: true, spo2: true, temp: true, steps: true, sleep: true },
          }
          const _support = INCREMENTAL_SUPPORT[brand] || {}
          const _prevRing = wx.getStorageSync('wearable_ring_data') || {}
          const _prevIsToday = !!_prevRing.syncedAt && _shanghaiDateStr(_prevRing.syncedAt) === _shanghaiDateStr(Date.now())
          const _sinceHr    = _support.hr    && _prevIsToday ? _deriveSinceDate(_prevRing.hrSlots, 't') : null
          const _sinceHrv   = _support.hrv   ? _deriveSinceDate(_prevRing.hrvSlots, 'timestamp') : null
          const _sinceSpo2  = _support.spo2  ? _deriveSinceDate(_prevRing.spo2Slots, 'timestamp') : null
          const _sinceTemp  = _support.temp  ? _deriveSinceDate(_prevRing.tempSlots, 'date') : null
          const _sinceSteps = _support.steps && _prevIsToday ? _deriveSinceDate(_prevRing.stepSlots, 't') : null
          const _sinceSleep = _support.sleep ? _deriveSinceDate(_prevRing.sleepBlocks, 'dateStr') : null

          await ring.connect(this.data.wearableId, { syncTime: true })
          // Apply background measurement intervals. Track failures so we can detect
          // if the ring's schedule was wiped (e.g. after a full battery drain).
          const _ivals = this.data.haloIntervals
          const _wms   = this.data.haloWorkModes
          const _baseOpts = { startHour: 0, startMinute: 0, endHour: 23, endMinute: 59, weekdays: 0x7F }
          let _monitorFailed = 0
          for (const [type, interval, wm] of [[1, _ivals.hr, _wms.hr], [2, _ivals.spo2, _wms.spo2], [3, _ivals.temp, _wms.temp], [4, _ivals.hrv, _wms.hrv]]) {
            try { await ring.setAutoMonitoring({ ..._baseOpts, workMode: wm, intervalMinutes: interval, type }) }
            catch (_) { _monitorFailed++ }
          }
          // Read back HRV (type 4) to verify the ring accepted the schedule.
          try {
            const _s4 = await ring.getAutoMonitoring(4)
            if (IS_DEV) console.log(JSON.stringify({ level: 'DEBUG', msg: 'HRV monitor readback', brand, config: _s4 }))
            if (_s4.workMode === 0 || _s4.intervalMinutes === 0) {
              console.log(JSON.stringify({ level: 'WARN', msg: 'HRV auto-monitor not active after sync', brand, config: _s4 }))
            }
          } catch (_) {}
          if (_monitorFailed > 0) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'setAutoMonitoring partial failure', brand, failed: _monitorFailed }))
          }
          const battery = await ring.getBattery()
          const steps   = await ring.getSteps(undefined, _sinceSteps).catch(() => null)

          // Sleep: incremental path (see comment above) fetches raw blocks and
          // merges them with the previous sync's raw blocks before re-deriving
          // night summaries — the night/session-grouping algorithm needs the
          // full set of a night's blocks, not just this sync's new slice.
          // Both brands expose getSleepBlocks(sinceDate)/a summarize function
          // with the same shape (Halo: HaloRing.parsers.summariseSleepBlocks;
          // V8: the static V8Band.summariseSleepBlocks) — only which module
          // to pull the summarizer from differs. Non-incremental path (stale/
          // no cursor) is the original full-fetch-then-summarize call, unchanged.
          let mergedSleepBlocks = null
          let sleepHist
          if (_support.sleep) {
            const summariseSleepBlocks = brand === 'halo'
              ? require('../../utils/wearable/halo/index.js').parsers.summariseSleepBlocks
              : require('../../utils/wearable/v8/index.js').summariseSleepBlocks
            const newSleepBlocks = await ring.getSleepBlocks(_sinceSleep).catch(() => [])
            mergedSleepBlocks = _mergeRingSlots(_prevRing.sleepBlocks || [], newSleepBlocks || [], 'dateStr', RING_SLOT_RETENTION_DAYS)
            sleepHist = summariseSleepBlocks(mergedSleepBlocks)
          } else {
            sleepHist = await ring.getSleepHistory().catch(() => [])
          }
          const sleepHistoryNorm = sleepHist.filter(n => n.totalMinutes > 0).map(n => ({
            date: n.date,
            onset: n.onset ?? null,
            totalMinutes: n.totalMinutes,
            deep: n.deep ?? null,
            light: n.light ?? null,
            rem: n.rem ?? null,
            awake: n.awake ?? null,
            sleepStart: n.sleepStart ?? null,
            sleepEnd: n.sleepEnd ?? null,
            slots: n.periods?.map(p => ({ type: p.typeName, min: p.minutes })) ?? null,
          }))
          // Merge every session belonging to the most recent night (see
          // _selectLastNight) so "Last Night" reflects the whole night rather
          // than only its most recent wake-interrupted segment.
          const sleep = _selectLastNight(sleepHistoryNorm)
          const hrLog   = await ring.getHeartRateLog(undefined, _sinceHr).catch(() => null)
          const hrvLog  = await ring.getHrvHistory(_sinceHrv).catch(() => [])            // new/incremental records only [{timestamp, hrv, stress, breath, heartRate, highBP, lowBP}]
          const spo2Log = await ring.getAutoSpo2History(_sinceSpo2).catch(() => [])      // new/incremental records only [{timestamp, spo2}]
          const tempLog = await ring.getTemperatureHistory(_sinceTemp).catch(() => [])   // new/incremental records only [{date, estimatedBodyTemp, skinTemp, status}]
          await ring.disconnect()

          // Merge each type's newly-fetched records into the previous snapshot
          // (see _mergeRingSlots above) so an incremental fetch — which may
          // legitimately return few or zero new records — never regresses the
          // stored/displayed history back down to just this sync's slice, and
          // so a per-type fetch failure (.catch above) can't wipe out
          // previously-synced data the way an unconditional overwrite would.
          const hrEntries      = (hrLog || []).filter(r => r.value > 0)
          const newHrSlots      = hrEntries.map(r => ({ t: r.timestamp.toISOString(), bpm: r.value }))
          const newTempRecords  = (tempLog || []).filter(r => r.estimatedBodyTemp != null && r.estimatedBodyTemp > 34)
          const newStepSlots    = steps?.slots || []
          const mergedHrSlots   = _mergeRingSlots(_prevIsToday ? (_prevRing.hrSlots || []) : [], newHrSlots, 't', null)
          const mergedHrvSlots  = _mergeRingSlots(_prevRing.hrvSlots  || [], hrvLog  || [], 'timestamp', RING_SLOT_RETENTION_DAYS)
          const mergedSpo2Slots = _mergeRingSlots(_prevRing.spo2Slots || [], spo2Log || [], 'timestamp', RING_SLOT_RETENTION_DAYS)
          const mergedTempSlots = _mergeRingSlots(_prevRing.tempSlots || [], newTempRecords, 'date', RING_SLOT_RETENTION_DAYS)
          const mergedStepSlots = _mergeRingSlots(_prevIsToday ? (_prevRing.stepSlots || []) : [], newStepSlots, 't', null)

          const restingHr  = mergedHrSlots.length   ? Math.min(...mergedHrSlots.map(r => r.bpm)) : null
          const latestHrv  = mergedHrvSlots.length  ? mergedHrvSlots[mergedHrvSlots.length - 1]   : {}
          const latestSpo2 = mergedSpo2Slots.length ? mergedSpo2Slots[mergedSpo2Slots.length - 1] : {}
          const latestTemp = mergedTempSlots.length ? mergedTempSlots[mergedTempSlots.length - 1] : {}
          const raw = {
            steps:        steps?.steps       ?? null,
            calories:     steps?.calories    ?? null,
            distance:     steps?.distance    ?? null,
            stepSlots:    mergedStepSlots.length > 0 ? mergedStepSlots : null,
            sleepMinutes: (sleep?.totalMinutes > 0) ? sleep.totalMinutes : null,
            sleepDeep:    sleep?.deep        ?? null,
            sleepLight:   sleep?.light       ?? null,
            sleepRem:     sleep?.rem         ?? null,
            sleepAwake:   sleep?.awake       ?? null,
            sleepStart:   sleep?.sleepStart  ?? null,
            sleepEnd:     sleep?.sleepEnd    ?? null,
            sleepSlots:   sleep?.slots       ?? null,
            sleepOnset:   sleep?.onset       ?? null,
            sleepDate:    sleep?.date        ?? null,
            sleepHistory: sleepHistoryNorm,
            // Raw sleep blocks (Halo incremental path only — null on V8, see
            // INCREMENTAL_SUPPORT above), kept so the next sync can merge new
            // blocks with these before re-deriving night summaries. Not sent
            // to the server (sync.js only reads the fields above); local-only.
            sleepBlocks: mergedSleepBlocks,
            hrSlots:         mergedHrSlots,
            restingHr,
            hrv:             latestHrv.hrv       ?? null,
            stress:          latestHrv.stress    ?? null,
            spo2:            latestSpo2.spo2     ?? null,
            breathRate:      latestHrv.breath    ?? null,
            heartRateFromHrv: latestHrv.heartRate ?? null,
            systolicBP:      latestHrv.highBP   ?? null,
            diastolicBP:     latestHrv.lowBP    ?? null,
            hrvMeasuredAt:   latestHrv.timestamp ?? null,
            hrvSlots:    mergedHrvSlots.length  > 0 ? mergedHrvSlots  : null,
            spo2Slots:   mergedSpo2Slots.length > 0 ? mergedSpo2Slots : null,
            tempSlots:   mergedTempSlots.length > 0 ? mergedTempSlots : null,
            bodyTempC:   latestTemp.estimatedBodyTemp ?? null,
            syncedAt: Date.now(),
          }
          if (IS_DEV) {
            console.log(JSON.stringify({
              level: 'DEBUG', msg: 'incremental sync', brand,
              hr:    { since: _sinceHr,    fetched: newHrSlots.length,      merged: mergedHrSlots.length },
              hrv:   { since: _sinceHrv,   fetched: (hrvLog || []).length,  merged: mergedHrvSlots.length },
              spo2:  { since: _sinceSpo2,  fetched: (spo2Log || []).length, merged: mergedSpo2Slots.length },
              temp:  { since: _sinceTemp,  fetched: newTempRecords.length,  merged: mergedTempSlots.length },
              steps: { since: _sinceSteps, fetched: newStepSlots.length,    merged: mergedStepSlots.length },
              sleep: { since: _sinceSleep, mergedBlocks: mergedSleepBlocks ? mergedSleepBlocks.length : null, nights: sleepHistoryNorm.length },
            }))
          }
          this._commitRingData(raw, battery.level, isZh, false)
        } catch (e) {
          await ring.disconnect().catch(() => {})
          if (IS_DEV) console.error(`[BLE][sync:${brand}]`, e?.message || e?.errMsg || e)
          if (!_isPrivacyError(e)) wx.showToast({ title: t.wearableSyncFail, icon: 'none' })
          this.setData({ wearableConnected: false, wearableBusy: false })
        } finally {
          this.setData({ wearableBusy: false, ringMeasuring: false })
        }
        return
      }

      // ── Aizo: single-phase sync — all data is historical, sourced from the
      // 0xCC health-history sync (which carries HR+HRV+SpO2+stress+temp per
      // sample — richer per-reading detail than Halo needs separate endpoints
      // for) plus the sleep summary/detail sync. Built the same way as the
      // Halo branch above (individual getters, not syncAll()) for parity. ──
      if (brand === 'aizo') {
        try {
          const savedDev = wx.getStorageSync('wearable_device') || {}
          await ring.connect(this.data.wearableId, { name: savedDev.name || '' })
          const battery   = await ring.getBattery()
          const steps     = await ring.getSteps().catch(() => null)
          const sleepHist = await ring.getSleepHistory().catch(() => [])
          const sleepHistoryNorm = sleepHist.filter(n => n.totalMinutes > 0).map(n => ({
            date: n.date,
            onset: n.onset ?? null,
            totalMinutes: n.totalMinutes,
            deep: n.deep ?? null,
            light: n.light ?? null,
            rem: n.rem ?? null,
            awake: n.awake ?? null,
            sleepStart: n.sleepStart ?? null,
            sleepEnd: n.sleepEnd ?? null,
            slots: n.periods?.map(p => ({ type: p.typeName, min: p.minutes })) ?? null,
          }))
          const sleep = _selectLastNight(sleepHistoryNorm)
          const hrLog   = await ring.getHeartRateLog().catch(() => null)
          const hrvLog  = await ring.getHrvHistory().catch(() => [])           // [{timestamp, hrv, stress, breath, heartRate, highBP, lowBP}]
          const spo2Log = await ring.getAutoSpo2History().catch(() => [])     // [{timestamp, spo2}]
          const tempLog = await ring.getTemperatureHistory().catch(() => [])  // [{timestamp, estimatedBodyTemp, skinTemp, status}]
          await ring.disconnect()

          const hrEntries  = (hrLog || []).filter(r => r.value > 0)
          const restingHr  = hrEntries.length ? Math.min(...hrEntries.map(r => r.value)) : null
          // HR and stress are on independent auto-monitor schedules on Aizo (HR
          // ticks roughly every 20min, stress every 45min — see protocol spec
          // §6.0.1), so a single health-history sample often has one field
          // populated and the other 0/null. Taking the chronologically *last*
          // record (as Halo's single-endpoint HRV reading safely can, since
          // hrv+stress+breath+bp always arrive together there) would pick
          // whichever field that particular tick happened to measure and show
          // "—" for the other even though an earlier same-day sample has it —
          // this is exactly what showed a stress trend but a blank "current
          // stress" reading. Scan backward per-field instead.
          const latestWith = (arr, field) => {
            for (let i = arr.length - 1; i >= 0; i--) if (arr[i][field] != null) return arr[i]
            return {}
          }
          const latestHrvEntry    = latestWith(hrvLog, 'hrv')
          const latestStressEntry = latestWith(hrvLog, 'stress')
          const latestSpo2 = spo2Log.length ? spo2Log[spo2Log.length - 1] : {}
          const validTemps = (tempLog || []).filter(r => r.estimatedBodyTemp != null && r.estimatedBodyTemp > 34)
          const latestTemp = validTemps.length ? validTemps[validTemps.length - 1] : {}
          const raw = {
            steps:        steps?.steps       ?? null,
            calories:     steps?.calories    ?? null,
            distance:     steps?.distance    ?? null,
            stepSlots:    null,
            sleepMinutes: (sleep?.totalMinutes > 0) ? sleep.totalMinutes : null,
            sleepDeep:    sleep?.deep        ?? null,
            sleepLight:   sleep?.light       ?? null,
            sleepRem:     sleep?.rem         ?? null,
            sleepAwake:   sleep?.awake       ?? null,
            sleepStart:   sleep?.sleepStart  ?? null,
            sleepEnd:     sleep?.sleepEnd    ?? null,
            sleepSlots:   sleep?.slots       ?? null,
            sleepOnset:   sleep?.onset       ?? null,
            sleepDate:    sleep?.date        ?? null,
            sleepHistory: sleepHistoryNorm,
            // Aizo timestamps are already "YYYY-MM-DD HH:MM:SS" strings (not
            // Date objects like Halo's hrLog) — pass through as-is.
            hrSlots:         hrEntries.map(r => ({ t: r.timestamp, bpm: r.value })),
            restingHr,
            hrv:             latestHrvEntry.hrv       ?? null,
            stress:          latestStressEntry.stress ?? null,
            spo2:            latestSpo2.spo2          ?? null,
            breathRate:      null,
            heartRateFromHrv: latestHrvEntry.heartRate ?? null,
            systolicBP:      null,
            diastolicBP:     null,
            hrvMeasuredAt:   latestHrvEntry.timestamp ?? null,
            hrvSlots:    hrvLog.length       > 0 ? hrvLog       : null,
            spo2Slots:   spo2Log.length      > 0 ? spo2Log      : null,
            tempSlots:   validTemps.length   > 0 ? validTemps   : null,
            bodyTempC:   latestTemp.estimatedBodyTemp ?? null,
            syncedAt: Date.now(),
          }
          this._commitRingData(raw, battery.level, isZh, false)
        } catch (e) {
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
      let battery, steps, sleep, hrLog
      try {
        await ring.connect(this.data.wearableId, { name: this.data.wearableName || '' })
        battery = await ring.getBattery()
        steps   = await ring.getSteps().catch(() => null)
        sleep   = await ring.getSleep().catch(() => null)
        hrLog   = await ring.getHeartRateLog().catch(() => null)
      } catch (e) {
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
        sleepHistory: (sleep?.totalMinutes > 0) ? [{ date: _shanghaiDateStr(Date.now()), totalMinutes: sleep.totalMinutes, deep: sleep.deep ?? null, light: sleep.light ?? null, rem: sleep.rem ?? null, awake: sleep.awake ?? null }] : [],
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
      // syncWearableData() never rejects (its wx.request `fail` handler resolves
      // with {success:false, error} instead of throwing), so a bare .catch() here
      // can never fire and any real failure (domain block, auth, 5xx) was
      // previously discarded silently. Inspect the resolved result instead.
      syncWearableData(this.properties.userId, { source: 'smart_ring', wearableName: this.data.wearableName || null, ...raw }, app?.globalData?.apiToken)
        .then((res) => {
          if (res && res.success === false && IS_DEV) {
            console.error(JSON.stringify({ level: 'ERROR', msg: 'wearable server sync failed', error: res.error }))
          }
        })
        .catch((e) => { if (IS_DEV) console.error(JSON.stringify({ level: 'ERROR', msg: 'wearable server sync threw', error: e?.message || e })) })

      // Accumulate today's realtime (Phase 2) readings for Colmi on-demand measurements.
      // Halo uses ring.hrvSlots / spo2Slots from its auto-monitoring buffer — skip accumulation
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
      const _charts2 = _buildReadingLineCharts(rawReadings)
      const _base2 = _buildRingDisplayData(raw, isZh)
      const ringData = { ..._base2, realtimeReadings, hasRealtimeReadings: realtimeReadings.length > 0, ..._charts2, hasSlotCharts: _base2.hasSlotCharts || _charts2.hrvChart.hasData || _charts2.spo2Chart.hasData || _charts2.stressChart.hasData }
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
        mood: computeMood(ringData),
        hasTwinData: visuals.vitalGauges.length > 0,
        twinLoading: false,
        ...visuals,
      })
    },

    async toggleRingSettings() {
      if (this.data.ringSettingsOpen) {
        this.setData({ ringSettingsOpen: false, haloIntervalsChanged: false, haloRingTime: null })
        return
      }
      if (this.data.wearableBusy || this.data.ringSettingsBusy) return

      // Brands without interval settings — just open the panel
      if (!_hasIntervalSettings(this.data.wearableBrand)) {
        this.setData({ ringSettingsOpen: true })
        return
      }

      this.setData({ ringSettingsOpen: true, ringSettingsBusy: true })
      const { createWearable } = require('../../utils/wearable/index.js')
      const ring = createWearable(this.data.wearableBrand)
      try {
        await ring.connect(this.data.wearableId)
        const s1 = await ring.getAutoMonitoring(1)
        const s2 = await ring.getAutoMonitoring(2)
        const s3 = await ring.getAutoMonitoring(3)
        const s4 = await ring.getAutoMonitoring(4)
        const ringTime = await ring.getDeviceTime().catch(() => null)
        let haloRingTime = null
        if (ringTime) {
          const hh = String(ringTime.getHours()).padStart(2, '0')
          const mm = String(ringTime.getMinutes()).padStart(2, '0')
          const ss = String(ringTime.getSeconds()).padStart(2, '0')
          haloRingTime = `${hh}:${mm}:${ss}`
        }
        this.setData({
          haloIntervals: { hr: s1.intervalMinutes, spo2: s2.intervalMinutes, temp: s3.intervalMinutes, hrv: s4.intervalMinutes },
          haloWorkModes: { hr: s1.workMode, spo2: s2.workMode, temp: s3.workMode, hrv: s4.workMode },
          haloRingTime,
          haloIntervalsChanged: false,
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
      this.setData({ haloIntervals: { ...this.data.haloIntervals, [type]: min }, haloIntervalsChanged: true })
    },

    handleWorkModeChange(e) {
      const { type } = e.currentTarget.dataset
      const modes = this.data.haloWorkModes
      const next = { 0: 1, 1: 2, 2: 0 }
      this.setData({ haloWorkModes: { ...modes, [type]: next[modes[type]] ?? 2 }, haloIntervalsChanged: true })
    },

    async saveRingIntervals() {
      if (this.data.ringSettingsBusy || this.data.wearableBusy) return
      this.setData({ ringSettingsBusy: true })
      const ivals = this.data.haloIntervals
      const wms   = this.data.haloWorkModes
      const baseOpts = { startHour: 0, startMinute: 0, endHour: 23, endMinute: 59, weekdays: 0x7F }
      const { createWearable } = require('../../utils/wearable/index.js')
      const ring = createWearable(this.data.wearableBrand)
      try {
        await ring.connect(this.data.wearableId)
        // Sync ring clock if it drifts more than 1 minute from host time
        try {
          const ringTime = await ring.getDeviceTime()
          if (!ringTime || Math.abs(Date.now() - ringTime.getTime()) > 60000) {
            await ring.setTime(new Date())
          }
        } catch (_) {}
        await ring.setAutoMonitoring({ ...baseOpts, workMode: wms.hr,   intervalMinutes: ivals.hr,   type: 1 })
        await ring.setAutoMonitoring({ ...baseOpts, workMode: wms.spo2, intervalMinutes: ivals.spo2, type: 2 })
        await ring.setAutoMonitoring({ ...baseOpts, workMode: wms.temp, intervalMinutes: ivals.temp, type: 3 })
        await ring.setAutoMonitoring({ ...baseOpts, workMode: wms.hrv,  intervalMinutes: ivals.hrv,  type: 4 })
        wx.setStorageSync('halo_interval_settings', ivals)
        wx.setStorageSync('halo_work_mode_settings', wms)
        this.setData({ haloIntervalsChanged: false })
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
            wx.removeStorageSync('halo_interval_settings')
            wx.removeStorageSync('halo_work_mode_settings')
            wx.removeStorageSync('x3_interval_settings')
            wx.removeStorageSync('x3_work_mode_settings')
            this.setData({ wearableId: '', wearableName: '', wearableBrand: '', wearableConnected: false, wearableBattery: 0, ringData: null, mood: DEFAULT_MOOD, wearableServerHint: null })
            this._syncWearableBindingToServer(null)
          }
        },
      })
    },

    noop() {},
  },
})
