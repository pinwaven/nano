const app = getApp()
const { BASE } = require('../../utils/config.js')
const toolActions = require('../../utils/tool-actions')

const T = {
  zh: {
    title: '教练面板',
    coachLabel: '教练',
    back: '返回',
    refresh: '刷新',
    loading: '加载中…',
    tabs: { clients: '我的客户', invites: '邀请码', earnings: '我的收益', questionnaires: '问卷', training: '培训', crm: '客户管理' },
    lightMode: '浅色模式',
    darkMode: '深色模式',
    kinoSimMenu: 'Kino 模拟器',
    userPanelMenu: '我的健康',
    adminMenu: '渠道管理',
    superadminMenu: '超管面板',
    logout: '退出',
    noClients: '暂无分配的客户',
    bioAge: '生理年龄', chronoAge: '实际年龄',
    lastScan: '上次检测',
    older: '岁↑', younger: '岁↓',
    openMessages: '发消息',
    detailTitle: '客户详情',
    noBmData: '暂无检测数据',
    noChatData: '暂无对话记录',
    tabHealth: '健康',
    tabPlans: '方案',
    tabChat: '聊天',
    tabMessages: '消息',
    clientPlans: '客户方案',
    recommendPlan: '推荐方案',
    createCustomPlan: '创建定制方案',
    noClientPlans: '暂无进行中的方案',
    planRecommended: '方案已推荐！',
    planPrimary: '主方案',
    planSecondary: '辅方案',
    planWeeks: '周',
    planCheckins: '打卡',
    customPlanName: '方案名称',
    customPlanGoal: '方案目标',
    customPlanDuration: '计划周期（周）',
    you: '用户',
    ai: 'AI',
    subAges: '生理年龄维度',
    bioAgeTrend: '生理年龄趋势',
    biomarkers: '生物标志物',
    noMessages: '暂无消息记录',
    msgPh: '输入消息给客户…',
    send: '发送',
    sending: '发送中…',
    sent: '已发送！',
    sendError: '发送失败，请重试',
    setReminder: '+ 定时提醒',
    reminderTitle: '设置提醒',
    reminderContentPh: '提醒内容…',
    reminderDate: '日期',
    reminderTime: '时间',
    selectDate: '选择日期',
    selectTime: '选择时间',
    recurrence: '重复',
    recurrenceNone: '不重复',
    recurrenceDaily: '每天',
    recurrenceWeekly: '每周',
    reminderSent: '提醒已设置',
    reminderError: '设置失败',
    networkError: '网络错误',
    joined: '注册时间',
    noPermission: '无权限',
    invite: {
      generate: '生成邀请码', deactivate: '停用', copy: '复制链接',
      uses: '已使用', active: '有效', inactive: '已停用',
      noInvites: '暂无邀请码',
      deactivateWarning: '停用此邀请码？已复制的链接将失效。',
      copied: '链接已复制',
    },
    earnings: {
      thisMonth: '本月待结算', available: '可提现余额', noPayouts: '暂无结算记录',
      payoutHistory: '结算记录', period: '周期', amount: '金额', status: '状态',
      draft: '待审批', approved: '已审批', transferred: '已转账',
    },
    questionnaires: {
      noQuestionnaires: '暂无可用问卷',
      assign: '指派',
      assignTitle: '指派问卷给客户',
      noClients: '暂无客户',
      noUsers: '请选择至少一名客户',
      assigned: '指派成功',
      assignError: '指派失败，请重试',
      responsesTitle: '问卷回答',
      noResponses: '暂无回答记录',
    },
    tabNotes: '笔记', tabGoals: '目标',
    noNotes: '暂无笔记', addNotePh: '添加笔记…', saveNote: '保存', notePin: '置顶', noteUnpin: '取消置顶', noteDelete: '删除',
    noGoals: '暂无目标', setGoal: '+ 设定目标', goalAchieved: '✓ 已达成', goalActive: '进行中', goalMissed: '未完成',
    goalTypeLabel: '目标类型', goalTargetLabel: '目标值', goalDateLabel: '目标日期',
    goalTypes: { bio_age: '生理年龄', sub_age: '生理维度', weight: '体重', steps: '步数', sleep_score: '睡眠分', hrv: 'HRV', custom: '自定义' },
    crmPipeline: '客户管道', crmStages: { lead: '待跟进', onboarding: '接入中', active: '活跃', at_risk: '需关注', churned: '已流失', graduated: '已毕业' },
    crmAppointments: '近期预约', crmActivity: '动态', noActivity: '暂无动态', noAppointments: '暂无预约',
    newAppt: '+ 新增预约', apptTitle: '预约标题', apptDate: '日期', apptTime: '时间',
    apptFormats: { video: '视频通话', phone: '电话', in_person: '面诊', wechat: '微信' },
    apptCreate: '创建预约', apptCancel: '取消',
    kpiTitle: '我的指标', kpiClients: '总客户', kpiActive: '活跃', kpiAtRisk: '需关注', kpiCommission: '本月佣金',
    kpiNps: 'NPS 评分', kpiScans: '促成检测', topImprovers: '改善最快',
    activityTypes: { message_sent: '发送消息', reminder_set: '设置提醒', plan_assigned: '指派方案', kino_scan: 'Kino 检测', stage_changed: '阶段变更', note_added: '添加笔记', appointment_scheduled: '创建预约', appointment_completed: '完成预约', goal_set: '设定目标', goal_achieved: '达成目标', bulk_message_sent: '群发消息' },
    toolFormulaDots: '营养定制',
    toolTestChip: '检测服务',
    toolHealthAdvice: '健康管理',
    toolUploadImage: '上传图片',
    toolFormulaDotMsg: '请帮我配制我的 DOTS 方案',
    toolHealthAdviceMsg: '请分析我目前的健康状态，并给我专业的健康建议。',
    formulaGenerating: '正在根据您的生物标志物生成7天营养方案…',
    formulaComplete: '您的7天营养方案已生成！',
    formulaViewDots: '查看营养方案 →',
    formulaError: '方案生成失败，请重试。',
    healthAdviceError: '健康分析请求失败，请重试。',
    imageUploading: '正在上传图片…',
    imageAnalyzing: '正在分析图片，请稍候…',
    imageError: '图片分析失败，请重试。',
    kinoScanSuccess: '客户的 Kino 芯片已成功登记！',
    kinoScanInstruction: '请将芯片插入 Kino 分析仪，开始检测。',
    kinoScanAlreadyLinked: '此芯片已绑定到该客户账户，正在等待检测结果。',
    kinoScanUsed: '此芯片已完成检测，无法重复登记。',
    kinoScanInvalidChip: '此二维码不是有效的 Kino 芯片，请扫描芯片上的二维码。',
    kinoScanError: '登记失败，请重试。',
    training: {
      header: '培训中心',
      courses: '课程', library: '参考资料',
      noTraining: '暂无已发布的培训课程',
      noLibrary: '暂无参考资料',
      noLessons: '本课程暂无课节',
      lessonCount: (n) => `${n} 节`,
      start: '开始', resume: '继续', completed: '已完成',
      markComplete: '标记为已完成',
      markedComplete: '已完成 ✓',
      backToCourses: '← 课程列表',
      backToLessons: '← 课节列表',
      loadError: '加载失败，请重试',
      progress: (done, total) => `${done}/${total} 已完成`,
    },
  },
  en: {
    title: 'Coach Panel',
    coachLabel: 'Coach',
    back: 'Back',
    refresh: 'Refresh',
    loading: 'Loading…',
    tabs: { clients: 'My Clients', invites: 'Invite Codes', earnings: 'My Earnings', questionnaires: 'Forms', training: 'Training', crm: 'CRM' },
    lightMode: 'Light Mode',
    darkMode: 'Dark Mode',
    kinoSimMenu: 'Kino Simulator',
    userPanelMenu: 'My Health',
    adminMenu: 'Channel Admin',
    superadminMenu: 'Super Admin',
    logout: 'Logout',
    noClients: 'No clients assigned yet',
    bioAge: 'Bio Age', chronoAge: 'Chrono Age',
    lastScan: 'Last scan',
    older: 'yrs↑', younger: 'yrs↓',
    openMessages: 'Message',
    detailTitle: 'Client Detail',
    noBmData: 'No biomarker data yet.',
    noChatData: 'No chat history yet.',
    tabHealth: 'Health',
    tabPlans: 'Plans',
    tabChat: 'Chat',
    tabMessages: 'Messages',
    clientPlans: 'Client Plans',
    recommendPlan: 'Recommend Plan',
    createCustomPlan: 'Create Custom Plan',
    noClientPlans: 'No active plans',
    planRecommended: 'Plan recommended!',
    planPrimary: 'Primary',
    planSecondary: 'Secondary',
    planWeeks: 'wks',
    planCheckins: 'check-ins',
    customPlanName: 'Plan Name',
    customPlanGoal: 'Plan Goal',
    customPlanDuration: 'Duration (weeks)',
    you: 'User',
    ai: 'AI',
    subAges: 'Bio Age Dimensions',
    bioAgeTrend: 'Bio Age Trend',
    biomarkers: 'Biomarkers',
    noMessages: 'No messages sent yet.',
    msgPh: 'Type a message to your client…',
    send: 'Send',
    sending: 'Sending…',
    sent: 'Sent!',
    sendError: 'Send failed, please retry',
    setReminder: '+ Set Reminder',
    reminderTitle: 'New Reminder',
    reminderContentPh: 'Reminder message…',
    reminderDate: 'Date',
    reminderTime: 'Time',
    selectDate: 'Select date',
    selectTime: 'Select time',
    recurrence: 'Repeat',
    recurrenceNone: 'Once',
    recurrenceDaily: 'Daily',
    recurrenceWeekly: 'Weekly',
    reminderSent: 'Reminder set',
    reminderError: 'Failed to set reminder',
    networkError: 'Network error',
    joined: 'Joined',
    noPermission: 'No permission',
    invite: {
      generate: 'Generate Code', deactivate: 'Deactivate', copy: 'Copy Link',
      uses: 'Uses', active: 'Active', inactive: 'Inactive',
      noInvites: 'No invite codes yet',
      deactivateWarning: 'Deactivate this invite code? Shared links will stop working.',
      copied: 'Link copied',
    },
    earnings: {
      thisMonth: 'This Month (Pending)', available: 'Available Balance', noPayouts: 'No payout history',
      payoutHistory: 'Payout History', period: 'Period', amount: 'Amount', status: 'Status',
      draft: 'Pending Approval', approved: 'Approved', transferred: 'Transferred',
    },
    questionnaires: {
      noQuestionnaires: 'No questionnaires available',
      assign: 'Assign',
      assignTitle: 'Assign to Clients',
      noClients: 'No clients yet',
      noUsers: 'Please select at least one client',
      assigned: 'Assigned successfully',
      assignError: 'Assignment failed, please retry',
      responsesTitle: 'Questionnaire Responses',
      noResponses: 'No responses yet',
    },
    tabNotes: 'Notes', tabGoals: 'Goals',
    noNotes: 'No notes yet', addNotePh: 'Add a note…', saveNote: 'Save', notePin: 'Pin', noteUnpin: 'Unpin', noteDelete: 'Delete',
    noGoals: 'No goals yet', setGoal: '+ Set Goal', goalAchieved: '✓ Achieved', goalActive: 'Active', goalMissed: 'Missed',
    goalTypeLabel: 'Goal Type', goalTargetLabel: 'Target Value', goalDateLabel: 'Target Date',
    goalTypes: { bio_age: 'Bio Age', sub_age: 'Sub Age', weight: 'Weight', steps: 'Steps', sleep_score: 'Sleep Score', hrv: 'HRV', custom: 'Custom' },
    crmPipeline: 'Pipeline', crmStages: { lead: 'Lead', onboarding: 'Onboarding', active: 'Active', at_risk: 'At Risk', churned: 'Churned', graduated: 'Graduated' },
    crmAppointments: 'Upcoming', crmActivity: 'Activity', noActivity: 'No activity yet', noAppointments: 'No upcoming appointments',
    newAppt: '+ New Appointment', apptTitle: 'Title', apptDate: 'Date', apptTime: 'Time',
    apptFormats: { video: 'Video Call', phone: 'Phone', in_person: 'In Person', wechat: 'WeChat' },
    apptCreate: 'Create', apptCancel: 'Cancel',
    kpiTitle: 'My KPIs', kpiClients: 'Total Clients', kpiActive: 'Active', kpiAtRisk: 'At Risk', kpiCommission: 'Commission',
    kpiNps: 'NPS Score', kpiScans: 'Scans', topImprovers: 'Top Improvers',
    activityTypes: { message_sent: 'Message sent', reminder_set: 'Reminder set', plan_assigned: 'Plan assigned', kino_scan: 'Kino scan', stage_changed: 'Stage changed', note_added: 'Note added', appointment_scheduled: 'Appointment scheduled', appointment_completed: 'Appointment completed', goal_set: 'Goal set', goal_achieved: 'Goal achieved', bulk_message_sent: 'Bulk message sent' },
    toolFormulaDots: 'Formulate Dots',
    toolTestChip: 'Use Kino Chip',
    toolHealthAdvice: 'Health Advice',
    toolUploadImage: 'Upload Image',
    toolFormulaDotMsg: 'Please formulate my Dots plan',
    toolHealthAdviceMsg: 'Please analyze my current health status and give me personalized health advice.',
    formulaGenerating: 'Generating your 7-day nutrition plan from your biomarkers…',
    formulaComplete: 'Your 7-day nutrition plan is ready!',
    formulaViewDots: 'View Dots Plan →',
    formulaError: 'Plan generation failed. Please try again.',
    healthAdviceError: 'Health analysis request failed. Please try again.',
    imageUploading: 'Uploading image…',
    imageAnalyzing: 'Analyzing your image, please wait…',
    imageError: 'Image analysis failed. Please try again.',
    kinoScanSuccess: "Client's Kino chip has been registered!",
    kinoScanInstruction: 'Now insert the chip into the Kino Analyzer to begin the test.',
    kinoScanAlreadyLinked: 'This chip is already linked to the client account and is awaiting analysis.',
    kinoScanUsed: 'This chip has already been analyzed and cannot be registered again.',
    kinoScanInvalidChip: 'This QR code is not a valid Kino chip. Please scan the QR code on the chip.',
    kinoScanError: 'Registration failed. Please try again.',
    training: {
      header: 'Training Center',
      courses: 'Courses', library: 'Reference Library',
      noTraining: 'No published training courses yet',
      noLibrary: 'No reference materials yet',
      noLessons: 'No lessons in this course yet',
      lessonCount: (n) => `${n} lesson${n !== 1 ? 's' : ''}`,
      start: 'Start', resume: 'Resume', completed: 'Completed',
      markComplete: 'Mark as Complete',
      markedComplete: 'Completed ✓',
      backToCourses: '← Courses',
      backToLessons: '← Lessons',
      loadError: 'Failed to load. Please retry.',
      progress: (done, total) => `${done}/${total} done`,
    },
  },
}

