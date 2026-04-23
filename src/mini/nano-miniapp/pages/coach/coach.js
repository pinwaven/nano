const app = getApp()
const BASE = 'https://nano.fros.cc'

const T = {
  zh: {
    title: '教练面板',
    back: '返回',
    refresh: '刷新',
    loading: '加载中…',
    clients: '我的客户',
    noClients: '暂无分配的客户',
    bioAge: '生物年龄', chronoAge: '实际年龄', unknown: '未知',
    sendInstruction: '发送指令',
    instructionPh: '输入健康指令，发送给客户…',
    send: '发送',
    sending: '发送中…',
    sent: '已发送！',
    sendError: '发送失败，请重试',
    detailTitle: '客户详情',
    biomarkers: '最新生物标志物',
    noBmData: '暂无检测数据',
    networkError: '网络错误',
    joined: '注册时间',
    noPermission: '无权限',
  },
  en: {
    title: 'Coach Panel',
    back: 'Back',
    refresh: 'Refresh',
    loading: 'Loading…',
    clients: 'My Clients',
    noClients: 'No clients assigned yet',
    bioAge: 'Bio Age', chronoAge: 'Chrono Age', unknown: 'Unknown',
    sendInstruction: 'Send Instruction',
    instructionPh: 'Enter a health instruction for your client…',
    send: 'Send',
    sending: 'Sending…',
    sent: 'Sent!',
    sendError: 'Send failed, please retry',
    detailTitle: 'Client Detail',
    biomarkers: 'Latest Biomarkers',
    noBmData: 'No biomarker data yet.',
    networkError: 'Network error',
    joined: 'Joined',
    noPermission: 'No permission',
  },
}

const BM_META = [
  { key: 'hsCRP',     label: 'hsCRP',           unit: 'mg/L',      color: '#ef4444' },
  { key: 'GDF15',     label: 'GDF-15',          unit: 'pg/mL',     color: '#f97316' },
  { key: 'IL6',       label: 'IL-6',            unit: 'pg/mL',     color: '#a855f7' },
  { key: 'GA',        label: 'Glycated Albumin', unit: '%',         color: '#6375EC' },
  { key: 'CystatinC', label: 'Cystatin C',      unit: 'mg/L',      color: '#0ea5e9' },
  { key: 'CD38',      label: 'CD38',            unit: 'xBaseline', color: '#10b981' },
]

function bioAgeColor(bio, chrono) {
  if (!bio || !chrono) return '#A6C4E5'
  return Number(bio) <= Number(chrono) ? '#10b981' : '#ef4444'
}

function chronoAge(birthDate) {
  if (!birthDate) return null
  return Math.floor((Date.now() - new Date(birthDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
}

function fmtDate(d) {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return String(d)
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

Page({
  data: {
    lang: 'zh',
    t: T.zh,
    loading: false,
    statusBarHeight: 0,
    clients: [],
    detailOpen: false,
    detailClient: null,
    detailBmList: [],
    detailBmLoading: false,
    instructionOpen: false,
    instructionTarget: null,
    instructionText: '',
    instructionBusy: false,
  },

  _coachId: null,

  onLoad() {
    const user = app.globalData.user
    if (!user) { wx.reLaunch({ url: '/pages/login/login' }); return }
    const roles = user.roles || []
    if (!roles.includes('coach') && !roles.includes('admin') && !roles.includes('superadmin')) {
      wx.showToast({ title: T.zh.noPermission, icon: 'none' })
      wx.navigateBack()
      return
    }
    const coach = app.globalData.coach
    this._coachId = coach ? coach.id : null
    const { statusBarHeight = 0 } = wx.getSystemInfoSync()
    const lang = app.globalData.lang || 'zh'
    this.setData({ statusBarHeight, lang, t: T[lang] })
    if (this._coachId) this._loadClients()
  },

  async _loadClients() {
    this.setData({ loading: true })
    try {
      const res = await this._req(`${BASE}/api/coach-users/${this._coachId}`)
      const lang = this.data.lang
      const clients = (res.data?.users || []).map(u => ({
        ...u,
        _cAge: chronoAge(u.birth_date),
        _bioAgeColor: bioAgeColor(u.bio_age, chronoAge(u.birth_date)),
        _joinedFmt: fmtDate(u.created_at),
        _avatar: (u.nickname || 'U')[0].toUpperCase(),
      }))
      this.setData({ clients })
    } catch (e) {
      wx.showToast({ title: T[this.data.lang].networkError, icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  handleRefresh() { if (this._coachId) this._loadClients() },

  handleBack() { wx.navigateBack() },

  noop() {},

  async openClientDetail(e) {
    const client = e.currentTarget.dataset.client
    this.setData({ detailOpen: true, detailClient: client, detailBmList: [], detailBmLoading: true })
    try {
      const res = await this._req(`${BASE}/api/biomarkers?openid=${encodeURIComponent(client.user_id)}`)
      const records = res.data?.records || []
      const kinoRecords = records.filter(r => r.test_type === 'kino_chip')
      const latest = kinoRecords.length > 0 ? kinoRecords[kinoRecords.length - 1] : null
      const estimated = latest?.data?.estimated || null
      const bmList = BM_META.map(({ key, label, unit, color }) => ({
        key, label, unit, color,
        value: estimated?.[key] != null ? estimated[key] : null,
      }))
      this.setData({ detailBmList: bmList, detailBmLoading: false })
    } catch (e) {
      this.setData({ detailBmLoading: false })
    }
  },

  closeClientDetail() { this.setData({ detailOpen: false, detailClient: null }) },

  openInstruction(e) {
    const client = e.currentTarget.dataset.client
    this.setData({ instructionOpen: true, instructionTarget: client, instructionText: '', instructionBusy: false })
  },

  closeInstruction() {
    if (this.data.instructionBusy) return
    this.setData({ instructionOpen: false, instructionTarget: null })
  },

  onInstructionInput(e) { this.setData({ instructionText: e.detail.value }) },

  async sendInstruction() {
    const { instructionTarget, instructionText, lang } = this.data
    if (!instructionText.trim()) return
    this.setData({ instructionBusy: true })
    try {
      await this._req(`${BASE}/api/coach-instruction`, 'POST', {
        openid: instructionTarget.user_id,
        instruction: instructionText.trim(),
      })
      wx.showToast({ title: T[lang].sent, icon: 'success' })
      this.setData({ instructionOpen: false, instructionTarget: null })
    } catch (e) {
      wx.showToast({ title: T[lang].sendError, icon: 'none' })
    } finally {
      this.setData({ instructionBusy: false })
    }
  },

  _req(url, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
      const opts = { url, method, header: { 'Content-Type': 'application/json' }, success: resolve, fail: reject }
      if (data) opts.data = data
      wx.request(opts)
    })
  },
})
