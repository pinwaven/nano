const app = getApp()
const { BASE, VERSION, WX_VERSION, IS_DEV } = require('../../utils/config.js')
const toolActions = require('../../utils/tool-actions')
const { resolveAvatarUrl, DEFAULT_MOOD } = require('../../utils/mood.js')
const { maskPhone } = require('../../utils/phone.js')
const { createPinchStepper } = require('../../utils/pinch.js')
const { mdToSegments, MD_TAG_STYLE } = require('../../utils/markdown.js')
const { buildSeriesIndex, sparkForLabel, appendReading } = require('../../utils/biomarker-series.js')
const speechPlugin = requirePlugin('WechatSI')

const KINO_SIM_SERIAL = 'KNA2-00000'

const CART_SETS = [
  {
    key: 'set-foundation',
    nameZh: '基础方阵套装', nameEn: 'Foundation Set',
    descZh: '甲基化 · 骨脉 · 静心 · 精力 · 迷走 · 线粒体', descEn: 'Methylation · Bone-Vascular · Sleep · Energy · Vagal · Mito',
    color: '#6375EC',
    dotItems: [
      { key: 'DOT-N1', zhName: '甲基平衡', enName: 'Methyl Balance' },
      { key: 'DOT-N2', zhName: '骨脉同步', enName: 'Bone-Vascular Sync' },
      { key: 'DOT-N3', zhName: '静心夜', enName: 'Quiet Mind' },
      { key: 'DOT-N4', zhName: '持续精力', enName: 'Steady Energy' },
      { key: 'DOT-N5', zhName: '迷走张力', enName: 'Vagal Tone' },
      { key: 'DOT-N6', zhName: '线粒体焕新', enName: 'Mito Renew' },
    ],
  },
  {
    key: 'set-renewal',
    nameZh: '焕新方阵套装', nameEn: 'Renewal Set',
    descZh: '衰老清除 · 明眸 · NAD · 肌光 · 代谢 · 心智', descEn: 'Senescence · Eyes · NAD · Skin · Metabolic · Mind',
    color: '#10b981',
    dotItems: [
      { key: 'DOT-N7', zhName: '衰老清除', enName: 'Senescence Clear' },
      { key: 'DOT-N8', zhName: '明眸', enName: 'Macular Guard' },
      { key: 'DOT-N9', zhName: 'NAD焕新', enName: 'NAD Renew' },
      { key: 'DOT-N10', zhName: '肌光焕采', enName: 'Radiant Skin' },
      { key: 'DOT-N11', zhName: '代谢焕新', enName: 'Metabolic Renew' },
      { key: 'DOT-N12', zhName: '敏锐心智', enName: 'Sharp Mind' },
    ],
  },
  {
    key: 'set-defense',
    nameZh: '防御方阵套装', nameEn: 'Defense Set',
    descZh: '肠道 · 免疫 · 抗糖化 · 心血管 · 血脂 · 抗氧化', descEn: 'Gut · Immune · Glycation · Cardio · Cholesterol · Antioxidant',
    color: '#f59e0b',
    dotItems: [
      { key: 'DOT-N13', zhName: '肠道焕新', enName: 'Gut Renew' },
      { key: 'DOT-N14', zhName: '免疫韧性', enName: 'Immune Resilience' },
      { key: 'DOT-N15', zhName: '抗糖化防护', enName: 'Glycation Guard' },
      { key: 'DOT-N16', zhName: '心血管信号', enName: 'Cardio Signal' },
      { key: 'DOT-N17', zhName: '血脂平衡', enName: 'Cholesterol Balance' },
      { key: 'DOT-N18', zhName: '抗氧化盾', enName: 'Antioxidant Shield' },
    ],
  },
]

// ── i18n ──────────────────────────────────────────────────────────────────────