const SUB_AGE_META = [
  { key: 'CellularAge',      labelZh: '细胞',   labelEn: 'Cellular',   shortZh: '细胞', shortEn: 'Cell', color: '#f97316' },
  { key: 'MetabolicAge',     labelZh: '代谢',   labelEn: 'Metabolic',  shortZh: '代谢', shortEn: 'Meta', color: '#6375EC' },
  { key: 'MicroVascularAge', labelZh: '微血管', labelEn: 'Vascular',   shortZh: '微血', shortEn: 'Vasc', color: '#0ea5e9' },
  { key: 'ResilienceAge',    labelZh: '抗压',   labelEn: 'Resilience', shortZh: '抗压', shortEn: 'Resi', color: '#10b981' },
]


function bioAgeColor(bio, chrono) {
  if (!bio || !chrono) return '#A6C4E5'
  return Number(bio) <= Number(chrono) ? '#10b981' : '#ef4444'
}

function chronoAge(birthDate) {
  if (!birthDate) return null
  return Math.floor((Date.now() - new Date(birthDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
}

function fmtTime(d) {
  if (!d) return ''
  const date = new Date(d)
  if (isNaN(date.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fmtAnswer(answer) {
  if (answer === null || answer === undefined) return '—'
  if (Array.isArray(answer)) return answer.join(', ')
  if (typeof answer === 'object') return Object.entries(answer).map(([k, v]) => `${k}: ${v}`).join('  ')
  return String(answer)
}

function fmtDate(d) {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return String(d)
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

function todayStr() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

Page({
  data: {
    lang: 'zh',
    t: T.zh,
    tab: 'clients',
    loading: false,
    clientsRefreshing: false,
    statusBarHeight: 0,
    capsuleRightPad: 0,
    channelName: 'NANO',
    channelLogo: '/assets/waven-logo-icon.png',
    nickname: '',
    menuOpen: false,
    menuTop: 0,
    theme: 'dark',
    isAdmin: false,
    isSuperadmin: false,
    clients: [],
    invites: [],
    // Client detail sheet
    detailOpen: false,
    detailClient: null,
    detailTab: 'health',
    // Unified chat tab (user + AI + coach)
    chatMessages: [],
    chatLoading: false,
    chatScrollId: '',
    // Compose
    msgText: '',
    msgBusy: false,
    chatToolboxOpen: false,
    chatToolList: [],
    chatToolBusy: false,
    // Earnings tab
    earningsThisMonth: null,
    earningsAvailable: null,
    earningsPayouts: [],
    earningsLoading: false,
    // Reminder overlay
    reminderOpen: false,
    reminderTarget: null,
    reminderDate: '',
    reminderTime: '08:00',
    reminderText: '',
    reminderRecurrence: 'none',
    reminderBusy: false,
    // Questionnaires tab
    questionnaires: [],
    questionnairesLoading: false,
    // Assign modal
    qAssignOpen: false,
    qAssignQuestionnaire: null,
    qAssignClients: [],
    qAssignSelectedIds: [],
    qAssignBusy: false,
    // Responses modal
    qResponsesOpen: false,
    qResponsesUser: null,
    qResponsesList: [],
    qResponsesLoading: false,
    // Training tab
    trainingCourses: [],
    trainingLibrary: [],
    trainingCompletedIds: [],
    trainingLessons: [],
    trainingView: 'list',
    trainingCurrentCourse: null,
    trainingCurrentLesson: null,
    trainingVideoUrl: '',
    trainingLibraryContent: '',
    trainingCurrentLibraryItem: null,
    trainingLoading: false,
    trainingMarkingComplete: false,
    // CRM: Notes tab (inside client detail)
    clientNotes: [],
    clientNotesLoading: false,
    noteText: '',
    notesBusy: false,
    // CRM: Goals tab (inside client detail)
    clientGoals: [],
    clientGoalsLoading: false,
    goalFormOpen: false,
    goalType: 'bio_age',
    goalTargetValue: '',
    goalTargetDate: '',
    goalBusy: false,
    // CRM Tab
    crmLoading: false,
    crmPipelineColumns: [],
    crmActivityFeed: [],
    crmUpcomingAppts: [],
    apptFormOpen: false,
    apptClientId: '',
    apptClientName: '',
    apptTitleText: '',
    apptDate: '',
    apptTime: '10:00',
    apptFormat: 'video',
    apptLink: '',
    apptBusy: false,
    // Performance Tab
    kpiLoading: false,
    kpiData: null,
    topImprovers: [],
    // Plans tab (inside client detail)
    detailPlans: [],
    detailPlansLoading: false,
    planTemplates: [],
    planRecommendOpen: false,
    planCustomOpen: false,
    planCustomName: '',
    planCustomGoal: '',
    planCustomDuration: 4,
    planActionBusy: false,
  },

  _coachId: null,
  _coachChannelId: null,
  _coachUserId: null,
  _touchX: 0,
  _touchY: 0,

  onLoad() {
    const user = app.globalData.user
    if (!user) { wx.reLaunch({ url: '/pages/login/login' }); return }
    const roles = user.roles || []
    if (!roles.includes('coach') && !roles.includes('admin') && !roles.includes('superadmin')) {
      wx.showToast({ title: T.zh.noPermission, icon: 'none' })
      wx.reLaunch({ url: '/pages/main/main' })
      return
    }
    const coach = app.globalData.coach
    this._coachId = coach ? coach.id : null
    this._coachChannelId = coach ? coach.channel_id : null
    this._coachUserId = user.user_id
    const { statusBarHeight = 0, windowWidth = 375 } = wx.getSystemInfoSync()
    const capsule = wx.getMenuButtonBoundingClientRect()
    const capsuleRightPad = windowWidth - (capsule.left || windowWidth - 96) + 8
    const menuTop = statusBarHeight + 44
    const channel = app.globalData.channel || null
    const channelName = channel?.name || 'NANO'
    const channelLogo = channel?.logo_url || '/assets/waven-logo-icon.png'
    const nickname = user.nickname || ''
    const isAdmin = roles.includes('admin') || roles.includes('superadmin')
    const isSuperadmin = roles.includes('superadmin')
    const theme = user.theme || app.globalData.theme || 'dark'
    const lang = app.globalData.lang || 'zh'
    const t = T[lang]
    this.setData({ statusBarHeight, capsuleRightPad, menuTop, channelName, channelLogo, nickname, isAdmin, isSuperadmin, theme, lang, t, reminderDate: todayStr(), chatToolList: toolActions.getToolList(t) })
    this._loadAll()
  },

  async _loadAll() {
    this.setData({ loading: true })
    try {
      const [clientsRes, invitesRes] = await Promise.all([
        this._coachId
          ? this._req(`${BASE}/api/coach-users/${this._coachId}`)
          : Promise.resolve({ data: { users: [] } }),
        this._req(`${BASE}/api/invitations?created_by=${encodeURIComponent(this._coachUserId)}`),
      ])
      const lang = this.data.lang
      const clients = (clientsRes.data?.users || []).map(u => {
        const cAge = chronoAge(u.birth_date)
        const bioAge = u.bio_age != null ? Number(u.bio_age) : null
        const delta = bioAge != null && cAge != null ? Number((bioAge - cAge).toFixed(1)) : null
        const subAgesRaw = u.bio_data?.bioage_profile?.SubAges || null
        const _subAges = subAgesRaw
          ? SUB_AGE_META.map(m => ({
              key: m.key,
              label: lang === 'zh' ? m.shortZh : m.shortEn,
              color: m.color,
              value: subAgesRaw[m.key] != null ? Number(subAgesRaw[m.key]).toFixed(1) : null,
              elevated: subAgesRaw[m.key] != null && cAge != null && Number(subAgesRaw[m.key]) > cAge,
            }))
          : []
        const stageColorMap = { lead: '#f59e0b', onboarding: '#6375EC', active: '#10b981', at_risk: '#ef4444', churned: '#6b7280', graduated: '#0ea5e9' }
        const crmStage = u.crm_stage || null
        const crmStagePill = crmStage ? { label: T[lang].crmStages[crmStage] || crmStage, color: stageColorMap[crmStage] || '#6b7280' } : null
        const crmTags = (u.crm_tag_objects || []).filter(Boolean).slice(0, 4)
        return {
          ...u,
          _cAge: cAge,
          _bioAgeColor: bioAgeColor(u.bio_age, cAge),
          _joinedFmt: fmtDate(u.created_at),
          _lastScanFmt: u.last_scan_at ? fmtDate(u.last_scan_at) : null,
          _lastMsgTimeFmt: u.last_user_msg_at ? fmtTime(u.last_user_msg_at) : null,
          _avatar: (u.nickname || 'U')[0].toUpperCase(),
          _subAges,
          _lastUserMsg: u.last_user_msg ? String(u.last_user_msg).slice(0, 100) : null,
          _crmStagePill: crmStagePill,
          _crmTags: crmTags,
        }
      })
      this.setData({ clients, invites: invitesRes.data?.invitations || [] })
    } catch (e) {
      wx.showToast({ title: T[this.data.lang].networkError, icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  handleRefresh() {
    this._loadAll()
    if (this.data.tab === 'earnings') this._loadEarnings()
    if (this.data.tab === 'questionnaires') this._loadQuestionnaires()
  },

  async onClientsRefresh() {
    this.setData({ clientsRefreshing: true })
    await this._loadAll()
    this.setData({ clientsRefreshing: false })
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ tab })
    if (tab === 'earnings' && this.data.earningsThisMonth === null) this._loadEarnings()
    if (tab === 'questionnaires' && this.data.questionnaires.length === 0) this._loadQuestionnaires()
    if (tab === 'training' && this.data.trainingCourses.length === 0) this._loadTraining()
    if (tab === 'crm') this._loadCRM()
  },
  handleBack() { wx.navigateBack() },
  noop() {},

  toggleMenu() { this.setData({ menuOpen: !this.data.menuOpen }) },
  closeMenu()  { this.setData({ menuOpen: false }) },

  toggleLang() {
    const lang = this.data.lang === 'zh' ? 'en' : 'zh'
    app.globalData.lang = lang
    this.setData({ lang, t: T[lang], menuOpen: false, chatToolList: toolActions.getToolList(T[lang]) })
  },

  async toggleTheme() {
    const theme = this.data.theme === 'dark' ? 'light' : 'dark'
    app.globalData.theme = theme
    wx.setStorageSync('nano_user', { ...wx.getStorageSync('nano_user'), theme })
    this.setData({ theme, menuOpen: false })
    try {
      await this._req(`${BASE}/api/users/${this._coachUserId}`, 'PATCH', { theme })
    } catch (e) {}
  },

  openUserPanel() {
    this.setData({ menuOpen: false })
    wx.navigateBack({ delta: 1, animationType: 'slide-out-right', animationDuration: 280 })
  },

  openKinoSim() {
    this.setData({ menuOpen: false })
    wx.navigateBack({ delta: 1, animationType: 'slide-out-right', animationDuration: 280 })
  },

  openAdmin() {
    this.setData({ menuOpen: false })
    wx.navigateTo({ url: '/pages/admin/admin' })
  },

  openSuperadmin() {
    this.setData({ menuOpen: false })
    wx.navigateTo({ url: '/pages/superadmin/superadmin' })
  },

  handleLogout() {
    this.setData({ menuOpen: false })
    wx.removeStorageSync('nano_user')
    app.globalData.user = null
    wx.reLaunch({ url: '/pages/login/login' })
  },

  onTouchStart(e) {
    this._touchX = e.touches[0].clientX
    this._touchY = e.touches[0].clientY
  },

  onTouchEnd(e) {
    if (this.data.menuOpen || this.data.detailOpen || this.data.reminderOpen || this.data.qAssignOpen || this.data.qResponsesOpen) return
    const dx = e.changedTouches[0].clientX - this._touchX
    const dy = e.changedTouches[0].clientY - this._touchY
    if (dx > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (this.data.tab === 'training') {
        const view = this.data.trainingView
        if (view === 'player') { this.trainingBackToLessons(); return }
        if (view === 'library-viewer') { this.trainingBackToList(); return }
        if (view === 'lessons') { this.trainingBackToList(); return }
      }
      wx.navigateBack({ delta: 1, animationType: 'slide-out-right', animationDuration: 280 })
    }
  },

  // ── Client detail sheet ──────────────────────────────────────────────────

  openClientDetail(e) {
    const client = e.currentTarget.dataset.client
    const initialTab = e.currentTarget.dataset.tab || 'health'
    const resolvedTab = initialTab === 'messages' ? 'chat' : initialTab
    this.setData({
      detailOpen: true, detailClient: client, detailTab: resolvedTab,
      chatMessages: [], chatLoading: false, chatScrollId: '',
      msgText: '',
    })
    if (resolvedTab === 'chat') this._loadClientChat()
  },

  onClientProfileUpdated(e) {
    const updated = e.detail
    if (!updated) return
    const detailClient = { ...this.data.detailClient, ...updated }
    const clients = this.data.clients.map(c =>
      c.user_id === updated.user_id ? { ...c, ...updated } : c
    )
    this.setData({ detailClient, clients })
  },

  closeClientDetail() {
    this.setData({ detailOpen: false, detailClient: null, chatMessages: [], msgText: '', chatScrollId: '', chatToolboxOpen: false, chatToolBusy: false })
  },

  switchDetailTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ detailTab: tab })
    if (tab === 'chat' && this.data.chatMessages.length === 0) this._loadClientChat()
    if (tab === 'plans') this._loadClientPlans()
    if (tab === 'notes') this._loadClientNotes()
    if (tab === 'goals') this._loadClientGoals()
  },

  async _loadClientPlans() {
    const { detailClient } = this.data
    if (!detailClient) return
    this.setData({ detailPlansLoading: true })
    try {
      const [plansRes, tplRes] = await Promise.all([
        this._req(`${BASE}/api/health-plans?openid=${encodeURIComponent(detailClient.user_id)}`),
        this._req(`${BASE}/api/health-plan-templates`),
      ])
      const templates = (tplRes.data?.templates || []).map(t => ({
        ...t,
        sub_ages_display: (t.target_sub_ages || []).join(', '),
      }))
      this.setData({
        detailPlans: plansRes.data?.plans || [],
        planTemplates: templates,
        detailPlansLoading: false,
      })
    } catch {
      this.setData({ detailPlansLoading: false })
    }
  },

  openPlanRecommend() {
    this.setData({ planRecommendOpen: true })
  },

  closePlanRecommend() {
    this.setData({ planRecommendOpen: false })
  },

  openPlanCustom() {
    this.setData({ planCustomOpen: true, planCustomName: '', planCustomGoal: '', planCustomDuration: 4 })
  },

  closePlanCustom() {
    this.setData({ planCustomOpen: false })
  },

  async handleRecommendPlan(e) {
    const { detailClient, lang } = this.data
    const templateId = e.currentTarget.dataset.templateId
    if (!detailClient || !templateId) return
    this.setData({ planActionBusy: true })
    try {
      await this._req(`${BASE}/api/health-plans`, 'POST', {
        openid: detailClient.user_id,
        template_id: templateId,
        plan_type: 'secondary',
        source: 'coach',
        coach_id: this._coachId,
      })
      const t = this.data.t
      wx.showToast({ title: t.planRecommended, icon: 'success' })
      this.setData({ planRecommendOpen: false })
      this._loadClientPlans()
    } catch (err) {
      wx.showToast({ title: err.message || 'Error', icon: 'none' })
    } finally {
      this.setData({ planActionBusy: false })
    }
  },

  onPlanCustomNameInput(e) { this.setData({ planCustomName: e.detail.value }) },
  onPlanCustomGoalInput(e) { this.setData({ planCustomGoal: e.detail.value }) },

  async handleCreateCustomPlan() {
    const { detailClient, planCustomName, planCustomGoal, planCustomDuration } = this.data
    if (!detailClient || !planCustomName.trim()) return
    this.setData({ planActionBusy: true })
    try {
      await this._req(`${BASE}/api/health-plans`, 'POST', {
        openid: detailClient.user_id,
        plan_type: 'secondary',
        source: 'coach',
        coach_id: this._coachId,
        custom_name_zh: planCustomName,
        custom_name_en: planCustomName,
        custom_goal_zh: planCustomGoal,
        custom_goal_en: planCustomGoal,
        duration_weeks: planCustomDuration || 4,
      })
      wx.showToast({ title: this.data.t.planRecommended, icon: 'success' })
      this.setData({ planCustomOpen: false })
      this._loadClientPlans()
    } catch (err) {
      wx.showToast({ title: err.message || 'Error', icon: 'none' })
    } finally {
      this.setData({ planActionBusy: false })
    }
  },

  // ── AI chat history ──────────────────────────────────────────────────────

  async _loadClientChat() {
    const { detailClient } = this.data
    if (!detailClient) return
    this.setData({ chatLoading: true })
    try {
      const params = `user_id=${encodeURIComponent(detailClient.user_id)}${this._coachId ? `&coach_id=${this._coachId}` : ''}`
      const res = await this._req(`${BASE}/api/coach-user-chat?${params}`)
      const chatMessages = (res.data?.messages || []).map((m, i) => ({
        ...m,
        content: m.role === 'coach' ? (m.content || '').replace(/\n+/g, ' ') : m.content,
        _time: fmtTime(m.created_at),
        _isUser: m.role === 'user',
        _isCoach: m.role === 'coach',
      }))
      const lastIdx = chatMessages.length - 1
      // Set messages first, then scroll in the callback so the new elements exist in DOM
      this.setData({ chatMessages, chatLoading: false, chatScrollId: '' }, () => {
        if (lastIdx >= 0) this.setData({ chatScrollId: `cmsg${lastIdx}` })
      })
    } catch {
      this.setData({ chatLoading: false })
    }
  },

  onMsgInput(e) { this.setData({ msgText: e.detail.value }) },

  toggleChatToolbox() {
    this.setData({ chatToolboxOpen: !this.data.chatToolboxOpen })
  },

  handleChatToolAction(e) {
    const action = e.detail?.action
    const { detailClient, t, chatToolBusy } = this.data
    if (!detailClient || chatToolBusy) return
    this.setData({ chatToolboxOpen: false })
    const ctx = {
      addMsg: (role, content, persist) => this._addChatMsg(role, content, persist),
      addImageMsg: (url) => this._addChatImageMsg(url),
      req: (url, method, data) => this._req(url, method, data),
      setTyping: (v) => this.setData({ chatToolBusy: v }),
    }
    if (action === 'test_chip') {
      toolActions.runTestChip(detailClient.user_id, t, ctx)
    } else if (action === 'formula_dots') {
      toolActions.runFormulaDs(detailClient.user_id, t, ctx)
    } else if (action === 'health_advice') {
      toolActions.runHealthAdvice(detailClient.user_id, t, ctx)
    } else if (action === 'upload_image') {
      toolActions.runUploadImage(detailClient.user_id, t, ctx)
    }
  },

  // Append a message to the coach's chat view for the current detailClient.
  // 'user' role is stored as 'coach' so it appears correctly in both panels.
  _addChatMsg(role, content, persist = false) {
    const persistRole = role === 'user' ? 'coach' : role
    const msg = {
      id: `${role}-${Date.now()}-${Math.random()}`,
      role: persistRole,
      content,
      _isUser: false,
      _isCoach: role === 'user',
      _isAi: role === 'ai',
      _time: '',
    }
    const chatMessages = [...this.data.chatMessages, msg]
    const lastIdx = chatMessages.length - 1
    this.setData({ chatMessages }, () => {
      this.setData({ chatScrollId: `cmsg${lastIdx}` })
    })
    if (persist && this.data.detailClient?.user_id) {
      this._req(`${BASE}/api/chat-messages`, 'POST', {
        openid: this.data.detailClient.user_id,
        role: persistRole,
        content,
      }).catch(() => {})
    }
  },

  _addChatImageMsg(imageUrl) {
    const msg = { id: `img-${Date.now()}`, role: 'coach', content: '', imageUrl, _isCoach: true, _isUser: false, _isAi: false, _time: '' }
    const chatMessages = [...this.data.chatMessages, msg]
    const lastIdx = chatMessages.length - 1
    this.setData({ chatMessages }, () => {
      this.setData({ chatScrollId: `cmsg${lastIdx}` })
    })
  },

  async sendMessage() {
    const { detailClient, msgText, lang } = this.data
    if (!msgText.trim() || !detailClient) return
    this.setData({ msgBusy: true })
    try {
      await this._req(`${BASE}/api/coach-instruction`, 'POST', {
        openid: detailClient.user_id,
        instruction: msgText.trim().replace(/\n+/g, ' '),
      })
      wx.showToast({ title: T[lang].sent, icon: 'success' })
      this.setData({ msgText: '', chatMessages: [] })
      this._loadClientChat()
    } catch {
      wx.showToast({ title: T[lang].sendError, icon: 'none' })
    } finally {
      this.setData({ msgBusy: false })
    }
  },

  // ── Reminders ────────────────────────────────────────────────────────────

  openReminderComposer(e) {
    const target = e.currentTarget.dataset.client || this.data.detailClient
    this.setData({
      reminderOpen: true,
      reminderTarget: target,
      reminderText: '',
      reminderDate: todayStr(),
      reminderTime: '08:00',
      reminderRecurrence: 'none',
      reminderBusy: false,
    })
  },

  closeReminderComposer() {
    if (this.data.reminderBusy) return
    this.setData({ reminderOpen: false, reminderTarget: null })
  },

  onReminderDateChange(e) { this.setData({ reminderDate: e.detail.value }) },
  onReminderTimeChange(e) { this.setData({ reminderTime: e.detail.value }) },
  onReminderTextInput(e) { this.setData({ reminderText: e.detail.value }) },
  setRecurrence(e) { this.setData({ reminderRecurrence: e.currentTarget.dataset.val }) },

  async submitReminder() {
    const { reminderTarget, reminderText, reminderDate, reminderTime, reminderRecurrence, lang } = this.data
    if (!reminderText.trim() || !reminderDate || !reminderTime) return
    this.setData({ reminderBusy: true })
    try {
      const scheduledFor = `${reminderDate}T${reminderTime}:00+08:00`
      await this._req(`${BASE}/api/reminders`, 'POST', {
        user_id: reminderTarget.user_id,
        coach_id: this._coachId,
        content: reminderText.trim(),
        scheduled_for: scheduledFor,
        recurrence: reminderRecurrence === 'none' ? null : reminderRecurrence,
      })
      wx.showToast({ title: T[lang].reminderSent, icon: 'success' })
      this.setData({ reminderOpen: false, reminderTarget: null })
    } catch {
      wx.showToast({ title: T[lang].reminderError, icon: 'none' })
    } finally {
      this.setData({ reminderBusy: false })
    }
  },

  // ── Invites ──────────────────────────────────────────────────────────────

  async generateInvite() {
    const { lang } = this.data
    if (!this._coachChannelId) {
      wx.showToast({ title: T[lang].networkError, icon: 'none' })
      return
    }
    try {
      await this._req(`${BASE}/api/invitations`, 'POST', {
        created_by: this._coachUserId,
        channel_id: this._coachChannelId,
        type: 'coach',
      })
      this._loadAll()
    } catch {
      wx.showToast({ title: T[lang].networkError, icon: 'none' })
    }
  },

  copyInvite(e) {
    const invite = e.currentTarget.dataset.invite
    const { lang } = this.data
    wx.setClipboardData({
      data: `pages/login/login?invite=${invite.code}`,
      success: () => wx.showToast({ title: T[lang].invite.copied, icon: 'success' }),
    })
  },

  deactivateInvite(e) {
    const invite = e.currentTarget.dataset.invite
    const { lang } = this.data
    const t = T[lang]
    wx.showModal({
      title: t.invite.deactivate,
      content: t.invite.deactivateWarning,
      confirmColor: '#ef4444',
      confirmText: t.invite.deactivate,
      success: async (res) => {
        if (!res.confirm) return
        try {
          await this._req(`${BASE}/api/invitations/${invite.id}`, 'DELETE')
          this._loadAll()
        } catch {
          wx.showToast({ title: t.networkError, icon: 'none' })
        }
      },
    })
  },

  async _loadEarnings() {
    if (!this._coachUserId) return
    this.setData({ earningsLoading: true })
    try {
      const res = await this._req(`${BASE}/api/coach-earnings?coach_user_id=${encodeURIComponent(this._coachUserId)}`)
      const d = res.data || {}
      const payouts = (d.payouts || []).map(p => ({
        ...p,
        _amountFmt: `¥${Number(p.total_cny).toFixed(2)}`,
      }))
      this.setData({
        earningsThisMonth: `¥${Number(d.this_month_pending || 0).toFixed(2)}`,
        earningsAvailable: `¥${Number(d.available_cny || 0).toFixed(2)}`,
        earningsPayouts: payouts,
        earningsLoading: false,
      })
    } catch {
      this.setData({ earningsLoading: false })
    }
  },

  // ── Questionnaires ──────────────────────────────────────────────────────

  async _loadQuestionnaires() {
    this.setData({ questionnairesLoading: true })
    try {
      const params = this._coachChannelId ? `channel_id=${this._coachChannelId}` : ''
      const res = await this._req(`${BASE}/api/questionnaires?${params}`)
      const questionnaires = (res.data?.questionnaires || []).filter(q => q.is_active)
      this.setData({ questionnaires })
    } catch {
      wx.showToast({ title: T[this.data.lang].networkError, icon: 'none' })
    } finally {
      this.setData({ questionnairesLoading: false })
    }
  },

  openQAssign(e) {
    const q = e.currentTarget.dataset.q
    const qAssignClients = this.data.clients.map(c => ({ ...c, _selected: false }))
    this.setData({ qAssignOpen: true, qAssignQuestionnaire: q, qAssignClients, qAssignSelectedIds: [] })
  },

  closeQAssign() {
    if (this.data.qAssignBusy) return
    this.setData({ qAssignOpen: false, qAssignQuestionnaire: null })
  },

  toggleQUser(e) {
    const uid = e.currentTarget.dataset.uid
    const ids = [...this.data.qAssignSelectedIds]
    const idx = ids.indexOf(uid)
    if (idx >= 0) ids.splice(idx, 1)
    else ids.push(uid)
    const qAssignClients = this.data.clients.map(c => ({ ...c, _selected: ids.includes(c.user_id) }))
    this.setData({ qAssignSelectedIds: ids, qAssignClients })
  },

  async submitQAssign() {
    const { qAssignQuestionnaire, qAssignSelectedIds, lang } = this.data
    const tq = T[lang].questionnaires
    if (!qAssignSelectedIds.length) {
      wx.showToast({ title: tq.noUsers, icon: 'none' })
      return
    }
    this.setData({ qAssignBusy: true })
    try {
      await this._req(`${BASE}/api/questionnaire-assignments`, 'POST', {
        questionnaire_id: qAssignQuestionnaire.id,
        user_ids: qAssignSelectedIds,
        assigned_by: this._coachUserId,
      })
      wx.showToast({ title: tq.assigned, icon: 'success' })
      this.setData({ qAssignOpen: false, qAssignQuestionnaire: null })
    } catch {
      wx.showToast({ title: tq.assignError, icon: 'none' })
    } finally {
      this.setData({ qAssignBusy: false })
    }
  },

  async openQResponses(e) {
    const client = e.currentTarget.dataset.client
    const lang = this.data.lang
    this.setData({ qResponsesOpen: true, qResponsesUser: client, qResponsesList: [], qResponsesLoading: true })
    try {
      const res = await this._req(`${BASE}/api/questionnaire-responses?user_id=${encodeURIComponent(client.user_id)}`)
      const responses = res.data?.responses || []
      const grouped = {}
      for (const r of responses) {
        const qName = lang === 'zh' ? (r.name_zh || r.name) : r.name
        if (!grouped[qName]) grouped[qName] = { name: qName, items: [] }
        grouped[qName].items.push({
          prompt: lang === 'zh' ? r.prompt_zh : r.prompt_en,
          answer_fmt: fmtAnswer(r.answer),
          answered_at: fmtDate(r.answered_at),
        })
      }
      this.setData({ qResponsesList: Object.values(grouped), qResponsesLoading: false })
    } catch {
      this.setData({ qResponsesLoading: false })
    }
  },

  closeQResponses() {
    this.setData({ qResponsesOpen: false, qResponsesUser: null, qResponsesList: [] })
  },

  // ── Training tab ────────────────────────────────────────────────────────────

  async _loadTraining() {
    const coachUserId = this._coachUserId
    if (!coachUserId) return
    this.setData({ trainingLoading: true })
    try {
      const [cRes, lRes, pRes] = await Promise.allSettled([
        this._req(`${BASE}/api/academy/courses`),
        this._req(`${BASE}/api/academy/library`),
        this._req(`${BASE}/api/academy/progress?coach_user_id=${coachUserId}`),
      ])
      const tl = (T[this.data.lang] || T.zh).training
      const rawCourses = (cRes.status === 'fulfilled' && cRes.value.data && cRes.value.data.courses) ? cRes.value.data.courses : []
      const courses = rawCourses
        .filter(c => c.status === 'published')
        .map(c => ({ ...c, _lessonCountLabel: tl.lessonCount(c.lesson_count || 0) }))
      const library = (lRes.status === 'fulfilled' && lRes.value.data && lRes.value.data.items) ? lRes.value.data.items : []
      const progressRows = (pRes.status === 'fulfilled' && pRes.value.data && pRes.value.data.progress) ? pRes.value.data.progress : []
      const completedIds = progressRows.map(p => p.lesson_id)
      this.setData({ trainingCourses: courses, trainingLibrary: library, trainingCompletedIds: completedIds })
    } catch (e) {
      wx.showToast({ title: this.data.t.training.loadError, icon: 'none' })
    } finally {
      this.setData({ trainingLoading: false })
    }
  },

  async trainingOpenCourse(e) {
    const course = e.currentTarget.dataset.course
    this.setData({ trainingCurrentCourse: course, trainingLessons: [], trainingView: 'lessons' })
    try {
      const res = await this._req(`${BASE}/api/academy/lessons?course_id=${course.id}`)
      const lessons = res.data && res.data.lessons ? res.data.lessons : []
      this.setData({ trainingLessons: lessons })
    } catch (e) {
      wx.showToast({ title: this.data.t.training.loadError, icon: 'none' })
    }
  },

  async trainingOpenLesson(e) {
    const lesson = e.currentTarget.dataset.lesson
    if (!lesson.oss_key) return
    this.setData({ trainingCurrentLesson: lesson, trainingVideoUrl: '', trainingView: 'player' })
    try {
      const res = await this._req(`${BASE}/api/oss/presign?action=get&key=${encodeURIComponent(lesson.oss_key)}`)
      const url = res.data && res.data.url ? res.data.url : ''
      this.setData({ trainingVideoUrl: url })
    } catch (e) {
      wx.showToast({ title: this.data.t.training.loadError, icon: 'none' })
    }
  },

  async trainingMarkComplete() {
    const lesson = this.data.trainingCurrentLesson
    if (!lesson) return
    const coachUserId = this._coachUserId
    if (this.data.trainingCompletedIds.includes(lesson.id)) return
    this.setData({ trainingMarkingComplete: true })
    try {
      await this._req(`${BASE}/api/academy/progress`, 'POST', { coach_user_id: coachUserId, lesson_id: lesson.id })
      const completedIds = [...this.data.trainingCompletedIds, lesson.id]
      this.setData({ trainingCompletedIds: completedIds })
      wx.showToast({ title: this.data.t.training.markedComplete, icon: 'success' })
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
      const content = res.data || ''
      this.setData({ trainingLibraryContent: content })
    } catch (e) {
      wx.showToast({ title: this.data.t.training.loadError, icon: 'none' })
    }
  },

  trainingBackToList() {
    this.setData({ trainingView: 'list', trainingCurrentCourse: null, trainingCurrentLesson: null, trainingVideoUrl: '' })
  },

  trainingBackToLessons() {
    this.setData({ trainingView: 'lessons', trainingCurrentLesson: null, trainingVideoUrl: '', trainingCurrentLibraryItem: null, trainingLibraryContent: '' })
  },

  // ─── CRM: Notes ────────────────────────────────────────────────────────────

  async _loadClientNotes() {
    const { detailClient } = this.data
    if (!detailClient || !this._coachId) return
    this.setData({ clientNotesLoading: true })
    try {
      const res = await this._req(`${BASE}/api/coach-notes?coach_id=${this._coachId}&user_id=${encodeURIComponent(detailClient.user_id)}`)
      this.setData({ clientNotes: res.data?.notes || [] })
    } catch (e) {
      wx.showToast({ title: this.data.t.networkError, icon: 'none' })
    } finally {
      this.setData({ clientNotesLoading: false })
    }
  },

  onNoteTextInput(e) { this.setData({ noteText: e.detail.value }) },

  async saveNote() {
    const { noteText, detailClient } = this.data
    if (!noteText.trim() || !this._coachId) return
    this.setData({ notesBusy: true })
    try {
      await this._req(`${BASE}/api/coach-notes`, 'POST', { coach_id: this._coachId, user_id: detailClient.user_id, content: noteText.trim() })
      this.setData({ noteText: '' })
      await this._loadClientNotes()
    } catch (e) {
      wx.showToast({ title: this.data.t.networkError, icon: 'none' })
    } finally {
      this.setData({ notesBusy: false })
    }
  },

  async toggleNotePin(e) {
    const note = e.currentTarget.dataset.note
    try {
      await this._req(`${BASE}/api/coach-notes/${note.id}`, 'PUT', { is_pinned: !note.is_pinned })
      await this._loadClientNotes()
    } catch (e) {}
  },

  async deleteNote(e) {
    const noteId = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除笔记', content: '确认删除此笔记？', success: async (res) => {
        if (!res.confirm) return
        try {
          await this._req(`${BASE}/api/coach-notes/${noteId}`, 'DELETE')
          await this._loadClientNotes()
        } catch (e) {}
      }
    })
  },

  // ─── CRM: Goals ─────────────────────────────────────────────────────────────

  async _loadClientGoals() {
    const { detailClient } = this.data
    if (!detailClient || !this._coachId) return
    this.setData({ clientGoalsLoading: true })
    try {
      const res = await this._req(`${BASE}/api/client-goals?coach_id=${this._coachId}&user_id=${encodeURIComponent(detailClient.user_id)}`)
      const goals = (res.data?.goals || []).map(g => ({
        ...g,
        _pct: g.baseline_value != null && g.target_value != null && g.current_value != null
          ? Math.min(100, Math.max(0, Math.round(
              g.goal_type === 'bio_age' || g.goal_type === 'sub_age'
                ? (g.baseline_value - g.current_value) / (g.baseline_value - g.target_value) * 100
                : (g.current_value - g.baseline_value) / (g.target_value - g.baseline_value) * 100
            )))
          : 0,
      }))
      this.setData({ clientGoals: goals })
    } catch (e) {
      wx.showToast({ title: this.data.t.networkError, icon: 'none' })
    } finally {
      this.setData({ clientGoalsLoading: false })
    }
  },

  openGoalForm() { this.setData({ goalFormOpen: true, goalType: 'bio_age', goalTargetValue: '', goalTargetDate: '' }) },
  closeGoalForm() { this.setData({ goalFormOpen: false }) },
  onGoalTypeChange(e) { this.setData({ goalType: e.detail.value }) },
  onGoalTargetInput(e) { this.setData({ goalTargetValue: e.detail.value }) },
  onGoalDateChange(e) { this.setData({ goalTargetDate: e.detail.value }) },

  async submitGoal() {
    const { goalType, goalTargetValue, goalTargetDate, detailClient, lang } = this.data
    if (!goalTargetValue || !this._coachId) return
    const t = T[lang]
    this.setData({ goalBusy: true })
    try {
      const baselineVal = goalType === 'bio_age' ? (detailClient.bio_age ? parseFloat(detailClient.bio_age) : null) : null
      await this._req(`${BASE}/api/client-goals`, 'POST', {
        coach_id: this._coachId,
        user_id: detailClient.user_id,
        goal_type: goalType,
        title_zh: t.goalTypes[goalType] || goalType,
        baseline_value: baselineVal,
        target_value: parseFloat(goalTargetValue),
        target_date: goalTargetDate || null,
      })
      this.setData({ goalFormOpen: false })
      await this._loadClientGoals()
    } catch (e) {
      wx.showToast({ title: this.data.t.networkError, icon: 'none' })
    } finally {
      this.setData({ goalBusy: false })
    }
  },

  // ─── CRM Tab ─────────────────────────────────────────────────────────────────

  async _loadCRM() {
    if (!this._coachId) return
    this.setData({ crmLoading: true })
    this._loadKPIs()
    try {
      const [actRes, apptRes] = await Promise.all([
        this._req(`${BASE}/api/coach-activity-feed?coach_id=${this._coachId}&limit=20`),
        this._req(`${BASE}/api/appointments/upcoming?coach_id=${this._coachId}`),
      ])
      const activityFeed = (actRes.data?.activities || []).map(a => ({
        ...a, _label: this.data.t.activityTypes[a.activity_type] || a.activity_type, _timeFmt: fmtTime(a.occurred_at),
      }))
      const upcomingAppts = (apptRes.data?.appointments || []).map(a => ({
        ...a, _timeFmt: fmtTime(a.scheduled_at),
      }))
      // Build pipeline columns from clients
      const stageOrder = ['lead', 'onboarding', 'active', 'at_risk', 'churned', 'graduated']
      const stageColorMap = { lead: '#f59e0b', onboarding: '#6375EC', active: '#10b981', at_risk: '#ef4444', churned: '#6b7280', graduated: '#0ea5e9' }
      const t = this.data.t
      const clientsByStage = {}
      for (const s of stageOrder) clientsByStage[s] = []
      for (const c of this.data.clients) {
        const stage = c.crm_stage || 'lead'
        if (clientsByStage[stage]) clientsByStage[stage].push(c)
      }
      const crmPipelineColumns = stageOrder.map(s => ({
        stage: s, label: t.crmStages[s] || s, color: stageColorMap[s], clients: clientsByStage[s],
      }))
      this.setData({ crmPipelineColumns, crmActivityFeed: activityFeed, crmUpcomingAppts: upcomingAppts })
    } catch (e) {
      wx.showToast({ title: this.data.t.networkError, icon: 'none' })
    } finally {
      this.setData({ crmLoading: false })
    }
  },

  openApptForm(e) {
    const client = e.currentTarget.dataset.client
    this.setData({ apptFormOpen: true, apptClientId: client ? client.user_id : '', apptClientName: client ? (client.nickname || '') : '', apptTitleText: '', apptDate: todayStr(), apptTime: '10:00', apptFormat: 'video', apptLink: '' })
  },
  closeApptForm() { this.setData({ apptFormOpen: false }) },
  onApptTitleInput(e) { this.setData({ apptTitleText: e.detail.value }) },
  onApptDateChange(e) { this.setData({ apptDate: e.detail.value }) },
  onApptTimeChange(e) { this.setData({ apptTime: e.detail.value }) },
  onApptFormatChange(e) { this.setData({ apptFormat: e.detail.value }) },
  onApptLinkInput(e) { this.setData({ apptLink: e.detail.value }) },

  async submitAppt() {
    const { apptClientId, apptTitleText, apptDate, apptTime, apptFormat, apptLink } = this.data
    if (!apptTitleText || !apptDate || !this._coachId) return
    this.setData({ apptBusy: true })
    try {
      const scheduled_at = `${apptDate}T${apptTime}:00`
      await this._req(`${BASE}/api/appointments`, 'POST', {
        coach_id: this._coachId, user_id: apptClientId, title: apptTitleText,
        scheduled_at, format: apptFormat, meeting_link: apptLink || null,
      })
      this.setData({ apptFormOpen: false })
      await this._loadCRM()
    } catch (e) {
      wx.showToast({ title: this.data.t.networkError, icon: 'none' })
    } finally {
      this.setData({ apptBusy: false })
    }
  },

  // ─── Performance Tab ─────────────────────────────────────────────────────────

  async _loadKPIs() {
    if (!this._coachId) return
    this.setData({ kpiLoading: true })
    try {
      const res = await this._req(`${BASE}/api/coach-kpis?coach_id=${this._coachId}`)
      const kpis = res.data?.kpis || null
      // Top improvers from client list (sorted by bio_age delta ascending = most improved)
      const topImprovers = [...this.data.clients]
        .filter(c => c._cAge && c.bio_age)
        .sort((a, b) => (a.bio_age - a._cAge) - (b.bio_age - b._cAge))
        .slice(0, 5)
        .map(c => ({ nickname: c.nickname, delta: Number((c.bio_age - c._cAge).toFixed(1)), _avatar: c._avatar }))
      this.setData({ kpiData: kpis, topImprovers })
    } catch (e) {
      wx.showToast({ title: this.data.t.networkError, icon: 'none' })
    } finally {
      this.setData({ kpiLoading: false })
    }
  },

  // ─────────────────────────────────────────────────────────────────────────────

  _req(url, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
      const opts = { url, method, header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.apiToken}` }, success: resolve, fail: reject }
      if (data) opts.data = data
      wx.request(opts)
    })
  },
})
