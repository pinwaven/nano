const app = getApp()
const BASE = 'https://nano.fros.cc'

const T = {
  zh: {
    title: '教练面板',
    coachLabel: '教练',
    back: '返回',
    refresh: '刷新',
    loading: '加载中…',
    tabs: { clients: '我的客户', invites: '邀请码', earnings: '我的收益', questionnaires: '问卷' },
    lightMode: '浅色模式',
    darkMode: '深色模式',
    kinoSimMenu: 'Kino 模拟器',
    userPanelMenu: '我的健康',
    adminMenu: '渠道管理',
    superadminMenu: '超管面板',
    logout: '退出',
    noClients: '暂无分配的客户',
    bioAge: '生理年龄', chronoAge: '实际年龄',
    lastScan: '上次扫描',
    older: '岁↑', younger: '岁↓',
    openMessages: '发消息',
    detailTitle: '客户详情',
    noBmData: '暂无检测数据',
    noChatData: '暂无对话记录',
    tabHealth: '健康',
    tabChat: '聊天',
    tabMessages: '消息',
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
  },
  en: {
    title: 'Coach Panel',
    coachLabel: 'Coach',
    back: 'Back',
    refresh: 'Refresh',
    loading: 'Loading…',
    tabs: { clients: 'My Clients', invites: 'Invite Codes', earnings: 'My Earnings', questionnaires: 'Forms' },
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
    tabChat: 'Chat',
    tabMessages: 'Messages',
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
  },
}

const BM_META = [
  { key: 'hsCRP',     label: 'hsCRP',            unit: 'mg/L',      color: '#ef4444' },
  { key: 'GDF15',     label: 'GDF-15',           unit: 'pg/mL',     color: '#f97316' },
  { key: 'IL6',       label: 'IL-6',             unit: 'pg/mL',     color: '#a855f7' },
  { key: 'GA',        label: 'Glycated Albumin',  unit: '%',         color: '#6375EC' },
  { key: 'CystatinC', label: 'Cystatin C',        unit: 'mg/L',      color: '#0ea5e9' },
  { key: 'CD38',      label: 'CD38',             unit: 'xBaseline', color: '#10b981' },
]

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
    // Health tab
    detailBmList: [],
    detailBmLoading: false,
    detailSubAges: [],
    detailBioAgeTrend: [],
    // Unified chat tab (user + AI + coach)
    chatMessages: [],
    chatLoading: false,
    chatScrollId: '',
    // Compose
    msgText: '',
    msgBusy: false,
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
    this.setData({ statusBarHeight, capsuleRightPad, menuTop, channelName, channelLogo, nickname, isAdmin, isSuperadmin, theme, lang, t: T[lang], reminderDate: todayStr() })
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
        return {
          ...u,
          _cAge: cAge,
          _bioAgeColor: bioAgeColor(u.bio_age, cAge),
          _joinedFmt: fmtDate(u.created_at),
          _lastScanFmt: u.last_scan_at ? fmtDate(u.last_scan_at) : null,
          _avatar: (u.nickname || 'U')[0].toUpperCase(),
          _delta: delta,
          _deltaPos: delta !== null && delta > 0,
          _deltaLabel: delta !== null ? `${delta > 0 ? '+' : ''}${delta}` : null,
          _subAges,
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
  },
  handleBack() { wx.navigateBack() },
  noop() {},

  toggleMenu() { this.setData({ menuOpen: !this.data.menuOpen }) },
  closeMenu()  { this.setData({ menuOpen: false }) },

  toggleLang() {
    const lang = this.data.lang === 'zh' ? 'en' : 'zh'
    app.globalData.lang = lang
    this.setData({ lang, t: T[lang], menuOpen: false })
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
    wx.navigateTo({ url: '/pages/main/main?from=coach', animationType: 'slide-in-left', animationDuration: 280 })
  },

  openKinoSim() {
    this.setData({ menuOpen: false })
    wx.navigateTo({ url: '/pages/main/main?from=coach', animationType: 'slide-in-left', animationDuration: 280 })
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
    if (dx < -70 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      wx.navigateTo({ url: '/pages/main/main?from=coach', animationType: 'slide-in-left', animationDuration: 280 })
    }
  },

  // ── Client detail sheet ──────────────────────────────────────────────────

  async openClientDetail(e) {
    const client = e.currentTarget.dataset.client
    const initialTab = e.currentTarget.dataset.tab || 'health'
    const resolvedTab = initialTab === 'messages' ? 'chat' : initialTab
    this.setData({
      detailOpen: true, detailClient: client, detailTab: resolvedTab,
      detailBmList: [], detailBmLoading: true, detailSubAges: [], detailBioAgeTrend: [],
      chatMessages: [], chatLoading: false, chatScrollId: '',
      msgText: '',
    })
    // Load health data eagerly regardless of initial tab
    try {
      const res = await this._req(`${BASE}/api/biomarkers?openid=${encodeURIComponent(client.user_id)}`)
      const records = res.data?.records || []
      const kinoRecords = records.filter(r => r.test_type === 'kino_chip')
      const latest = kinoRecords.length > 0 ? kinoRecords[kinoRecords.length - 1] : null
      const estimated = latest?.data?.estimated || null
      const lang = this.data.lang

      const bmList = BM_META.map(({ key, label, unit, color }) => ({
        key, label, unit, color,
        value: estimated?.[key] != null ? estimated[key] : null,
      }))

      const subAgesRaw = latest?.data?.bioage_profile?.SubAges || null
      const detailSubAges = subAgesRaw
        ? SUB_AGE_META.map(m => ({
            key: m.key,
            label: lang === 'zh' ? m.labelZh : m.labelEn,
            color: m.color,
            value: subAgesRaw[m.key] != null ? Number(subAgesRaw[m.key]).toFixed(1) : null,
          }))
        : []

      const detailBioAgeTrend = kinoRecords.slice(-5).map(r => ({
        bioAge: r.bio_age != null ? Number(r.bio_age).toFixed(1) : null,
        date: fmtDate(r.tested_at || r.created_at),
      }))

      this.setData({ detailBmList: bmList, detailBmLoading: false, detailSubAges, detailBioAgeTrend })
    } catch {
      this.setData({ detailBmLoading: false })
    }

    if (resolvedTab === 'chat') this._loadClientChat()
  },

  closeClientDetail() {
    this.setData({ detailOpen: false, detailClient: null, chatMessages: [], msgText: '', chatScrollId: '' })
  },

  switchDetailTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ detailTab: tab })
    if (tab === 'chat' && this.data.chatMessages.length === 0) this._loadClientChat()
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

  _req(url, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
      const opts = { url, method, header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.apiToken}` }, success: resolve, fail: reject }
      if (data) opts.data = data
      wx.request(opts)
    })
  },
})
