const app = getApp()
const { BASE } = require('../../utils/config.js')
const toolActions = require('../../utils/tool-actions')

const KINO_SIM_SERIAL = 'KNA2-00000'

const CART_SETS = [
  {
    key: 'set-bioage-reducing',
    nameZh: '逆龄还原套装', nameEn: 'BioAge Reducing',
    descZh: '细胞年龄 · 代谢韧性', descEn: 'Cellular Age · Metabolic Resilience',
    color: '#6375EC',
    dotItems: [
      { key: 'DOT01', zhName: '细胞原力', enName: 'Cellular Fuel' },
      { key: 'DOT02', zhName: '细胞守护', enName: 'Cellular Guard' },
      { key: 'DOT03', zhName: '细胞催化', enName: 'Cellular Catalyst' },
      { key: 'DOT04', zhName: '细胞净化', enName: 'Cellular Cleanup' },
      { key: 'DOT05', zhName: '代谢韧性', enName: 'Metabolic Resilience' },
      { key: 'DOT06', zhName: '紧致焕颜', enName: 'Dermal Radiance' },
    ],
  },
  {
    key: 'set-energy-boost',
    nameZh: '能量提升套装', nameEn: 'Energy Boost',
    descZh: '代谢 · 微血管 · 抗压 · 睡眠', descEn: 'Metabolic · Vascular · Resilience · Sleep',
    color: '#10b981',
    dotItems: [
      { key: 'DOT07', zhName: '代谢动力', enName: 'Metabolic Power' },
      { key: 'DOT08', zhName: '血管唤醒', enName: 'Vascular Awakening' },
      { key: 'DOT09', zhName: '抗压支持', enName: 'Resilience Support' },
      { key: 'DOT10', zhName: '晨间引擎', enName: 'Morning Ignition' },
      { key: 'DOT11', zhName: '巅峰体能', enName: 'Athletic Peak' },
      { key: 'DOT12', zhName: '深度睡眠', enName: 'Deep Sleep' },
    ],
  },
  {
    key: 'set-system-optimization',
    nameZh: '系统调优套装', nameEn: 'System Optimization',
    descZh: '微血管 · 抗压年龄 · 肠道 · 免疫', descEn: 'Vascular · Resilience · Gut · Immunity',
    color: '#f59e0b',
    dotItems: [
      { key: 'DOT13', zhName: '微血管通流', enName: 'Vascular Flow' },
      { key: 'DOT14', zhName: '微血管保护', enName: 'Vascular Protection' },
      { key: 'DOT15', zhName: '禅意共振', enName: 'Zen Resonance' },
      { key: 'DOT16', zhName: '抗压防御', enName: 'Resilience Defense' },
      { key: 'DOT17', zhName: '肠道微生态', enName: 'Gut & Microbiome' },
      { key: 'DOT18', zhName: '免疫防御', enName: 'Immunity & Gastric' },
    ],
  },
]

// ── i18n ──────────────────────────────────────────────────────────────────────

