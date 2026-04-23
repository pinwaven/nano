const app = getApp()
const BASE = 'https://nano.fros.cc'

const T = {
  zh: {
    title: '超管面板',
    tabs: { channels: '渠道', users: '用户', coaches: '教练' },
    back: '返回', refresh: '刷新', loading: '加载中…',
    add: '添加', edit: '编辑', delete: '删除', save: '保存', cancel: '取消',
    saving: '保存中…', deleting: '删除中…',
    empty: { channels: '暂无渠道', users: '暂无用户', coaches: '暂无教练' },
    channel: {
      key: '标识', name: '名称', logo: 'Logo URL', users: '用户', coaches: '教练',
      addTitle: '添加渠道', editTitle: '编辑渠道',
      deleteWarning: '确认删除此渠道？所有关联用户和教练将失去渠道归属。',
    },
    user: {
      nickname: '昵称', channel: '渠道', roles: '角色', bioAge: '生物年龄',
      joined: '注册时间', noPermission: '无权限',
    },
    coach: {
      name: '姓名', channel: '渠道', linkedUser: '关联用户 ID', users: '客户数',
    },
    roles: {
      label: '角色管理',
      user: '用户', coach: '教练', admin: '渠道管理员', superadmin: '超级管理员',
      saveRoles: '保存角色',
    },
    error: { required: '此项为必填', saveFailed: '保存失败', networkError: '网络错误' },
  },
  en: {
    title: 'Super Admin',
    tabs: { channels: 'Channels', users: 'Users', coaches: 'Coaches' },
    back: 'Back', refresh: 'Refresh', loading: 'Loading…',
    add: 'Add', edit: 'Edit', delete: 'Delete', save: 'Save', cancel: 'Cancel',
    saving: 'Saving…', deleting: 'Deleting…',
    empty: { channels: 'No channels', users: 'No users', coaches: 'No coaches' },
    channel: {
      key: 'Key', name: 'Name', logo: 'Logo URL', users: 'Users', coaches: 'Coaches',
      addTitle: 'Add Channel', editTitle: 'Edit Channel',
      deleteWarning: 'Delete this channel? All linked users and coaches will lose their channel assignment.',
    },
    user: {
      nickname: 'Nickname', channel: 'Channel', roles: 'Roles', bioAge: 'Bio Age',
      joined: 'Joined', noPermission: 'No permission',
    },
    coach: {
      name: 'Name', channel: 'Channel', linkedUser: 'Linked User ID', users: 'Clients',
    },
    roles: {
      label: 'Role Management',
      user: 'User', coach: 'Coach', admin: 'Channel Admin', superadmin: 'Superadmin',
      saveRoles: 'Save Roles',
    },
    error: { required: 'Required', saveFailed: 'Save failed', networkError: 'Network error' },
  },
}