const T = {
  zh: {
    tabChat: '对话', tabHealth: '健康', tabPlans: '方案', tabStore: '补给', tabLearn: '学习',
    plansDotsPlanTab: '方案', plansDotsDotsTab: '原粒', learnAcademyTab: '学院', learnBoxTab: '魔盒',
    wellnessEmpty: '暂无内容',
    wellnessDeviceTitle: '智能戒指', wellnessDeviceDownload: '复制下载链接', wellnessDeviceNoApk: '暂无可用版本',
    wellnessDeviceVersion: '版本', wellnessOpenLink: '复制链接',
    loading: '加载中…',
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
    formulationReadyTitle: '您的专属方案已生成',
    formulationNotReadyTitle: '尚未生成本方案的原粒配方',
    formulationNotReadyHint: '在聊天工具箱中点击"配置原粒"，即可根据本方案生成专属配方。',
    buyFormulationBtn: '购买此配方',
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
    exitSandbox: '退出沙盒',
    sandboxBanner: '沙盒模式：正在以「{name}」的身份查看，任何操作都不会保存',
    initMsg: '您好！我是 Nano，您的AI健康伴侣。今天有什么可以帮您的？',
    verifyPhonePrompt: '为了确保您的健康数据准确关联到您本人，请验证您的手机号码。',
    verifyPhoneCta: '验证手机号 →',
    inputPh: '输入消息…',
    micRecording: '正在录音…松开结束',
    errServer: '无法连接服务器，请重试。',
    chatThinking: '正在构建研究计划…',
    chatTimedOut: '这次分析没能按时完成，抱歉～ 你可以稍后再试一次。',
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
    neoBindTitle: '请先绑定 Neo 分配器以管理原粒盒',
    neoBindBtn: '绑定 Neo 设备',
    neoNotFoundMsg: '附近未找到 Neo 设备',
    // ── Scan-to-activate (box QR → 28-day cycle starts today) ──
    scanBoxTitle: '扫描包装激活方案',
    scanBoxDetail: '收到定制原粒后扫描盒身二维码，28 天周期从今天开始',
    scanBoxWorking: '正在激活…',
    scanBoxOk: '已激活，28 天周期从今天开始',
    scanBoxAlready: '这盒已经激活过了',
    scanBoxFailTitle: '无法激活',
    scanBoxErrGeneric: '暂时无法激活，请稍后再试。',
    scanBoxErr_invalid_box_code: '这不是原粒包装上的二维码。',
    scanBoxErr_box_not_found: '未找到该包装，请确认扫描的是原粒盒身的二维码。',
    scanBoxErr_not_your_box: '这盒原粒是为其他人定制的，配方基于对方的检测数据，请勿服用。',
    scanBoxErr_claimed_by_other: '这盒已被其他账号激活。',
    scanBoxErr_batch_recalled: '该批次已被召回，请勿服用，我们会尽快与您联系。',
    scanBoxErr_formulation_not_approved: '该配方尚未通过专家审核，请稍后再试。',
    gotIt: '知道了',
    orderDotsTitle: '未绑定 Neo 分配器，可直接订购原粒胶囊',
    orderDotsDetail: '默认 4 周装 · 56 粒 · 每日 2 粒',
    orderDotsBtn: '订购 28 天定制套餐',
    // ── My dots packages (Plans ▸ Dots) ──
    // Stage labels are keyed by the server's own stage string (t['pkgStage_' + p.stage]),
    // following the t['scanBoxErr_' + reason] convention already used below. A stage with no key
    // renders empty — WXML has no compile-time key checking — so every value in
    // handlers/dots.js's PACKAGE_STAGES must have a line here AND in the en block.
    pkgSectionTitle: '我的原粒套餐',
    pkgStage_proposed: '待下单',
    pkgStage_pending_payment: '待付款',
    pkgStage_paid: '已付款',
    pkgStage_awaiting_formulation: '待确认配方',
    pkgStage_awaiting_ag: 'Viva AG 配方中',
    pkgStage_expert_review: '专家审核中',
    pkgStage_compounding: '配制中',
    pkgStage_shipped: '已发货',
    pkgStage_delivered: '已送达',
    pkgStage_active: '进行中',
    pkgStage_cancelled: '已取消',
    pkgStage_refunded: '已退款',
    pkgUnnamed: '定制原粒方案',
    pkgUseFormulaBtn: '用此配方定制',
    pkgNeedsFormulaHint: '请先在对话中使用「营养定制」生成配方',
    pkgScanBtn: '扫描包装二维码启用',
    pkgOrderBtn: '按此配方下单',
    pkgOrderGone: '该套餐已不在等待配方（可能已退款或已由其他设备提交）。请刷新后重试。',
    pkgSubmitConfirm: '确认用当前配方定制这份套餐？确认后即进入配制，无法更改。',
    pkgSubmitOk: '已提交配制',
    pkgDay: (n, total) => `第 ${n} 天 · 共 ${total} 天`,
    pkgOrderedOn: (d) => `${d} 下单`,
    pkgTierUpTo: (n) => `最多 ${n} 种原粒`,
    copy: '复制',
    cartridgeTitle: '原粒盒',
    noCartridges: '未插入原粒盒。请将原粒盒插入分配器。',
    simCartTitle: '选择套装',
    simCartSubtitle: '自动生成 NFC 标签并插入',
    simCartInserting: '正在插入…',
    simCartDone: '套装已插入！',
    simCartCancel: '取消',
    noPlan: '暂无营养方案。在对话中使用「营养定制」生成专属配方并下单，收到实物后扫码即可启用。',
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
    storePartnerPrice: '合伙人价',
    storeEmpty: '暂无商品。',
    storeSubProducts: '商品', storeSubOrders: '我的订单',
    noOrders: '暂无订单记录。',
    storeAddToCart: '加入', storeCart: '购物车',
    storeCartCheckout: '结算', storeCartTotal: '合计',
    storeCartItems: '件商品', storeCartEmpty: '购物车是空的',
    checkoutShippingTitle: '收货信息',
    checkoutName: '收货人姓名', checkoutNamePh: '请输入姓名',
    checkoutPhone: '手机号码', checkoutPhonePh: '请输入手机号',
    checkoutAddress: '收货地址', checkoutAddressPh: '省市区街道详细地址',
    checkoutFillRequired: '请填写完整的收货信息',
    checkoutWxAddress: '使用微信地址',
    checkoutWxAddressFail: '无法获取微信地址，请手动填写',
    checkoutInsufficientTitle: '积分不足',
    checkoutInsufficientMsg: '本次结算需要 {need} 积分，您当前有 {have} 积分。',
    toolFormulaDots: '营养定制',
    toolTestChip: '检测服务',
    toolHealthAdvice: '健康管理',
    toolUploadImage: '上传图片',
    imageUploading: '正在上传图片…',
    imageAnalyzing: '正在分析图片，请稍候…',
    imageError: '图片分析失败，请重试。',
    hrAskOwn: '这份化验／体检报告是您本人的吗？',
    hrYes: '是的',
    hrNo: '不是',
    hrAskSave: '要把它保存到您的健康档案吗（健康页 › 实验室）？',
    hrSave: '保存',
    hrLater: '暂不',
    hrNotOwn: '好的，我不会保存这份报告。',
    hrNotSaved: '好的，已取消保存。',
    hrSaving: '正在保存…',
    hrSaved: '已保存到您的健康档案（健康页 › 实验室）。',
    hrSavedBioage: '您的生物年龄也已更新。',
    hrSaveError: '保存失败，请重试。',
    toolFormulaDotMsg: '请帮我配制我的 DOTS 方案',
    toolTestChipMsg: '我想使用 Kino 芯片',
    toolHealthAdviceMsg: '请分析我目前的健康状态，并给我专业的健康建议。',
    healthAdviceGenerating: '正在分析您的健康数据，请稍候…',
    healthAdviceError: '健康分析请求失败，请重试。',
    formulaGenerating: '正在为你定制 28 天营养方案…',
    formulaComplete: '您的 28 天定制方案已生成！',
    formulaProcessing: '正在为您深度分析并定制 28 天方案，完成后会发送通知，请稍候…',
    formulaCardTitle: '原粒定制方案',
    productCardTitle: '商城可选',
    formulaEvalNote: '收到实物扫码后启用',
    formulaAm: '早',
    formulaPm: '晚',
    formulaTotalLabel: '每日合计',
    // Day numbers in a proposal are RELATIVE — the cycle is anchored when the delivered box is
    // scanned, not when the plan was worked out — so the label is "Day 1-9", never a date. The
    // word is deliberately the English one in both languages: it reads as a product term here,
    // the way DOTS and BioAge already do, and "第1–9 · 12–28天" does not survive day ranges.
    formulaDayWord: 'Day',
    formulaResetDay: 'DOT-N7 单独重置',
    formulaDaysUnit: '天',
    formulaCapsulesUnit: '粒胶囊',
    formulaOrderCta: '购买 28 天定制套餐 →',
    formulaLabelCta: '查看配方标签与二维码',
    formulaSubmitCta: '确认此方案，开始配制 →',
    formulaSubmitConfirmTitle: '确认配制方案',
    formulaSubmitConfirmBody: '确认后将按此 28 天方案为您配制并发货，配方不可再更改。如需调整，请先重新生成。',
    formulaSubmitOk: '已提交配制，我们会尽快为您加工发货。',
    formulaSubmitNoOrder: '未找到待配制的订单，可能已完成或已取消。',
    formulaSubmitExpert: '该订单为专家审核套餐，正式配方将由 Viva AG 生成。',
    formulaSubmitOverTier: '本方案某一周同时服用的原粒种类超出您购买的套餐上限，请重新使用「营养定制」生成一份符合套餐的方案。',
    formulaSubmitFailed: '提交失败，请稍后重试。',
    formulaAgPending: '您已购买 28 天套餐（含专家审核）。正式配方将由 Viva AG 生成并经营养专家审核，以上仅为参考评估。',
    formulaError: '方案生成失败，请重试。',
    chatHistoryLoadMore: '下拉或点此加载更早消息',
    chatHistoryLoading: '加载中…',
    chatHistoryStart: '— 对话开始 —',
    mdTakeaway: '关键要点',
    mdLinkCopy: '复制链接',
    mdLinkCopied: '链接已复制',
    adminMenu: '渠道管理',
    coachMenu: '教练面板',
    superadminMenu: '超管面板',
    webAdminMenu: '网页后台',
    kinoSimMenu: 'Kino 模拟器',
    referralMenu: '邀请好友',
    phonesMenu: '手机号管理',
    vivaRedeemMenu: '兑换订阅码',
    vivaRedeemTitle: '兑换 Viva 订阅码',
    vivaRedeemPlaceholder: '请输入订阅激活码',
    vivaRedeemBtn: '兑换',
    vivaRedeemRequired: '请输入激活码',
    vivaRedeemInvalid: '激活码无效或已失效',
    vivaRedeemAlreadyUsed: '此激活码已被使用',
    vivaRedeemExpired: '此激活码已过期',
    vivaRedeemSuccess: '兑换成功！',
    vivaSubscriptionExpiredBanner: 'Viva 订阅已过期，续订后即可继续对话',
    vivaSubscriptionRenewBtn: '续订',
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
    kinoScanClaimedByOther: '此芯片已被其他账户登记，正在等待检测结果。如需重新使用，请联系管理员重置该芯片。',
    kinoScanInvalidChip: '此二维码不是有效的 Kino 芯片，请扫描芯片上的二维码。',
    kinoScanError: '登记失败，请重试。',
    bmLabels: { hsCRP: 'hs-CRP', GDF15: 'GDF-15', IL6: 'IL-6', GA: '糖化白蛋白', CystatinC: '胱抑素 C', CD38: 'CD38' },
    subAgeLabels: { ResilienceAge: '抗压年龄', CellularAge: '细胞年龄', MetabolicAge: '代谢年龄', MicroVascularAge: '微血管年龄' },
    lightMode: '浅色模式',
    darkMode: '深色模式',
    textSizeMenu: '字体大小',
    textSizeLevels: ['标准', '较大', '大', '特大'],
    guestHeaderName: '游客',
    guestJoinTitle: '激活健康账户',
    guestJoinDesc: '输入您的邀请码，解锁 AI 健康教练、生物标志物检测与精准营养方案。',
    guestJoinBtn: '激活账户',
    guestActivating: '注册中…',
    guestInviteRequired: '请输入邀请码',
    guestInviteInvalid: '邀请码无效或已失效，请重新输入',
    guestSignupBtn: '注册',
    guestDotsCta: '激活账户后，获取您的专属营养方案',
    guestMenuSignUp: '注册账户',
    aiDisclaimer: '本服务为AI生成内容，结果仅供参考',
    nowPlaying: '正在播放',
    eventsTitle: '线下活动', eventsSignUp: '立即报名', eventsSignedUp: '已报名',
    eventsCancel: '取消报名', eventsFull: '已满', eventsEmpty: '暂无线下活动',
    eventsLocation: '地点', eventsCapacity: '名额', eventsLoading: '加载中…',
    orderStatus: {
      pending: '待处理', confirmed: '已确认', shipped: '已发货',
      delivered: '已送达', cancelled: '已取消',
    },
    training: {
      courses: '课程', library: '参考资料',
      noTraining: '暂无已发布的课程',
      noLibrary: '暂无参考资料',
      noLessons: '本课程暂无课节',
      lessonCount: (n) => `${n} 节`,
      markComplete: '标记为已完成',
      markedComplete: '已完成 ✓',
      backToCourses: '← 课程列表',
      backToLessons: '← 课节列表',
      loadError: '加载失败，请重试',
    },
  },
  en: {
    tabChat: 'Chat', tabHealth: 'Health', tabPlans: 'Plans', tabStore: 'Store', tabLearn: 'Learn',
    plansDotsPlanTab: 'Plans', plansDotsDotsTab: 'Dots', learnAcademyTab: 'Academy', learnBoxTab: 'Box',
    wellnessEmpty: 'No content yet',
    wellnessDeviceTitle: 'Smart Ring', wellnessDeviceDownload: 'Copy Download Link', wellnessDeviceNoApk: 'No APK available',
    wellnessDeviceVersion: 'Version', wellnessOpenLink: 'Copy Link',
    loading: 'Loading…',
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
    formulationReadyTitle: 'Your personalized formulation is ready',
    formulationNotReadyTitle: "You haven't formulated dots for this focus yet",
    formulationNotReadyHint: 'Tap "Formulate Dots" in the chat toolbox to generate a personalized recipe for this focus.',
    buyFormulationBtn: 'Buy This Formulation',
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
    exitSandbox: 'Exit Sandbox',
    sandboxBanner: 'Sandbox: viewing as "{name}" — nothing is saved',
    initMsg: 'Hello! I am Nano, your AI health companion. How can I help you today?',
    verifyPhonePrompt: 'To make sure your health data is accurately linked to you, please verify your phone number.',
    verifyPhoneCta: 'Verify Phone Number →',
    inputPh: 'Type a message…',
    micRecording: 'Recording… release to finish',
    errServer: 'Could not reach the server. Please try again.',
    chatThinking: 'Building your research plan…',
    chatTimedOut: "This one didn't finish in time — sorry. Please try again in a moment.",
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
    neoBindTitle: 'Bind a Neo dispenser to manage your cartridges',
    neoBindBtn: 'Bind Neo Device',
    neoNotFoundMsg: 'No Neo device found nearby',
    // ── Scan-to-activate (box QR → 28-day cycle starts today) ──
    scanBoxTitle: 'Scan your box to start',
    scanBoxDetail: 'Scan the QR on your capsule box — the 28-day cycle begins today',
    scanBoxWorking: 'Activating…',
    scanBoxOk: 'Activated — your 28-day cycle starts today',
    scanBoxAlready: 'This box is already activated',
    scanBoxFailTitle: "Couldn't activate",
    scanBoxErrGeneric: "Couldn't activate this box just now. Please try again shortly.",
    scanBoxErr_invalid_box_code: "That isn't a code from a Dots box.",
    scanBoxErr_box_not_found: "We couldn't find that box — check you scanned the QR on the capsule box itself.",
    scanBoxErr_not_your_box: "This box was formulated for someone else, from their test results. Please don't take it.",
    scanBoxErr_claimed_by_other: 'This box has already been activated on another account.',
    scanBoxErr_batch_recalled: "This batch has been recalled — please don't take it. We'll be in touch shortly.",
    scanBoxErr_formulation_not_approved: "This formulation hasn't cleared expert review yet. Please try again shortly.",
    gotIt: 'Got it',
    orderDotsTitle: 'No Neo dispenser bound — order pre-mixed capsules instead',
    orderDotsDetail: 'Default: 4-week pack · 56 capsules · 2/day',
    orderDotsBtn: 'Order the 28-Day Package',
    // ── My dots packages (Plans ▸ Dots) — see the zh block for why every stage needs a key ──
    pkgSectionTitle: 'My Dots Packages',
    pkgStage_proposed: 'Ready to order',
    pkgStage_pending_payment: 'Awaiting payment',
    pkgStage_paid: 'Paid',
    pkgStage_awaiting_formulation: 'Needs your formula',
    pkgStage_awaiting_ag: 'Viva AG formulating',
    pkgStage_expert_review: 'Expert review',
    pkgStage_compounding: 'Being compounded',
    pkgStage_shipped: 'Shipped',
    pkgStage_delivered: 'Delivered',
    pkgStage_active: 'In progress',
    pkgStage_cancelled: 'Cancelled',
    pkgStage_refunded: 'Refunded',
    pkgUnnamed: 'Custom dots formulation',
    pkgUseFormulaBtn: 'Use this formula',
    pkgNeedsFormulaHint: 'Run Formulate Dots in chat first to build a formula',
    pkgScanBtn: 'Scan the box QR to start',
    pkgOrderBtn: 'Order this formula',
    pkgOrderGone: 'That package is no longer waiting for a formula — it may have been refunded, or filled from another device. Pull to refresh and try again.',
    pkgSubmitConfirm: 'Compound this package using your current formula? Compounding starts right away and cannot be changed.',
    pkgSubmitOk: 'Sent to compounding',
    pkgDay: (n, total) => `Day ${n} of ${total}`,
    pkgOrderedOn: (d) => `Ordered ${d}`,
    pkgTierUpTo: (n) => `up to ${n} dots`,
    copy: 'Copy',
    cartridgeTitle: 'Cartridges',
    noCartridges: 'No cartridges inserted. Insert cartridges into your dispenser.',
    simCartTitle: 'Choose a Set',
    simCartSubtitle: 'Auto-generates NFC tags and inserts',
    simCartInserting: 'Inserting…',
    simCartDone: 'Set inserted!',
    simCartCancel: 'Cancel',
    noPlan: 'No nutrition plan yet. Use Formulate Dots in chat to build your formulation and order it — scan the box when it arrives to start.',
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
    storePartnerPrice: 'Partner Price',
    storeEmpty: 'No products available.',
    storeSubProducts: 'Products', storeSubOrders: 'My Orders',
    noOrders: 'No orders yet.',
    storeAddToCart: 'Add', storeCart: 'Cart',
    storeCartCheckout: 'Checkout', storeCartTotal: 'Total',
    storeCartItems: ' items', storeCartEmpty: 'Cart is empty',
    checkoutShippingTitle: 'Shipping Info',
    checkoutName: 'Recipient Name', checkoutNamePh: 'Enter full name',
    checkoutPhone: 'Phone Number', checkoutPhonePh: 'Enter phone number',
    checkoutAddress: 'Shipping Address', checkoutAddressPh: 'Province, city, district, street & details',
    checkoutFillRequired: 'Please fill in all shipping details',
    checkoutWxAddress: 'Use WeChat Address',
    checkoutWxAddressFail: 'Cannot get WeChat address, please fill manually',
    checkoutInsufficientTitle: 'Not Enough Credits',
    checkoutInsufficientMsg: 'This order needs {need} credits, but you only have {have}.',
    toolFormulaDots: 'Formulate Dots',
    toolTestChip: 'Use Kino Chip',
    toolHealthAdvice: 'Health Advice',
    toolUploadImage: 'Upload Image',
    imageUploading: 'Uploading image…',
    imageAnalyzing: 'Analyzing your image, please wait…',
    imageError: 'Image analysis failed. Please try again.',
    hrAskOwn: 'Is this lab / checkup report your own?',
    hrYes: 'Yes',
    hrNo: 'No',
    hrAskSave: 'Save it to your health records (Health tab › Lab)?',
    hrSave: 'Save',
    hrLater: 'Not now',
    hrNotOwn: "Got it — I won't save this report.",
    hrNotSaved: 'Okay, not saved.',
    hrSaving: 'Saving…',
    hrSaved: 'Saved to your health records (Health tab › Lab).',
    hrSavedBioage: 'Your BioAge has been updated too.',
    hrSaveError: 'Save failed. Please try again.',
    toolFormulaDotMsg: 'Please formulate my Dots plan',
    toolTestChipMsg: 'I want to use a Kino chip',
    toolHealthAdviceMsg: 'Please analyze my current health status and give me personalized health advice.',
    healthAdviceGenerating: 'Analyzing your health data, please wait…',
    healthAdviceError: 'Health analysis request failed. Please try again.',
    formulaGenerating: 'Building your 28-day formulation from your biomarkers…',
    formulaComplete: 'Your 28-day formulation is ready!',
    formulaProcessing: "Deeply analyzing your data and building your 28-day formulation — you'll get a notification when it's ready…",
    formulaCardTitle: 'Your formulation',
    productCardTitle: 'From the store',
    formulaEvalNote: 'Starts when you scan your box',
    formulaAm: 'AM',
    formulaPm: 'PM',
    formulaTotalLabel: 'Per day',
    formulaDayWord: 'Day',
    formulaResetDay: 'DOT-N7 reset',
    formulaDaysUnit: ' days',
    formulaCapsulesUnit: ' capsules',
    formulaOrderCta: 'Buy your 28-day package →',
    formulaLabelCta: 'View formulation label & QR',
    formulaSubmitCta: 'Confirm and start compounding →',
    formulaSubmitConfirmTitle: 'Confirm this formulation',
    formulaSubmitConfirmBody: 'This 28-day formulation will be compounded and shipped to you. It cannot be changed afterwards — regenerate first if you want to adjust it.',
    formulaSubmitOk: 'Submitted. We will compound and ship this to you shortly.',
    formulaSubmitNoOrder: 'No order is waiting to be formulated — it may already be fulfilled or cancelled.',
    formulaSubmitExpert: 'That order includes expert review, so its final formula comes from Viva AG.',
    formulaSubmitOverTier: "One week of this formulation runs more dots at once than your package allows — run Formulate Dots again to build one that fits it.",
    formulaSubmitFailed: 'Submission failed. Please try again shortly.',
    formulaAgPending: 'You have a 28-day package with expert review. Its final formula will be produced by Viva AG and signed off by a nutritionist — the allocation above is a preview.',
    formulaError: 'Plan generation failed. Please try again.',
    chatHistoryLoadMore: 'Pull or tap to load older messages',
    chatHistoryLoading: 'Loading…',
    chatHistoryStart: '— Beginning of conversation —',
    mdTakeaway: 'Key takeaway',
    mdLinkCopy: 'Copy link',
    mdLinkCopied: 'Link copied',
    adminMenu: 'Channel Admin',
    coachMenu: 'Coach Panel',
    superadminMenu: 'Super Admin',
    webAdminMenu: 'Web Admin',
    kinoSimMenu: 'Kino Simulator',
    referralMenu: 'Invite Friends',
    phonesMenu: 'Manage Phone Numbers',
    vivaRedeemMenu: 'Redeem Subscription Code',
    vivaRedeemTitle: 'Redeem Viva Subscription Code',
    vivaRedeemPlaceholder: 'Enter your subscription code',
    vivaRedeemBtn: 'Redeem',
    vivaRedeemRequired: 'Please enter a code',
    vivaRedeemInvalid: 'Invalid or expired code',
    vivaRedeemAlreadyUsed: 'This code has already been used',
    vivaRedeemExpired: 'This code has expired',
    vivaRedeemSuccess: 'Redeemed successfully!',
    vivaSubscriptionExpiredBanner: 'Your Viva subscription has expired. Renew to keep chatting.',
    vivaSubscriptionRenewBtn: 'Renew',
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
    kinoScanClaimedByOther: 'This chip is already registered to another account and is awaiting analysis. Ask an admin to reset it if you need to reuse it.',
    kinoScanInvalidChip: 'This QR code is not a valid Kino chip. Please scan the QR code on your chip.',
    kinoScanError: 'Registration failed. Please try again.',
    bmLabels: { hsCRP: 'hs-CRP', GDF15: 'GDF-15', IL6: 'IL-6', GA: 'Glycated Albumin', CystatinC: 'Cystatin C', CD38: 'CD38' },
    subAgeLabels: { ResilienceAge: 'Resilience Age', CellularAge: 'Cellular Age', MetabolicAge: 'Metabolic Age', MicroVascularAge: 'Micro-Vascular Age' },
    lightMode: 'Light Mode',
    darkMode: 'Dark Mode',
    textSizeMenu: 'Text Size',
    textSizeLevels: ['Default', 'Large', 'Larger', 'Largest'],
    guestHeaderName: 'Guest',
    guestJoinTitle: 'Activate Your Account',
    guestJoinDesc: 'Enter your invite code to unlock AI health coaching, biomarker testing, and precision nutrition.',
    guestJoinBtn: 'Activate Account',
    guestActivating: 'Activating…',
    guestInviteRequired: 'Please enter an invite code',
    guestInviteInvalid: 'Invalid or expired invite code. Please try again.',
    guestSignupBtn: 'Sign up',
    guestDotsCta: 'Activate your account to get your personalized nutrition plan',
    guestMenuSignUp: 'Sign Up',
    aiDisclaimer: 'AI-generated content — for reference only',
    nowPlaying: 'Now Playing',
    eventsTitle: 'Events', eventsSignUp: 'Sign Up', eventsSignedUp: 'Registered',
    eventsCancel: 'Cancel Registration', eventsFull: 'Full', eventsEmpty: 'No events available',
    eventsLocation: 'Location', eventsCapacity: 'Spots', eventsLoading: 'Loading…',
    orderStatus: {
      pending: 'Pending', confirmed: 'Confirmed', shipped: 'Shipped',
      delivered: 'Delivered', cancelled: 'Cancelled',
    },
    training: {
      courses: 'Courses', library: 'Library',
      noTraining: 'No published courses yet',
      noLibrary: 'No reference materials yet',
      noLessons: 'No lessons in this course yet',
      lessonCount: (n) => `${n} lesson${n === 1 ? '' : 's'}`,
      markComplete: 'Mark as Complete',
      markedComplete: 'Completed ✓',
      backToCourses: '← Courses',
      backToLessons: '← Lessons',
      loadError: 'Failed to load, please retry',
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

function buildSubAgeLabels(base, overrides, lang) {
  if (!overrides) return base
  const result = { ...base }
  for (const key of SUB_AGE_KEYS) {
    const override = overrides[key]?.[lang]
    if (override && override.trim()) result[key] = override.trim()
  }
  return result
}

// Notification types whose text is ALSO written to chat_messages by the backend, so the
// chat_messages catch-up poll in _poll can legitimately re-deliver the same text. Only these
// participate in the cross-channel de-duplication (_markRenderedAi/_isRenderedAi). Deliberately
// excludes coach_reminder and questionnaire_ready, which have no chat_messages row at all —
// registering a reminder would make two genuinely separate identical ones look like a duplicate.
const AI_ECHO_TYPES = new Set([
  'chat_reply', 'nutrition_plan', 'formulation_proposal', 'formulation_reorder_ready',
  'formulation_order_paid', 'biological_report',
  'coach_message', 'morning_checkin', 'midday_checkin', 'evening_checkin',
  'viva_ag_result', 'viva_ag_failed', 'viva_ag_questionnaire',
])

// Notification types delivered by the external Viva AG agent rather than by Viva itself. Drives
// the "Viva AG" label on the bubble so the user can tell a deep analysis apart from a normal
// reply; the durable equivalent is chat_messages.source.
const AG_NOTIFICATION_TYPES = new Set(['viva_ag_result', 'viva_ag_failed', 'viva_ag_questionnaire'])

// Two chat messages more than this far apart get a time separator between them. The agentic
// loop delivers replies through _poll minutes after the question, and history spans days, so
// without this a conversation reads as one undifferentiated run.
const MSG_SEPARATOR_GAP_MS = 30 * 60 * 1000

function _msgSeparator(prevTs, ts, lang) {
  if (!prevTs || !ts || ts - prevTs < MSG_SEPARATOR_GAP_MS) return ''
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return `${hh}:${mm}`
  const md = lang === 'zh' ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getMonth() + 1}/${d.getDate()}`
  return `${md} ${hh}:${mm}`
}

// "The user backed out of the package picker", which is NOT the same as "nothing is waiting":
// one must silently do nothing, the other must explain itself. A symbol so it can never collide
// with a real order_id.
const CANCELLED = Symbol('picker-cancelled')

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

function getWeekRange(offsetWeeks = 0) {
  const now = new Date()
  const dow = now.getDay()
  const daysFromMonday = dow === 0 ? 6 : dow - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - daysFromMonday + offsetWeeks * 7)
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

// One row per dots package, for Plans ▸ Dots. The server already merged the GCN order with
// nano's own formula and derived the stage (handlers/dots.js, _mergeFormulationPackages); this
// only turns that into strings, because WXML cannot format or branch on a numeric day count.
//
// Every stage label is looked up as t['pkgStage_' + stage] rather than switched on here, so a new
// server-side stage needs one line in each T block and nothing else. A missing key falls back to
// the generic name instead of rendering an empty pill — WXML has no compile-time key checking.
function mapPackages(rawPackages, t, lang) {
  if (!Array.isArray(rawPackages) || !t) return []
  return rawPackages.map((p, i) => {
    const name = p.package_name || t.pkgUnnamed
    const bits = []
    // What the row says under its title, most specific fact first.
    if (p.stage === 'active' && p.day_index) {
      bits.push(t.pkgDay(p.day_index, p.total_days))
    } else {
      if (p.tier_label) bits.push(p.tier_label)
      else if (p.max_distinct_dots) bits.push(t.pkgTierUpTo(p.max_distinct_dots))
      if (p.ordered_at) bits.push(t.pkgOrderedOn(fmtDate(p.ordered_at, lang)))
    }
    return {
      // order_id is a UUID and plan_id an int; a package can legitimately have only one of them,
      // so the wx:key is the pair plus the index rather than either alone.
      key: `${p.order_id || 'p'}-${p.plan_id || 'o'}-${i}`,
      stage: p.stage,
      stageLabel: t['pkgStage_' + p.stage] || name,
      name,
      meta: bits.join(' · '),
      order_id: p.order_id || null,
      plan_id: p.plan_id || null,
      // The formula a waiting package could be filled with — a DIFFERENT plan from plan_id, which
      // is what is already attached (nothing is bound until submit). Dropping this is what makes
      // the CTA silently render as a hint, so it must stay copied through.
      submit_plan_id: p.submit_plan_id || null,
      can_submit: !!p.can_submit,
      can_scan: !!p.can_scan,
      can_order: !!p.can_order,
      tracking_number: p.tracking_number || null,
      // The courier's own status line when Kuaidi100 has pushed one, otherwise just the number.
      trackingLabel: [p.shipping_carrier, p.tracking_number, p.tracking_status_desc]
        .filter(Boolean).join(' · '),
      // "Bought and not yet finished with" — what hides the buy-another card. A proposal is not
      // in flight (nothing was paid), and neither is a package already taken, cancelled or refunded.
      inFlight: !['proposed', 'active', 'cancelled', 'refunded'].includes(p.stage),
    }
  })
}

// Constrains <img> tags in HTML descriptions so pictures fit the store card width
function prepDescHtml(html) {
  return html.replace(/<img\b([^>]*?)\/?>/gi, (m, attrs) => {
    if (/style\s*=/i.test(attrs)) {
      return `<img${attrs.replace(/style\s*=\s*"([^"]*)"/i, 'style="max-width:100%;height:auto;$1"')}>`
    }
    return `<img style="max-width:100%;height:auto;display:block;"${attrs ? ' ' + attrs : ''}>`
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
  return rawItems.map(item => {
    const partnerRaw = lang === 'zh' ? item.partner_price_cny : item.partner_price_usd
    const hasPartnerPrice = partnerRaw != null
    const desc = (lang === 'zh' ? item.desc_zh : item.desc_en) || ''
    const descIsHtml = /<[a-z][^>]*>/i.test(desc)
    const hasCreditsPrice = item.price_credits != null
    const creditsRaw = hasCreditsPrice ? parseFloat(item.price_credits) : null
    const variants = item.variants
      ? item.variants.map(v => ({
          id: v.id,
          skuCode: v.sku_code,
          label: Object.entries(v.attributes || {}).map(([k, val]) => `${k} ${val}`).join(' · '),
          stockQuantity: v.stock_quantity,
        }))
      : null
    return {
      id: item.id,
      key: item.key_name,
      name: lang === 'zh' ? item.name_zh : item.name_en,
      desc: descIsHtml ? prepDescHtml(desc) : desc,
      descIsHtml,
      unit: lang === 'zh' ? item.unit_zh : item.unit_en,
      price: hasCreditsPrice ? `${creditsRaw} ${lang === 'zh' ? '积分' : 'pts'}` : (lang === 'zh' ? `¥${item.price_cny}` : `$${item.price_usd}`),
      partnerPrice: (!hasCreditsPrice && hasPartnerPrice) ? (lang === 'zh' ? `¥${partnerRaw}` : `$${partnerRaw}`) : '',
      rawPrice: hasCreditsPrice ? creditsRaw : (hasPartnerPrice ? partnerRaw : (lang === 'zh' ? (item.price_cny || 0) : (item.price_usd || 0))),
      useCredits: hasCreditsPrice,
      tagLabel: tagLabel(item.tag),
      variants,
      selectedVariantId: null,
    }
  })
}

function mapStoreOrders(rawOrders, lang) {
  return rawOrders.map(o => ({
    id: o.id,
    shortId: o.id.slice(0, 8),
    name: lang === 'zh' ? (o.name_zh || o.item_key) : (o.name_en || o.item_key),
    unit: lang === 'zh' ? o.unit_zh : o.unit_en,
    quantity: o.quantity,
    price: o.price_credits != null ? `${o.price_credits} ${lang === 'zh' ? '积分' : 'pts'}` : (lang === 'zh' ? `¥${o.price_cny}` : `$${o.price_usd}`),
    status: o.status,
    createdAt: new Date(o.created_at).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US'),
    shippingName: o.shipping_name || '',
    shippingPhone: o.shipping_phone || '',
    shippingAddress: o.shipping_address || '',
    shippingCarrier: o.shipping_carrier || '',
    trackingNumber: o.tracking_number || '',
    paymentStatus: o.payment_status || 'paid',
    paymentMethod: o.payment_method || 'wechat_pay',
    shippedAt: o.shipped_at ? new Date(o.shipped_at).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US') : '',
    deliveredAt: o.delivered_at ? new Date(o.delivered_at).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US') : '',
  }))
}

// ── Page ──────────────────────────────────────────────────────────────────────

Page({
  data: {
    user: null,
    lang: 'zh',
    t: T.zh,
    textScale: 0,   // accessibility text size, 0-3; renders as .fs-N on the root view
    tab: 'chat',
    version: IS_DEV ? VERSION : WX_VERSION,

    // Privacy authorization (page-level — always visible regardless of active tab)
    showPrivacyModal: false,

    // Chat
    messages: [],
    // Static per-tag inline-style map for <mp-html>. Set once and never rebound: mp-html's
    // `properties` declares an observer on `content` ONLY, so re-binding tagStyle would not
    // re-parse messages that are already rendered. Everything theme-dependent is handled by
    // inheritance (.message-ai / .theme-light .message-ai) instead. See utils/markdown.js.
    mdTagStyle: MD_TAG_STYLE,
    chatInput: '',
    isRecording: false,
    typing: false,
    chatStatusText: '',
    isSending: false,
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
    scrollAnchor: '',
    hasMoreHistory: false,
    historyLoading: false,

    userAvatarLetter: 'U',

    // Channel
    channel: null,
    isAeviva: false,

    // Viva subscription (see _loadVivaSubscriptionStatus)
    personaType: 'nano',
    vivaSubscriptionExpiresAt: null,
    vivaSubscriptionExpiresAtDisplay: '',
    vivaSubscriptionExpired: false,
    vivaRedeemSheetOpen: false,
    vivaRedeemCode: '',
    vivaRedeemBusy: false,
    vivaRedeemError: '',
    // Viva AG add-on — drives the health tab's subtab strip. Cosmetic; the server re-checks.
    vivaAgActive: false,

    // Role menu flags
    menuOpen: false,
    isCoach: false,
    isAdmin: false,
    isSuperadmin: false,
    isGuest: false,
    creditBalance: 0,
    creditCurrency: 'CNY',

    // Guest join sheet — invite-code entry only; a valid code hands off to
    // login.js, which owns account creation, avatar capture, and the
    // phone/OTP verify-phone gate (see submitGuestInvite).
    guestSheetOpen: false,
    guestInviteCode: '',
    guestInviteDigits: ['', '', '', '', '', ''],
    guestInviteBusy: false,
    guestInviteError: '',
    guestKeyboardHeight: 0,

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
    // Every dots package this user has, merged server-side from the GCN order and nano's
    // own formula. Never a source for hasPlan — see _loadDots.
    packages: [],
    hasPackageInFlight: false,
    weekLabel: '',
    dotsWeekOffset: 0,
    hasPrevWeek: false,
    hasNextWeek: false,
    simCartOpen: false,
    simCartLoading: false,
    simCartSets: [],

    // Store
    storeLoading: true,
    storeRefreshing: false,
    storeItems: [],
    storeOrders: [],
    storeSubTab: 'products',
    cart: [],
    cartMap: {},
    cartCount: 0,
    cartTotal: '',
    cartOpen: false,
    checkoutName: '',
    checkoutPhone: '',
    checkoutAddress: '',
    // Plans tab
    plansLoading: true,
    activePlans: [],
    planTemplates: [],
    planDetailOpen: false,
    planDetailData: null,
    planSubTab: 'overview',
    plansDotsSubTab: 'dots',
    neoBound: false,
    learnSubTab: 'academy',
    planBrowseOpen: false,
    events: [],
    mySignupEventIds: [],
    eventsLoading: false,
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

    // Magic Box tab
    wellnessLoading: false,
    wellnessAssets: [],        // all digital assets (with mediaType: 'audio'|'video'|'other')
    sleepPlaying: false,
    sleepCurrentTrack: null,
    sleepPosition: 0,
    sleepDuration: 0,
    deviceApkVersion: '',
    deviceApkUrl: '',

    // Academy tab
    trainingCourses: [],
    trainingLibrary: [],
    trainingCompletedIds: [],
    trainingLessons: [],
    trainingView: 'list',
    trainingCurrentCourse: null,
    trainingCurrentLesson: null,
    trainingVideoUrl: '',
    trainingTextContent: '',
    trainingLibraryContent: '',
    trainingCurrentLibraryItem: null,
    trainingLoading: false,
    trainingMarkingComplete: false,
    trainingDashboard: null,
    trainingPaths: [],
    trainingCertifications: [],
    showCertDetail: false,
    certDetailItem: null,
    trainingQuizQuestions: [],
    trainingQuizAnswers: {},
    trainingQuizResult: null,
    trainingQuizReview: [],
    trainingQuizSubmitting: false,
  },

  _pollingTimer: null,
  _kinoSlideTimer: null,
  _seenIds: null,
  _renderedAiKeys: null,
  _rawStoreItems: null,
  _rawStoreOrders: null,
  _dotsLoadedAt: 0,
  _plansLoadedAt: 0,
  _lastMsgId: null,
  _touchX: 0,
  _touchY: 0,

  onLoad(options) {
    this._seenIds = new Set()
    this._renderedAiKeys = new Set()
    const user = app.globalData.user
    if (!user) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    // Defense in depth: an interrupted sign-up (app closed/reopened right after
    // login.js's _finishNewUser, before verify-phone ran) shouldn't land here —
    // login.js's own session-restore already redirects this case, but this page
    // shouldn't trust that alone.
    if (user.pendingPhoneVerification) {
      wx.reLaunch({ url: '/pages/verify-phone/verify-phone?new=1' })
      return
    }
    this._recordManager = speechPlugin.getRecordRecognitionManager()
    this._recordManager.onStop = (res) => this._onMicStop(res)
    this._recordManager.onError = (res) => {
      console.log(JSON.stringify({ level: 'WARN', msg: '[mic] recognition error', data: res }))
      this.setData({ isRecording: false })
    }
    const { statusBarHeight = 0, windowWidth = 375 } = wx.getSystemInfoSync()
    this._screenW = windowWidth
    const capsule = wx.getMenuButtonBoundingClientRect()
    const capsuleRightPad = windowWidth - (capsule.left || windowWidth - 96) + 8
    const menuTop = statusBarHeight + 44
    const channel = app.globalData.channel || null
    const lang = app.globalData.lang || (user.language === 'en' ? 'en' : (channel?.locale === 'en' ? 'en' : 'zh'))
    const isGuest = !!user.guest
    const roles = user.roles || (isGuest ? [] : ['user'])
    const isCoach = roles.includes('coach')
    const isAdmin = roles.includes('admin') || roles.includes('superadmin')
    const isSuperadmin = roles.includes('superadmin')
    const theme = user.theme || app.globalData.theme || 'dark'
    const textScale = app.globalData.textScale || 0
    app.globalData.theme = theme
    this._applyNavBarColor(theme)
    const userAvatarLetter = (user.nickname || 'U').slice(-1).toUpperCase()
    const channelOverrides = channel?.sub_age_display_names || null
    const t = { ...T[lang], subAgeLabels: buildSubAgeLabels(T[lang].subAgeLabels, channelOverrides, lang) }
    const sandboxMode = !!app.globalData.sandboxMode
    const sandboxBannerText = sandboxMode ? t.sandboxBanner.replace('{name}', user.nickname || '—') : ''
    const isAeviva = channel?.key_name === 'aeviva' || channel?.key_name === 'aeviva-china'
    this.setData({ user: { ...user }, userAvatarLetter, channel, lang, t, statusBarHeight, capsuleRightPad, menuTop, menuOpen: false, isCoach, isAdmin, isSuperadmin, theme, textScale, isGuest, isAeviva, toolList: toolActions.getToolList(t), sandboxMode, sandboxBannerText })
    if (isGuest) {
      this.setData({ messages: [this._makeMsg({ id: 'init', role: 'ai', content: T[lang].initMsg })], obStep: null, storeLoading: true })
      this._loadGuestStore(lang)
      return
    }
    this._initChat(user, lang)
    this._loadVivaSubscriptionStatus(user)
    this._loadDots(user, lang)
    this._loadCartridges(user, lang)
    // Aeviva's GCN store URL is minted lazily in switchTab (wvt is one-time/60s-TTL —
    // minting it here on page load, before the user has even looked at Store, risks it
    // being stale by the time they tap the tab).
    if (!isAeviva) {
      this._loadStore(user, lang)
    }
    this._loadCreditBalance(user)
    // Restore persisted cart
    try {
      const savedCart = wx.getStorageSync('nano_cart')
      if (Array.isArray(savedCart) && savedCart.length > 0) this._syncCart(savedCart)
    } catch (e) {}
  },

  async onShow() {
    const { user, lang, isGuest, obStep } = this.data
    if (user && !isGuest) {
      this.selectComponent('#health-comp')?.refresh()
      this._startPolling(user)
      this._loadCreditBalance(user)
      // Re-checks persona_type + subscription expiry on every foreground/return-to-page —
      // not just onLoad — so (a) a subscription that lapsed while the app sat backgrounded
      // clears any stale "active" state, and (b) returning from the GCN store webview after
      // a "buy for myself" auto-redeem (handleBuyVivaSubscription) immediately reflects the
      // new expiry instead of waiting for a full app relaunch.
      this._loadVivaSubscriptionStatus(user)
      // Check for questionnaires assigned while the user was away
      if (obStep === 'done') this._checkForPendingQuestionnaire()

      // If a wearable sync is actually due (>30min stale, per _maybeAutoSync's own
      // throttle), let it finish — BLE round trip + server health_twin update —
      // before the heartbeat below marks this user "active". Otherwise the
      // dispatcher's daily check-in scan (CLAUDE.md §29) can fire on stale wearable
      // data. Capped at 90s and fail-open (never blocks the heartbeat indefinitely
      // if the sync is slow or fails) — a full non-incremental sync can chain
      // several 8-15s BLE command timeouts, well past the ~30s typical case, so
      // the cap needs real headroom. Most app-opens aren't due for a sync at all,
      // so this resolves immediately and the heartbeat fires exactly as before.
      const syncPromise = this.selectComponent('#health-comp')?._maybeAutoSync()
      if (syncPromise) {
        await Promise.race([
          syncPromise.catch(() => {}),
          new Promise(resolve => setTimeout(resolve, 90000)),
        ])
      }

      this._req(`${BASE}/api/heartbeat`, 'POST', { user_id: user.user_id }).then(res => {
        if (res?.phone && !this.data.user.phone) {
          this.setData({ user: { ...this.data.user, phone: res.phone } })
        }
      }).catch(() => {})
    }
  },

  onHide() {
    this._stopPolling()
    this._stopKinoSlide()
    if (this.data.isRecording) {
      this._recordManager && this._recordManager.stop()
      this.setData({ isRecording: false })
    }
  },

  onReady() {
    // Override user-health's onNeedPrivacyAuthorization handler with a page-level one.
    // user-health renders inside .health-tab which is display:none when the chat tab
    // is active, so its privacy popup is invisible. This page-level handler is always
    // rendered outside any tab container and is always visible.
    const _app = getApp()
    _app._onPrivacyRequest = () => this.setData({ showPrivacyModal: true })
    // If onNeedPrivacyAuthorization fired before this handler was registered (e.g. during
    // app launch before onReady), the resolve is stored but no modal was shown — flush it now.
    if (_app._privacyResolve) this.setData({ showPrivacyModal: true })
  },

  onUnload() {
    this._stopPolling()
    this._stopKinoSlide()
    if (this.data.isRecording) {
      this._recordManager && this._recordManager.stop()
    }
    const _app = getApp()
    if (_app._onPrivacyRequest) _app._onPrivacyRequest = null
  },

  async onPullDownRefresh() {
    const { tab, user, lang } = this.data
    if (tab === 'health') {
      this.selectComponent('#health-comp')?.refresh()
    } else if (tab === 'store') {
      this.setData({ storeLoading: true })
      await this._loadStore(user, lang)
    }
    wx.stopPullDownRefresh()
  },

  async onStoreRefresh() {
    const { user, lang } = this.data
    this.setData({ storeRefreshing: true })
    await this._loadStore(user, lang)
    this.setData({ storeRefreshing: false })
  },

  // ── Tab navigation ──────────────────────────────────────────────────────────

  // Shared by the Store tab and the Dots subtab's "Order Dots" button — both need the same
  // phone-verification gate before minting a wvt nobody can use (handleNanoSSO hard-requires
  // a verified phone and 403s otherwise, dead-ending on GCN's login page with no explanation).
  // Checked fresh against the server rather than trusting the cached flag: a returning session
  // restores `user.phone_verified` straight from local storage (app.js onLaunch) and never
  // re-syncs it against the server, so a pre-migration account whose cache still says `true`
  // from before phone verification existed would otherwise sail past this gate.
  async _openAevivaStoreGated(context = null) {
    const verified = await this._checkPhoneVerified()
    if (!verified) {
      const { lang } = this.data
      wx.showModal({
        title: lang === 'zh' ? '需要验证手机号' : 'Phone verification needed',
        content: lang === 'zh'
          ? '进入商城前，请先验证您的手机号码'
          : 'Please verify your phone number before entering the store.',
        confirmText: lang === 'zh' ? '去验证' : 'Verify',
        cancelText: lang === 'zh' ? '取消' : 'Cancel',
        success: (r) => {
          if (r.confirm) wx.navigateTo({ url: '/pages/verify-phone/verify-phone' })
        },
      })
      return
    }
    this._openAevivaStore(context)
  },

  // Scan the Dots box you received. This is what starts a Viva AG formulation's 28-day cycle:
  // the plan was created (status 'approved') when a nutrition expert signed the formula off, but
  // its schedule is only generated now, so day 1 is the day the capsules are actually in hand.
  //
  // wx.scanCode returns whatever the QR encodes — the box code itself, or the public ingredient
  // page's URL that contains it. The server accepts either, so no parsing happens here.
  handleScanBox() {
    const { lang, user } = this.data
    const t = T[lang]
    if (!user?.user_id) return
    wx.scanCode({
      onlyFromCamera: false,
      success: async (res) => {
        wx.showLoading({ title: t.scanBoxWorking, mask: true })
        try {
          const r = await this._req(`${BASE}/api/box-claim`, 'POST', { openid: user.user_id, box_code: res.result })
          wx.hideLoading()
          if (r.data?.success) {
            // A second scan of a box already claimed is not an error — say so plainly rather
            // than showing a success animation for something that didn't just happen.
            wx.showToast({ title: r.data.already_claimed ? t.scanBoxAlready : t.scanBoxOk, icon: 'none', duration: 2500 })
            this._loadDots(user, lang)
          } else {
            wx.showModal({
              title: t.scanBoxFailTitle,
              content: t[`scanBoxErr_${r.data?.reason}`] || t.scanBoxErrGeneric,
              showCancel: false,
              confirmText: t.gotIt,
            })
          }
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: t.scanBoxErrGeneric, icon: 'none' })
        }
      },
      // Silent on cancel — the user backing out of the camera is not a failure.
      fail: () => {},
    })
  },

  // "Order pre-mixed capsules" on the Dots subtab, shown when no Neo dispenser is bound. Opens
  // the SAME product the chat tool's :::formula card sells — 原粒 · 定制营养素 · 28天 — rather
  // than dropping the user on the storefront to find it themselves. Both routes therefore go
  // through GCN's dashboard.html, which owns where `buy_custom_formulation` lands.
  //
  // No nutrition_plan_id, deliberately: this is the buy-first ordering (§28c). Nothing here is a
  // formulation the user just approved — the Dots subtab reads /api/nutrition-plan, which serves
  // only 'active' plans, and an active plan id could never be attached to the order anyway
  // (_settleFastTrackPackage requires 'proposed'). So the order parks at 'awaiting_formulation'
  // and nano messages the buyer to run 营养定制, which is exactly that flow's intended shape.
  handleOrderDots() {
    this._openAevivaStoreGated({ intent: 'buy_custom_formulation' })
  },

  // Tapping a row of the :::product card Viva appended to a reply. Opens the GCN storefront
  // deep-linked to that exact sku, reusing the existing webview-token context bridge — GCN's
  // dashboard.html already owns the ?sku= opener this lands in, including its silent no-op when
  // the item isn't listed in the buyer's own bound store.
  //
  // A native tap handler rather than a link in the prose is not a style choice: _onMdLinkTap can
  // only offer to COPY an http(s) URL, because a WeChat miniapp cannot open an arbitrary external
  // link from chat text. This is the only way a chat recommendation can actually reach the store.
  handleProductCardTap(e) {
    const skuId = e.currentTarget.dataset.sku
    if (!this.data.isAeviva || !skuId) return
    this._openAevivaStoreGated({ intent: 'view_product', sku_id: skuId })
  },

  // "Buy This Formulation" CTA in the plan-detail overlay — only rendered (see main.wxml) once
  // planDetailData.formulation is populated, i.e. a real committed nutrition_plans row exists
  // for this focus. Passes the specific plan id through the webview-token bridge so GCN's
  // checkout can validate/price against the exact recipe rather than a placeholder.
  handleBuyFormulation() {
    const { planDetailData, isAeviva } = this.data
    const nutritionPlanId = planDetailData?.formulation?.nutrition_plan_id
    if (!isAeviva || !nutritionPlanId) return
    this._openAevivaStoreGated({ intent: 'buy_custom_formulation', nutrition_plan_id: nutritionPlanId })
  },

  // The order CTA on a :::formula card. The card carries the id of the 'proposed'
  // nutrition_plans row the chat tool just wrote, and GCN's checkout reads that exact recipe back
  // through /formulation-checkout-snapshot — so what gets priced is what the user is looking at,
  // not a re-derivation of it. Same store bridge handleBuyFormulation uses.
  handleFormulaOrder(e) {
    const planId = e.currentTarget.dataset.plan
    if (!this.data.isAeviva || !planId) return
    this._openAevivaStoreGated({ intent: 'buy_custom_formulation', nutrition_plan_id: planId })
  },

  // Opens the formulation's label page — the GCN aeviva page that draws the QR, lists every dot
  // with its ingredients, and is what gets printed on the box. Deliberately a webview rather than
  // a QR drawn natively here: the user should be looking at the exact page the label is printed
  // from, and there is then only one renderer to keep correct.
  //
  // The URL is written by the server into the card and scheme-checked by the markdown parser
  // before it reaches this handler; it is never taken from model output.
  handleFormulaLabel(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.navigateTo({
      url: `/pages/appview/appview?url=${encodeURIComponent(url)}`,
      fail: () => wx.setClipboardData({ data: url }),
    })
  },

  // The confirm CTA on a :::formula card, shown only when GCN reported a paid FAST-TRACK package
  // waiting to be formulated (see _buildFormulaChartBlock's `#order` note). Fast track means no
  // expert reviews this before it is compounded, so the formula is fixed at this tap — hence an
  // explicit confirm rather than submitting silently when the card is generated. Regenerating is
  // the way to change it, and the dialog says so.
  //
  // The server re-checks the order independently; this handler never assumes the card is current.
  async handleFormulaSubmit(e) {
    const planId = e.currentTarget.dataset.plan
    const { user, t } = this.data
    if (!this.data.isAeviva || !planId || !user) return
    if (this._formulaSubmitting) return

    // Confirm first, then ask which package — agreeing to compound is the bigger decision, and
    // this keeps the single-package flow byte-identical to what it was before a picker existed.
    const confirmed = await new Promise(resolve => wx.showModal({
      title: t.formulaSubmitConfirmTitle,
      content: t.formulaSubmitConfirmBody,
      success: r => resolve(!!r.confirm),
      fail: () => resolve(false),
    }))
    if (!confirmed) return

    // Which package is this filling? Resolved NOW, not from the card. The formulation turn is
    // async, so this card may be minutes old and was rendered against whatever was waiting then —
    // an order can have been refunded, or a second one confirmed, since. Same reasoning
    // _resolveOrderContext gives for never caching the mode.
    const orderId = await this._pickAwaitingOrder()
    if (orderId === CANCELLED) return
    await this._submitFormulation(planId, orderId, msg => this._addMsg('ai', msg, true))
  },

  // The Dots subtab's own submit. The package row already names its order, so there is nothing to
  // pick — tapping the row IS the choice, which is what makes selection work when more than one
  // package is waiting. Reports through a toast rather than a chat bubble; the user is not in the
  // chat tab, and dropping a message into a conversation they are not looking at reads as noise.
  async handlePackageSubmit(e) {
    const { plan: planId, order: orderId } = e.currentTarget.dataset
    const { user, t } = this.data
    if (!this.data.isAeviva || !planId || !orderId || !user) return
    if (this._formulaSubmitting) return
    const confirmed = await new Promise(resolve => wx.showModal({
      title: t.formulaSubmitConfirmTitle,
      content: t.pkgSubmitConfirm,
      success: r => resolve(!!r.confirm),
      fail: () => resolve(false),
    }))
    if (!confirmed) return
    const ok = await this._submitFormulation(planId, orderId,
      msg => wx.showModal({ title: '', content: msg, showCancel: false }))
    if (ok) {
      wx.showToast({ title: t.pkgSubmitOk, icon: 'success' })
      // The package has moved to 'compounding' on GCN's side; repaint so the row stops offering
      // an action that has already been taken.
      this._dotsLoadedAt = 0
      this._loadDots(user, this.data.lang)
    }
  },

  // Sentinel for "the user backed out of the picker", which is not the same as "no order" — one
  // must silently do nothing, the other must explain itself.
  //
  // Returns the chosen order_id, null when nothing is waiting (the server says so authoritatively
  // and its message is the one the user sees), or CANCELLED.
  async _pickAwaitingOrder() {
    const { user, t } = this.data
    let packages = []
    try {
      const res = await this._req(`${BASE}/api/formulation-orders?openid=${encodeURIComponent(user.user_id)}`)
      packages = (res.data?.packages || []).filter(p => p.can_submit && p.order_id)
    } catch (err) {
      // Fall through with no id: the submit below re-resolves server-side and picks the oldest,
      // exactly as it did before a picker existed. A lookup failure must not block the action.
      return null
    }
    if (packages.length <= 1) return packages.length === 1 ? packages[0].order_id : null
    const labels = packages.map(p => {
      const tier = p.tier_label || (p.max_distinct_dots ? t.pkgTierUpTo(p.max_distinct_dots) : '')
      return [p.package_name || t.pkgUnnamed, tier].filter(Boolean).join(' · ')
    })
    return await new Promise(resolve => wx.showActionSheet({
      itemList: labels,
      success: r => resolve(packages[r.tapIndex].order_id),
      fail: () => resolve(CANCELLED),
    }))
  },

  // The one submit path, shared by the chat card and the Dots subtab so the two surfaces can never
  // disagree about what a reason code means. `report` is how each surface talks to its own user.
  // Returns true only on a real success.
  async _submitFormulation(planId, orderId, report) {
    const { user, t } = this.data
    this._formulaSubmitting = true
    wx.showLoading({ title: t.formulaSubmitCta, mask: true })
    try {
      const body = { openid: user.user_id, plan_id: planId }
      if (orderId) body.order_id = orderId
      const res = await this._req(`${BASE}/api/formulation-submit`, 'POST', body)
      const d = res.data || {}
      if (d.success) { report(t.formulaSubmitOk); return true }
      // Named reasons the user can act on get their own message; everything else is a retry.
      if (d.reason === 'no_awaiting_order') report(t.formulaSubmitNoOrder)
      // The package they picked moved on between the picker and the tap — refunded, or filled from
      // another device. Not a failure of their formula, so it must not read like one.
      else if (d.reason === 'order_not_available') report(t.pkgOrderGone)
      else if (d.reason === 'order_requires_expert_review') report(t.formulaSubmitExpert)
      else if (d.reason === 'formulation_exceeds_package') report(t.formulaSubmitOverTier)
      else report(t.formulaSubmitFailed)
      return false
    } catch (err) {
      report(t.formulaSubmitFailed)
      return false
    } finally {
      wx.hideLoading()
      this._formulaSubmitting = false
    }
  },

  handleCopyPackageTracking(e) {
    const num = e.currentTarget.dataset.num
    const { lang } = this.data
    if (!num) return
    wx.setClipboardData({
      data: num,
      success: () => wx.showToast({ title: lang === 'zh' ? '单号已复制' : 'Tracking copied', icon: 'success' }),
    })
  },

  // Raised by the AG panel (via user-health) when a job is parked waiting on a clarifying
  // questionnaire. The form renders in the chat tab — one server-driven renderer for every
  // questionnaire in the app — so this just lands the user there and asks it to start.
  // _checkForPendingQuestionnaire is idempotent, so a repeat tap is harmless.
  handleAgGoToChat() {
    this.setData({ tab: 'chat' })
    // Only fetch if a form isn't already on screen. _checkForPendingQuestionnaire has NO
    // internal guard — it re-fetches, finds the first unanswered question and re-runs
    // _startQuestionnaire, which re-posts the intro and the current question as duplicate
    // bubbles. Every other caller guards it externally the same way (onShow: `obStep ===
    // 'done'`), and the "it's idempotent" comment on the notification path means only that it
    // won't start a *different* questionnaire.
    //
    // It matters more here than anywhere else: the questionnaire_ready notification the park
    // also writes has usually started the form already by the time the user taps 去回答, so an
    // unguarded call duplicated almost every time. Found on a live end-to-end run, not in
    // review. Note `obStep` and not `obQuestion` — _onAllQuestionnaireDone sets obStep 'done'
    // but deliberately leaves obQuestion populated.
    const formInProgress = this.data.obStep && this.data.obStep !== 'done'
    if (!formInProgress) this._checkForPendingQuestionnaire()
    this._scrollBottom()
  },

  async switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === 'store' && !this.data.isGuest) {
      const { channel } = this.data
      if (channel?.key_name === 'aeviva' || channel?.key_name === 'aeviva-china') {
        // Aeviva's GCN store opens as a separate navigated page (pages/appview — its own
        // header/back button, a plain page layout) rather than an inline tab section:
        // <web-view> doesn't reliably support any overlay button (cover-view is only
        // documented for map/video/canvas/camera, not web-view) when embedded inside this
        // page's absolutely-positioned tab-switching containers — confirmed by testing,
        // not just theory. Don't change `tab` at all; stay on whatever tab was active.
        await this._openAevivaStoreGated()
        return
      }
    }
    this.setData({ tab })
    const STALE_MS = 30_000
    const now = Date.now()
    if (tab === 'health') {
      const hc = this.selectComponent('#health-comp')
      hc?._maybeAutoSync()
      // The health tab is the Digital Twin, and chat writes into it (remember_fact,
      // record_weight, report uploads). Without this it only ever showed the state
      // captured when the component first attached.
      hc?.refreshIfStale(STALE_MS)
    }
    if (tab === 'plans') {
      if (now - this._plansLoadedAt > STALE_MS) {
        this.setData({ plansLoading: true, remindersLoading: true })
        this._loadPlans(this.data.user, this.data.lang)
        this._loadReminders(this.data.user)
      }
      if (now - this._dotsLoadedAt > STALE_MS) {
        this.setData({ dotsLoading: true, cartridgesLoading: true })
        this._loadDots(this.data.user, this.data.lang)
        this._loadCartridges(this.data.user, this.data.lang)
      }
    }
    if (tab === 'learn') {
      const { learnSubTab } = this.data
      if (learnSubTab === 'academy' && this.data.trainingCourses.length === 0) this._loadAcademy()
      if (learnSubTab === 'wellness' && this.data.wellnessAssets.length === 0) this._loadWellness()
    }
  },

  switchPlansDotsSubTab(e) {
    const subTab = e.currentTarget.dataset.tab
    this.setData({ plansDotsSubTab: subTab })
    if (subTab === 'dots') {
      const STALE_MS = 30_000
      if (Date.now() - this._dotsLoadedAt > STALE_MS) {
        this.setData({ dotsLoading: true, cartridgesLoading: true })
        this._loadDots(this.data.user, this.data.lang)
        this._loadCartridges(this.data.user, this.data.lang)
      }
    }
  },

  handleBindNeoDevice() {
    wx.showToast({ title: this.data.t.neoNotFoundMsg, icon: 'none', duration: 2000 })
  },

  switchLearnSubTab(e) {
    const subTab = e.currentTarget.dataset.tab
    this.setData({ learnSubTab: subTab })
    if (subTab === 'academy' && this.data.trainingCourses.length === 0) this._loadAcademy()
    if (subTab === 'wellness' && this.data.wellnessAssets.length === 0) this._loadWellness()
  },

  // ── Logo menu ───────────────────────────────────────────────────────────────

  toggleMenu() { this.setData({ menuOpen: !this.data.menuOpen }) },
  closeMenu()  { this.setData({ menuOpen: false }) },
  noop()       {},

  onPrivacyAgree() {
    const _app = getApp()
    if (_app._privacyResolve) {
      _app._privacyResolve({ event: 'agree', buttonId: 'privacy-agree-btn' })
      _app._privacyResolve = null
    }
    this.setData({ showPrivacyModal: false })
  },

  onPrivacyCancel() {
    const _app = getApp()
    if (_app._privacyResolve) {
      _app._privacyResolve({ event: null })
      _app._privacyResolve = null
    }
    this.setData({ showPrivacyModal: false })
  },

  toggleLang() {
    const lang = this.data.lang === 'zh' ? 'en' : 'zh'
    app.globalData.lang = lang
    const storeItems  = this._rawStoreItems  ? mapStoreItems(this._rawStoreItems, lang)   : []
    const storeOrders = this._rawStoreOrders ? mapStoreOrders(this._rawStoreOrders, lang) : []
    const channelOverridesLang = this.data.channel?.sub_age_display_names || null
    const mergedT = { ...T[lang], subAgeLabels: buildSubAgeLabels(T[lang].subAgeLabels, channelOverridesLang, lang) }
    this.setData({ lang, t: mergedT, menuOpen: false, storeItems, storeOrders, toolList: toolActions.getToolList(mergedT) })
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
    this._applyNavBarColor(theme)
    try {
      await this._req(`${BASE}/api/users/${user.user_id}`, 'PATCH', { theme })
    } catch (e) {}
  },

  // One step per gesture; a pinch past either end stop is a silent no-op, not a wrap-around.
  _stepTextScale(dir) {
    const next = this.data.textScale + (dir > 0 ? 1 : -1)
    if (next < 0 || next > 3) return
    this._applyTextScale(next)
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' })
  },

  // Pinch on the health tab, forwarded up by the user-health component.
  onTextScaleStep(e) {
    this._stepTextScale(e.detail.dir)
  },

  // Pinch on the chat tab. The health tab's gesture lives inside its component, but the chat
  // tab is plain page markup, so the same shared stepper is driven from here instead. Bound
  // on .chat-tab with `bind`, so it still bubbles to the root edge-swipe handler (which
  // ignores multi-touch) and so a one-finger scroll or the mic press-and-hold never reaches
  // the pinch path — the stepper only acts on exactly two touches.
  _chatPinch() {
    if (!this.__chatPinch) {
      this.__chatPinch = createPinchStepper((dir) => this._stepTextScale(dir))
    }
    return this.__chatPinch
  },

  onChatTouchStart(e) { this._chatPinch().start(e) },
  onChatTouchMove(e) { this._chatPinch().move(e) },
  onChatTouchEnd() { this._chatPinch().end() },

  // Header-menu stepper. Deliberately does NOT close the menu — it is a 4-way control and
  // the point is to tap through the levels and watch the text behind it resize.
  setTextScale(e) {
    const level = parseInt(e.currentTarget.dataset.level, 10) || 0
    if (level === this.data.textScale) return
    this._applyTextScale(level)
  },

  // Mirrors toggleTheme's persistence chain: globalData -> storage -> setData -> server.
  async _applyTextScale(textScale) {
    app.globalData.textScale = textScale
    wx.setStorageSync('nano_text_scale', textScale)
    this.setData({ textScale })
    wx.showToast({ title: this.data.t.textSizeLevels[textScale], icon: 'none', duration: 900 })
    const user = this.data.user
    if (this.data.isGuest || !user || !user.user_id) return
    try {
      await this._req(`${BASE}/api/users/${user.user_id}`, 'PATCH', { text_scale: textScale })
    } catch (e) {}
  },

  openCoach() {
    this.setData({ menuOpen: false })
    wx.navigateTo({ url: '/pages/coach/coach' })
  },

  onTouchStart(e) {
    // A two-finger pinch (health-tab text size) must not also read as an edge swipe.
    // Latched here rather than cleared in onTouchEnd because touchend fires once per
    // finger — clearing on the first lift would let the second one through.
    if (e.touches.length > 1) { this._multiTouch = true; return }
    this._multiTouch = false
    this._touchX = e.touches[0].clientX
    this._touchY = e.touches[0].clientY
  },

  onTouchEnd(e) {
    if (this._multiTouch) return
    if (!this.data.isCoach) return
    const d = this.data
    if (d.menuOpen || d.kinoSimOpen || d.guestSheetOpen || d.qSheetOpen) return
    if (this._touchX < (this._screenW || 375) - 40) return // only honor swipes starting at the right edge
    const dx = e.changedTouches[0].clientX - this._touchX
    const dy = e.changedTouches[0].clientY - this._touchY
    if (dx < -70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      wx.navigateTo({ url: '/pages/coach/coach', animationType: 'slide-in-right', animationDuration: 280 })
    }
  },

  openReferral() {
    this.setData({ menuOpen: false })
    wx.navigateTo({ url: '/pages/referral/referral' })
  },

  openPhones() {
    this.setData({ menuOpen: false })
    wx.navigateTo({ url: '/pages/phones/phones' })
  },

  // ── Viva subscription redeem sheet ──────────────────────────────────────────
  // Modeled on openGuestSheet/submitGuestInvite (same server-validated code-entry
  // pattern), but a plain text input rather than a 6-digit grid — subscription codes
  // are 16+ crypto-random alphanumeric chars (see handlers/viva_subscription.js), not digits.

  openVivaRedeemSheet() {
    this.setData({ vivaRedeemSheetOpen: true, vivaRedeemCode: '', vivaRedeemError: '', menuOpen: false })
  },

  closeVivaRedeemSheet() {
    if (this.data.vivaRedeemBusy) return
    this.setData({ vivaRedeemSheetOpen: false })
  },

  onVivaRedeemInput(e) {
    this.setData({ vivaRedeemCode: e.detail.value || '', vivaRedeemError: '' })
  },

  async submitVivaRedeem() {
    const { vivaRedeemCode, vivaRedeemBusy, user, t } = this.data
    if (vivaRedeemBusy) return
    const code = vivaRedeemCode.trim()
    if (!code) { this.setData({ vivaRedeemError: t.vivaRedeemRequired }); return }
    this.setData({ vivaRedeemBusy: true, vivaRedeemError: '' })
    try {
      const res = await this._req(`${BASE}/api/viva-subscription-redeem`, 'POST', { openid: user.user_id, code })
      if (!res.data?.success) {
        const errText = {
          invalid_code: t.vivaRedeemInvalid,
          already_used: t.vivaRedeemAlreadyUsed,
          code_expired: t.vivaRedeemExpired,
          revoked: t.vivaRedeemInvalid,
        }[res.data?.status] || t.errServer
        this.setData({ vivaRedeemError: errText, vivaRedeemBusy: false })
        return
      }
      const newExpiresAtDisplay = fmtDate(res.data.new_expires_at, this.data.lang)
      this.setData({
        vivaRedeemSheetOpen: false,
        vivaRedeemBusy: false,
        vivaSubscriptionExpiresAt: res.data.new_expires_at,
        vivaSubscriptionExpiresAtDisplay: newExpiresAtDisplay,
        vivaSubscriptionExpired: false,
      })
      // Toast is ephemeral — show the actual new expiry date rather than a generic
      // "success", since that date is the whole point of redeeming. It also now persists
      // in the menu's status row (menu-viva-row) and the redeem sheet's status line for
      // anyone who missed the toast.
      wx.showToast({ title: `${t.vivaRedeemSuccess} ${newExpiresAtDisplay}`, icon: 'none', duration: 3000 })
    } catch (e) {
      this.setData({ vivaRedeemError: this.data.t.errServer, vivaRedeemBusy: false })
    }
  },

  // "Renew" CTA in the expired-subscription banner and the redeem sheet's own store link —
  // reuses the exact GCN-store webview bridge handleBuyFormulation already uses; GCN's own
  // checkout UI owns the "for me / as a gift" choice, nano only tags the entry point.
  handleBuyVivaSubscription() {
    if (!this.data.isAeviva) return
    this._openAevivaStoreGated({ intent: 'buy_viva_subscription' })
  },

  openAdmin() {
    this.setData({ menuOpen: false })
    wx.navigateTo({ url: '/pages/admin/admin' })
  },


  openSuperadmin() {
    this.setData({ menuOpen: false })
    wx.navigateTo({ url: '/pages/superadmin/superadmin' })
  },

  openWebAdmin() {
    this.setData({ menuOpen: false })
    wx.navigateTo({ url: '/pages/webadmin/webadmin' })
  },

  // `context` (optional) is an arbitrary JSON-serializable intent payload — e.g.
  // { intent: 'buy_custom_formulation', nutrition_plan_id } — carried through to appview.js,
  // which threads it into /api/webview-token so the target page (GCN's dashboard.html) can
  // read it back after the SSO exchange. See handlers/login.js's webview_tokens.context column.
  openUserApp(path = '/app', context = null) {
    this.setData({ menuOpen: false })
    const contextParam = context ? `&context=${encodeURIComponent(JSON.stringify(context))}` : ''
    wx.navigateTo({ url: `/pages/appview/appview?url=${encodeURIComponent(path)}${contextParam}` })
  },

  // Aeviva channel's Store tab tap opens the GCN storefront via appview.js (which mints
  // its own wvt internally) instead of the native dots/credits store — see switchTab.
  // Uses the direct aeviva(-dev).gcn.net hostname, not edge(-dev).gcn.net's path-prefixed
  // routing (both serve the identical site/aeviva/dashboard.html) — WeChat's <web-view>
  // business-domain verification is per-exact-domain, and only aeviva(-dev).gcn.net has a
  // verification file hosted/verified (see nano/docs/wechat-domain-setup.md); edge(-dev)
  // was never verified and 不支持打开's with it. Mirror BASE's own develop-vs-trial/release
  // split (CLAUDE.md §"Miniapp Backend Selection") rather than IS_DEV, which also covers
  // trial builds.
  _openAevivaStore(context = null) {
    const host = BASE.includes('-dev.') ? 'https://aeviva-dev.gcn.net' : 'https://aeviva.gcn.net'
    this.openUserApp(`${host}/dashboard.html`, context)
  },

  // ── Kino Simulator ──────────────────────────────────────────────────────────

  async _resolveKinoSimDevice() {
    try {
      const res = await this._req(`${BASE}/api/kino-devices`)
      const devices = res.data?.devices || []
      const dev = devices.find(d => d.serial_number === KINO_SIM_SERIAL)
      if (dev) this.setData({ kinoSimDeviceId: dev.serial_number })
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
      const biomarkerId = res.data?.biomarker_id || null
      // Keep the metric-tile sparklines current without a refetch: res.data.biomarkers IS the
      // validated set this scan just wrote to data.validated. Sparks already attached to older
      // messages are left alone on purpose — they belong to the reading those messages describe.
      if (biomarkers) appendReading(this._bioSeries, biomarkers)
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
            biomarker_id: biomarkerId,
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

  exitSandbox() {
    this._stopPolling()
    const origin = wx.getStorageSync('nano_sandbox_origin')
    wx.removeStorageSync('nano_sandbox_origin')
    wx.removeStorageSync('nano_sandbox_active')
    app.globalData.sandboxMode = false
    if (origin && origin.user) {
      app.globalData.user = origin.user
      app.globalData.channel = origin.channel || null
      app.globalData.coach = origin.coach || null
      wx.setStorageSync('nano_user', origin.user)
      wx.setStorageSync('nano_channel', origin.channel || null)
      wx.setStorageSync('nano_coach', origin.coach || null)
      wx.reLaunch({ url: '/pages/main/main' })
    } else {
      // No origin snapshot (unexpected) — fall back to a full logout.
      wx.removeStorageSync('nano_user')
      app.globalData.user = null
      wx.reLaunch({ url: '/pages/login/login' })
    }
  },

  handleLogout() {
    this.setData({ menuOpen: false })
    if (app.globalData.sandboxMode) { this.exitSandbox(); return }
    this._stopPolling()
    // Snapshot this session (minus phone/email, same PII-stripping convention as
    // login.js's _finishLogin) so the logged-out screen can offer an instant,
    // no-OTP "continue as previous" restore without re-deriving via WeChat openid.
    // Prefer the already-persisted user.maskedPhone (set once at login time) over
    // re-deriving from the raw phone — app.globalData.user almost never carries a
    // raw .phone beyond the fleeting moment right after a fresh login, since
    // app.onLaunch() only ever restores from the trimmed wx.storage copy. Falling
    // back to re-deriving here would silently blank out phoneSet/maskedPhone for
    // any session that survived even one app restart.
    const user = app.globalData.user
    if (user && !user.guest) {
      const { phone, email, ...userToStore } = user
      wx.setStorageSync('nano_last_session', {
        user: userToStore,
        channel: app.globalData.channel,
        coach: app.globalData.coach,
        maskedPhone: user.maskedPhone || maskPhone(phone) || '',
      })
    }
    wx.removeStorageSync('nano_user')
    app.globalData.user = null
    wx.reLaunch({ url: '/pages/login/login?loggedOut=1' })
  },

  // ── Chat init ───────────────────────────────────────────────────────────────

  async _initChat(user, lang) {
    const t = T[lang]
    const initMsg = this._makeMsg({ id: 'init', role: 'ai', content: t.initMsg })

    // Load history
    let historyLoaded = false
    try {
      const res = await this._req(`${BASE}/api/chat-history?openid=${encodeURIComponent(user.user_id)}`)
      const history = res.data?.messages || []
      if (history.length > 0) {
        const msgs = this._applySeparators(history.map((m, i) => this._fromHistoryRow(m, `h-${i}`)), null)
        const ids = history.map(m => m.id).filter(id => typeof id === 'number')
        this._lastMsgId = ids.length > 0 ? Math.max(...ids) : 0
        this._oldestDbId = ids.length > 0 ? Math.min(...ids) : 0
        this.setData({ messages: msgs, hasMoreHistory: res.data?.has_more ?? false })
        this._scrollBottom()
        historyLoaded = true
      } else {
        this._lastMsgId = 0
      }
    } catch (e) {
      if (IS_DEV) console.error('History load failed', e)
    }
    if (!historyLoaded) { this.setData({ messages: [initMsg] }) }

    // Advisory nudge, not a blocking gate — WeChat mini-program review requires free
    // browsing, so phone verification can never stand in the way of using the app (see
    // login.js's _finishNewUser comment). Shown client-side only (not persisted to
    // chat_messages) so it naturally reappears every session until phone_verified flips
    // true, without accumulating duplicate rows in chat history.
    if (!user.phone_verified) {
      this._addMsg('ai', t.verifyPhonePrompt)
      this._addActionMsg('verify_phone', t.verifyPhoneCta)
    }

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
      this._setBioSeries(biomarkerRecords)
    } catch (e) { if (IS_DEV) console.error('Init fetch failed', e) }

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
    // Phone verification is now enforced as a hard gate before reaching this page
    // (see onLoad) — no in-chat nudge needed anymore.
    this._startPolling(user)
  },

  onScrollToUpper() {
    // Intentionally empty — history is loaded on explicit pull or tap, not auto-triggered.
  },

  async _loadMoreHistory() {
    if (this.data.historyLoading || !this.data.hasMoreHistory) return
    const user = this.data.user
    if (!user || !this._oldestDbId) return
    this.setData({ historyLoading: true })
    try {
      const url = `${BASE}/api/chat-history?openid=${encodeURIComponent(user.user_id)}&before_id=${this._oldestDbId}`
      const res = await this._req(url)
      const history = res.data?.messages || []
      const hasMore = res.data?.has_more ?? false
      if (history.length > 0) {
        // Older rows are PREPENDED, so the separator pass runs over the new run alone, then the
        // first pre-existing message is re-evaluated against the newly-arrived tail.
        const newMsgs = this._applySeparators(history.map(m => this._fromHistoryRow(m, `old-${m.id}`)), null)
        const existing = [...this.data.messages]
        if (existing.length > 0 && newMsgs.length > 0) {
          existing[0] = { ...existing[0], sep: _msgSeparator(newMsgs[newMsgs.length - 1].ts, existing[0].ts, this.data.lang) }
        }
        const anchorId = 'm' + (existing[0]?.id || '')
        const ids = history.map(m => m.id).filter(id => typeof id === 'number')
        this._oldestDbId = ids.length > 0 ? Math.min(...ids) : this._oldestDbId
        this.setData({ messages: [...newMsgs, ...existing], hasMoreHistory: hasMore, scrollAnchor: anchorId })
        setTimeout(() => this.setData({ scrollAnchor: '' }), 300)
      } else {
        this.setData({ hasMoreHistory: false })
      }
    } catch (e) {
      if (IS_DEV) console.error('Load more history failed', e)
    }
    this.setData({ historyLoading: false })
  },

  async _loadHistory(user) {
    // Already handled in _initChat or can be called separately to refresh
    try {
      const res = await this._req(`${BASE}/api/chat-history?openid=${encodeURIComponent(user.user_id)}`)
      const history = res.data?.messages || []
      if (history.length > 0) {
        const msgs = this._applySeparators(history.map((m, i) => this._fromHistoryRow(m, `h-${i}`)), null)
        this.setData({ messages: msgs })
        this._scrollBottom()
      }
    } catch (e) {}
  },

  // ── Chat messaging ──────────────────────────────────────────────────────────

  // Single construction point for every chat message. Before this there were nine of them, each
  // re-deriving the role normalisation and the markdown conversion slightly differently — two of
  // them skipped the conversion entirely. `content` is always the RAW text: AI rows are segmented
  // for display here, while the persist path (_addMsg below) still posts its own raw argument, so
  // nothing rendered is ever written back to the server.
  _makeMsg({ id, role, content, imageUrl, action, label, createdAt, source }) {
    const r = (role === 'assistant') ? 'ai' : role
    // `source` attributes a bubble to something other than the plain persona — currently only
    // 'viva_ag', which renders a label the way a coach message does.
    const msg = { id, role: r, imageUrl: imageUrl || null, source: source || null, ts: createdAt ? +new Date(createdAt) : Date.now(), sep: '' }
    if (r === 'action') { msg.action = action; msg.label = label; return msg }
    if (r === 'coach') { msg.content = (content || '').replace(/\n+/g, ' '); return msg }
    if (r === 'ai') { msg.segments = mdToSegments(content || ''); this._attachSparks(msg.segments) }
    else msg.content = content || ''
    // Distinguishes an image-only bubble (which drops its padding via .msg-bubble-image) from an
    // image WITH text, which must keep it. The old wx:elif chain rendered the image and silently
    // dropped the text for the latter.
    msg.imageOnly = !!msg.imageUrl && !msg.content && !(msg.segments && msg.segments.length)
    return msg
  },

  // ── Metric-tile sparklines ──────────────────────────────────────────────────

  // The trend behind a :::metric tile comes from the user's OWN biomarker history, fetched
  // here, not from anything the model wrote — see utils/biomarker-series.js for why that
  // separation matters. Mutates the segments in place and reports whether anything changed.
  _attachSparks(segments) {
    if (!this._bioSeries || !segments) return false
    let changed = false
    for (const seg of segments) {
      if (seg.t !== 'metric' || !seg.items) continue
      for (const it of seg.items) {
        if (it.spark) continue
        const spark = sparkForLabel(this._bioSeries, it.label)
        if (spark) { it.spark = spark; changed = true }
      }
    }
    return changed
  },

  // GET /api/biomarkers resolves AFTER _initChat has already rendered history, so the first
  // paint of an older metric card has no sparkline. Back-fill once when the series lands. The
  // full-list setData is gated on something actually gaining a spark, which for a conversation
  // with no metric cards — the common case — means this costs nothing.
  _setBioSeries(records) {
    try {
      this._bioSeries = buildSeriesIndex(records)
    } catch (e) {
      if (IS_DEV) console.error('buildSeriesIndex failed', e)
      return
    }
    const msgs = this.data.messages || []
    let changed = false
    for (const m of msgs) { if (this._attachSparks(m.segments)) changed = true }
    if (changed) this.setData({ messages: msgs })
  },

  _fromHistoryRow(m, id) {
    const role = (m.role === 'assistant' || m.role === 'ai') ? 'ai' : m.role
    if (role === 'action') {
      try {
        const d = JSON.parse(m.content)
        return this._makeMsg({ id, role: 'action', action: d.action, label: d.label, createdAt: m.created_at })
      } catch (e) {
        return this._makeMsg({ id, role: 'ai', content: m.content, createdAt: m.created_at })
      }
    }
    return this._makeMsg({ id, role, content: m.content, imageUrl: m.image_url, source: m.source, createdAt: m.created_at })
  },

  // Stamps each message's time separator relative to its predecessor. `prev` is the message
  // immediately before msgs[0] (null when msgs starts the conversation). Appends only ever pass
  // the single new run, never the whole list — a full-array recompute on every message would be a
  // setData on every row for a purely cosmetic label.
  _applySeparators(msgs, prev) {
    const lang = this.data.lang
    let last = prev || null
    for (const m of msgs) {
      m.sep = _msgSeparator(last ? last.ts : 0, m.ts, lang)
      last = m
    }
    return msgs
  },

  // A mini program cannot navigate to an arbitrary external URL, and mp-html's own linkTap
  // handler copies the href behind a HARDCODED Chinese toast — wrong for an English user. Handle
  // it here instead so the whole interaction is localised and explicit.
  _onMdLinkTap(e) {
    const href = e.detail?.href
    if (!href || !/^https?:\/\//i.test(href)) return
    const { t } = this.data
    wx.showActionSheet({
      itemList: [t.mdLinkCopy],
      success: () => {
        wx.setClipboardData({
          data: href,
          success: () => wx.showToast({ title: t.mdLinkCopied, icon: 'none' })
        })
      },
      fail: () => {}
    })
  },

  // Each AI message now mounts one <mp-html> per prose segment plus native card views, so its
  // final height settles later than the single mp-html instance it replaced — _scrollBottom's
  // nextTick/150ms/500ms ladder can under-shoot on a long multi-segment reply. mp-html fires
  // `ready` once content is rendered AND measured, which is the real signal. Same shape as
  // _onChatImageLoad below: only re-snap for the LAST message, so a segment in older/history
  // content settling doesn't yank the view away from where the user is reading.
  _onSegReady(e) {
    const id = e.currentTarget.dataset.id
    const last = this.data.messages[this.data.messages.length - 1]
    if (!last || last.id !== id) return
    // A multi-segment reply fires `ready` once per segment in quick succession — debounce so the
    // burst collapses into a single scroll rather than N competing ones.
    if (this._segReadyTimer) clearTimeout(this._segReadyTimer)
    this._segReadyTimer = setTimeout(() => this._scrollBottom(), 60)
  },

  // Identity of an AI bubble for cross-channel de-duplication. The same reply reaches this page
  // through two independent channels now — the notifications poll (fast) and the chat_messages
  // catch-up poll (durable, see _poll) — and either can win the race, so whichever renders first
  // registers its text here and the other drops it. Keyed on normalised text because a
  // notification row carries no chat_messages id to match on.
  _aiKey(content) {
    return String(content || '').replace(/\s+/g, ' ').trim().slice(0, 160)
  },

  _markRenderedAi(content) {
    const k = this._aiKey(content)
    if (!k || !this._renderedAiKeys) return
    this._renderedAiKeys.add(k)
    // Bounded — a long session must not grow this without limit. Sets iterate in insertion
    // order, so this evicts the oldest key.
    if (this._renderedAiKeys.size > 200) {
      this._renderedAiKeys.delete(this._renderedAiKeys.values().next().value)
    }
  },

  _isRenderedAi(content) {
    const k = this._aiKey(content)
    return !!k && !!this._renderedAiKeys && this._renderedAiKeys.has(k)
  },

  _addMsg(role, rawContent, persist = false) {
    const msg = this._makeMsg({ id: `${role}-${Date.now()}`, role, content: rawContent })
    // Locally-added AI bubbles are persisted server-side too (persist=true), so the
    // chat_messages catch-up poll will see them come back — register them as already rendered.
    if (msg.role === 'ai') this._markRenderedAi(rawContent)
    const messages = [...this.data.messages, ...this._applySeparators([msg], this.data.messages[this.data.messages.length - 1])]
    this.setData({ messages })
    this._scrollBottom()

    if (persist && this.data.user?.user_id) {
      this._req(`${BASE}/api/chat-messages`, 'POST', {
        openid: this.data.user.user_id,
        role, content: rawContent
      }).catch(e => { if (IS_DEV) console.error('Persistent msg failed', e) })
    }
  },

  _applyNavBarColor(theme) {
    // navigationStyle is "custom" (main.json) so this page draws its own header —
    // the OS status bar icon color set globally in app.json (white, for the dark
    // navy default) doesn't track that. Without this, light theme's cream header
    // leaves the white status bar icons nearly invisible against it.
    wx.setNavigationBarColor({
      frontColor: theme === 'light' ? '#000000' : '#ffffff',
      backgroundColor: theme === 'light' ? '#FAF7F2' : '#0B1C2E',
    })
  },

  _scrollBottom() {
    if (this.data.messages.length === 0) return
    if (this._scrollTimer) clearTimeout(this._scrollTimer)
    if (this._scrollTimer2) clearTimeout(this._scrollTimer2)
    if (this._scrollAnchorTimer) clearTimeout(this._scrollAnchorTimer)
    const doScrollTop = () => {
      this._scrollFlip = !this._scrollFlip
      this.setData({ scrollTop: this._scrollFlip ? 999998 : 999999 })
    }
    // wx.nextTick fires right after this setData's render actually commits — more reliable
    // than a blind delay for ordinary text reflow. The two follow-up timers catch slower
    // devices/longer markdown re-layout that hasn't settled by the first tick — a single
    // ~50ms guess wasn't always enough, which is exactly why the last message sometimes
    // wasn't fully scrolled into view (found 2026-07-29). See also _onChatImageLoad for the
    // <image> case, whose height isn't known until the image itself finishes loading.
    wx.nextTick(doScrollTop)
    this._scrollTimer = setTimeout(doScrollTop, 150)
    this._scrollTimer2 = setTimeout(doScrollTop, 500)

    // scrollTop is a raw pixel offset that assumes the scroll-view's total content height (and
    // the scroll-view's OWN layout) is already settled — on a real phone's cold app launch, the
    // page/scroll-view can still be settling its own layout, and scrollTop alone still missed
    // the true bottom (found 2026-07-29, reported from a real-device cold-start screenshot).
    // scroll-into-view instead asks the renderer to scroll a specific element into view against
    // whatever the current layout actually is, which is more robust for exactly that case.
    // Only re-fires when the target value changes, so clear it after a delay (mirrors the
    // existing history-pagination anchor pattern above) rather than re-setting the same value.
    const lastId = this.data.messages[this.data.messages.length - 1].id
    this.setData({ scrollAnchor: `m${lastId}` })
    this._scrollAnchorTimer = setTimeout(() => this.setData({ scrollAnchor: '' }), 700)
  },

  // <image mode="widthFix"> bubbles (msg-image) only reach their final height once the image
  // itself has loaded — well after the setData/nextTick-driven scroll above already fired.
  // Only re-snap to bottom if the image that just loaded belongs to the LAST message, so this
  // doesn't yank the view away from the user's current position when an older/history image
  // (e.g. from _loadMoreHistory) finishes loading instead.
  _onChatImageLoad(e) {
    const id = e.currentTarget.dataset.id
    const last = this.data.messages[this.data.messages.length - 1]
    if (last && last.id === id) this._scrollBottom()
  },

  onChatInput(e) {
    this.setData({ chatInput: e.detail.value })
  },

  toggleToolbox() {
    const { typing, toolboxOpen } = this.data
    if (typing && !toolboxOpen) return
    this.setData({ toolboxOpen: !toolboxOpen })
  },

  // ── Voice input (mic) ──────────────────────────────────────────────────────

  onMicTouchStart() {
    const { typing, isSending, isRecording, lang } = this.data
    if (typing || isSending || isRecording) return
    this._micStartTs = Date.now()
    this._micReleased = false
    this._checkRecordAuth().then((granted) => {
      if (!granted) return
      // Fast tap-and-release can finish before this async auth check resolves —
      // skip starting the recorder if the user already lifted their finger.
      if (this._micReleased) return
      this.setData({ isRecording: true })
      this._recordManager.start({
        duration: 60000,
        lang: lang === 'zh' ? 'zh_CN' : 'en_US',
      })
    })
  },

  onMicTouchEnd() {
    this._micReleased = true
    if (!this.data.isRecording) return
    this.setData({ isRecording: false })
    this._recordManager.stop()
  },

  _onMicStop(res) {
    const heldMs = Date.now() - (this._micStartTs || 0)
    const result = ((res && res.result) || '').trim()
    // Accidental tap or silence — fail quietly, no error toast.
    if (heldMs < 500 || !result) return
    const current = this.data.chatInput
    const merged = current
      ? `${current}${/\s$/.test(current) ? '' : ' '}${result}`
      : result
    this.setData({ chatInput: merged })
  },

  _checkRecordAuth() {
    return new Promise((resolve) => {
      wx.getSetting({
        success: (res) => {
          if (res.authSetting['scope.record'] === true) {
            resolve(true)
            return
          }
          if (res.authSetting['scope.record'] === false) {
            // Previously denied — wx.authorize would just fail silently again; must
            // route through Settings per WeChat's documented pattern.
            this._promptOpenSetting()
            resolve(false)
            return
          }
          // Never asked — trigger the native one-time authorize prompt.
          wx.authorize({
            scope: 'scope.record',
            success: () => resolve(true),
            fail: () => {
              this._promptOpenSetting()
              resolve(false)
            },
          })
        },
        fail: () => resolve(false),
      })
    })
  },

  _promptOpenSetting() {
    const { lang } = this.data
    wx.showModal({
      title: lang === 'zh' ? '需要麦克风权限' : 'Microphone access needed',
      content: lang === 'zh'
        ? '请在设置中开启麦克风权限，以使用语音输入功能'
        : 'Please enable microphone access in Settings to use voice input.',
      confirmText: lang === 'zh' ? '去设置' : 'Settings',
      cancelText: lang === 'zh' ? '取消' : 'Cancel',
      success: (r) => {
        if (r.confirm) wx.openSetting()
      },
    })
  },

  handleToolAction(e) {
    const action = e.detail?.action || e.currentTarget?.dataset?.action
    const { t, typing, obStep, user } = this.data
    if (typing || obStep !== 'done') {
      return
    }
    this.setData({ toolboxOpen: false })
    const ctx = {
      addMsg: (role, content, persist) => this._addMsg(role, content, persist),
      addActionMsg: (action, label, persist) => this._addActionMsg(action, label, persist),
      addImageMsg: (url) => this._addImageMsg(url),
      updateImageMsg: (id, url) => this._updateImageMsg(id, url),
      req: (url, method, data, timeoutMs) => this._req(url, method, data, timeoutMs),
      setTyping: (v) => this.setData({ typing: v }),
      onHealthReportPending: (payload) => this._startHealthReportConsent(payload),
      // Fires when the backend acks with {processing:true} instead of the reply itself (Viva's
      // agentic loop running async — see chat.generate) — mirrors _sendMessage's handling so the
      // same status-caption/safety-timeout machinery in _poll covers this path too.
      onAsyncStart: () => {
        this._chatWaitStartedAt = Date.now()
        this.setData({ typing: true, chatStatusText: this.data.t.chatThinking })
      },
    }
    if (action === 'test_chip') {
      this._addMsg('ai', t.kinoScanPrompt)
      this.setData({ kinoScanPending: true })
    } else if (action === 'formula_dots') {
      toolActions.runFormulaDs(user.user_id, t, ctx)
    } else if (action === 'health_advice') {
      toolActions.runHealthAdvice(user.user_id, t, ctx, { async: true })
    } else if (action === 'upload_image') {
      const tempFilePath = e.detail?.tempFilePath
      if (tempFilePath) toolActions.runUploadImage(user.user_id, t, ctx, tempFilePath)
    }
  },

  _addImageMsg(imageUrl) {
    const id = `user-${Date.now()}`
    const msg = this._makeMsg({ id, role: 'user', content: '', imageUrl })
    this.setData({ messages: [...this.data.messages, ...this._applySeparators([msg], this.data.messages[this.data.messages.length - 1])] })
    this._scrollBottom()
    return id
  },

  _updateImageMsg(id, imageUrl) {
    const messages = this.data.messages.map(m => m.id === id ? { ...m, imageUrl } : m)
    this.setData({ messages })
  },

  _addActionMsg(action, label, persist = false) {
    const msg = this._makeMsg({ id: `action-${action}-${Date.now()}`, role: 'action', action, label })
    const messages = [...this.data.messages, ...this._applySeparators([msg], this.data.messages[this.data.messages.length - 1])]
    this.setData({ messages })
    this._scrollBottom()

    if (persist && this.data.user?.user_id) {
      this._req(`${BASE}/api/chat-messages`, 'POST', {
        openid: this.data.user.user_id,
        role: 'action',
        content: JSON.stringify({ action, label })
      }).catch(e => { if (IS_DEV) console.error('Persistent action failed', e) })
    }
  },

  handleMsgAction(e) {
    const { action } = e.currentTarget.dataset
    const { t } = this.data
    if (action === 'view_dots') {
      const { user, lang } = this.data
      // Dots lives as a sub-tab ('plansDotsSubTab') under the main 'plans' tab, not as its own
      // top-level tab value — setting tab:'dots' directly matches none of the WXML's tab==='...'
      // blocks (chat/health/plans/learn/store), rendering a blank page. Found via a real-device
      // report, 2026-07-29.
      this.setData({ tab: 'plans', plansDotsSubTab: 'dots', dotsLoading: true, cartridgesLoading: true })
      this._loadDots(user, lang)
      this._loadCartridges(user, lang)
    } else if (action === 'verify_phone') {
      // No `?new=1` — this is an existing account being prompted later, not the
      // brand-new-signup flow, so verify-phone.js skips the avatar step and its
      // cancel/logout link won't delete the account (see verify-phone.js's own guards).
      wx.navigateTo({ url: '/pages/verify-phone/verify-phone' })
    } else if (action === 'hr_own_yes') {
      this._removeHrActions()
      this._addMsg('ai', t.hrAskSave)
      this._addActionMsg('hr_save_yes', t.hrSave)
      this._addActionMsg('hr_save_no', t.hrLater)
    } else if (action === 'hr_own_no') {
      this._removeHrActions()
      this._pendingHealthReport = null
      this._addMsg('ai', t.hrNotOwn)
    } else if (action === 'hr_save_yes') {
      this._removeHrActions()
      this._saveHealthReport()
    } else if (action === 'hr_save_no') {
      this._removeHrActions()
      this._pendingHealthReport = null
      this._addMsg('ai', t.hrNotSaved)
    }
  },

  // Lab-report consent flow: triggered after analyze-image flags pending_health_report.
  _startHealthReportConsent(payload) {
    if (!payload) return
    this._pendingHealthReport = payload
    const { t } = this.data
    this._addMsg('ai', t.hrAskOwn)
    this._addActionMsg('hr_own_yes', t.hrYes)
    this._addActionMsg('hr_own_no', t.hrNo)
  },

  _removeHrActions() {
    const messages = this.data.messages.filter(
      m => !(m.role === 'action' && typeof m.action === 'string' && m.action.indexOf('hr_') === 0)
    )
    this.setData({ messages })
  },

  async _saveHealthReport() {
    const { t, user } = this.data
    const payload = this._pendingHealthReport
    if (!payload) return
    this._pendingHealthReport = null
    this.setData({ typing: true })
    try {
      const res = await this._req(`${BASE}/api/health-reports`, 'POST', {
        openid: user.user_id,
        oss_key: payload.oss_key,
        get_url: payload.get_url,
        report_date: payload.report_date,
        institution: payload.institution,
        report_type: payload.report_type,
        observations: payload.observations || [],
        compute_bioage: true,
      })
      if (res.data?.success) {
        let msg = t.hrSaved
        if (res.data.bioage_updated) msg += ' ' + t.hrSavedBioage
        this._addMsg('ai', msg)
        const healthComp = this.selectComponent('#health-comp')
        if (healthComp && typeof healthComp.refreshHealthReports === 'function') {
          healthComp.refreshHealthReports()
        }
      } else {
        this._addMsg('ai', t.hrSaveError)
      }
    } catch (err) {
      if (IS_DEV) console.error('save health report failed', err)
      this._addMsg('ai', t.hrSaveError)
    } finally {
      this.setData({ typing: false })
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
    const { chatInput, typing, obStep, isSending } = this.data
    const text = chatInput.trim()
    if (!text || typing || obStep !== 'done' || isSending) return
    this.setData({ chatInput: '', isSending: true })
    await this._sendMessage(text)
    this.setData({ isSending: false })
  },

  async _sendMessage(text) {
    const { user, t } = this.data
    this._addMsg('user', text)
    this.setData({ typing: true, chatStatusText: '', toolboxOpen: false })
    try {
      // `client` gates the ::: display-card syntax server-side (see prompts/chat/outputFormat.js):
      // this is the only surface whose renderer understands the fences.
      const res = await this._req(`${BASE}/api/chat`, 'POST', { openid: user.user_id, message: text, client: 'miniapp' }, 30000)
      if (res.data?.recorded_weight != null) {
        this.selectComponent('#health-comp')?.refresh()
      }
      if (res.data?.processing) {
        // Viva's agentic loop is running asynchronously (see backend chat.generate event) —
        // the real reply isn't ready yet. Keep the typing indicator up with an evolving
        // status caption; _poll clears it when the actual reply (or the safety timeout)
        // arrives. Set an immediate local caption so there's no gap before the first
        // server-sent status notification lands on the next 3s poll tick.
        this._chatWaitStartedAt = Date.now()
        this.setData({ chatStatusText: t.chatThinking })
        return
      }
      // Sandbox sessions get the reply directly in the response (nothing was persisted
      // to notifications for polling to pick up).
      if (app.globalData.sandboxMode && res.data?.reply) {
        this._addMsg('ai', res.data.reply)
      }
      this.setData({ typing: false, chatStatusText: '' })
    } catch (e) {
      this._addMsg('ai', this.data.t.errServer)
      this.setData({ typing: false, chatStatusText: '' })
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
        // 'chat_status' rows are transient "what I'm doing" captions from the async agentic
        // loop (see backend makeStatusNotifier) — update the status caption only, never add
        // them as chat bubbles. Everything else (chat_reply, coach_reminder, ...) behaves as
        // before, and additionally clears the status caption / wait timer since a real reply
        // means the wait is over.
        const statusRows = unseen.filter(n => n.notification_type === 'chat_status')
        const realRows = unseen.filter(n => n.notification_type !== 'chat_status')
        if (statusRows.length > 0) {
          this.setData({ chatStatusText: statusRows[statusRows.length - 1].content })
        }
        if (realRows.length > 0) {
          // A 'questionnaire_ready' row means Viva just generated a short follow-up
          // questionnaire — its content is just a placeholder caption, not the real payload
          // (the form itself, fetched below via _checkForPendingQuestionnaire). Skip the
          // generic bubble for it so the user doesn't see a redundant one-liner immediately
          // followed by the form's own first question as a second bubble.
          const hasQuestionnaireReady = realRows.some(n => n.notification_type === 'questionnaire_ready')
          // `_isRenderedAi` drops a row whose text the chat_messages catch-up below already
          // rendered — during a pending turn both channels carry the same reply and either can
          // win the race. Only AI_ECHO_TYPES take part: a coach_reminder has no chat_messages
          // row, so registering it would make two genuinely separate identical reminders
          // ("喝水" twice) look like a duplicate and swallow the second.
          const bubbleRows = realRows.filter(n => n.notification_type !== 'questionnaire_ready'
            && !(AI_ECHO_TYPES.has(n.notification_type) && this._isRenderedAi(n.content)))
          bubbleRows.forEach(n => { if (AI_ECHO_TYPES.has(n.notification_type)) this._markRenderedAi(n.content) })
          const newMsgs = bubbleRows.map(n => this._makeMsg({
            id: `n-${n.id}`, role: 'ai', content: n.content,
            // The notification type is the only attribution available on this channel — the
            // matching chat_messages row carries it durably for reloads.
            source: AG_NOTIFICATION_TYPES.has(n.notification_type) ? 'viva_ag' : null,
          }))
          // No "view plan" button on a 'nutrition_plan' row any more: Formulate-Dots writes a
          // 'proposed' plan, which has no schedules and stays out of the Dots subtab until the
          // delivered box is scanned — so that button would show whatever plan the user is
          // currently ON, not the one they just asked for. The whole 28-day allocation lives in
          // the message itself now, as a :::formula card with its own order CTA.
          this._chatWaitStartedAt = null
          if (newMsgs.length > 0) {
            const messages = [...this.data.messages, ...this._applySeparators(newMsgs, this.data.messages[this.data.messages.length - 1])]
            this.setData({ messages, typing: false, chatStatusText: '' })
            this._scrollBottom()
          } else {
            this.setData({ typing: false, chatStatusText: '' })
          }
          // _checkForPendingQuestionnaire() is idempotent — re-fetches pending assignments and
          // only starts one if an unanswered question actually exists — so it's safe to call
          // unconditionally here even on a duplicate/racing notification.
          if (hasQuestionnaireReady) this._checkForPendingQuestionnaire()
        }
      }
    } catch (e) {}

    // Catch-up on what was written to chat_messages since the last tick. Coach messages, always,
    // as before — plus ai replies, but ONLY while a turn is actually pending.
    //
    // That second half is the durable backstop for the async agentic turn. GET /api/notifications
    // is a DESTRUCTIVE read — the server marks rows 'sent' in the same statement that returns
    // them, with no ack from us — so a single poll response this client never receives (app
    // backgrounded mid-request, network blip, request timeout) consumes the only copy of the
    // reply and strands the user on the typing indicator forever. Confirmed live 2026-08-22: a
    // health-advice reply was saved to chat_messages and its notification marked 'sent' 81s after
    // the request, and still never reached the device. chat_messages is not destructive, so
    // replaying from it recovers exactly that case within one 3s tick.
    //
    // Gated on `_chatWaitStartedAt` so this stays a recovery path and not a second delivery
    // channel: outside a pending turn, notifications (reminders, check-ins, topups) keep behaving
    // exactly as before, and anything missed there is still picked up by the full history load on
    // the next app open.
    //
    // Runs BELOW the notification block and ABOVE the wait timeout on purpose — the timeout must
    // be the last thing considered, after both delivery channels have had their turn.
    if (this._lastMsgId !== null) {
      try {
        const roles = this._chatWaitStartedAt ? 'coach,ai' : 'coach'
        const res = await this._req(`${BASE}/api/chat-history?openid=${encodeURIComponent(user.user_id)}&since_id=${this._lastMsgId}&roles=${roles}`)
        const rows = res.data?.messages || []
        if (rows.length > 0) {
          this._lastMsgId = Math.max(...rows.map(m => m.id))
          // An ai row normally arrives here just after the notification channel already showed
          // the same text — drop those instead of double-rendering.
          const fresh = rows.filter(m => m.role === 'coach' || !this._isRenderedAi(m.content))
          const gotAi = fresh.some(m => m.role !== 'coach')
          fresh.forEach(m => { if (m.role !== 'coach') this._markRenderedAi(m.content) })
          if (fresh.length > 0) {
            const newMsgs = fresh.map(m => this._fromHistoryRow(m, `c-${m.id}`))
            const messages = [...this.data.messages, ...this._applySeparators(newMsgs, this.data.messages[this.data.messages.length - 1])]
            // Only an ai row ends the wait — a coach message arriving mid-turn says nothing
            // about whether the reply the user is waiting for has landed.
            if (gotAi) this._chatWaitStartedAt = null
            this.setData(gotAi ? { messages, typing: false, chatStatusText: '' } : { messages })
            this._scrollBottom()
          }
        }
      } catch (e) {}
    }

    // Last resort: neither delivery channel produced anything within the whole server-side
    // budget, so the turn is genuinely lost (e.g. the chat.generate event was never delivered at
    // all) — tell the user plainly instead of leaving the typing indicator up forever.
    //
    // Must stay ABOVE the server's own worst case or it fires on turns that were going to
    // succeed: agenticChat's TURN_DEADLINE_MS is 200s, and finalizeChatReply's grounding check
    // can add one more LLM call (~40-60s) after that, so a legitimate turn can run ~260s before
    // the reply lands. At the old 180s this bound was BELOW the server's, so any turn that used
    // its full budget showed a spurious "still working" even though the reply arrived moments
    // later — exactly what the 健康管理 tool hit (measured 266s end-to-end on 2026-08-22).
    // 285s also sits just past handleChatGenerateEvent's own 250s watchdog, which now guarantees
    // an honest server-side message before the worker's 300s FC ceiling — so reaching this line
    // means even that never made it, and "didn't finish" is the accurate thing to say.
    if (this.data.typing && this._chatWaitStartedAt && Date.now() - this._chatWaitStartedAt > 285000) {
      this._chatWaitStartedAt = null
      this._addMsg('ai', this.data.t.chatTimedOut)
      this.setData({ typing: false, chatStatusText: '' })
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

  _applySliderValue(key, rawVal, step, min, max) {
    let val = rawVal
    if (min != null && !isNaN(min) && max != null && !isNaN(max)) val = Math.min(max, Math.max(min, val))
    if (step) val = Math.round(val / step) * step
    const display = step < 1 ? val.toFixed(1) : String(val)
    const obSliders = { ...this.data.obSliders, [key]: val }
    const obSliderDisplay = { ...this.data.obSliderDisplay, [key]: display }
    const update = { obSliders, obSliderDisplay }
    if (key === 'height') { update.obHeight = val }
    if (key === 'weight') { update.obWeight = val; update.obWeightDisplay = display }
    this.setData(update)
  },

  onSliderChange(e) {
    const key = e.currentTarget.dataset.key
    const step = parseFloat(e.currentTarget.dataset.step) || 1
    this._applySliderValue(key, e.detail.value, step, null, null)
  },

  onSliderValueBlur(e) {
    const { key } = e.currentTarget.dataset
    const step = parseFloat(e.currentTarget.dataset.step) || 1
    const min = parseFloat(e.currentTarget.dataset.min)
    const max = parseFloat(e.currentTarget.dataset.max)
    let val = parseFloat(e.detail.value)
    if (isNaN(val)) val = this.data.obSliders[key]
    this._applySliderValue(key, val, step, min, max)
  },

  onSliderStep(e) {
    const { key, dir } = e.currentTarget.dataset
    const step = parseFloat(e.currentTarget.dataset.step) || 1
    const min = parseFloat(e.currentTarget.dataset.min)
    const max = parseFloat(e.currentTarget.dataset.max)
    const current = this.data.obSliders[key] || 0
    this._applySliderValue(key, current + Number(dir) * step, step, min, max)
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
    let list
    if (key === 'none') {
      // selecting "none" clears everything else
      list = this.data.obConditionList.map(item => ({ ...item, selected: item.key === 'none' }))
    } else {
      // selecting any real option deselects "none", then toggles the tapped item
      list = this.data.obConditionList.map(item => {
        if (item.key === 'none') return { ...item, selected: false }
        return item.key === key ? { ...item, selected: !item.selected } : item
      })
    }
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

  // phone/email/language/coach_id are deliberately omitted from the base object here
  // (only sent when a caller explicitly includes one via `updates`) — user.phone/email
  // are stripped from the cached session (see login.js/verify-phone.js's PII-stripping
  // convention) and are frequently undefined outside the fleeting moment right after a
  // fresh login/verification, so resending them unconditionally risked silently wiping a
  // verified phone/email on every unrelated save (found via a real incident: picking an
  // avatar or answering a questionnaire follow-up nulled the caller's own phone number).
  // The backend (handlePutUser) now also treats an omitted key as "leave untouched", so
  // omitting here is the correct, safe default rather than resending a stale cached value.
  _saveUser(user, updates) {
    return this._req(`${BASE}/api/users/${user.user_id}`, 'PUT', {
      nickname: user.nickname, gender: user.gender, birth_date: user.birth_date,
      ...updates
    })
  },

  // ── Dots tab ────────────────────────────────────────────────────────────────

  async _loadDots(user, lang) {
    this._dotsLoadedAt = Date.now()
    try {
      const res = await this._req(`${BASE}/api/nutrition-plan?openid=${encodeURIComponent(user.user_id)}`)
      const plan = res.data?.plan || null
      const structured = res.data?.structured_plan || null
      const schedules = res.data?.schedules || []
      const dotsArr = res.data?.dots || []
      const dotsMap = {}
      dotsArr.forEach(d => { dotsMap[d.key_name] = d })

      let allDays = []
      if (structured && schedules.length > 0) {
        allDays = mapStructuredSchedules(schedules, dotsMap, lang)
      } else if (plan) {
        allDays = parsePlan(plan, dotsMap, lang)
      }
      this._dotsAllDays = allDays

      const todayDay = allDays.find(d => d.isToday) || null
      const dispenseSlot = new Date().getHours() < 12 ? 'morning_cup' : 'evening_cup'
      const dispenseSlotDots = todayDay
        ? (dispenseSlot === 'morning_cup' ? todayDay.morning : todayDay.evening)
        : []

      const packages = mapPackages(res.data?.packages, this.data.t, lang)

      this.setData({
        dotsLoading: false,
        // Still 'active'-only, deliberately. `packages` is a sibling of the plan fields and must
        // never feed this — CLAUDE.md §28b records the bug where a proposal made this tab report
        // a plan the user did not physically have.
        hasPlan: (plan !== null || structured !== null),
        packages,
        // Buying a second package while one is in flight is refused by GCN
        // (formulation_already_in_progress), so the order card hides rather than dead-ending.
        hasPackageInFlight: packages.some(p => p.inFlight),
        dispenseSlot,
        dispenseSlotDots,
        dispenseDate: localISODate(new Date()),
        dispenseHasToday: !!todayDay,
        dispenseStatus: '',
      })
      this._applyDotsWeek(0)
    } catch (e) {
      this.setData({ dotsLoading: false, hasPlan: false, packages: [], hasPackageInFlight: false })
    }
  },

  // Slices the full (up to 28-day) plan already cached in this._dotsAllDays down to a single
  // calendar Mon-Sun week for the card scroller, so paging weeks is instant and needs no refetch.
  _applyDotsWeek(offset) {
    const allDays = this._dotsAllDays || []
    const { monday, sunday } = getWeekRange(offset)
    const weekLabel = fmtWeekLabel(monday, sunday, this.data.lang)
    const dotsDays = allDays.filter(d => d.dateStr >= monday && d.dateStr <= sunday)

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

    const hasPrevWeek = allDays.length > 0 && allDays[0].dateStr < monday
    const hasNextWeek = allDays.length > 0 && allDays[allDays.length - 1].dateStr > sunday

    this.setData({ dotsWeekOffset: offset, dotsDays, weekLabel, todayScrollLeft, hasPrevWeek, hasNextWeek })
  },

  handleDotsPrevWeek() {
    if (!this.data.hasPrevWeek) return
    this._applyDotsWeek(this.data.dotsWeekOffset - 1)
  },

  handleDotsNextWeek() {
    if (!this.data.hasNextWeek) return
    this._applyDotsWeek(this.data.dotsWeekOffset + 1)
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
      const openid = user?.user_id ? `?openid=${encodeURIComponent(user.user_id)}` : ''
      const res = await this._req(`${BASE}/api/store-items${openid}`)
      const raw = res.data?.items || []
      this._rawStoreItems = raw
      this.setData({ storeLoading: false, storeItems: mapStoreItems(raw, lang) })
    } catch (e) {
      this.setData({ storeLoading: false })
    }
    await this._loadStoreOrders(user, lang)
  },

  async _loadCreditBalance(user) {
    if (!user?.user_id) return
    try {
      const res = await this._req(`${BASE}/api/credits/balance?user_id=${encodeURIComponent(user.user_id)}`)
      if (res.data?.success) {
        this.setData({ creditBalance: res.data.balance || 0, creditCurrency: res.data.currency || 'CNY' })
      }
    } catch (e) {}
  },

  // Fetches persona_type + viva_subscription_expires_at once at init — kept as a small
  // dedicated endpoint (handlers/viva_subscription.js's handleGetVivaSubscriptionStatus)
  // rather than threading these two fields through login.js's many branched user-lookup
  // queries. Drives the redeem-code menu entry and the expired-subscription banner.
  async _loadVivaSubscriptionStatus(user) {
    if (!user?.user_id) return
    try {
      const res = await this._req(`${BASE}/api/viva-subscription-status?openid=${encodeURIComponent(user.user_id)}`)
      if (res.data?.success) {
        const expiresAt = res.data.viva_subscription_expires_at
        const personaType = res.data.persona_type || 'nano'
        const vivaSubscriptionExpired = personaType === 'viva' && (!expiresAt || new Date(expiresAt) <= new Date())
        const vivaSubscriptionExpiresAtDisplay = expiresAt ? fmtDate(expiresAt, this.data.lang) : ''
        this.setData({ personaType, vivaSubscriptionExpiresAt: expiresAt || null, vivaSubscriptionExpired, vivaSubscriptionExpiresAtDisplay,
          vivaAgActive: !!res.data.viva_ag_active })
      }
    } catch (e) {}
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

  _syncCart(cart) {
    const { lang } = this.data
    const cartMap = {}
    let total = 0, count = 0
    const allCredits = cart.length > 0 && cart.every(e => e.useCredits)
    for (const entry of cart) {
      cartMap[entry.id] = entry.quantity
      total += entry.rawPrice * entry.quantity
      count += entry.quantity
    }
    const cartTotal = allCredits
      ? `${total} ${lang === 'zh' ? '积分' : 'pts'}`
      : (lang === 'zh' ? `¥${total}` : `$${(total / 7.2).toFixed(0)}`)
    this.setData({ cart, cartMap, cartCount: count, cartTotal })
    try { wx.setStorageSync('nano_cart', cart) } catch (e) {}
  },

  handleAddToCart(e) {
    if (this.data.isGuest) { this.openGuestSheet(); return }
    const item = e.currentTarget.dataset.item
    if (item.variants && item.variants.length > 0) {
      if (!item.selectedVariantId) {
        wx.showToast({ title: this.data.lang === 'zh' ? '请先选择规格' : 'Please select a size', icon: 'none', duration: 1500 })
        return
      }
      const variant = item.variants.find(v => v.id === item.selectedVariantId)
      const cartItem = { ...item, id: item.selectedVariantId, name: item.name + ' ' + variant.label, variants: null }
      const cart = [...this.data.cart]
      const existing = cart.find(x => x.id === cartItem.id)
      if (existing) { existing.quantity += 1 } else { cart.push({ ...cartItem, quantity: 1 }) }
      this._syncCart(cart)
      return
    }
    const cart = [...this.data.cart]
    const existing = cart.find(x => x.id === item.id)
    if (existing) {
      existing.quantity += 1
    } else {
      cart.push({ ...item, quantity: 1 })
    }
    this._syncCart(cart)
  },

  handleSelectVariant(e) {
    const { itemId, variantId } = e.currentTarget.dataset
    const storeItems = this.data.storeItems.map(it =>
      it.id === itemId ? { ...it, selectedVariantId: variantId } : it
    )
    this.setData({ storeItems })
  },

  handleCartQtyChange(e) {
    const { id, delta } = e.currentTarget.dataset
    const cart = [...this.data.cart]
    const idx = cart.findIndex(x => x.id === id)
    if (idx === -1) return
    cart[idx] = { ...cart[idx], quantity: cart[idx].quantity + delta }
    if (cart[idx].quantity <= 0) cart.splice(idx, 1)
    this._syncCart(cart)
  },

  handleOpenCart() {
    this.setData({ cartOpen: true })
  },

  handleCloseCart() {
    this.setData({ cartOpen: false, checkoutName: '', checkoutPhone: '', checkoutAddress: '' })
  },

  handleCheckoutFieldInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  async handleCheckout() {
    if (this.data.isGuest) { this.openGuestSheet(); return }
    const { t, user, lang, cart } = this.data
    if (cart.length === 0) return
    const items = cart.map(x => ({ channel_inventory_item_id: x.id, quantity: x.quantity }))
    const useCredits = cart.every(x => x.useCredits)
    const needCredits = useCredits ? cart.reduce((sum, x) => sum + x.rawPrice * x.quantity, 0) : 0
    const _showInsufficient = () => {
      wx.showModal({
        title: t.checkoutInsufficientTitle,
        content: t.checkoutInsufficientMsg
          .replace('{need}', needCredits)
          .replace('{have}', this.data.creditBalance),
        showCancel: false,
        confirmText: 'OK',
      })
    }
    // Credit-paid orders: stop before submitting if the balance can't cover the cart.
    if (useCredits && this.data.creditBalance < needCredits) {
      _showInsufficient()
      return
    }
    const _submitBatchOrder = async (shipping_name, shipping_phone, shipping_address) => {
      try {
        wx.showLoading({ title: t.storeOrderSent || 'Processing...' })
        const res = await this._req(`${BASE}/api/orders/batch`, 'POST', {
          openid: user.user_id,
          items,
          shipping_name,
          shipping_phone,
          shipping_address,
          payment_method: useCredits ? 'credits' : 'wechat_pay',
          payment_status: 'paid'
        })
        wx.hideLoading()
        // wx.request resolves on HTTP 4xx/5xx too — must check the payload.
        if (!res.data?.success) {
          const errMsg = res.data?.error || ''
          if (/insufficient credits/i.test(errMsg)) {
            await this._loadCreditBalance(user) // refresh stale balance, then notify
            _showInsufficient()
          } else {
            wx.showToast({ title: t.errServer, icon: 'none', duration: 2500 })
          }
          return
        }
        wx.showToast({ title: t.storeOrderSent || 'Order Sent', icon: 'success', duration: 2500 })
        this._syncCart([])
        this.setData({ cartOpen: false, checkoutName: '', checkoutPhone: '', checkoutAddress: '' })
        await this._loadStoreOrders(user, lang)
        this.setData({ storeSubTab: 'orders' })
        this._loadCreditBalance(user) // reflect the debit
      } catch (err) {
        wx.hideLoading()
        wx.showToast({ title: t.errServer, icon: 'none', duration: 2500 })
      }
    }
    const { checkoutName, checkoutPhone, checkoutAddress } = this.data
    if (checkoutName.trim() && checkoutPhone.trim() && checkoutAddress.trim()) {
      await _submitBatchOrder(checkoutName.trim(), checkoutPhone.trim(), checkoutAddress.trim())
      return
    }
    // Address incomplete — open cart, pre-fill name/phone, then try WeChat address book
    this.setData({
      cartOpen: true,
      checkoutName: checkoutName || user.nickname || '',
      checkoutPhone: checkoutPhone || user.phone || '',
    })
    if (!checkoutAddress.trim()) this.fetchWechatAddress()
  },

  // Pull name/phone/address from the user's WeChat address book.
  // Requires "用户收货地址" declared in the MP privacy protocol; with
  // __usePrivacyCheck__ enabled, the onNeedPrivacyAuthorization flow (app.js +
  // onPrivacyAgree) handles consent automatically before the picker opens.
  fetchWechatAddress() {
    const { t } = this.data
    wx.chooseAddress({
      success: (addr) => {
        this.setData({
          checkoutName: addr.userName || this.data.checkoutName,
          checkoutPhone: addr.telNumber || this.data.checkoutPhone,
          checkoutAddress: `${addr.provinceName || ''}${addr.cityName || ''}${addr.countyName || ''}${addr.detailInfo || ''}`,
        })
      },
      fail: (err) => {
        const errMsg = (err && err.errMsg) || ''
        console.log(JSON.stringify({ level: 'WARN', msg: 'wx.chooseAddress failed', data: { errMsg } }))
        // User dismissed the picker / denied — stay silent, manual form is ready.
        if (/cancel|deny/i.test(errMsg)) return
        // Real failure (e.g. privacy declaration missing) — prompt manual entry.
        wx.showToast({ title: t.checkoutWxAddressFail, icon: 'none', duration: 2500 })
      },
    })
  },

  async handleCancelOrder(e) {
    const orderId = e.currentTarget.dataset.id
    const { t, user, lang } = this.data
    wx.showModal({
      title: lang === 'zh' ? '取消订单' : 'Cancel Order',
      content: lang === 'zh' ? '您确定要取消此订单吗？' : 'Are you sure you want to cancel this order?',
      confirmColor: '#ef4444',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await this._req(`${BASE}/api/orders/${orderId}`, 'PUT', { status: 'cancelled' })
          wx.showToast({ title: lang === 'zh' ? '订单已取消' : 'Order cancelled', icon: 'success' })
          await this._loadStoreOrders(user, lang)
        } catch (err) {
          wx.showToast({ title: t.errServer, icon: 'none' })
        }
      }
    })
  },

  handleCopyTracking(e) {
    const tracking = e.currentTarget.dataset.tracking
    const { lang } = this.data
    wx.setClipboardData({
      data: tracking,
      success: () => {
        wx.showToast({
          title: lang === 'zh' ? '单号已复制' : 'Tracking copied',
          icon: 'success'
        })
      }
    })
  },

  // ── Health Plans ─────────────────────────────────────────────────────────────

  async _loadPlans(user, lang) {
    if (!user) { this.setData({ plansLoading: false }); return }
    this._plansLoadedAt = Date.now()
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
    const tab = e.currentTarget.dataset.tab
    this.setData({ planSubTab: tab })
    if (tab === 'activities') this.loadEvents()
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
      const formulation = res.data?.formulation || null
      this.setData({ planDetailData: { ...plan, ...detail, reminders, formulation } })
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
    this.setData({ planWeightOpen: true, planWeightInput: '', planWeightPlanId: planId, _weightSubAccepted: false })
    wx.requestSubscribeMessage({
      tmplIds: [wx.env?.WX_WEIGHT_TMPL_ID || 'EMj8N9HC4_a2dYyUxDR87AF0nRvme8uB7IPhOi56Zl4'],
      success: (res) => {
        const accepted = res['EMj8N9HC4_a2dYyUxDR87AF0nRvme8uB7IPhOi56Zl4'] === 'accept'
        this.setData({ _weightSubAccepted: accepted })
      },
    })
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
        send_weight_reminder: !!this.data._weightSubAccepted,
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

  // ── Events (线下活动) ──────────────────────────────────────────────────────

  async loadEvents() {
    const { user } = this.data
    if (!user?.channel_id) return
    this.setData({ eventsLoading: true })
    try {
      const res = await this._req(`${BASE}/api/events?channel_id=${encodeURIComponent(user.channel_id)}&user_id=${encodeURIComponent(user.user_id)}`)
      const raw = res.data?.events || []
      const now = Date.now()
      const events = raw.map(ev => {
        const d = new Date(ev.scheduled_at)
        const signupCount = parseInt(ev.signup_count, 10) || 0
        const remaining = ev.capacity ? Math.max(0, ev.capacity - signupCount) : null
        return {
          ...ev,
          scheduled_at_display: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,
          remaining,
          is_full: ev.capacity !== null && remaining === 0,
        }
      })
      const mySignupEventIds = events.filter(ev => ev.signed_up).map(ev => ev.id)
      this.setData({ events, mySignupEventIds, eventsLoading: false })
    } catch {
      this.setData({ eventsLoading: false })
    }
  },

  async handleEventSignUp(e) {
    const { user, t, mySignupEventIds } = this.data
    const eventId = e.currentTarget.dataset.eventId
    try {
      const res = await this._req(`${BASE}/api/event-signups`, 'POST', { event_id: eventId, user_id: user.user_id })
      if (res.data?.success) {
        this.setData({ mySignupEventIds: [...mySignupEventIds, eventId] })
        wx.showToast({ title: t.eventsSignedUp, icon: 'success' })
      } else {
        wx.showToast({ title: res.data?.error || 'Error', icon: 'none' })
      }
    } catch {
      wx.showToast({ title: t.errServer, icon: 'none' })
    }
  },

  async handleEventCancelSignup(e) {
    const { user, t, mySignupEventIds } = this.data
    const eventId = e.currentTarget.dataset.eventId
    try {
      await this._req(`${BASE}/api/event-signups/${eventId}?user_id=${encodeURIComponent(user.user_id)}`, 'DELETE')
      this.setData({ mySignupEventIds: mySignupEventIds.filter(id => id !== eventId) })
      wx.showToast({ title: t.eventsCancel, icon: 'none' })
    } catch {
      wx.showToast({ title: t.errServer, icon: 'none' })
    }
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
    this.setData({ guestSheetOpen: true, guestInviteCode: '', guestInviteDigits: Array(6).fill(''), guestInviteError: '', menuOpen: false })
  },

  closeGuestSheet() {
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
      // Valid invite code confirmed — hand off to login.js, which owns account
      // creation, avatar capture, and the phone/OTP verify-phone gate. Keeps a
      // single implementation of "new account" instead of a second copy here.
      wx.reLaunch({ url: `/pages/login/login?invite=${encodeURIComponent(code)}` })
    } catch (e) {
      this.setData({ guestInviteError: this.data.t.errServer, guestInviteBusy: false })
    }
  },

  handleHealthChooseAvatar(e) {
    const { avatarId } = e.detail
    const comp = this.selectComponent('#health-comp')
    const done = () => comp?.setData({ avatarUpdating: false })
    const url = avatarId ? resolveAvatarUrl(avatarId, DEFAULT_MOOD) : null
    if (!url) { done(); return }
    const { user } = this.data
    this._saveUser(user, { avatar_url: url, avatar_character: avatarId }).then(() => {
      this._updateUser({ ...user, avatar_url: url, avatar_character: avatarId })
    }).catch(() => {}).finally(done)
  },

  onProfileUpdated(e) {
    const updated = e.detail
    if (!updated) return
    this._updateUser(updated)
  },

  _getCode() {
    return new Promise((resolve, reject) => {
      wx.login({ success: resolve, fail: reject })
    })
  },

  // ── Wellness tab ─────────────────────────────────────────────────────────────

  _bgAudio: null,

  async _loadWellness() {
    this.setData({ wellnessLoading: true })
    try {
      const cid = this.data.user?.channel_id
      const [assetsRes, apkRes] = await Promise.allSettled([
        this._req(`${BASE}/api/digital-assets${cid ? `?channel_id=${cid}` : ''}`),
        this._req(`${BASE}/api/kino-upgrade`),
      ])
      const raw = assetsRes.status === 'fulfilled' ? (assetsRes.value.data?.assets || []) : []
      const assets = raw.map(a => ({
        ...a,
        mediaType: (a.content_type || '').startsWith('audio/') ? 'audio'
                 : (a.content_type || '').startsWith('video/') ? 'video'
                 : 'other',
      }))
      const apk = apkRes.status === 'fulfilled' ? apkRes.value.data : {}
      this.setData({
        wellnessAssets: assets,
        deviceApkVersion: apk?.version || '',
        deviceApkUrl: apk?.url || '',
        wellnessLoading: false,
      })
    } catch (err) {
      this.setData({ wellnessLoading: false })
    }
  },

  _initBgAudio() {
    if (this._bgAudio) return
    this._bgAudio = wx.getBackgroundAudioManager()
    this._bgAudio.onPlay(() => this.setData({ sleepPlaying: true }))
    this._bgAudio.onPause(() => this.setData({ sleepPlaying: false }))
    this._bgAudio.onStop(() => this.setData({ sleepPlaying: false, sleepPosition: 0 }))
    this._bgAudio.onEnded(() => this.setData({ sleepPlaying: false, sleepPosition: 0 }))
    this._bgAudio.onTimeUpdate(() => {
      this.setData({
        sleepPosition: Math.floor(this._bgAudio.currentTime),
        sleepDuration: Math.floor(this._bgAudio.duration) || this.data.sleepDuration,
      })
    })
  },

  playAudioAsset(e) {
    const track = e.currentTarget.dataset.track
    const current = this.data.sleepCurrentTrack
    this._initBgAudio()
    if (current?.id === track.id && this.data.sleepPlaying) {
      this._bgAudio.pause()
      return
    }
    this._bgAudio.src = track.url
    this._bgAudio.title = track.title_zh || track.title
    this._bgAudio.coverImgUrl = ''
    this.setData({
      sleepCurrentTrack: track,
      sleepPosition: 0,
      sleepDuration: track.duration_seconds || 0,
    })
  },

  stopAudioAsset() {
    this._bgAudio?.stop()
    this.setData({ sleepCurrentTrack: null, sleepPlaying: false, sleepPosition: 0 })
  },

  openMediaAsset(e) {
    const asset = e.currentTarget.dataset.asset
    if (!asset?.url) return
    wx.setClipboardData({
      data: asset.url,
      success: () => wx.showToast({ title: '链接已复制，请在浏览器打开', icon: 'none', duration: 2500 }),
    })
  },

  copyApkUrl() {
    const url = this.data.deviceApkUrl
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制，请在浏览器打开', icon: 'none', duration: 2500 }),
    })
  },

  // ── Academy tab ─────────────────────────────────────────────────────────────

  async _loadAcademy() {
    const userId = this.data.user?.user_id
    if (!userId) return
    this.setData({ trainingLoading: true })
    try {
      const [cRes, lRes, pRes, dashRes, pathRes, certRes] = await Promise.allSettled([
        this._req(`${BASE}/api/academy/courses`),
        this._req(`${BASE}/api/academy/library`),
        this._req(`${BASE}/api/academy/progress?user_id=${userId}`),
        this._req(`${BASE}/api/academy/coach-dashboard?user_id=${userId}`),
        this._req(`${BASE}/api/academy/learning-paths`),
        this._req(`${BASE}/api/academy/coach-certifications?user_id=${userId}`),
      ])
      const tl = (T[this.data.lang] || T.zh).training
      const rawCourses = (cRes.status === 'fulfilled' && cRes.value.data?.courses) ? cRes.value.data.courses : []
      const publishedCourses = rawCourses.filter(c => c.status === 'published')
      const library = (lRes.status === 'fulfilled' && lRes.value.data?.items) ? lRes.value.data.items : []
      const progressRows = (pRes.status === 'fulfilled' && pRes.value.data?.progress) ? pRes.value.data.progress : []
      const completedIds = progressRows.map(p => p.lesson_id)

      // Build per-course completion count (requires course_id on progress rows)
      const completedByCourse = {}
      for (const p of progressRows) {
        if (p.course_id) {
          completedByCourse[p.course_id] = (completedByCourse[p.course_id] || 0) + 1
        }
      }
      // A course is fully completed when all its lessons are done
      const completedCourseIds = new Set(
        publishedCourses
          .filter(c => c.lesson_count > 0 && (completedByCourse[c.id] || 0) >= c.lesson_count)
          .map(c => c.id)
      )

      const courses = publishedCourses.map(c => ({
        ...c,
        _lessonCountLabel: tl.lessonCount(c.lesson_count || 0),
        _locked: c.prerequisite_course_id ? !completedCourseIds.has(c.prerequisite_course_id) : false,
      }))

      const dashboard = (dashRes.status === 'fulfilled' && dashRes.value.data) ? dashRes.value.data : null
      const paths = (pathRes.status === 'fulfilled' && pathRes.value.data?.paths) ? pathRes.value.data.paths : []
      const certifications = (certRes.status === 'fulfilled' && certRes.value.data?.certifications) ? certRes.value.data.certifications : []
      const enrichedPaths = paths.map(p => {
        const total = (p.courses || []).length
        const done = (p.courses || []).filter(c => completedCourseIds.has(c.course_id)).length
        return { ...p, _total: total, _done: done }
      })
      this.setData({ trainingCourses: courses, trainingLibrary: library, trainingCompletedIds: completedIds, trainingDashboard: dashboard, trainingPaths: enrichedPaths, trainingCertifications: certifications })
    } catch (e) {
      wx.showToast({ title: this.data.t.training.loadError, icon: 'none' })
    } finally {
      this.setData({ trainingLoading: false })
    }
  },

  async trainingOpenCourse(e) {
    const course = e.currentTarget.dataset.course
    if (course._locked) {
      const prereq = course.prerequisite_title || (this.data.lang === 'zh' ? '前置课程' : 'prerequisite course')
      wx.showToast({ title: this.data.lang === 'zh' ? `请先完成：${prereq}` : `Complete first: ${prereq}`, icon: 'none', duration: 2500 })
      return
    }
    this.setData({ trainingCurrentCourse: course, trainingLessons: [], trainingView: 'lessons' })
    try {
      const res = await this._req(`${BASE}/api/academy/lessons?course_id=${course.id}`)
      this.setData({ trainingLessons: res.data?.lessons || [] })
    } catch (e) {
      wx.showToast({ title: this.data.t.training.loadError, icon: 'none' })
    }
  },

  async trainingOpenLesson(e) {
    const lesson = e.currentTarget.dataset.lesson
    this.setData({ trainingCurrentLesson: lesson, trainingVideoUrl: '', trainingTextContent: '', trainingQuizQuestions: [], trainingQuizAnswers: {}, trainingQuizResult: null, trainingQuizReview: [], trainingView: 'player' })
    try {
      const detailRes = await this._req(`${BASE}/api/academy/lessons/${lesson.id}`)
      const detail = detailRes.data || {}
      const quizQuestions = detail.quiz_questions || []
      if (lesson.content_type === 'text' || lesson.content_type === 'interactive') {
        this.setData({ trainingTextContent: detail.lesson?.text_content || '', trainingQuizQuestions: quizQuestions })
        return
      }
      if (lesson.oss_key) {
        const presignRes = await this._req(`${BASE}/api/oss/presign?action=get&key=${encodeURIComponent(lesson.oss_key)}`)
        this.setData({ trainingVideoUrl: presignRes.data?.url || '', trainingQuizQuestions: quizQuestions })
      }
    } catch (e) {
      wx.showToast({ title: this.data.t.training.loadError, icon: 'none' })
    }
  },

  trainingSelectAnswer(e) {
    const { questionId, optionIndex } = e.currentTarget.dataset
    this.setData({ trainingQuizAnswers: { ...this.data.trainingQuizAnswers, [questionId]: optionIndex } })
  },

  async trainingSubmitQuiz() {
    const lesson = this.data.trainingCurrentLesson
    if (!lesson) return
    const userId = this.data.user?.user_id
    const answers = this.data.trainingQuizAnswers
    if (Object.keys(answers).length === 0) { wx.showToast({ title: '请先回答问题', icon: 'none' }); return }
    this.setData({ trainingQuizSubmitting: true })
    try {
      const res = await this._req(`${BASE}/api/academy/quiz-attempts`, 'POST', { user_id: userId, lesson_id: lesson.id, answers })
      const result = res.data || {}
      const trainingQuizReview = (this.data.trainingQuizQuestions || []).map(q => {
        const ca = (result.correct_answers || []).find(x => x.question_id === q.id)
        return {
          question: q.question,
          user_answer: ca ? (q.options[answers[String(q.id)]]?.text || '—') : '—',
          correct_answer: ca ? (q.options[ca.correct_index]?.text || '') : '',
          explanation: ca?.explanation || '',
          is_correct: ca?.is_correct || false,
        }
      })
      this.setData({ trainingQuizResult: result, trainingQuizReview })
      if (result.passed) { await this._doMarkComplete(lesson.id); this._loadAcademy() }
    } catch (e) {
      wx.showToast({ title: this.data.t.training.loadError, icon: 'none' })
    } finally {
      this.setData({ trainingQuizSubmitting: false })
    }
  },

  async _doMarkComplete(lessonId) {
    const userId = this.data.user?.user_id
    if (this.data.trainingCompletedIds.includes(lessonId)) return
    try {
      await this._req(`${BASE}/api/academy/progress`, 'POST', { user_id: userId, lesson_id: lessonId })
      this.setData({ trainingCompletedIds: [...this.data.trainingCompletedIds, lessonId] })
    } catch (e) { /* silent */ }
  },

  async trainingMarkComplete() {
    const lesson = this.data.trainingCurrentLesson
    if (!lesson) return
    if (lesson.has_quiz && this.data.trainingQuizQuestions.length > 0 && !this.data.trainingQuizResult?.passed) {
      wx.showToast({ title: '请先完成测验', icon: 'none' }); return
    }
    if (this.data.trainingCompletedIds.includes(lesson.id)) return
    this.setData({ trainingMarkingComplete: true })
    try {
      await this._doMarkComplete(lesson.id)
      wx.showToast({ title: this.data.t.training.markedComplete, icon: 'success' })
      this._loadAcademy()
    } catch (e) {
      wx.showToast({ title: this.data.t.training.loadError, icon: 'none' })
    } finally {
      this.setData({ trainingMarkingComplete: false })
    }
  },

  async trainingOpenLibraryItem(e) {
    const item = e.currentTarget.dataset.item
    this.setData({ trainingCurrentLibraryItem: item, trainingLibraryContent: '', trainingView: 'library-viewer' })
    try {
      const res = await this._req(`${BASE}/api/academy/library/${item.id}/content`)
      this.setData({ trainingLibraryContent: res.data || '' })
    } catch (e) {
      wx.showToast({ title: this.data.t.training.loadError, icon: 'none' })
    }
  },

  trainingBackToList() {
    this.setData({ trainingView: 'list', trainingCurrentCourse: null, trainingCurrentLesson: null, trainingVideoUrl: '', trainingQuizQuestions: [], trainingQuizAnswers: {}, trainingQuizResult: null, trainingQuizReview: [] })
  },

  // API responses serialize DATE columns as full ISO datetimes, e.g.
  // "2026-07-05T16:00:00.000Z" for what the DB actually stores as 2026-07-06 — the
  // backend parses DATE columns using its process timezone (Asia/Shanghai, set on
  // every FC function), so by the time it's JSON, the value is one calendar day
  // "behind" in UTC terms. Shift by the fixed +8h Shanghai offset (no DST in China)
  // before reading fields, so the day comes out right regardless of the device's
  // own local timezone.
  _formatCertDate(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    if (Number.isNaN(d.getTime())) return dateStr
    const shanghai = new Date(d.getTime() + 8 * 60 * 60 * 1000)
    const y = shanghai.getUTCFullYear()
    const day = shanghai.getUTCDate()
    if (this.data.lang === 'zh') return `${y}年${shanghai.getUTCMonth() + 1}月${day}日`
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    return `${months[shanghai.getUTCMonth()]} ${day}, ${y}`
  },

  async showCertDetail(e) {
    const cert = e.currentTarget.dataset.cert
    // cert_oss_key is the backend-composited image (name/dates burned in) — prefer
    // it for the preview. template_image_oss_key is the blank template, only used
    // as a fallback for the rare case a cert exists but generation hasn't run yet.
    const displayKey = cert.cert_oss_key || cert.template_image_oss_key
    let templateImageUrl = ''
    if (displayKey) {
      try {
        const res = await this._req(`${BASE}/api/oss/presign?action=get&key=${encodeURIComponent(displayKey)}`)
        templateImageUrl = res.data?.url || ''
      } catch (_) {}
    }
    const issueDateDisplay = this._formatCertDate(cert.issue_date)
    const expiryDateDisplay = this._formatCertDate(cert.expiry_date)
    this.setData({ showCertDetail: true, certDetailItem: { ...cert, templateImageUrl, issueDateDisplay, expiryDateDisplay } })
  },

  hideCertDetail() {
    this.setData({ showCertDetail: false, certDetailItem: null })
  },

  noop() {},

  async downloadCert(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    wx.showLoading({ title: this.data.lang === 'zh' ? '准备中…' : 'Loading…' })
    try {
      const res = await this._req(`${BASE}/api/oss/presign?action=get&key=${encodeURIComponent(key)}`)
      const url = res.data?.url
      if (!url) throw new Error('No URL')
      wx.hideLoading()
      const dlRes = await new Promise((resolve, reject) => {
        wx.downloadFile({ url, success: resolve, fail: reject })
      })
      wx.openDocument({ filePath: dlRes.tempFilePath, showMenu: true })
    } catch (_) {
      wx.hideLoading()
      wx.showToast({ title: this.data.lang === 'zh' ? '下载失败' : 'Download failed', icon: 'none' })
    }
  },

  trainingBackToLessons() {
    this.setData({ trainingView: 'lessons', trainingCurrentLesson: null, trainingVideoUrl: '', trainingCurrentLibraryItem: null, trainingLibraryContent: '', trainingQuizQuestions: [], trainingQuizAnswers: {}, trainingQuizResult: null, trainingQuizReview: [] })
  },

  // ── HTTP helper ─────────────────────────────────────────────────────────────

  _req(url, method = 'GET', data = null, timeoutMs = null) {
    return new Promise((resolve, reject) => {
      const opts = {
        url, method,
        header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.apiToken}` },
        success: resolve,
        fail: reject,
      }
      if (app.globalData.sandboxMode && method !== 'GET') data = { ...(data || {}), sandbox: true }
      if (data) opts.data = data
      // Default (unset) falls back to wx.request's built-in 60s timeout — fine for every
      // other call, but /api/chat holds the request open for Viva's full agentic
      // plan/generate/judge/revise loop, which we've measured at 60-120s+ worst case, so it
      // needs its own longer override (see _sendMessage) or it trips the client timeout
      // before the worker responds, even though the reply still arrives moments later via
      // the separate notification poller.
      if (timeoutMs) opts.timeout = timeoutMs
      wx.request(opts)
    })
  },

  // Fetches the authoritative phone_verified state from the server rather than trusting
  // the locally cached flag on this.data.user, which is only ever refreshed on a fresh
  // wx-login — a returning session (app.js onLaunch restoring from
  // wx.getStorageSync('nano_user')) never re-syncs it. Falls back to the cached value on
  // a network error so a flaky connection doesn't block store access outright.
  async _checkPhoneVerified() {
    const user = this.data.user
    if (!user || user.guest) return false
    try {
      const res = await this._req(`${BASE}/api/users/${user.user_id}`)
      const verified = !!res.data?.user?.phone_verified
      this.setData({ 'user.phone_verified': verified })
      if (app.globalData.user) app.globalData.user.phone_verified = verified
      const cached = wx.getStorageSync('nano_user')
      if (cached) wx.setStorageSync('nano_user', { ...cached, phone_verified: verified })
      return verified
    } catch (e) {
      return !!user.phone_verified
    }
  },
})