const T = {
  zh: {
    tabChat: '对话', tabHealth: '健康', tabDots: '原粒', tabPlans: '方案', tabStore: '补给',
    plansTitle: '健康方案',
    plansEmpty: '暂无进行中的健康方案',
    plansBrowse: '加入方案',
    plansPrimary: '主方案', plansSecondary: '辅方案',
    plansAdherence: '打卡率', plansWeeks: '周',
    plansCheckin: '今日打卡', plansCheckinDone: '已打卡',
    plansAbandon: '放弃方案', plansSwitch: '切换主/辅',
    plansJoin: '加入方案',
    plansSubTabOverview: '概览', plansSubTabProgress: '进度',
    plansSubTabActivities: '活动', plansSubTabGuidance: '指导',
    plansStartDate: '开始日期', plansTargetSubAges: '目标维度',
    plansRecommendedDots: '推荐原粒', plansGoal: '目标',
    plansBaselineVsCurrent: '初始 vs 当前生理年龄',
    plansNoMilestones: '暂无里程碑记录',
    plansTemplates: '可加入的方案',
    plansDuration: '周期', plansSource: '来源',
    plansJoinPrimary: '加入为主方案', plansJoinSecondary: '加入为辅方案', plansAlreadyEnrolled: '已加入',
    planReminders: '提醒设置', planReminderPause: '暂停', planReminderResume: '恢复', planNoReminders: '此方案暂无提醒',
    plansConflict: '该槽位已有方案，是否替换？',
    plansConfirmAbandon: '确认放弃此方案？放弃后可重新加入。',
    plansConfirmSwitch: '确认切换主/辅方案？',
    remindersTitle: '即将提醒',
    remindersEmpty: '暂无即将到来的提醒',
    reminderSourceCoach: '教练',
    reminderSourceAi: 'AI',
    reminderRecurDaily: '每天',
    reminderRecurWeekly: '每周',
    taskDots: '服用原粒', taskWeight: '记录体重', taskQuestions: '每日问答',
    taskWeightTitle: '记录体重', taskWeightPlaceholder: '输入体重（公斤）',
    taskWeightConfirm: '确认', taskWeightCancel: '取消',
    taskQuestionsTitle: '每日问答',
    taskQEnergy: '今天的精力如何？', taskQSleep: '昨晚睡眠如何？', taskQMood: '整体状态如何？',
    taskQSubmit: '提交', taskQCancel: '取消',
    todayProgress: '今日进度',
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
    obComplete: '谢谢您的回答！',
    questionnaireThanks: '感谢您的回答！您的健康教练很快会跟进。',
    questionnaireIntro: '您的健康教练有几个问题想了解您。',
    confirm: '确认',
    bsHeight: '身高', bsWeight: '体重', bsCm: 'cm', bsKg: 'kg',
    male: '男', female: '女',
    selectBirthday: '选择出生日期',
    dotsTitle: '营养方案',
    cartridgeTitle: '原粒盒',
    noCartridges: '未插入原粒盒。请将原粒盒插入分配器。',
    simCartTitle: '选择套装',
    simCartSubtitle: '自动生成 NFC 标签并插入',
    simCartInserting: '正在插入…',
    simCartDone: '套装已插入！',
    simCartCancel: '取消',
    noPlan: '暂无营养方案。完成 Kino 生物标志物检测后，系统将为您生成个性化方案。',
    morning: '早上', evening: '晚上', today: '今天', tomorrow: '明天',
    dispenseTitle: '分发原粒', dispenseMorning: '今日早上配方', dispenseEvening: '今日晚上配方',
    dispenseBtn: '立即分发', dispensing: '正在分发…', dispenseOk: '✓ 已成功分发', dispenseErr: '分发失败，点击重试', dispenseNoDots: '此时段暂无配方',
    obConditionsPrompt: '您是否曾被诊断/体检出以下方面的问题？（可多选）',
    obConditionsNone: '以上均无',
    obConditionsOtherPh: '请描述您的其他健康状况',
    storeTitle: '健康补给站',
    storeBuy: '立即预约',
    storeOrderSent: '订单已提交！我们的健康教练将尽快与您联系。',
    storeConfirmTitle: '确认订单',
    storeBestseller: '热销', storeValue: '超值',
    storeEmpty: '暂无商品。',
    storeSubProducts: '商品', storeSubOrders: '我的订单',
    noOrders: '暂无订单记录。',
    toolFormulaDots: '营养定制',
    toolTestChip: '检测服务',
    toolHealthAdvice: '健康管理',
    toolUploadImage: '上传图片',
    imageUploading: '正在上传图片…',
    imageAnalyzing: '正在分析图片，请稍候…',
    imageError: '图片分析失败，请重试。',
    toolFormulaDotMsg: '请帮我配制我的 DOTS 方案',
    toolTestChipMsg: '我想使用 Kino 芯片',
    toolHealthAdviceMsg: '请分析我目前的健康状态，并给我专业的健康建议。',
    healthAdviceGenerating: '正在分析您的健康数据，请稍候…',
    healthAdviceError: '健康分析请求失败，请重试。',
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
    kinoSimChipNotFound: '未找到芯片记录，请先在手机端登记芯片。',
    kinoSimChipUsed: '此芯片已完成检测，无法重复使用。',
    kinoSimPatientLabel: '受检者',
    kinoSimTabBioAge: '生理年龄',
    kinoSimTabBm: '生物标志物',
    kinoSimBioAgeLabel: '生理年龄',
    kinoSimChronoLabel: '实际年龄',
    kinoScanPrompt: '请扫描您 Kino 芯片上的二维码，以登记您的芯片。',
    kinoScanBtn: '扫描二维码',
    kinoScanSuccess: '您的 Kino 芯片已成功登记！',
    kinoScanInstruction: '请将芯片插入 Kino 分析仪，开始检测。',
    kinoScanAlreadyLinked: '此芯片已绑定到您的账户，正在等待检测结果。',
    kinoScanUsed: '此芯片已完成检测，无法重复登记。',
    kinoScanInvalidChip: '此二维码不是有效的 Kino 芯片，请扫描芯片上的二维码。',
    kinoScanError: '登记失败，请重试。',
    bmLabels: { hsCRP: 'hs-CRP', GDF15: 'GDF-15', IL6: 'IL-6', GA: '糖化白蛋白', CystatinC: '胱抑素 C', CD38: 'CD38' },
    subAgeLabels: { ResilienceAge: '抗压年龄', CellularAge: '细胞年龄', MetabolicAge: '代谢年龄', MicroVascularAge: '微血管年龄' },
    lightMode: '浅色模式',
    darkMode: '深色模式',
    phonePromptMsg: '最后一步！绑定手机号，让您的健康教练可以随时联系到您。',
    phonePromptBtn: '📱 绑定手机号',
    phoneMaybeLater: '稍后再说',
    phoneBindSuccess: '手机号绑定成功！',
    phoneBindError: '绑定失败，请稍后重试。',
    guestHeaderName: '游客',
    guestJoinTitle: '激活健康账户',
    guestJoinDesc: '输入您的邀请码，解锁 AI 健康教练、生物标志物检测与精准营养方案。',
    guestJoinBtn: '激活账户',
    guestActivating: '注册中…',
    guestInviteRequired: '请输入邀请码',
    guestInviteInvalid: '邀请码无效或已失效，请重新输入',
    guestPhoneTitle: '完善您的资料',
    guestPhoneDesc: '以下两项为注册必填信息。',
    guestAvatarLabel: '使用我的微信头像',
    guestPhoneLabel: '授权手机号',
    guestContinueBtn: '继续',
    guestCancelSignup: '退出注册',
    guestChatCtaText: '输入邀请码，激活您的 AI 健康伴侣',
    guestChatCtaBtn: '立即加入',
    guestDotsCta: '激活账户后，获取您的专属营养方案',
    guestMenuSignUp: '注册账户',
    orderStatus: {
      pending: '待处理', confirmed: '已确认', shipped: '已发货',
      delivered: '已送达', cancelled: '已取消',
    },
  },
  en: {
    tabChat: 'Chat', tabHealth: 'Health', tabDots: 'Dots', tabPlans: 'Plans', tabStore: 'Store',
    plansTitle: 'Health Plans',
    plansEmpty: 'No active health plans',
    plansBrowse: 'Browse Plans',
    plansPrimary: 'Primary', plansSecondary: 'Secondary',
    plansAdherence: 'Adherence', plansWeeks: 'wks',
    plansCheckin: 'Check In', plansCheckinDone: 'Checked In',
    plansAbandon: 'Abandon Plan', plansSwitch: 'Switch Type',
    plansJoin: 'Join Plan',
    plansSubTabOverview: 'Overview', plansSubTabProgress: 'Progress',
    plansSubTabActivities: 'Activities', plansSubTabGuidance: 'Guidance',
    plansStartDate: 'Start Date', plansTargetSubAges: 'Target Sub-Ages',
    plansRecommendedDots: 'Recommended Dots', plansGoal: 'Goal',
    plansBaselineVsCurrent: 'Baseline vs Current BioAge',
    plansNoMilestones: 'No milestone records yet',
    plansTemplates: 'Available Plans',
    plansDuration: 'Duration', plansSource: 'Source',
    plansJoinPrimary: 'Join as Primary', plansJoinSecondary: 'Join as Secondary', plansAlreadyEnrolled: 'Current Plan',
    planReminders: 'Reminders', planReminderPause: 'Pause', planReminderResume: 'Resume', planNoReminders: 'No reminders for this plan',
    plansConflict: 'That slot is occupied. Replace existing plan?',
    plansConfirmAbandon: 'Abandon this plan? You can rejoin anytime.',
    plansConfirmSwitch: 'Switch primary/secondary?',
    remindersTitle: 'Upcoming Reminders',
    remindersEmpty: 'No upcoming reminders',
    reminderSourceCoach: 'Coach',
    reminderSourceAi: 'AI',
    reminderRecurDaily: 'Daily',
    reminderRecurWeekly: 'Weekly',
    taskDots: 'Dots', taskWeight: 'Weight', taskQuestions: 'Questions',
    taskWeightTitle: 'Log Weight', taskWeightPlaceholder: 'Enter weight (kg)',
    taskWeightConfirm: 'Confirm', taskWeightCancel: 'Cancel',
    taskQuestionsTitle: 'Daily Check-in',
    taskQEnergy: "How's your energy today?", taskQSleep: 'How did you sleep?', taskQMood: 'How do you feel?',
    taskQSubmit: 'Submit', taskQCancel: 'Cancel',
    todayProgress: 'Today',
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
    obComplete: 'Thanks for your answers!',
    questionnaireThanks: 'Thanks for your answers! Your coach will review them shortly.',
    questionnaireIntro: 'Your health coach has a few quick questions for you.',
    confirm: 'Confirm',
    bsHeight: 'Height', bsWeight: 'Weight', bsCm: 'cm', bsKg: 'kg',
    male: 'Male', female: 'Female',
    selectBirthday: 'Select Birthday',
    dotsTitle: 'Nutrition Plan',
    cartridgeTitle: 'Cartridges',
    noCartridges: 'No cartridges inserted. Insert cartridges into your dispenser.',
    simCartTitle: 'Choose a Set',
    simCartSubtitle: 'Auto-generates NFC tags and inserts',
    simCartInserting: 'Inserting…',
    simCartDone: 'Set inserted!',
    simCartCancel: 'Cancel',
    noPlan: 'No nutrition plan yet. Complete a Kino biomarker test to generate your personalized plan.',
    morning: 'Morning', evening: 'Evening', today: 'Today', tomorrow: 'Tomorrow',
    dispenseTitle: 'Dispense Dots', dispenseMorning: "Today's Morning Dose", dispenseEvening: "Today's Evening Dose",
    dispenseBtn: 'Dispense Now', dispensing: 'Dispensing…', dispenseOk: '✓ Dispensed Successfully', dispenseErr: 'Failed — tap to retry', dispenseNoDots: 'No dots scheduled for this slot',
    obConditionsPrompt: 'Have you ever been diagnosed with or identified any of the following? (Select all that apply)',
    obConditionsNone: 'None of the above',
    obConditionsOtherPh: 'Please describe your other health condition',
    storeTitle: 'Health Store',
    storeBuy: 'Reserve Now',
    storeOrderSent: 'Order placed! Our health advisor will reach out shortly.',
    storeConfirmTitle: 'Confirm Order',
    storeBestseller: 'Best Seller', storeValue: 'Value Pack',
    storeEmpty: 'No products available.',
    storeSubProducts: 'Products', storeSubOrders: 'My Orders',
    noOrders: 'No orders yet.',
    toolFormulaDots: 'Formulate Dots',
    toolTestChip: 'Use Kino Chip',
    toolHealthAdvice: 'Health Advice',
    toolUploadImage: 'Upload Image',
    imageUploading: 'Uploading image…',
    imageAnalyzing: 'Analyzing your image, please wait…',
    imageError: 'Image analysis failed. Please try again.',
    toolFormulaDotMsg: 'Please formulate my Dots plan',
    toolTestChipMsg: 'I want to use a Kino chip',
    toolHealthAdviceMsg: 'Please analyze my current health status and give me personalized health advice.',
    healthAdviceGenerating: 'Analyzing your health data, please wait…',
    healthAdviceError: 'Health analysis request failed. Please try again.',
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
    kinoSimChipNotFound: 'Chip not registered. Please register it in the app first.',
    kinoSimChipUsed: 'This chip has already been analyzed and cannot be used again.',
    kinoSimPatientLabel: 'PATIENT',
    kinoSimTabBioAge: 'Bio Age',
    kinoSimTabBm: 'Biomarkers',
    kinoSimBioAgeLabel: 'BIO AGE',
    kinoSimChronoLabel: 'CHRONO AGE',
    kinoScanPrompt: 'Please scan the QR code on your Kino chip to register your Chip.',
    kinoScanBtn: 'Scan QR Code',
    kinoScanSuccess: 'Your Kino chip has been registered!',
    kinoScanInstruction: 'Now insert the chip into the Kino Analyzer to begin the test.',
    kinoScanAlreadyLinked: 'This chip is already linked to your account and is awaiting analysis.',
    kinoScanUsed: 'This chip has already been analyzed and cannot be registered again.',
    kinoScanInvalidChip: 'This QR code is not a valid Kino chip. Please scan the QR code on your chip.',
    kinoScanError: 'Registration failed. Please try again.',
    bmLabels: { hsCRP: 'hs-CRP', GDF15: 'GDF-15', IL6: 'IL-6', GA: 'Glycated Albumin', CystatinC: 'Cystatin C', CD38: 'CD38' },
    subAgeLabels: { ResilienceAge: 'Resilience Age', CellularAge: 'Cellular Age', MetabolicAge: 'Metabolic Age', MicroVascularAge: 'Micro-Vascular Age' },
    lightMode: 'Light Mode',
    darkMode: 'Dark Mode',
    phonePromptMsg: 'One last thing — link your phone number so your health advisor can reach you when needed.',
    phonePromptBtn: '📱 Link Phone Number',
    phoneMaybeLater: 'Maybe later',
    phoneBindSuccess: 'Phone number linked successfully!',
    phoneBindError: 'Failed to link phone number. Please try again.',
    guestHeaderName: 'Guest',
    guestJoinTitle: 'Activate Your Account',
    guestJoinDesc: 'Enter your invite code to unlock AI health coaching, biomarker testing, and precision nutrition.',
    guestJoinBtn: 'Activate Account',
    guestActivating: 'Activating…',
    guestInviteRequired: 'Please enter an invite code',
    guestInviteInvalid: 'Invalid or expired invite code. Please try again.',
    guestPhoneTitle: 'Complete Your Profile',
    guestPhoneDesc: 'Both items below are required to sign up.',
    guestAvatarLabel: 'Use my WeChat avatar',
    guestPhoneLabel: 'Authorize phone number',
    guestContinueBtn: 'Continue',
    guestCancelSignup: 'Cancel sign-up',
    guestChatCtaText: 'Enter your invite code to activate your AI health companion',
    guestChatCtaBtn: 'Join Now',
    guestDotsCta: 'Activate your account to get your personalized nutrition plan',
    guestMenuSignUp: 'Sign Up',
    orderStatus: {
      pending: 'Pending', confirmed: 'Confirmed', shipped: 'Shipped',
      delivered: 'Delivered', cancelled: 'Cancelled',
    },
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTH_EN = ['January','February','March','April','May','June',
  'July','August','September','October','November','December']

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

function localISODate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getWeekRange() {
  const now = new Date()
  const dow = now.getDay()
  const daysFromMonday = dow === 0 ? 6 : dow - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - daysFromMonday)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { monday: localISODate(monday), sunday: localISODate(sunday) }
}

function fmtWeekLabel(monday, sunday, lang) {
  const m = new Date(monday + 'T12:00:00Z')
  const s = new Date(sunday + 'T12:00:00Z')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (lang === 'zh') return `${m.getUTCMonth()+1}月${m.getUTCDate()}日 – ${s.getUTCMonth()+1}月${s.getUTCDate()}日`
  return `${months[m.getUTCMonth()]} ${m.getUTCDate()} – ${months[s.getUTCMonth()]} ${s.getUTCDate()}`
}

function mapCartridges(cartridges, lang) {
  return cartridges.map(c => {
    const pct = Math.max(0, Math.round((c.remaining_dots / c.total_dots) * 100))
    const barColor = pct < 10 ? '#FF4D4D' : pct < 25 ? '#F5A623' : (c.color_hex || '#6375EC')
    return {
      id: c.id,
      dotKey: c.dot_key.replace('DOT', 'D'),
      dotName: lang === 'zh' ? (c.dot_name_zh || c.dot_name) : c.dot_name,
      colorHex: c.color_hex || '#6375EC',
      barColor,
      timing: c.timing,
      remaining: c.remaining_dots,
      total: c.total_dots,
      percent: pct,
      status: c.status,
      isEmpty: c.status === 'empty',
    }
  })
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
          color: dot.color_hex || '#6375EC',
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

function mapStructuredSchedules(schedules, dotsMap, lang) {
  const dayGroups = {}
  const now = new Date()
  const todayStr = localISODate(now)

  schedules.forEach(s => {
    // PG DATE type might come back as full ISO string or just date
    const datePart = typeof s.scheduled_date === 'string' ? s.scheduled_date.split('T')[0] : s.scheduled_date
    const dateStr = datePart
    if (!dayGroups[dateStr]) {
      dayGroups[dateStr] = {
        dateStr,
        label: fmtDate(dateStr, lang),
        isToday: dateStr === todayStr,
        morning: [],
        evening: []
      }
    }

    const dots = s.recipe?.dots || {}
    const parsedDots = Object.entries(dots).map(([key, count]) => {
      const dot = dotsMap[key] || {}
      return {
        displayKey: key.replace('DOT', 'D'),
        count,
        color: dot.color_hex || '#6375EC'
      }
    })

    if (s.slot_name === 'morning_cup') {
      dayGroups[dateStr].morning = parsedDots
    } else if (s.slot_name === 'evening_cup') {
      dayGroups[dateStr].evening = parsedDots
    }
  })

  return Object.values(dayGroups).sort((a, b) => {
    return new Date(a.label).getTime() - new Date(b.label).getTime()
  })
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
    toolList: [],
    kinoScanPending: false,

    // Kino Simulator passcode
    kinoPassOpen: false,
    kinoPassInput: '',
    kinoPassError: false,

    // Kino Simulator
    kinoSimOpen: false,
    kinoSimStatus: 'ready',
    kinoSimDebug: false,
    kinoSimError: '',
    kinoSimBmList: [],
    kinoSimSubAgeList: [],
    kinoSimBioAge: null,
    kinoSimChronoAge: null,
    kinoSimBioAgeColor: '#A6C4E5',
    kinoSimActiveTab: 'bioage',
    kinoSimSlideIndex: 0,
    kinoSimSlideVisible: true,
    kinoSimScannedUserId: null,
    kinoSimScannedUserName: null,
    kinoSimChipId: null,
    kinoSimDeviceId: null,
    obStep: null,              // current question key, 'done', or null
    obQuestion: null,          // current question config from questionnaire_questions
    obQuestions: [],           // all active questions for current questionnaire
    obAssignmentId: null,      // current assignment ID
    obQuestionnaireType: null, // 'onboarding' or 'custom' — used for completion message
    obQIndex: 0,           // current question index in obQuestions
    obSliders: {},         // { height: 165, weight: 65 } keyed by slider.key
    obSliderDisplay: {},   // { weight: '65.0' } formatted display values
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

    userAvatarLetter: 'U',

    // Channel
    channel: null,

    // Role menu flags
    menuOpen: false,
    isCoach: false,
    isAdmin: false,
    isSuperadmin: false,
    isGuest: false,

    // Guest join sheet
    guestSheetOpen: false,
    guestInviteCode: '',
    guestInviteDigits: ['', '', '', '', '', ''],
    guestInviteBusy: false,
    guestInviteError: '',
    guestSheetStep: 'invite',
    guestKeyboardHeight: 0,
    guestPendingAvatar: '',
    guestAvatarDone: false,
    guestAvatarUploading: false,
    guestAvatarReady: false,
    guestPhoneDone: false,
    guestResolvedPhone: '',

    // Dots
    dotsLoading: true,
    dotsDays: [],
    hasPlan: false,
    todayScrollLeft: 0,
    dispenseSlot: '',
    dispenseSlotDots: [],
    dispenseDate: '',
    dispenseHasToday: false,
    dispenseStatus: '',
    cartridges: [],
    cartridgesLoading: true,
    weekLabel: '',
    simCartOpen: false,
    simCartLoading: false,
    simCartSets: [],

    // Store
    storeLoading: true,
    storeItems: [],
    storeOrders: [],
    storeSubTab: 'products',
    // Plans tab
    plansLoading: true,
    activePlans: [],
    planTemplates: [],
    planDetailOpen: false,
    planDetailData: null,
    planSubTab: 'overview',
    planBrowseOpen: false,
    planCheckinBusy: false,
    planTaskBusy: false,
    planWeightOpen: false,
    planWeightInput: '',
    planWeightPlanId: null,
    planWeightKeyboard: 0,
    planQuestionsOpen: false,
    planQuestionsData: { energy: 3, sleep: 3, mood: 3 },
    planQuestionsPlanId: null,
    upcomingReminders: [],
    remindersLoading: false,
  },

  _pollingTimer: null,
  _kinoSlideTimer: null,
  _seenIds: null,
  _rawStoreItems: null,
  _rawStoreOrders: null,
  _pendingGuestSignup: null,
  _pendingGuestAvatarUrl: '',
  _pendingInviteCode: '',
  _pendingPhoneCode: '',
  _lastMsgId: null,
  _touchX: 0,
  _touchY: 0,

  onLoad(options) {
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
    const isGuest = !!user.guest
    const roles = user.roles || (isGuest ? [] : ['user'])
    const isCoach = roles.includes('coach')
    const isAdmin = roles.includes('admin') || roles.includes('superadmin')
    const isSuperadmin = roles.includes('superadmin')
    const theme = user.theme || app.globalData.theme || 'dark'
    app.globalData.theme = theme
    const userAvatarLetter = (user.nickname || 'U').slice(-1).toUpperCase()
    const t = T[lang]
    this.setData({ user: { ...user }, userAvatarLetter, channel, lang, t, statusBarHeight, capsuleRightPad, menuTop, menuOpen: false, isCoach, isAdmin, isSuperadmin, theme, isGuest, toolList: toolActions.getToolList(t) })
    if (isGuest) {
      this.setData({ messages: [{ id: 'init', role: 'ai', content: T[lang].initMsg }], obStep: null, storeLoading: true })
      this._loadGuestStore(lang)
      return
    }
    this._initChat(user, lang)
    this._loadDots(user, lang)
    this._loadCartridges(user, lang)
    this._loadStore(user, lang)
  },

  onShow() {
    const { user, lang, isGuest, obStep } = this.data
    if (user && !isGuest) {
      this._req(`${BASE}/api/heartbeat`, 'POST', { user_id: user.user_id }).catch(() => {})
      this.selectComponent('#health-comp')?.refresh()
      this._startPolling(user)
      // Check for questionnaires assigned while the user was away
      if (obStep === 'done') this._checkForPendingQuestionnaire()
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
    if (tab === 'dots') {
      this.setData({ dotsLoading: true, cartridgesLoading: true })
      this._loadDots(this.data.user, this.data.lang)
      this._loadCartridges(this.data.user, this.data.lang)
    }
    if (tab === 'plans') {
      this.setData({ plansLoading: true, remindersLoading: true })
      this._loadPlans(this.data.user, this.data.lang)
      this._loadReminders(this.data.user)
    }
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
    this.setData({ lang, t: T[lang], menuOpen: false, storeItems, storeOrders, toolList: toolActions.getToolList(T[lang]) })
    this._loadDots(this.data.user, lang)
    this._loadCartridges(this.data.user, lang)
    if (this.data.tab === 'plans') this._loadReminders(this.data.user)
  },

  async toggleTheme() {
    const theme = this.data.theme === 'dark' ? 'light' : 'dark'
    app.globalData.theme = theme
    wx.setStorageSync('nano_theme', theme)
    const user = { ...this.data.user, theme }
    wx.setStorageSync('nano_user', user)
    this.setData({ theme, menuOpen: false, user })
    try {
      await this._req(`${BASE}/api/users/${user.user_id}`, 'PATCH', { theme })
    } catch (e) {}
  },

  openCoach() {
    this.setData({ menuOpen: false })
    wx.navigateTo({ url: '/pages/coach/coach' })
  },

  onTouchStart(e) {
    this._touchX = e.touches[0].clientX
    this._touchY = e.touches[0].clientY
  },

  onTouchEnd(e) {
    if (!this.data.isCoach) return
    const d = this.data
    if (d.menuOpen || d.kinoSimOpen || d.guestSheetOpen || d.qSheetOpen) return
    const dx = e.changedTouches[0].clientX - this._touchX
    const dy = e.changedTouches[0].clientY - this._touchY
    if (dx < -70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      wx.navigateTo({ url: '/pages/coach/coach', animationType: 'slide-in-right', animationDuration: 280 })
    }
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

  async _resolveKinoSimDevice() {
    try {
      const res = await this._req(`${BASE}/api/kino-devices`)
      const devices = res.data?.devices || []
      const dev = devices.find(d => d.serial_number === KINO_SIM_SERIAL)
      if (dev) this.setData({ kinoSimDeviceId: dev.id })
    } catch (e) {}
  },

  openKinoSim() {
    if (this.data.isSuperadmin) {
      this.setData({ menuOpen: false, kinoSimOpen: true })
      this._resolveKinoSimDevice()
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
        this._resolveKinoSimDevice()
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

  toggleKinoSimDebug() {
    this.setData({ kinoSimDebug: !this.data.kinoSimDebug })
  },

  closeKinoSim() {
    this._stopKinoSlide()
    this.setData({
      kinoSimOpen: false, kinoSimStatus: 'ready', kinoSimDebug: false, kinoSimError: '',
      kinoSimBmList: [], kinoSimSubAgeList: [],
      kinoSimBioAge: null, kinoSimChronoAge: null, kinoSimBioAgeColor: '#A6C4E5',
      kinoSimActiveTab: 'bioage', kinoSimSlideIndex: 0, kinoSimSlideVisible: true,
      kinoSimScannedUserId: null, kinoSimScannedUserName: null, kinoSimChipId: null,
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

  handleKinoSimStart() {
    const { kinoSimStatus, lang } = this.data
    if (kinoSimStatus === 'analyzing') return
    if (kinoSimStatus === 'complete') {
      this._stopKinoSlide()
      this.setData({
        kinoSimStatus: 'ready', kinoSimError: '', kinoSimBmList: [], kinoSimSubAgeList: [],
        kinoSimBioAge: null, kinoSimChronoAge: null, kinoSimBioAgeColor: '#A6C4E5',
        kinoSimActiveTab: 'bioage', kinoSimSlideIndex: 0, kinoSimSlideVisible: true,
        kinoSimScannedUserId: null, kinoSimScannedUserName: null, kinoSimChipId: null,
      })
      return
    }
    const t = T[lang]
    wx.scanCode({
      onlyFromCamera: false,
      success: async (scanRes) => {
        const chip_id = scanRes.result
        this.setData({ kinoSimStatus: 'analyzing' })
        try {
          const chipRes = await this._req(`${BASE}/api/kino-chip?chip_id=${encodeURIComponent(chip_id)}`)
          if (chipRes.statusCode !== 200 || !chipRes.data?.found) {
            this.setData({ kinoSimStatus: 'failed', kinoSimError: 'Chip not bound to any user. Ask the user to scan and bind the chip first via the chat Test Chip tool.' })
            return
          }
          if (chipRes.data.used) {
            this.setData({ kinoSimStatus: 'failed', kinoSimError: 'chip already used' })
            return
          }
          const { user_id: chipUserId, nickname: chipNickname } = chipRes.data
          this.setData({ kinoSimScannedUserId: chipUserId, kinoSimScannedUserName: chipNickname, kinoSimChipId: chip_id })
          await this._runKinoAnalysis(chipUserId)
        } catch (e) {
          this.setData({ kinoSimStatus: 'failed', kinoSimError: e instanceof Error ? e.message : JSON.stringify(e, null, 2) })
        }
      },
      fail: () => {},
    })
  },

  async _runKinoAnalysis(targetUserId) {
    const { lang } = this.data
    const t = T[lang]
    try {
      const res = await this._req(`${BASE}/api/biomarkers`, 'POST', {
        openid: targetUserId,
        test_type: 'kino_chip',
        test_data: {},
        kino_device_id: this.data.kinoSimDeviceId || undefined,
      })
      if (res.statusCode !== 200 && res.statusCode !== 201) {
        throw new Error(`POST /biomarkers HTTP ${res.statusCode}: ${res.data?.error || JSON.stringify(res.data)}`)
      }
      const biomarkers = res.data?.biomarkers || null
      let bioageProfile = res.data?.bioage_profile || null
      if (!bioageProfile) {
        try {
          const bmRes = await this._req(`${BASE}/api/biomarkers?openid=${encodeURIComponent(targetUserId)}`)
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
      const { kinoSimChipId } = this.data
      if (kinoSimChipId) {
        try {
          await this._req(`${BASE}/api/kino-result`, 'POST', {
            chip_id: kinoSimChipId,
            data: { biomarkers, bioage_profile: bioageProfile },
            bio_age: rawBioAge,
            kino_device_id: this.data.kinoSimDeviceId || undefined,
          })
        } catch (e) {}
      }
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
      this.setData({ kinoSimStatus: 'failed', kinoSimError: e instanceof Error ? e.message : JSON.stringify(e, null, 2) })
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
    const initMsg = { id: 'init', role: 'ai', content: t.initMsg }

    // Load history
    let historyLoaded = false
    try {
      const res = await this._req(`${BASE}/api/chat-history?openid=${encodeURIComponent(user.user_id)}`)
      const history = res.data?.messages || []
      if (history.length > 0) {
        const msgs = history.map((m, i) => {
          const role = (m.role === 'assistant' || m.role === 'ai') ? 'ai' : m.role
          if (role === 'action') {
            try {
              const data = JSON.parse(m.content)
              return { id: `h-${i}`, role: 'action', action: data.action, label: data.label }
            } catch (e) {
              return { id: `h-${i}`, role: 'ai', content: m.content }
            }
          }
          const content = role === 'coach' ? (m.content || '').replace(/\n+/g, ' ') : m.content
          return { id: `h-${i}`, role, content, imageUrl: m.image_url || null }
        })
        const ids = history.map(m => m.id).filter(id => typeof id === 'number')
        this._lastMsgId = ids.length > 0 ? Math.max(...ids) : 0
        this.setData({ messages: msgs })
        this._scrollBottom()
        historyLoaded = true
      } else {
        this._lastMsgId = 0
      }
    } catch (e) {
      console.error('History load failed', e)
    }
    if (!historyLoaded) { this.setData({ messages: [initMsg] }) }

    // Fetch pending questionnaires + biomarkers in parallel
    let pendingAssignments = []
    let biomarkerRecords = []
    try {
      const [qRes, bRes] = await Promise.all([
        this._req(`${BASE}/api/pending-questionnaires?openid=${encodeURIComponent(user.user_id)}`),
        this._req(`${BASE}/api/biomarkers?openid=${encodeURIComponent(user.user_id)}`),
      ])
      pendingAssignments = qRes.data?.assignments || []
      biomarkerRecords = bRes.data?.records || []
    } catch (e) { console.error('Init fetch failed', e) }

    // Find first assignment with an unanswered question
    for (const assignment of pendingAssignments) {
      const answeredIds = new Set((assignment.responses || []).map(r => r.question_id))
      const questions = assignment.questions || []
      const firstIdx = questions.findIndex(q => !this._isQuestionAnswered(q, user, biomarkerRecords, answeredIds))
      if (firstIdx >= 0) {
        this._startQuestionnaire(assignment, questions, firstIdx)
        return
      }
    }

    this._onAllQuestionnaireDone(user, null, true)
  },

  _isQuestionAnswered(q, user, biomarkerRecords, answeredIds) {
    if (answeredIds.has(q.id)) return true
    const cc = q.completion_check || {}
    if (cc.type === 'user_field') return !!(user[cc.field])
    if (cc.type === 'bio_data_field') return (user.bio_data || {})[cc.field] !== undefined
    if (cc.type === 'biomarker') {
      return biomarkerRecords.some(r =>
        r.test_type === cc.test_type && this._getNestedPath(r.data, cc.data_path)
      )
    }
    return false
  },

  _getNestedPath(obj, dotPath) {
    if (!dotPath || !obj) return undefined
    return dotPath.split('.').reduce((cur, k) => (cur != null ? cur[k] : undefined), obj)
  },

  _startQuestionnaire(assignment, questions, firstIdx) {
    const { lang } = this.data
    const t = T[lang]
    if (assignment.type !== 'onboarding') {
      this._addMsg('ai', t.questionnaireIntro, true)
    }
    this.setData({
      obQuestions: questions,
      obAssignmentId: assignment.assignment_id,
      obQIndex: firstIdx,
      obQuestionnaireType: assignment.type,
    })
    if (assignment.status === 'pending') {
      this._req(`${BASE}/api/questionnaire-assignments/${assignment.assignment_id}`, 'PATCH', { status: 'in_progress' })
        .catch(() => {})
    }
    this._showQuestion(questions[firstIdx])
  },

  _showQuestion(q) {
    const { lang } = this.data
    const prompt = lang === 'zh' ? q.prompt_zh : q.prompt_en
    this._addMsg('ai', prompt)
    const update = { obQuestion: q, obStep: q.key }

    if (q.input_type === 'slider_group' && q.config && q.config.sliders) {
      const sliders = {}
      const sliderDisplay = {}
      for (const s of q.config.sliders) {
        sliders[s.key] = s.default
        sliderDisplay[s.key] = s.step < 1 ? Number(s.default).toFixed(1) : String(s.default)
      }
      update.obSliders = sliders
      update.obSliderDisplay = sliderDisplay
      if (sliders.height !== undefined) update.obHeight = sliders.height
      if (sliders.weight !== undefined) { update.obWeight = sliders.weight; update.obWeightDisplay = sliderDisplay.weight }
    }

    if (q.input_type === 'multi_select' && q.config && q.config.options) {
      const list = q.config.options.map((opt, idx) => ({
        key: opt.key || opt.value || String(idx),
        label: lang === 'zh' ? opt.label_zh : opt.label_en,
        selected: false,
      }))
      update.obConditionList = list
      update.obConditions = []
      update.obOtherSelected = false
      update.obConditionsOther = ''
    }

    if (q.input_type === 'date_picker') {
      update.obBirthday = ''
    }

    if (q.input_type === 'text') {
      update.obName = ''
    }

    this.setData(update)
  },

  async _saveAnswer(displayText, answerValue) {
    const { obQuestion, obAssignmentId, obQIndex, obQuestions, user } = this.data
    if (!obQuestion || !obAssignmentId) return

    this._addMsg('user', displayText)
    this.setData({ typing: true })

    try {
      const res = await this._req(`${BASE}/api/questionnaire-responses`, 'POST', {
        assignment_id: obAssignmentId,
        question_id: obQuestion.id,
        answer: answerValue,
        answer_display: displayText,
      })

      // Update local user cache for onboarding profile fields
      const q = obQuestion
      if (q.save_target === 'user_field' && q.save_field) {
        const updated = { ...this.data.user, [q.save_field]: answerValue }
        this._updateUser(updated)
        this.data.user = updated
      } else if (q.save_target === 'bio_data_field' && q.save_field) {
        const updated = { ...this.data.user, bio_data: { ...(this.data.user.bio_data || {}), [q.save_field]: answerValue } }
        this._updateUser(updated)
        this.data.user = updated
      }

      if (res.data && res.data.completed) {
        this.setData({ obQuestion: null, obStep: null, typing: false })
        await this._advanceOnboarding()
      } else {
        // Find next unanswered question (questions up to obQIndex are answered)
        const nextIdx = obQuestions.findIndex((q, i) => i > obQIndex)
        if (nextIdx >= 0) {
          this.setData({ obQIndex: nextIdx, typing: false })
          this._showQuestion(obQuestions[nextIdx])
        } else {
          this.setData({ obQuestion: null, obStep: null, typing: false })
          await this._advanceOnboarding()
        }
      }
    } catch (e) {
      this._addMsg('ai', this.data.t.errServer)
      this.setData({ typing: false })
    }
  },

  async _checkForPendingQuestionnaire() {
    const { user } = this.data
    if (!user) return
    try {
      const [qRes, bRes] = await Promise.all([
        this._req(`${BASE}/api/pending-questionnaires?openid=${encodeURIComponent(user.user_id)}`),
        this._req(`${BASE}/api/biomarkers?openid=${encodeURIComponent(user.user_id)}`),
      ])
      const pendingAssignments = qRes.data?.assignments || []
      const biomarkerRecords = bRes.data?.records || []
      for (const assignment of pendingAssignments) {
        const answeredIds = new Set((assignment.responses || []).map(r => r.question_id))
        const questions = assignment.questions || []
        const firstIdx = questions.findIndex(q => !this._isQuestionAnswered(q, user, biomarkerRecords, answeredIds))
        if (firstIdx >= 0) {
          this._startQuestionnaire(assignment, questions, firstIdx)
          return
        }
      }
    } catch (e) {}
  },

  async _advanceOnboarding() {
    const { user, obQuestionnaireType } = this.data
    try {
      const [qRes, bRes] = await Promise.all([
        this._req(`${BASE}/api/pending-questionnaires?openid=${encodeURIComponent(user.user_id)}`),
        this._req(`${BASE}/api/biomarkers?openid=${encodeURIComponent(user.user_id)}`),
      ])
      const pendingAssignments = qRes.data?.assignments || []
      const biomarkerRecords = bRes.data?.records || []

      for (const assignment of pendingAssignments) {
        const answeredIds = new Set((assignment.responses || []).map(r => r.question_id))
        const questions = assignment.questions || []
        const firstIdx = questions.findIndex(q => !this._isQuestionAnswered(q, user, biomarkerRecords, answeredIds))
        if (firstIdx >= 0) {
          if (obQuestionnaireType === 'custom') this._addMsg('ai', this.data.t.questionnaireThanks, true)
          this._startQuestionnaire(assignment, questions, firstIdx)
          return
        }
      }
    } catch (e) {}

    this._onAllQuestionnaireDone(this.data.user, obQuestionnaireType)
  },

  _onAllQuestionnaireDone(user, completedType, silent = false) {
    const { t } = this.data
    if (!silent) this._addMsg('ai', t.questionnaireThanks, true)
    this.setData({ obStep: 'done' })
    if (!user.phone && !wx.getStorageSync('nano_phone_prompted')) {
      wx.setStorageSync('nano_phone_prompted', '1')
      setTimeout(() => {
        this._addMsg('ai', t.phonePromptMsg)
        this._addActionMsg('bind_phone', t.phonePromptBtn)
        this._addActionMsg('maybe_later', t.phoneMaybeLater)
      }, 800)
    }
    this._startPolling(user)
  },

  async _loadHistory(user) {
    // Already handled in _initChat or can be called separately to refresh
    try {
      const res = await this._req(`${BASE}/api/chat-history?openid=${encodeURIComponent(user.user_id)}`)
      const history = res.data?.messages || []
      if (history.length > 0) {
        const msgs = history.map((m, i) => {
          const role = (m.role === 'assistant' || m.role === 'ai') ? 'ai' : m.role
          const content = role === 'coach' ? (m.content || '').replace(/\n+/g, ' ') : m.content
          return { id: `h-${i}`, role, content, imageUrl: m.image_url || null }
        })
        this.setData({ messages: msgs })
        this._scrollBottom()
      }
    } catch (e) {}
  },

  // ── Chat messaging ──────────────────────────────────────────────────────────

  _removePhonePrompt() {
    const messages = this.data.messages.filter(m => m.action !== 'bind_phone' && m.action !== 'maybe_later')
    this.setData({ messages })
  },

  _addMsg(role, content, persist = false) {
    const msg = { id: `${role}-${Date.now()}`, role, content }
    const messages = [...this.data.messages, msg]
    this.setData({ messages })
    this._scrollBottom()

    if (persist && this.data.user?.user_id) {
      this._req(`${BASE}/api/chat-messages`, 'POST', {
        openid: this.data.user.user_id,
        role, content
      }).catch(e => console.error('Persistent msg failed', e))
    }
  },

  _scrollBottom() {
    if (this.data.messages.length === 0) return
    if (this._scrollTimer) clearTimeout(this._scrollTimer)
    this._scrollTimer = setTimeout(() => {
      this._scrollFlip = !this._scrollFlip
      this.setData({ scrollTop: this._scrollFlip ? 999998 : 999999 })
    }, 50)
  },

  onChatInput(e) {
    this.setData({ chatInput: e.detail.value })
  },

  toggleToolbox() {
    this.setData({ toolboxOpen: !this.data.toolboxOpen })
  },

  handleToolAction(e) {
    const action = e.detail?.action || e.currentTarget?.dataset?.action
    const { t, typing, obStep, user } = this.data
    if (typing || obStep !== 'done') return
    this.setData({ toolboxOpen: false })
    const ctx = {
      addMsg: (role, content, persist) => this._addMsg(role, content, persist),
      addActionMsg: (action, label, persist) => this._addActionMsg(action, label, persist),
      addImageMsg: (url) => this._addImageMsg(url),
      req: (url, method, data) => this._req(url, method, data),
      setTyping: (v) => this.setData({ typing: v }),
    }
    if (action === 'test_chip') {
      this._addMsg('ai', t.kinoScanPrompt)
      this.setData({ kinoScanPending: true })
    } else if (action === 'formula_dots') {
      toolActions.runFormulaDs(user.user_id, t, ctx)
    } else if (action === 'health_advice') {
      toolActions.runHealthAdvice(user.user_id, t, ctx)
    } else if (action === 'upload_image') {
      toolActions.runUploadImage(user.user_id, t, ctx)
    }
  },

  _addImageMsg(imageUrl) {
    const msg = { id: `user-${Date.now()}`, role: 'user', content: '', imageUrl }
    this.setData({ messages: [...this.data.messages, msg] })
    this._scrollBottom()
  },

  _addActionMsg(action, label, persist = false) {
    const msg = { id: `action-${Date.now()}`, role: 'action', action, label }
    const messages = [...this.data.messages, msg]
    this.setData({ messages })
    this._scrollBottom()

    if (persist && this.data.user?.user_id) {
      this._req(`${BASE}/api/chat-messages`, 'POST', {
        openid: this.data.user.user_id,
        role: 'action',
        content: JSON.stringify({ action, label })
      }).catch(e => console.error('Persistent action failed', e))
    }
  },

  handleMsgAction(e) {
    const { action } = e.currentTarget.dataset
    if (action === 'view_dots') {
      const { user, lang } = this.data
      this.setData({ tab: 'dots', dotsLoading: true, cartridgesLoading: true })
      this._loadDots(user, lang)
      this._loadCartridges(user, lang)
    } else if (action === 'maybe_later') {
      this._removePhonePrompt()
    }
  },

  async handleBindPhone(e) {
    const { t, user } = this.data
    const { code, errMsg } = e.detail
    this._removePhonePrompt()
    if (errMsg !== 'getPhoneNumber:ok' || !code) return
    try {
      const { appId } = wx.getAccountInfoSync().miniProgram
      const res = await this._req(`${BASE}/api/bind-phone`, 'POST', { user_id: user.user_id, code, app_id: appId })
      if (res.data?.success) {
        const updatedUser = { ...user, phone: res.data.phone }
        app.globalData.user = updatedUser
        wx.setStorageSync('nano_user', updatedUser)
        this.setData({ user: updatedUser })
        this._addMsg('ai', t.phoneBindSuccess)
      } else {
        this._addMsg('ai', t.phoneBindError)
      }
    } catch (err) {
      this._addMsg('ai', t.phoneBindError)
    }
  },

  cancelKinoScan() {
    this.setData({ kinoScanPending: false })
  },

  handleKinoScan() {
    const { user, t } = this.data
    this.setData({ kinoScanPending: false })
    toolActions.runTestChip(user.user_id, t, {
      addMsg: (role, content, persist) => this._addMsg(role, content, persist),
      req: (url, method, data) => this._req(url, method, data),
      setTyping: (v) => this.setData({ typing: v }),
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
      const res = await this._req(`${BASE}/api/chat`, 'POST', { openid: user.user_id, message: text })
      if (res.data?.recorded_weight != null) {
        this.selectComponent('#health-comp')?.refresh()
      }
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
    // Check for new coach messages
    if (this._lastMsgId !== null) {
      try {
        const res = await this._req(`${BASE}/api/chat-history?openid=${encodeURIComponent(user.user_id)}&since_id=${this._lastMsgId}`)
        const newCoach = res.data?.messages || []
        if (newCoach.length > 0) {
          const newMsgs = newCoach.map(m => ({
            id: `c-${m.id}`,
            role: 'coach',
            content: (m.content || '').replace(/\n+/g, ' '),
            imageUrl: null,
          }))
          this._lastMsgId = Math.max(...newCoach.map(m => m.id))
          const messages = [...this.data.messages, ...newMsgs]
          this.setData({ messages })
          this._scrollBottom()
        }
      } catch (e) {}
    }
  },

  // ── Onboarding handlers ─────────────────────────────────────────────────────

  onObNameInput(e) { this.setData({ obName: e.detail.value }) },

  onObNameInput(e) { this.setData({ obName: e.detail.value }) },

  async handleSubmitName() {
    const { obName } = this.data
    const name = obName.trim()
    if (!name) return
    this.setData({ obName: '' })
    await this._saveAnswer(name, name)
  },

  async handleSelectButton(e) {
    const { lang, obQuestion } = this.data
    const value = e.currentTarget.dataset.value
    const opt = (obQuestion && obQuestion.config && obQuestion.config.options || []).find(o => o.value === value)
    const label = opt ? (lang === 'zh' ? opt.label_zh : opt.label_en) : value
    await this._saveAnswer(label, value)
  },

  onBirthdayChange(e) { this.setData({ obBirthday: e.detail.value }) },

  async handleSubmitBirthday() {
    const { obBirthday } = this.data
    if (!obBirthday) return
    await this._saveAnswer(obBirthday, obBirthday)
  },

  onSliderChange(e) {
    const key = e.currentTarget.dataset.key
    const step = parseFloat(e.currentTarget.dataset.step) || 1
    const val = e.detail.value
    const display = step < 1 ? Number(val).toFixed(1) : String(val)
    const obSliders = { ...this.data.obSliders, [key]: val }
    const obSliderDisplay = { ...this.data.obSliderDisplay, [key]: display }
    const update = { obSliders, obSliderDisplay }
    if (key === 'height') { update.obHeight = val }
    if (key === 'weight') { update.obWeight = val; update.obWeightDisplay = display }
    this.setData(update)
  },

  async handleSubmitBody() {
    const { obSliders, obSliderDisplay, obQuestion, lang, t } = this.data
    const sliders = (obQuestion && obQuestion.config && obQuestion.config.sliders) || []
    const parts = sliders.map(s => {
      const lbl = lang === 'zh' ? s.label_zh : s.label_en
      const val = obSliderDisplay[s.key] || obSliders[s.key]
      return `${lbl}: ${val}${s.unit}`
    })
    await this._saveAnswer(parts.join('  '), { ...obSliders })
  },

  handleToggleCondition(e) {
    const key = e.currentTarget.dataset.key
    const list = this.data.obConditionList.map(item =>
      item.key === key ? { ...item, selected: !item.selected } : item
    )
    const hasOtherOpt = list.some(i => i.key === 'other')
    const otherSelected = hasOtherOpt && list.some(i => i.key === 'other' && i.selected)
    this.setData({
      obConditionList: list,
      obConditions: list.filter(i => i.selected).map(i => i.key),
      obOtherSelected: otherSelected,
      obConditionsOther: otherSelected ? this.data.obConditionsOther : '',
    })
  },

  onObConditionsOtherInput(e) { this.setData({ obConditionsOther: e.detail.value }) },

  async handleSubmitConditions() {
    const { obConditions, obConditionList, obOtherSelected, obConditionsOther, obQuestion, lang, t } = this.data
    const otherText = obOtherSelected ? obConditionsOther.trim() : ''
    const sep = lang === 'zh' ? '、' : ', '
    const selectedLabels = obConditionList
      .filter(i => i.selected)
      .map(i => i.key === 'other' && otherText ? `${i.label}（${otherText}）` : i.label)
    const displayText = selectedLabels.length > 0 ? selectedLabels.join(sep) : t.obConditionsNone

    await this._saveAnswer(displayText, obConditions)

    // Also persist 'other' free-text to bio_data via separate update
    if (otherText && obQuestion && obQuestion.config && obQuestion.config.other_key) {
      const { user } = this.data
      this._saveUser(user, { bio_data: { [obQuestion.config.other_key]: otherText } }).catch(() => {})
    }
  },

  // ── User state ──────────────────────────────────────────────────────────────

  _updateUser(updated) {
    app.globalData.user = { ...updated }
    wx.setStorageSync('nano_user', updated)
    const userAvatarLetter = (updated.nickname || 'U').slice(-1).toUpperCase()
    this.setData({ user: { ...updated }, userAvatarLetter })
  },

  _saveUser(user, updates) {
    return this._req(`${BASE}/api/users/${user.user_id}`, 'PUT', {
      nickname: user.nickname, phone: user.phone, email: user.email,
      gender: user.gender, birth_date: user.birth_date,
      language: user.language, coach_id: user.coach_id,
      ...updates
    })
  },

  // ── Dots tab ────────────────────────────────────────────────────────────────

  async _loadDots(user, lang) {
    try {
      const res = await this._req(`${BASE}/api/nutrition-plan?openid=${encodeURIComponent(user.user_id)}`)
      const plan = res.data?.plan || null
      const structured = res.data?.structured_plan || null
      const schedules = res.data?.schedules || []
      const dotsArr = res.data?.dots || []
      const dotsMap = {}
      dotsArr.forEach(d => { dotsMap[d.key_name] = d })

      let dotsDays = []
      let weekLabel = ''
      const { monday, sunday } = getWeekRange()
      weekLabel = fmtWeekLabel(monday, sunday, lang)

      if (structured && schedules.length > 0) {
        const allDays = mapStructuredSchedules(schedules, dotsMap, lang)
        dotsDays = allDays.filter(d => d.dateStr >= monday && d.dateStr <= sunday)
      } else if (plan) {
        dotsDays = parsePlan(plan, dotsMap, lang)
      }

      const todayIndex = dotsDays.findIndex(d => d.isToday)
      let todayScrollLeft = 0
      if (todayIndex >= 0) {
        const { windowWidth } = wx.getSystemInfoSync()
        const r = windowWidth / 750
        const cardPx = windowWidth * 0.7
        const gapPx = 16 * r
        const padPx = 28 * r
        todayScrollLeft = Math.max(0, todayIndex * (cardPx + gapPx) + padPx - (windowWidth - cardPx) / 2)
      }

      const todayDay = todayIndex >= 0 ? dotsDays[todayIndex] : null
      const dispenseSlot = new Date().getHours() < 12 ? 'morning_cup' : 'evening_cup'
      const dispenseSlotDots = todayDay
        ? (dispenseSlot === 'morning_cup' ? todayDay.morning : todayDay.evening)
        : []

      this.setData({
        dotsLoading: false,
        dotsDays,
        weekLabel,
        todayScrollLeft,
        hasPlan: (plan !== null || structured !== null),
        dispenseSlot,
        dispenseSlotDots,
        dispenseDate: localISODate(new Date()),
        dispenseHasToday: !!todayDay,
        dispenseStatus: '',
      })
    } catch (e) {
      this.setData({ dotsLoading: false, hasPlan: false })
    }
  },

  async _loadCartridges(user, lang) {
    try {
      const res = await this._req(`${BASE}/api/my-cartridges?openid=${encodeURIComponent(user.user_id)}`)
      const raw = res.data?.cartridges || []
      this.setData({ cartridgesLoading: false, cartridges: mapCartridges(raw, lang) })
    } catch (e) {
      this.setData({ cartridgesLoading: false })
    }
  },

  async dispenseToday() {
    const { user, dispenseSlot, dispenseSlotDots, dispenseDate, dispenseStatus } = this.data
    if (dispenseStatus === 'loading' || dispenseStatus === 'done') return
    if (!dispenseSlotDots || dispenseSlotDots.length === 0) return
    this.setData({ dispenseStatus: 'loading' })
    try {
      const dispensed = {}
      dispenseSlotDots.forEach(dot => {
        dispensed['DOT' + dot.displayKey.slice(1)] = dot.count
      })
      const res = await this._req(`${BASE}/api/dispense`, 'POST', {
        openid: user.user_id, slot: dispenseSlot, date: dispenseDate, dispensed
      })
      if (res.data?.success) {
        this.setData({ dispenseStatus: 'done' })
        this._loadCartridges(user, this.data.lang)
      } else {
        this.setData({ dispenseStatus: 'error' })
      }
    } catch (e) {
      this.setData({ dispenseStatus: 'error' })
    }
  },

  openCartSim() {
    const lang = this.data.lang
    const sets = CART_SETS.map(s => ({
      key: s.key,
      name: lang === 'zh' ? s.nameZh : s.nameEn,
      desc: lang === 'zh' ? s.descZh : s.descEn,
      color: s.color,
      dotItems: s.dotItems.map(d => ({
        displayKey: d.key.replace('DOT', 'D'),
        dotName: lang === 'zh' ? d.zhName : d.enName,
      })),
      dots_raw: s.dotItems.map(d => d.key),
    }))
    this.setData({ simCartOpen: true, simCartSets: sets })
  },

  closeCartSim() {
    this.setData({ simCartOpen: false, simCartLoading: false })
  },

  async handleSelectCartSet(e) {
    const { dotsRaw } = e.currentTarget.dataset
    const { user, lang } = this.data
    this.setData({ simCartLoading: true })
    try {
      const ts = Date.now()
      await Promise.all(dotsRaw.map((dotKey, i) =>
        this._req(`${BASE}/api/cartridge-insert`, 'POST', {
          openid: user.user_id,
          nfc_tag_id: `SIM-${dotKey}-${ts}-${i}`,
          dot_key: dotKey,
        })
      ))
      wx.showToast({ title: this.data.t.simCartDone, icon: 'success', duration: 1500 })
    } catch (e) {
      wx.showToast({ title: this.data.t.errServer, icon: 'none', duration: 2000 })
    }
    this.setData({ simCartOpen: false, simCartLoading: false, cartridgesLoading: true })
    this._loadCartridges(user, lang)
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
    if (this.data.isGuest) { this.openGuestSheet(); return }
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

  // ── Health Plans ─────────────────────────────────────────────────────────────

  async _loadPlans(user, lang) {
    if (!user) { this.setData({ plansLoading: false }); return }
    try {
      const [plansRes, tplRes] = await Promise.all([
        this._req(`${BASE}/api/health-plans?openid=${encodeURIComponent(user.user_id)}`),
        this._req(`${BASE}/api/health-plan-templates`),
      ])
      const now = Date.now()
      const plans = (plansRes.data?.plans || []).map(p => {
        const totalWeeks = p.duration_weeks || p.template_duration_weeks || 4
        const weeksElapsed = Math.max(0, Math.floor((now - new Date(p.start_date).getTime()) / (7 * 86400000)))
        const progressPct = Math.min(100, Math.round((weeksElapsed / totalWeeks) * 100))
        const checkins = parseInt(p.checkin_count || 0, 10)
        const daysSinceStart = Math.max(1, Math.floor((now - new Date(p.start_date).getTime()) / 86400000))
        const adherencePct = Math.round((checkins / daysSinceStart) * 100)
        return {
          ...p,
          name_zh: p.name_zh || p.custom_name_zh || '',
          name_en: p.name_en || p.custom_name_en || '',
          totalWeeks,
          weeksDone: weeksElapsed,
          progressPct,
          adherencePct: Math.min(100, adherencePct),
          checkedInToday: parseInt(p.checked_in_today || 0, 10) > 0,
          ...(() => {
            const tc = p.today_checkin || null
            const acts = Array.isArray(tc?.activities_done) ? tc.activities_done : []
            const taskDone = {
              dots:      () => tc?.dots_taken || false,
              weight:    () => acts.includes('weight_logged'),
              questions: () => acts.includes('daily_questions'),
            }
            const defaultTasks = [
              { key: 'dots',      label_zh: '服用原粒', label_en: 'Dots',      enabled: true },
              { key: 'weight',    label_zh: '记录体重', label_en: 'Weight',    enabled: true },
              { key: 'questions', label_zh: '每日问答', label_en: 'Questions', enabled: true },
            ]
            const templateTasks = Array.isArray(p.daily_tasks) && p.daily_tasks.length > 0
              ? p.daily_tasks : defaultTasks
            const todayTasks = templateTasks
              .filter(t => t.enabled)
              .map(t => ({ key: t.key, labelZh: t.label_zh, labelEn: t.label_en, done: taskDone[t.key]?.() || false }))
            const todayDoneCount = todayTasks.filter(tk => tk.done).length
            const total = todayTasks.length || 1
            return {
              todayTasks,
              todayDoneCount,
              todayProgressPct: Math.round((todayDoneCount / total) * 100),
              today_dots_taken: tc?.dots_taken || false,
              today_activities: acts,
            }
          })(),
        }
      })
      const enrolledIds = new Set(plans.map(p => p.template_id))
      const hasPrimary = plans.some(p => p.plan_type === 'primary')
      const hasSecondary = plans.some(p => p.plan_type === 'secondary')
      const templates = (tplRes.data?.templates || []).map(t => ({
        ...t,
        sub_ages_display: (t.target_sub_ages || []).join(' · '),
        alreadyEnrolled: enrolledIds.has(t.id),
        canJoinPrimary: !enrolledIds.has(t.id) && !hasPrimary,
        canJoinSecondary: !enrolledIds.has(t.id) && !hasSecondary,
      }))
      this.setData({ activePlans: plans, planTemplates: templates, plansLoading: false })
    } catch {
      this.setData({ plansLoading: false })
    }
  },

  async _loadReminders(user) {
    if (!user) { this.setData({ remindersLoading: false }); return }
    this.setData({ remindersLoading: true })
    try {
      const res = await this._req(`${BASE}/api/reminders?openid=${encodeURIComponent(user.user_id)}`)
      const { lang, t } = this.data
      const now = new Date()
      const reminders = (res.data?.reminders || []).map(r => {
        const d = new Date(r.scheduled_for)
        const isToday = d.toDateString() === now.toDateString()
        const isTomorrow = d.toDateString() === new Date(now.getTime() + 86400000).toDateString()
        const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        let dateLabel
        if (isToday)         dateLabel = lang === 'zh' ? `今天 ${hhmm}` : `Today ${hhmm}`
        else if (isTomorrow) dateLabel = lang === 'zh' ? `明天 ${hhmm}` : `Tomorrow ${hhmm}`
        else                 dateLabel = fmtDate(r.scheduled_for, lang)
        return {
          ...r,
          dateLabel,
          isCoach: !!r.coach_id,
          recurrenceLabel: r.recurrence === 'daily'  ? t.reminderRecurDaily
                         : r.recurrence === 'weekly' ? t.reminderRecurWeekly
                         : '',
        }
      })
      this.setData({ upcomingReminders: reminders, remindersLoading: false })
    } catch {
      this.setData({ remindersLoading: false })
    }
  },

  switchPlanSubTab(e) {
    this.setData({ planSubTab: e.currentTarget.dataset.tab })
  },

  async openPlanDetail(e) {
    const plan = e.currentTarget.dataset.plan
    this.setData({ planDetailOpen: true, planDetailData: plan, planSubTab: 'overview' })
    try {
      const { user } = this.data
      const res = await this._req(`${BASE}/api/health-plans/${plan.id}?openid=${encodeURIComponent(user.user_id)}`)
      const detail = res.data?.plan || plan
      const rawReminders = res.data?.reminders || []
      const reminders = rawReminders.map(r => {
        const d = new Date(r.scheduled_for)
        return { ...r, timeDisplay: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
      })
      this.setData({ planDetailData: { ...plan, ...detail, reminders } })
    } catch { /* keep existing plan data if fetch fails */ }
  },

  closePlanDetail() {
    this.setData({ planDetailOpen: false, planDetailData: null })
  },

  openPlanBrowse() {
    this.setData({ planBrowseOpen: true })
  },

  closePlanBrowse() {
    this.setData({ planBrowseOpen: false })
  },

  async handleTogglePlanReminder(e) {
    const { reminderId, currentStatus } = e.currentTarget.dataset
    const newStatus = currentStatus === 'paused' ? 'pending' : 'paused'
    const { user, planDetailData } = this.data
    try {
      await this._req(`${BASE}/api/plan-reminders/${reminderId}`, 'PATCH', { openid: user.user_id, status: newStatus })
      const reminders = (planDetailData.reminders || []).map(r =>
        r.id === reminderId || String(r.id) === String(reminderId) ? { ...r, status: newStatus } : r
      )
      this.setData({ planDetailData: { ...planDetailData, reminders } })
    } catch { /* ignore */ }
  },

  async handlePlanCheckin(e) {
    if (this.data.isGuest) { this.openGuestSheet(); return }
    const { user } = this.data
    const planId = e.currentTarget.dataset.planId
    if (!planId || this.data.planCheckinBusy) return
    this.setData({ planCheckinBusy: true })
    try {
      const today = new Date()
      const pad = n => String(n).padStart(2, '0')
      const checkinDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
      await this._req(`${BASE}/api/health-plans/${planId}/checkin`, 'POST', {
        openid: user.user_id,
        checkin_date: checkinDate,
        dots_taken: true,
        activities_done: [],
      })
      await this._loadPlans(user, this.data.lang)
    } catch (err) {
      wx.showToast({ title: err.message || 'Error', icon: 'none' })
    } finally {
      this.setData({ planCheckinBusy: false })
    }
  },

  async _upsertCheckin(planId, dots_taken, activities_done) {
    const { user } = this.data
    const today = new Date()
    const pad = n => String(n).padStart(2, '0')
    const checkin_date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
    await this._req(`${BASE}/api/health-plans/${planId}/checkin`, 'POST', {
      openid: user.user_id, checkin_date, dots_taken, activities_done,
    })
  },

  handlePlanTask(e) {
    if (this.data.isGuest) { this.openGuestSheet(); return }
    if (this.data.planTaskBusy) return
    const { planId, task } = e.currentTarget.dataset
    if (task === 'dots')           this._doDotsTask(planId)
    else if (task === 'weight')    this.openWeightTask(planId)
    else if (task === 'questions') this.openQuestionsTask(planId)
  },

  async _doDotsTask(planId) {
    const plan = this.data.activePlans.find(p => String(p.id) === String(planId))
    if (!plan) return
    this.setData({ planTaskBusy: true })
    try {
      await this._upsertCheckin(planId, !plan.today_dots_taken, plan.today_activities)
      await this._loadPlans(this.data.user, this.data.lang)
    } catch (err) {
      wx.showToast({ title: err.message || 'Error', icon: 'none' })
    } finally {
      this.setData({ planTaskBusy: false })
    }
  },

  openWeightTask(planId) {
    this.setData({ planWeightOpen: true, planWeightInput: '', planWeightPlanId: planId })
  },

  handleWeightInput(e) {
    this.setData({ planWeightInput: e.detail.value })
  },

  async handleWeightSubmit() {
    const { planWeightInput, planWeightPlanId, user } = this.data
    const w = parseFloat(planWeightInput)
    if (!w || w < 10 || w > 500) {
      wx.showToast({ title: user.language === 'zh' ? '请输入有效体重' : 'Enter a valid weight', icon: 'none' })
      return
    }
    this.setData({ planTaskBusy: true })
    try {
      await this._req(`${BASE}/api/biomarkers`, 'POST', {
        openid: user.user_id, test_type: 'body_composition', test_data: { weight: w },
      })
      const plan = this.data.activePlans.find(p => String(p.id) === String(planWeightPlanId))
      const activities = [...(plan?.today_activities || []).filter(a => a !== 'weight_logged'), 'weight_logged']
      await this._upsertCheckin(planWeightPlanId, plan?.today_dots_taken || false, activities)
      this.setData({ planWeightOpen: false })
      await this._loadPlans(user, this.data.lang)
    } catch (err) {
      wx.showToast({ title: err.message || 'Error', icon: 'none' })
    } finally {
      this.setData({ planTaskBusy: false })
    }
  },

  closeWeightTask() {
    this.setData({ planWeightOpen: false, planWeightKeyboard: 0 })
  },

  handleWeightFocus(e) {
    this.setData({ planWeightKeyboard: e.detail.height || 0 })
  },

  handleWeightBlur() {
    this.setData({ planWeightKeyboard: 0 })
  },

  openQuestionsTask(planId) {
    this.setData({ planQuestionsOpen: true, planQuestionsData: { energy: 3, sleep: 3, mood: 3 }, planQuestionsPlanId: planId })
  },

  handleQuestionChange(e) {
    const key = e.currentTarget.dataset.key
    const val = e.detail.value
    const planQuestionsData = { ...this.data.planQuestionsData, [key]: val }
    this.setData({ planQuestionsData })
  },

  async handleQuestionsSubmit() {
    const { planQuestionsPlanId, user } = this.data
    this.setData({ planTaskBusy: true })
    try {
      const plan = this.data.activePlans.find(p => String(p.id) === String(planQuestionsPlanId))
      const activities = [...(plan?.today_activities || []).filter(a => a !== 'daily_questions'), 'daily_questions']
      await this._upsertCheckin(planQuestionsPlanId, plan?.today_dots_taken || false, activities)
      this.setData({ planQuestionsOpen: false })
      await this._loadPlans(user, this.data.lang)
    } catch (err) {
      wx.showToast({ title: err.message || 'Error', icon: 'none' })
    } finally {
      this.setData({ planTaskBusy: false })
    }
  },

  closeQuestionsTask() {
    this.setData({ planQuestionsOpen: false })
  },

  async handleJoinPlan(e) {
    if (this.data.isGuest) { this.openGuestSheet(); return }
    const { user, t, lang } = this.data
    const { templateId, planType } = e.currentTarget.dataset
    try {
      const res = await this._req(`${BASE}/api/health-plans`, 'POST', {
        openid: user.user_id,
        template_id: templateId,
        plan_type: planType || 'primary',
        source: 'self',
      })
      if (!res.success && res.error === 'conflict') {
        wx.showModal({
          title: t.plansConflict,
          content: '',
          confirmText: lang === 'zh' ? '替换' : 'Replace',
          success: async (modal) => {
            if (!modal.confirm) return
            // Abandon existing and retry
            await this._req(`${BASE}/api/health-plans/${res.existing_plan_id}`, 'PUT', { openid: user.user_id, status: 'abandoned' })
            await this._req(`${BASE}/api/health-plans`, 'POST', {
              openid: user.user_id,
              template_id: templateId,
              plan_type: planType || 'primary',
              source: 'self',
            })
            this.setData({ planBrowseOpen: false })
            await this._loadPlans(user, lang)
          },
        })
        return
      }
      this.setData({ planBrowseOpen: false })
      await this._loadPlans(user, lang)
    } catch (err) {
      wx.showToast({ title: err.message || 'Error', icon: 'none' })
    }
  },

  async handleAbandonPlan(e) {
    const { user, t, planDetailData, lang } = this.data
    const planId = e.currentTarget.dataset.planId || planDetailData?.id
    if (!planId) return
    wx.showModal({
      title: t.plansConfirmAbandon,
      content: '',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await this._req(`${BASE}/api/health-plans/${planId}`, 'PUT', { openid: user.user_id, status: 'abandoned' })
          this.setData({ planDetailOpen: false })
          await this._loadPlans(user, lang)
        } catch (err) {
          wx.showToast({ title: err.message || 'Error', icon: 'none' })
        }
      },
    })
  },

  async handleSwitchPlanType(e) {
    const { user, t, planDetailData, lang } = this.data
    const planId = e.currentTarget.dataset.planId || planDetailData?.id
    const currentType = e.currentTarget.dataset.currentType || planDetailData?.plan_type
    const newType = currentType === 'primary' ? 'secondary' : 'primary'
    if (!planId) return
    wx.showModal({
      title: t.plansConfirmSwitch,
      content: '',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await this._req(`${BASE}/api/health-plans/${planId}`, 'PUT', { openid: user.user_id, plan_type: newType })
          this.setData({ planDetailOpen: false })
          await this._loadPlans(user, lang)
        } catch (err) {
          wx.showToast({ title: err.message || 'Error', icon: 'none' })
        }
      },
    })
  },

  // ── Guest join sheet ────────────────────────────────────────────────────────

  async _loadGuestStore(lang) {
    try {
      const res = await this._req(`${BASE}/api/store-items`)
      const raw = res.data?.items || []
      this._rawStoreItems = raw
      this.setData({ storeLoading: false, storeItems: mapStoreItems(raw, lang) })
    } catch (e) {
      this.setData({ storeLoading: false })
    }
  },

  openGuestSheet() {
    this._pendingGuestAvatarUrl = ''
    this._pendingInviteCode = ''
    this._pendingPhoneCode = ''
    this.setData({ guestSheetOpen: true, guestSheetStep: 'invite', guestInviteCode: '', guestInviteDigits: Array(6).fill(''), guestInviteError: '', guestPendingAvatar: '', guestAvatarDone: false, guestAvatarUploading: false, guestAvatarReady: false, guestPhoneDone: false, guestResolvedPhone: '', menuOpen: false })
  },

  closeGuestSheet() {
    if (this.data.guestSheetStep === 'phone') return
    this.setData({ guestSheetOpen: false, guestKeyboardHeight: 0 })
  },

  onGuestKeyboardHeightChange(e) {
    this.setData({ guestKeyboardHeight: e.detail.height || 0 })
  },

  onGuestInviteInput(e) {
    const val = String(e.detail.value || '').slice(0, 6)
    const digits = val.split('')
    while (digits.length < 6) digits.push('')
    this.setData({ guestInviteCode: val, guestInviteDigits: digits, guestInviteError: '' })
    if (val.length === 6) this.submitGuestInvite()
  },

  async submitGuestInvite() {
    const { guestInviteCode, guestInviteBusy, t } = this.data
    if (guestInviteBusy) return
    const code = guestInviteCode.trim()
    if (!code) { this.setData({ guestInviteError: t.guestInviteRequired }); return }
    this.setData({ guestInviteBusy: true, guestInviteError: '' })
    try {
      const res = await this._req(`${BASE}/api/validate-invite`, 'POST', { invite_code: code })
      if (res.data?.invalid_code) {
        this.setData({ guestInviteError: t.guestInviteInvalid, guestInviteBusy: false })
        return
      }
      if (!res.data?.success) {
        this.setData({ guestInviteError: res.data?.error || t.errServer, guestInviteBusy: false })
        return
      }
      this._pendingInviteCode = code
      this._pendingGuestSignup = { channel: res.data.channel }
      this.setData({ guestSheetStep: 'phone', guestInviteBusy: false })
    } catch (e) {
      this.setData({ guestInviteError: this.data.t.errServer, guestInviteBusy: false })
    }
  },

  handleGuestChooseAvatar(e) {
    const avatarUrl = e.detail?.avatarUrl
    if (!avatarUrl) return
    this.setData({ guestPendingAvatar: avatarUrl, guestAvatarDone: true, guestAvatarUploading: true })
    const upload = (localPath) => {
      this._req(`${BASE}/api/oss/presign?type=avatar&filename=avatar.jpg&category=users`, 'GET').then(presignRes => {
        const { put_url, get_url } = presignRes.data || {}
        if (!put_url) { this.setData({ guestAvatarUploading: false }); return }
        wx.getFileSystemManager().readFile({
          filePath: localPath,
          success: (fileRes) => {
            wx.request({
              url: put_url,
              method: 'PUT',
              data: fileRes.data,
              header: { 'Content-Type': 'application/octet-stream' },
              responseType: 'text',
              success: () => {
                this._pendingGuestAvatarUrl = get_url
                this.setData({ guestPendingAvatar: get_url, guestAvatarUploading: false, guestAvatarReady: true })
              },
              fail: () => this.setData({ guestAvatarUploading: false }),
            })
          },
          fail: () => this.setData({ guestAvatarUploading: false }),
        })
      }).catch(() => this.setData({ guestAvatarUploading: false }))
    }
    if (avatarUrl.startsWith('http')) {
      wx.downloadFile({
        url: avatarUrl,
        success: (res) => upload(res.tempFilePath),
        fail: () => this.setData({ guestAvatarUploading: false }),
      })
    } else {
      upload(avatarUrl)
    }
  },

  handleHealthChooseAvatar(e) {
    const avatarUrl = e.detail?.avatarUrl
    if (!avatarUrl) return
    const comp = this.selectComponent('#health-comp')
    const { user } = this.data
    const done = () => comp?.setData({ avatarUpdating: false })
    const upload = (localPath) => {
      this._req(`${BASE}/api/oss/presign?type=avatar&filename=avatar.jpg&category=users`, 'GET').then(presignRes => {
        const { put_url, get_url } = presignRes.data || {}
        if (!put_url) { done(); return }
        wx.getFileSystemManager().readFile({
          filePath: localPath,
          success: (fileRes) => {
            wx.request({
              url: put_url,
              method: 'PUT',
              data: fileRes.data,
              header: { 'Content-Type': 'application/octet-stream' },
              responseType: 'text',
              success: () => {
                this._saveUser(user, { avatar_url: get_url }).then(() => {
                  this._updateUser({ ...user, avatar_url: get_url })
                }).catch(() => {}).finally(done)
              },
              fail: done,
            })
          },
          fail: done,
        })
      }).catch(done)
    }
    if (avatarUrl.startsWith('http')) {
      wx.downloadFile({
        url: avatarUrl,
        success: (res) => upload(res.tempFilePath),
        fail: done,
      })
    } else {
      upload(avatarUrl)
    }
  },

  onProfileUpdated(e) {
    const updated = e.detail
    if (!updated) return
    this._updateUser(updated)
  },

  handleGuestPhone(e) {
    const { code, errMsg } = e.detail
    if (errMsg !== 'getPhoneNumber:ok' || !code) return
    this._pendingPhoneCode = code
    this.setData({ guestPhoneDone: true, guestInviteError: '', guestResolvedPhone: '' })
    const { appId } = wx.getAccountInfoSync().miniProgram
    this._req(`${BASE}/api/resolve-phone`, 'POST', { code, app_id: appId }).then(res => {
      if (res.data?.success && res.data.phone) {
        this.setData({ guestResolvedPhone: res.data.phone })
      }
    }).catch(() => {})
  },

  async proceedGuestSignup() {
    const { guestAvatarReady, guestAvatarUploading, guestResolvedPhone, guestInviteBusy, t } = this.data
    if (!guestAvatarReady || guestAvatarUploading || !guestResolvedPhone || guestInviteBusy) return
    this.setData({ guestInviteBusy: true })
    try {
      const { code: wxCode } = await this._getCode()
      const { appId } = wx.getAccountInfoSync().miniProgram
      this._pendingPhoneCode = ''
      const loginRes = await this._req(`${BASE}/api/wx-login`, 'POST', {
        code: wxCode, invite_code: this._pendingInviteCode, app_id: appId, phone: guestResolvedPhone,
      })
      if (!loginRes.data?.success) {
        if (loginRes.data?.phone_error) {
          this.setData({ guestInviteError: loginRes.data.error || t.errServer, guestInviteBusy: false, guestPhoneDone: false })
        } else {
          this.setData({ guestInviteError: loginRes.data?.error || t.errServer, guestInviteBusy: false })
        }
        return
      }
      this._pendingGuestSignup = loginRes.data
      const u = loginRes.data.user
      if (this._pendingGuestAvatarUrl) {
        try {
          await this._req(`${BASE}/api/users/${u.user_id}`, 'PUT', {
            nickname: u.nickname, phone: u.phone,
            email: u.email, gender: u.gender, birth_date: u.birth_date,
            language: u.language, coach_id: u.coach_id, avatar_url: this._pendingGuestAvatarUrl,
          })
          const confirmedUrl = await this._pollAvatarUrl(u.user_id)
          const finalUrl = confirmedUrl || this._pendingGuestAvatarUrl
          this._pendingGuestSignup.user = { ...u, avatar_url: finalUrl }
        } catch (err) {}
        this._pendingGuestAvatarUrl = ''
      }
      this._completeGuestSignup()
    } catch (e) {
      this.setData({ guestInviteError: t.errServer, guestInviteBusy: false })
    }
  },

  cancelGuestSignup() {
    this._pendingGuestSignup = null
    this._pendingGuestAvatarUrl = ''
    this._pendingInviteCode = ''
    this._pendingPhoneCode = ''
    this.setData({ guestSheetOpen: false, guestSheetStep: 'invite', guestAvatarDone: false, guestAvatarUploading: false, guestAvatarReady: false, guestPhoneDone: false, guestResolvedPhone: '', guestPendingAvatar: '', guestInviteCode: '', guestInviteDigits: Array(6).fill(''), guestInviteError: '' })
  },

  _pollAvatarUrl(userId) {
    return new Promise((resolve) => {
      let attempts = 0
      const poll = () => {
        this._req(`${BASE}/api/users/${userId}`, 'GET').then(res => {
          const url = res.data?.user?.avatar_url
          if (url) { resolve(url); return }
          if (++attempts < 8) setTimeout(poll, 1500)
          else resolve(null)
        }).catch(() => {
          if (++attempts < 8) setTimeout(poll, 1500)
          else resolve(null)
        })
      }
      poll()
    })
  },

  _completeGuestSignup() {
    const data = this._pendingGuestSignup
    if (!data) return
    this._pendingGuestSignup = null
    const user = data.user
    const channel = data.channel || null
    const coach = data.coach || null
    this.setData({ guestPendingAvatar: '' })
    app.globalData.user = user
    app.globalData.channel = channel
    app.globalData.coach = coach
    app.globalData.lang = user.language === 'en' ? 'en' : 'zh'
    wx.setStorageSync('nano_user', user)
    wx.setStorageSync('nano_channel', channel)
    wx.setStorageSync('nano_coach', coach)
    const lang = user.language === 'en' ? 'en' : 'zh'
    const roles = user.roles || ['user']
    const isCoach = roles.includes('coach')
    const isAdmin = roles.includes('admin') || roles.includes('superadmin')
    const isSuperadmin = roles.includes('superadmin')
    const userAvatarLetter = (user.nickname || 'U').slice(-1).toUpperCase()
    this.setData({ user: { ...user }, userAvatarLetter, channel, lang, t: T[lang], isGuest: false, guestSheetOpen: false, guestSheetStep: 'invite', guestInviteBusy: false, isCoach, isAdmin, isSuperadmin })
    this._initChat(user, lang)
    this._loadDots(user, lang)
    this._loadCartridges(user, lang)
    this._loadStore(user, lang)
  },

  _getCode() {
    return new Promise((resolve, reject) => {
      wx.login({ success: resolve, fail: reject })
    })
  },

  // ── HTTP helper ─────────────────────────────────────────────────────────────

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
})