const ALL_ROLES = ['user', 'coach', 'admin', 'superadmin']

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
    tab: 'channels',
    loading: false,
    statusBarHeight: 0,
    channels: [],
    users: [],
    coaches: [],

    // Channel modal
    channelModalOpen: false,
    channelModalMode: '',
    channelModalTitle: '',
    channelModalBusy: false,
    channelModalError: '',
    channelForm: { key_name: '', name: '', logo_url: '' },
    editChannelId: null,

    // Roles modal
    rolesModalOpen: false,
    rolesTarget: null,
    rolesChecked: [],

    // Coaches modal
    coachModalOpen: false,
    coachModalMode: '',
    coachModalBusy: false,
    coachModalError: '',
    coachForm: { name: '', email: '', phone: '', language: 'zh', channel_id: '', user_id: '' },
    editCoachId: null,
    channelPickerOptions: [],
    channelPickerValues: [],
    channelPickerIdx: 0,
  },

  onLoad() {
    const user = app.globalData.user
    if (!user) { wx.reLaunch({ url: '/pages/login/login' }); return }
    const roles = user.roles || []
    if (!roles.includes('superadmin')) {
      wx.showToast({ title: T.zh.user.noPermission, icon: 'none' })
      wx.navigateBack()
      return
    }
    const { statusBarHeight = 0 } = wx.getSystemInfoSync()
    const lang = app.globalData.lang || 'zh'
    this.setData({ statusBarHeight, lang, t: T[lang] })
    this._loadAll()
  },

  async _loadAll() {
    this.setData({ loading: true })
    try {
      const [chRes, uRes, cRes] = await Promise.all([
        this._req(`${BASE}/api/channels`),
        this._req(`${BASE}/api/users`),
        this._req(`${BASE}/api/coach-list`),
      ])
      const lang = this.data.lang
      const channels = chRes.data?.channels || []
      const users = (uRes.data?.users || []).map(u => ({
        ...u,
        _joinedFmt: fmtDate(u.created_at),
        _rolesLabel: (u.roles || ['user']).join(', '),
        _avatar: (u.nickname || 'U')[0].toUpperCase(),
      }))
      const coaches = (cRes.data?.coaches || []).map(c => ({ ...c }))
      const channelMap = {}
      channels.forEach(c => { channelMap[c.id] = c.name })
      users.forEach(u => { u._channelName = channelMap[u.channel_id] || '—' })
      coaches.forEach(c => { c._channelName = channelMap[c.channel_id] || '—' })

      const channelPickerOptions = [lang === 'zh' ? '— 无渠道 —' : '— No Channel —', ...channels.map(c => c.name)]
      const channelPickerValues = ['', ...channels.map(c => String(c.id))]

      this.setData({ channels, users, coaches, channelPickerOptions, channelPickerValues })
    } catch (e) {
      wx.showToast({ title: T[this.data.lang].error.networkError, icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  handleRefresh() { this._loadAll() },
  handleBack() { wx.navigateBack() },
  noop() {},
  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }) },

  // ── Channel CRUD ────────────────────────────────────────────────────────────

  openAddChannel() {
    const t = T[this.data.lang]
    this.setData({
      channelModalOpen: true, channelModalMode: 'add', channelModalTitle: t.channel.addTitle,
      channelModalError: '', editChannelId: null,
      channelForm: { key_name: '', name: '', logo_url: '' },
    })
  },

  openEditChannel(e) {
    const c = e.currentTarget.dataset.channel
    const t = T[this.data.lang]
    this.setData({
      channelModalOpen: true, channelModalMode: 'edit', channelModalTitle: t.channel.editTitle,
      channelModalError: '', editChannelId: c.id,
      channelForm: { key_name: c.key_name || '', name: c.name || '', logo_url: c.logo_url || '' },
    })
  },

  closeChannelModal() {
    if (this.data.channelModalBusy) return
    this.setData({ channelModalOpen: false })
  },

  onChannelFormInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`channelForm.${key}`]: e.detail.value })
  },

  async saveChannel() {
    const { channelModalMode, channelForm, editChannelId, lang } = this.data
    const t = T[lang]
    if (!channelForm.key_name.trim() || !channelForm.name.trim()) {
      this.setData({ channelModalError: t.error.required })
      return
    }
    this.setData({ channelModalBusy: true, channelModalError: '' })
    try {
      const payload = { key_name: channelForm.key_name.trim(), name: channelForm.name.trim(), logo_url: channelForm.logo_url.trim() || null }
      if (channelModalMode === 'add') await this._req(`${BASE}/api/channels`, 'POST', payload)
      else await this._req(`${BASE}/api/channels/${editChannelId}`, 'PUT', { name: payload.name, logo_url: payload.logo_url })
      this.setData({ channelModalOpen: false })
      this._loadAll()
    } catch (e) {
      this.setData({ channelModalError: t.error.saveFailed })
    } finally {
      this.setData({ channelModalBusy: false })
    }
  },

  deleteChannel(e) {
    const channel = e.currentTarget.dataset.channel
    const { lang } = this.data
    const t = T[lang]
    wx.showModal({
      title: t.channel.deleteWarning.split('？')[0] + '？',
      content: t.channel.deleteWarning,
      confirmColor: '#ef4444',
      confirmText: t.delete,
      success: async (res) => {
        if (!res.confirm) return
        try {
          await this._req(`${BASE}/api/channels/${channel.id}`, 'DELETE')
          this._loadAll()
        } catch (e) { wx.showToast({ title: t.error.networkError, icon: 'none' }) }
      },
    })
  },

  // ── Roles management ────────────────────────────────────────────────────────

  openRoles(e) {
    const user = e.currentTarget.dataset.user
    const rolesChecked = ALL_ROLES.map(r => (user.roles || ['user']).includes(r))
    this.setData({ rolesModalOpen: true, rolesTarget: user, rolesChecked })
  },

  closeRolesModal() { this.setData({ rolesModalOpen: false, rolesTarget: null }) },

  toggleRole(e) {
    const idx = e.currentTarget.dataset.idx
    const rolesChecked = [...this.data.rolesChecked]
    rolesChecked[idx] = !rolesChecked[idx]
    // Always keep 'user' checked
    rolesChecked[0] = true
    this.setData({ rolesChecked })
  },

  async saveRoles() {
    const { rolesTarget, rolesChecked, lang } = this.data
    const roles = ALL_ROLES.filter((_, i) => rolesChecked[i])
    try {
      await this._req(`${BASE}/api/users/${rolesTarget.user_id}`, 'PUT', {
        nickname: rolesTarget.nickname,
        phone: rolesTarget.phone,
        email: rolesTarget.email,
        gender: rolesTarget.gender,
        birth_date: rolesTarget.birth_date,
        language: rolesTarget.language || 'zh',
        coach_id: rolesTarget.coach_id,
        channel_id: rolesTarget.channel_id,
        roles,
      })
      wx.showToast({ title: lang === 'zh' ? '已保存' : 'Saved', icon: 'success' })
      this.setData({ rolesModalOpen: false, rolesTarget: null })
      this._loadAll()
    } catch (e) {
      wx.showToast({ title: T[lang].error.saveFailed, icon: 'none' })
    }
  },

  // ── HTTP helper ─────────────────────────────────────────────────────────────

  _req(url, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
      const opts = { url, method, header: { 'Content-Type': 'application/json' }, success: resolve, fail: reject }
      if (data) opts.data = data
      wx.request(opts)
    })
  },
})
