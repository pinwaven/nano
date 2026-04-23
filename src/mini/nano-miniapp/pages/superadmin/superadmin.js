const app = getApp()
const BASE = 'https://nano.fros.cc'

const T = {
  zh: {
    title: '超管面板',
    tabs: { channels: '渠道', users: '用户', coaches: '教练', dots: '原粒' },
    back: '返回', refresh: '刷新', loading: '加载中…',
    add: '添加', edit: '编辑', delete: '删除', save: '保存', cancel: '取消',
    saving: '保存中…', deleting: '删除中…',
    empty: { channels: '暂无渠道', users: '暂无用户', coaches: '暂无教练', dots: '暂无原粒' },
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
    dot: {
      key: '标识', nameEn: '名称 (英)', nameZh: '名称 (中)', color: '颜色 (英)', colorZh: '颜色 (中)',
      type: '类型', desc: '描述', isolate: '单体', blend: '复合',
      ingrEn: '成分 (英)', ingrZh: '成分 (中)',
      ingrName: '成分名称', ingrMg: 'mg', addIngr: '+ 添加成分',
      addTitle: '添加原粒', editTitle: '编辑原粒',
      deleteWarning: '确认删除此原粒？此操作不可撤销。',
    },
    roles: {
      label: '角色管理',
      user: '用户', coach: '教练', admin: '渠道管理员', superadmin: '超级管理员',
      saveRoles: '保存角色',
    },
    typeOptions: ['复合', '单体'],
    typeValues: [false, true],
    error: { required: '此项为必填', saveFailed: '保存失败', networkError: '网络错误' },
  },
  en: {
    title: 'Super Admin',
    tabs: { channels: 'Channels', users: 'Users', coaches: 'Coaches', dots: 'Dots' },
    back: 'Back', refresh: 'Refresh', loading: 'Loading…',
    add: 'Add', edit: 'Edit', delete: 'Delete', save: 'Save', cancel: 'Cancel',
    saving: 'Saving…', deleting: 'Deleting…',
    empty: { channels: 'No channels', users: 'No users', coaches: 'No coaches', dots: 'No dots' },
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
    dot: {
      key: 'Key', nameEn: 'Name (EN)', nameZh: 'Name (ZH)', color: 'Color (EN)', colorZh: 'Color (ZH)',
      type: 'Type', desc: 'Description', isolate: 'Isolate', blend: 'Blend',
      ingrEn: 'Ingredients (EN)', ingrZh: 'Ingredients (ZH)',
      ingrName: 'Name', ingrMg: 'mg', addIngr: '+ Add Ingredient',
      addTitle: 'Add Dot', editTitle: 'Edit Dot',
      deleteWarning: 'Delete this dot? This cannot be undone.',
    },
    roles: {
      label: 'Role Management',
      user: 'User', coach: 'Coach', admin: 'Channel Admin', superadmin: 'Superadmin',
      saveRoles: 'Save Roles',
    },
    typeOptions: ['Blend', 'Isolate'],
    typeValues: [false, true],
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

function ingrToArr(arr) {
  if (!arr || !Array.isArray(arr)) return []
  return arr.map(item => ({ name: item.name || '', mg: item.mg != null ? String(item.mg) : '' }))
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
    dots: [],

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

    // Dot modal
    dotModalOpen: false,
    dotModalMode: '',
    dotModalTitle: '',
    dotModalBusy: false,
    dotModalError: '',
    dotForm: { key_name: '', name_en: '', name_zh: '', color: '', color_zh: '', description: '', is_isolate: false },
    editDotId: null,
    formIngredients: [],
    formIngredientsZh: [],
    formTypeIdx: 0,

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
      const [chRes, uRes, cRes, dRes] = await Promise.all([
        this._req(`${BASE}/api/channels`),
        this._req(`${BASE}/api/users`),
        this._req(`${BASE}/api/coach-list`),
        this._req(`${BASE}/api/dots-inventory`),
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

      this.setData({ channels, users, coaches, dots: dRes.data?.dots || [], channelPickerOptions, channelPickerValues })
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

  // ── Dots CRUD ────────────────────────────────────────────────────────────────

  openAddDot() {
    const t = T[this.data.lang]
    this.setData({
      dotModalOpen: true, dotModalMode: 'add', dotModalTitle: t.dot.addTitle,
      dotModalError: '', editDotId: null,
      dotForm: { key_name: '', name_en: '', name_zh: '', color: '', color_zh: '', description: '', is_isolate: false },
      formTypeIdx: 0, formIngredients: [], formIngredientsZh: [],
    })
  },

  openEditDot(e) {
    const d = e.currentTarget.dataset.dot
    const { lang } = this.data
    const t = T[lang]
    const typeIdx = t.typeValues.indexOf(!!d.is_isolate)
    this.setData({
      dotModalOpen: true, dotModalMode: 'edit', dotModalTitle: t.dot.editTitle,
      dotModalError: '', editDotId: d.id,
      dotForm: { key_name: d.key_name || '', name_en: d.name || '', name_zh: d.name_zh || '', color: d.color || '', color_zh: d.color_zh || '', description: d.description || '', is_isolate: !!d.is_isolate },
      formTypeIdx: typeIdx >= 0 ? typeIdx : 0,
      formIngredients: ingrToArr(d.ingredients),
      formIngredientsZh: ingrToArr(d.ingredients_zh),
    })
  },

  closeDotModal() {
    if (this.data.dotModalBusy) return
    this.setData({ dotModalOpen: false })
  },

  onDotFormInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`dotForm.${key}`]: e.detail.value })
  },

  onPickerType(e) {
    const { lang } = this.data
    const idx = Number(e.detail.value)
    this.setData({ formTypeIdx: idx, 'dotForm.is_isolate': T[lang].typeValues[idx] })
  },

  addIngredient(e) {
    const isZh = e.currentTarget.dataset.zh
    const key = isZh ? 'formIngredientsZh' : 'formIngredients'
    this.setData({ [key]: [...this.data[key], { name: '', mg: '' }] })
  },

  removeIngredient(e) {
    const { zh, idx } = e.currentTarget.dataset
    const key = zh ? 'formIngredientsZh' : 'formIngredients'
    const arr = [...this.data[key]]
    arr.splice(idx, 1)
    this.setData({ [key]: arr })
  },

  onIngredientInput(e) {
    const { zh, idx, field } = e.currentTarget.dataset
    const key = zh ? 'formIngredientsZh' : 'formIngredients'
    this.setData({ [`${key}[${idx}].${field}`]: e.detail.value })
  },

  async saveDot() {
    const { dotModalMode, dotForm, editDotId, lang } = this.data
    const t = T[lang]
    if (!dotForm.key_name.trim() || !dotForm.name_en.trim()) {
      this.setData({ dotModalError: t.error.required })
      return
    }
    this.setData({ dotModalBusy: true, dotModalError: '' })
    try {
      const ingredients = this.data.formIngredients
        .filter(r => r.name.trim())
        .map(r => ({ name: r.name.trim(), mg: r.mg !== '' ? Number(r.mg) : 0 }))
      const ingredients_zh = this.data.formIngredientsZh
        .filter(r => r.name.trim())
        .map(r => ({ name: r.name.trim(), mg: r.mg !== '' ? Number(r.mg) : 0 }))
      const payload = {
        key_name: dotForm.key_name, name: dotForm.name_en, name_zh: dotForm.name_zh,
        color: dotForm.color, color_zh: dotForm.color_zh, description: dotForm.description,
        is_isolate: dotForm.is_isolate, ingredients, ingredients_zh,
      }
      if (dotModalMode === 'add') await this._req(`${BASE}/api/dots`, 'POST', payload)
      else await this._req(`${BASE}/api/dots/${editDotId}`, 'PUT', payload)
      this.setData({ dotModalOpen: false })
      this._loadAll()
    } catch (e) {
      this.setData({ dotModalError: t.error.saveFailed })
    } finally {
      this.setData({ dotModalBusy: false })
    }
  },

  handleDeleteDot(e) {
    const dot = e.currentTarget.dataset.dot
    const { lang } = this.data
    const t = T[lang]
    wx.showModal({
      title: t.dot.deleteWarning.split('？')[0] + '？',
      content: t.dot.deleteWarning,
      confirmColor: '#ef4444',
      confirmText: t.delete,
      success: async (res) => {
        if (!res.confirm) return
        try {
          await this._req(`${BASE}/api/dots/${dot.id}`, 'DELETE')
          this._loadAll()
        } catch (e) { wx.showToast({ title: t.error.networkError, icon: 'none' }) }
      },
    })
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
