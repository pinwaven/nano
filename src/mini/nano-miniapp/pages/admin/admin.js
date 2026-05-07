const app = getApp()
const { BASE } = require('../../utils/config.js')

const T = {
  zh: {
    title: 'Nano 管理',
    tabs: { users: '用户', coaches: '教练', store: '商城', invites: '邀请', rewards: '奖励' },
    refresh: '刷新', loading: '加载中…', back: '返回',
    add: '添加', edit: '编辑', delete: '删除', save: '保存', cancel: '取消',
    saving: '保存中…', deleting: '删除中…',
    empty: { users: '暂无用户', coaches: '暂无教练', items: '暂无商品', orders: '暂无订单', invites: '暂无邀请码' },
    invite: {
      generate: '生成邀请码', deactivate: '停用', copy: '复制链接',
      uses: '已使用', active: '有效', inactive: '已停用',
      deactivateWarning: '停用此邀请码？已复制的链接将失效。',
      copied: '链接已复制',
    },
    stats: {
      totalUsers: '总用户', tested: '已检测', avgBioAge: '平均生理年龄', coaches: '教练数',
      totalCoaches: '教练总数', assigned: '已分配', unassigned: '未分配',
      totalItems: '商品', active: '上架中', totalOrders: '订单', pending: '待处理',
    },
    user: {
      nickname: '昵称', gender: '性别', birthDate: '出生日期', language: '语言',
      coach: '负责教练', phone: '电话', email: '邮箱', externalId: '外部 ID',
      externalApp: '外部应用', bioAge: '生理年龄', chronoAge: '实际年龄',
      joined: '注册时间', unassigned: '未分配',
      male: '男', female: '女', unknown: '未知',
      addTitle: '添加用户', editTitle: '编辑用户',
      deleteWarning: '确认删除此用户？将同时删除其所有检测记录和通知。',
      deleteRolesError: '无法删除：该用户拥有附加角色，请先在超管面板移除所有附加角色后再删除。',
    },
    coach: {
      selectUser: '选择用户 *', users: '用户数',
      joined: '注册时间', addTitle: '添加教练', editTitle: '编辑教练',
      deleteWarning: '确认删除此教练？其名下用户将变为未分配状态。',
    },
    store: {
      itemsTab: '商品', ordersTab: '订单',
      key: '标识', nameEn: '名称 (英)', nameZh: '名称 (中)', priceCny: '售价 CNY',
      priceUsd: '售价 USD', tag: '标签', isActive: '上架', unit: '单位 (英)', unitZh: '单位 (中)',
      descEn: '描述 (英)', descZh: '描述 (中)', sortOrder: '排序',
      noTag: '无标签', bestseller: '热销', value: '超值', yes: '是', no: '否',
      addTitle: '添加商品', editTitle: '编辑商品',
      deleteWarning: '确认删除此商品？此操作不可撤销。',
      orderId: '订单 ID', customer: '用户', item: '商品', qty: '数量', price: '金额', status: '状态', date: '日期',
      pending: '待处理', confirmed: '已确认', shipped: '已发货', delivered: '已送达', cancelled: '已取消',
    },
    detail: {
      profile: '用户档案', biomarkers: '最新生物标志物', noData: '暂无检测数据',
    },
    langOptions: ['中文 (ZH)', '英文 (EN)'],
    langValues: ['zh', 'en'],
    appOptions: ['WeChat', 'WhatsApp', 'Waven App'],
    appValues: ['wechat', 'whatsapp', 'wavenapp'],
    genderOptions: ['—', '男', '女'],
    genderValues: ['', 'male', 'female'],
    tagOptions: ['无标签', '热销', '超值'],
    tagValues: ['', 'bestseller', 'value'],
    activeOptions: ['上架', '下架'],
    activeValues: [true, false],
    orderStatuses: ['待处理', '已确认', '已发货', '已送达', '已取消'],
    orderStatusValues: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'],
    error: { required: '此项为必填', saveFailed: '保存失败，请重试', networkError: '网络错误' },
    rewards: {
      thisMonth: '本月渠道收益', coachBreakdown: 'Coach 佣金明细',
      coachName: 'Coach', thisMonthCol: '本月', pendingCol: '待结算',
      pendingPayouts: '待审批结算单', period: '周期', amount: '金额',
      approve: '审批通过', markTransferred: '标记已转账',
      draft: '待审批', approved: '已审批', transferred: '已转账',
      generatePayouts: '生成 Coach 结算单', generating: '生成中…', noBreakdown: '暂无数据', noPayouts: '暂无结算单',
    },
  },
  en: {
    title: 'Nano Admin',
    tabs: { users: 'Users', coaches: 'Coaches', store: 'Store', invites: 'Invites', rewards: 'Rewards' },
    refresh: 'Refresh', loading: 'Loading…', back: 'Back',
    add: 'Add', edit: 'Edit', delete: 'Delete', save: 'Save', cancel: 'Cancel',
    saving: 'Saving…', deleting: 'Deleting…',
    empty: { users: 'No users', coaches: 'No coaches', items: 'No items', orders: 'No orders', invites: 'No invite codes' },
    invite: {
      generate: 'Generate Code', deactivate: 'Deactivate', copy: 'Copy Link',
      uses: 'Uses', active: 'Active', inactive: 'Inactive',
      deactivateWarning: 'Deactivate this invite code? Shared links will stop working.',
      copied: 'Link copied',
    },
    stats: {
      totalUsers: 'Users', tested: 'Tested', avgBioAge: 'Avg Bio Age', coaches: 'Coaches',
      totalCoaches: 'Coaches', assigned: 'Assigned', unassigned: 'Unassigned',
      totalItems: 'Items', active: 'Active', totalOrders: 'Orders', pending: 'Pending',
    },
    user: {
      nickname: 'Nickname', gender: 'Gender', birthDate: 'Birth Date', language: 'Language',
      coach: 'Coach', phone: 'Phone', email: 'Email', externalId: 'External ID',
      externalApp: 'External App', bioAge: 'Bio Age', chronoAge: 'Chrono Age',
      joined: 'Joined', unassigned: 'Unassigned',
      male: 'Male', female: 'Female', unknown: 'Unknown',
      addTitle: 'Add User', editTitle: 'Edit User',
      deleteWarning: 'Delete this user? All their biomarkers, scans and notifications will also be removed.',
      deleteRolesError: 'Cannot delete: user has elevated roles. Remove all extra roles in the Super Admin panel first.',
    },
    coach: {
      selectUser: 'Select User *', users: 'Users',
      joined: 'Joined', addTitle: 'Add Coach', editTitle: 'Edit Coach',
      deleteWarning: 'Delete this coach? Their assigned users will become unassigned.',
    },
    store: {
      itemsTab: 'Items', ordersTab: 'Orders',
      key: 'Key', nameEn: 'Name (EN)', nameZh: 'Name (ZH)', priceCny: 'Price CNY',
      priceUsd: 'Price USD', tag: 'Tag', isActive: 'Active', unit: 'Unit (EN)', unitZh: 'Unit (ZH)',
      descEn: 'Desc (EN)', descZh: 'Desc (ZH)', sortOrder: 'Sort',
      noTag: 'No tag', bestseller: 'Best Seller', value: 'Value Pack', yes: 'Yes', no: 'No',
      addTitle: 'Add Item', editTitle: 'Edit Item',
      deleteWarning: 'Delete this item? This cannot be undone.',
      orderId: 'Order ID', customer: 'Customer', item: 'Item', qty: 'Qty', price: 'Price', status: 'Status', date: 'Date',
      pending: 'Pending', confirmed: 'Confirmed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled',
    },
    detail: {
      profile: 'Profile', biomarkers: 'Latest Biomarkers', noData: 'No biomarker data yet.',
    },
    langOptions: ['Chinese (ZH)', 'English (EN)'],
    langValues: ['zh', 'en'],
    appOptions: ['WeChat', 'WhatsApp', 'Waven App'],
    appValues: ['wechat', 'whatsapp', 'wavenapp'],
    genderOptions: ['—', 'Male', 'Female'],
    genderValues: ['', 'male', 'female'],
    tagOptions: ['No tag', 'Best Seller', 'Value Pack'],
    tagValues: ['', 'bestseller', 'value'],
    activeOptions: ['Active', 'Inactive'],
    activeValues: [true, false],
    orderStatuses: ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'],
    orderStatusValues: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'],
    error: { required: 'This field is required', saveFailed: 'Save failed, please retry', networkError: 'Network error' },
    rewards: {
      thisMonth: 'Channel Earnings (This Month)', coachBreakdown: 'Coach Breakdown',
      coachName: 'Coach', thisMonthCol: 'This Month', pendingCol: 'Pending',
      pendingPayouts: 'Pending Payouts', period: 'Period', amount: 'Amount',
      approve: 'Approve', markTransferred: 'Mark Transferred',
      draft: 'Pending Approval', approved: 'Approved', transferred: 'Transferred',
      generatePayouts: 'Generate Coach Payouts', generating: 'Generating…', noBreakdown: 'No data', noPayouts: 'No payouts',
    },
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

function fmtDate(d, lang) {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return String(d)
  const y = date.getFullYear(), m = date.getMonth() + 1, day = date.getDate()
  return lang === 'zh' ? `${y}/${m}/${day}` : `${m}/${day}/${y}`
}

function chronoAge(birthDate) {
  if (!birthDate) return null
  return Math.floor((Date.now() - new Date(birthDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
}

Page({
  data: {
    lang: 'zh',
    t: T.zh,
    tab: 'users',
    loading: false,
    statusBarHeight: 0,

    users: [], coaches: [], storeItems: [], orders: [], invites: [],
    storeSubTab: 'items',

    // Rewards tab
    rewardsLoading: false,
    rewardsThisMonth: null,
    rewardsCoachBreakdown: [],
    rewardsPendingPayouts: [],
    rewardsGenerating: false,

    // User detail overlay
    detailOpen: false,
    detailUser: null,
    detailBmList: [],
    detailBmLoading: false,

    // Modal (add / edit)
    modalOpen: false,
    modalType: '',
    modalMode: '',
    modalTitle: '',
    modalBusy: false,
    modalError: '',

    // Form fields — all types share this flat object
    form: {
      // user
      external_id: '', external_app: 'wechat', nickname: '', gender: '',
      birth_date: '', language: 'zh', coach_id: '', phone: '', email: '',
      // coach
      user_id: '',
      // dot
      key_name: '', name_en: '', name_zh: '', color: '', color_zh: '',
      description: '', is_isolate: false,
      // store item
      name_en: '', name_zh: '', desc_en: '', desc_zh: '',
      unit_en: '', unit_zh: '', price_cny: '', price_usd: '',
      tag: '', sort_order: 0, active: true,
    },
    editTargetId: null,

    // Picker indices
    formLangIdx: 0,
    formAppIdx: 0,
    formGenderIdx: 0,
    formCoachIdx: 0,
    formTagIdx: 0,
    formActiveIdx: 0,
    coachPickerOptions: [],
    coachPickerValues: [],
    coachUserPickerOptions: [],
    coachUserPickerValues: [],
    coachUserPickerIdx: 0,
  },

  _channelId: null,

  onLoad() {
    const user = app.globalData.user
    if (!user) { wx.reLaunch({ url: '/pages/login/login' }); return }
    const roles = user.roles || []
    if (!roles.includes('admin') && !roles.includes('superadmin')) {
      wx.showToast({ title: '无权限', icon: 'none' })
      wx.navigateBack()
      return
    }
    const { statusBarHeight = 0 } = wx.getSystemInfoSync()
    const lang = app.globalData.lang || 'zh'
    this._channelId = user.channel_id || null
    this.setData({ statusBarHeight, lang, t: T[lang] })
    this._loadAll()
  },

  // ── Data loading ──────────────────────────────────────────────────────────────

  async _loadAll() {
    this.setData({ loading: true })
    try {
      const cid = this._channelId
      const [uRes, cRes, sRes, oRes, iRes] = await Promise.all([
        cid ? this._req(`${BASE}/api/channel-users/${cid}`) : this._req(`${BASE}/api/users`),
        cid ? this._req(`${BASE}/api/channel-coaches/${cid}`) : this._req(`${BASE}/api/coach-list`),
        this._req(`${BASE}/api/store-items?all=true`),
        this._req(`${BASE}/api/orders`),
        cid ? this._req(`${BASE}/api/invitations?channel_id=${cid}`) : this._req(`${BASE}/api/invitations`),
      ])
      const lang = this.data.lang
      const users = (uRes.data?.users || []).map(u => ({
        ...u,
        _cAge: chronoAge(u.birth_date),
        _bioAgeColor: bioAgeColor(u.bio_age, chronoAge(u.birth_date)),
        _joinedFmt: fmtDate(u.created_at, lang),
        _avatar: (u.nickname || 'U')[0].toUpperCase(),
      }))
      const coaches = cRes.data?.coaches || []
      this.setData({
        users,
        coaches,
        invites: iRes.data?.invitations || [],
        storeItems: sRes.data?.items || [],
        orders: (oRes.data?.orders || []).map(o => ({
          ...o,
          _shortId: (o.id || '').slice(0, 8),
          _dateFmt: fmtDate(o.created_at, lang),
        })),
      })
    } catch (e) {
      wx.showToast({ title: T[this.data.lang].error.networkError, icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  handleRefresh() {
    this._loadAll()
    if (this.data.tab === 'rewards') this._loadRewards()
  },

  handleBack() { wx.navigateBack() },

  // ── Tabs ──────────────────────────────────────────────────────────────────────

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ tab })
    if (tab === 'rewards' && this.data.rewardsThisMonth === null) this._loadRewards()
  },

  switchStoreTab(e) { this.setData({ storeSubTab: e.currentTarget.dataset.tab }) },

  // ── User detail ───────────────────────────────────────────────────────────────

  async openUserDetail(e) {
    const user = e.currentTarget.dataset.user
    this.setData({ detailOpen: true, detailUser: user, detailBmList: [], detailBmLoading: true })
    try {
      const res = await this._req(`${BASE}/api/biomarkers?openid=${encodeURIComponent(user.user_id)}`)
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

  closeUserDetail() { this.setData({ detailOpen: false, detailUser: null }) },

  // ── Modal open helpers ────────────────────────────────────────────────────────

  _buildCoachPicker() {
    const { coaches, lang } = this.data
    const t = T[lang]
    return {
      coachPickerOptions: [t.user.unassigned, ...coaches.map(c => c.name)],
      coachPickerValues: ['', ...coaches.map(c => String(c.id))],
    }
  },

  noop() {},

  openAddUser() {
    const { lang } = this.data
    const t = T[lang]
    const cp = this._buildCoachPicker()
    this.setData({
      modalOpen: true, modalType: 'user', modalMode: 'add', modalTitle: t.user.addTitle, modalError: '', editTargetId: null,
      form: { external_id: '', external_app: 'wechat', nickname: '', gender: '', birth_date: '', language: 'zh', coach_id: '', phone: '', email: '' },
      formLangIdx: 0, formAppIdx: 0, formGenderIdx: 0, formCoachIdx: 0,
      ...cp,
    })
  },

  openEditUser(e) {
    const u = e.currentTarget.dataset.user
    const { coaches, lang } = this.data
    const cp = this._buildCoachPicker()
    const langIdx = T[lang].langValues.indexOf(u.language || 'zh')
    const genderIdx = T[lang].genderValues.indexOf(u.gender || '')
    const coachIdx = cp.coachPickerValues.indexOf(String(u.coach_id || ''))
    this.setData({
      modalOpen: true, modalType: 'user', modalMode: 'edit', modalTitle: T[lang].user.editTitle, modalError: '', editTargetId: u.user_id,
      form: { external_id: u.external_id || '', external_app: u.external_app || 'wechat', nickname: u.nickname || '', gender: u.gender || '', birth_date: u.birth_date ? u.birth_date.slice(0, 10) : '', language: u.language || 'zh', coach_id: String(u.coach_id || ''), phone: u.phone || '', email: u.email || '' },
      formLangIdx: langIdx >= 0 ? langIdx : 0,
      formAppIdx: T[lang].appValues.indexOf(u.external_app || 'wechat') >= 0 ? T[lang].appValues.indexOf(u.external_app || 'wechat') : 0,
      formGenderIdx: genderIdx >= 0 ? genderIdx : 0,
      formCoachIdx: coachIdx >= 0 ? coachIdx : 0,
      ...cp,
    })
  },

  openAddCoach() {
    const { lang, users } = this.data
    const userOptions = users.map(u => (u.nickname || u.user_id) + ' (' + u.user_id + ')')
    const userValues = users.map(u => u.user_id)
    this.setData({
      modalOpen: true, modalType: 'coach', modalMode: 'add', modalTitle: T[lang].coach.addTitle, modalError: '', editTargetId: null,
      form: { user_id: '' },
      coachUserPickerOptions: userOptions,
      coachUserPickerValues: userValues,
      coachUserPickerIdx: -1,
    })
  },

  openEditCoach(e) {
    const c = e.currentTarget.dataset.coach
    const { lang, users } = this.data
    const userOptions = users.map(u => (u.nickname || u.user_id) + ' (' + u.user_id + ')')
    const userValues = users.map(u => u.user_id)
    const idx = userValues.indexOf(c.user_id || '')
    this.setData({
      modalOpen: true, modalType: 'coach', modalMode: 'edit', modalTitle: T[lang].coach.editTitle, modalError: '', editTargetId: c.id,
      form: { user_id: c.user_id || '' },
      coachUserPickerOptions: userOptions,
      coachUserPickerValues: userValues,
      coachUserPickerIdx: idx >= 0 ? idx : 0,
    })
  },

  onPickerCoachUser(e) {
    const idx = parseInt(e.detail.value)
    const { coachUserPickerValues } = this.data
    this.setData({ coachUserPickerIdx: idx, 'form.user_id': coachUserPickerValues[idx] || '' })
  },

  openAddItem() {
    this.setData({
      modalOpen: true, modalType: 'item', modalMode: 'add', modalTitle: T[this.data.lang].store.addTitle, modalError: '', editTargetId: null,
      form: { key_name: '', name_en: '', name_zh: '', desc_en: '', desc_zh: '', unit_en: '', unit_zh: '', price_cny: '', price_usd: '', tag: '', sort_order: 0, active: true },
      formTagIdx: 0, formActiveIdx: 0,
    })
  },

  openEditItem(e) {
    const item = e.currentTarget.dataset.item
    const { lang } = this.data
    const tagIdx = T[lang].tagValues.indexOf(item.tag || '')
    const activeIdx = T[lang].activeValues.indexOf(item.active !== false)
    this.setData({
      modalOpen: true, modalType: 'item', modalMode: 'edit', modalTitle: T[lang].store.editTitle, modalError: '', editTargetId: item.id,
      form: { key_name: item.key_name || '', name_en: item.name_en || '', name_zh: item.name_zh || '', desc_en: item.desc_en || '', desc_zh: item.desc_zh || '', unit_en: item.unit_en || '', unit_zh: item.unit_zh || '', price_cny: String(item.price_cny ?? ''), price_usd: String(item.price_usd ?? ''), tag: item.tag || '', sort_order: item.sort_order ?? 0, active: item.active !== false },
      formTagIdx: tagIdx >= 0 ? tagIdx : 0,
      formActiveIdx: activeIdx >= 0 ? activeIdx : 0,
    })
  },

  closeModal() {
    if (this.data.modalBusy) return
    this.setData({ modalOpen: false })
  },

  // ── Form field bindings ───────────────────────────────────────────────────────

  onFormInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`form.${key}`]: e.detail.value })
  },

  onDateChange(e) { this.setData({ 'form.birth_date': e.detail.value }) },

  onPickerLang(e) {
    const { lang } = this.data
    const idx = Number(e.detail.value)
    this.setData({ formLangIdx: idx, 'form.language': T[lang].langValues[idx] })
  },

  onPickerApp(e) {
    const { lang } = this.data
    const idx = Number(e.detail.value)
    this.setData({ formAppIdx: idx, 'form.external_app': T[lang].appValues[idx] })
  },

  onPickerGender(e) {
    const { lang } = this.data
    const idx = Number(e.detail.value)
    this.setData({ formGenderIdx: idx, 'form.gender': T[lang].genderValues[idx] })
  },

  onPickerCoach(e) {
    const idx = Number(e.detail.value)
    const val = this.data.coachPickerValues[idx]
    this.setData({ formCoachIdx: idx, 'form.coach_id': val })
  },

  onPickerTag(e) {
    const { lang } = this.data
    const idx = Number(e.detail.value)
    this.setData({ formTagIdx: idx, 'form.tag': T[lang].tagValues[idx] })
  },

  onPickerActive(e) {
    const { lang } = this.data
    const idx = Number(e.detail.value)
    this.setData({ formActiveIdx: idx, 'form.active': T[lang].activeValues[idx] })
  },

  // ── Save ──────────────────────────────────────────────────────────────────────

  async handleSave() {
    const { modalType, modalMode, form, editTargetId, lang } = this.data
    const t = T[lang]
    this.setData({ modalBusy: true, modalError: '' })

    try {
      if (modalType === 'user') {
        const payload = {
          nickname: form.nickname, gender: form.gender, birth_date: form.birth_date,
          language: form.language, phone: form.phone, email: form.email,
          coach_id: form.coach_id === '' ? null : parseInt(form.coach_id),
          external_id: form.external_id, external_app: form.external_app,
        }
        if (modalMode === 'add') await this._req(`${BASE}/api/users`, 'POST', payload)
        else await this._req(`${BASE}/api/users/${editTargetId}`, 'PUT', payload)
      } else if (modalType === 'coach') {
        if (!form.user_id) { this.setData({ modalError: t.error.required, modalBusy: false }); return }
        if (modalMode === 'add') await this._req(`${BASE}/api/coaches`, 'POST', { user_id: form.user_id })
        else await this._req(`${BASE}/api/coaches/${editTargetId}`, 'PUT', { user_id: form.user_id })
      } else if (modalType === 'item') {
        if (!form.key_name.trim() || !form.name_en.trim()) { this.setData({ modalError: t.error.required, modalBusy: false }); return }
        if (modalMode === 'add') await this._req(`${BASE}/api/store-items`, 'POST', form)
        else await this._req(`${BASE}/api/store-items/${editTargetId}`, 'PUT', form)
      }
      this.setData({ modalOpen: false, modalBusy: false })
      this._loadAll()
    } catch (e) {
      this.setData({ modalError: t.error.saveFailed, modalBusy: false })
    }
  },

  // ── Delete ────────────────────────────────────────────────────────────────────

  handleDeleteUser(e) {
    const user = e.currentTarget.dataset.user
    const { lang } = this.data
    const extraRoles = (user.roles || ['user']).filter(r => r !== 'user')
    if (extraRoles.length > 0) {
      wx.showModal({
        title: T[lang].user.deleteWarning.split('？')[0],
        content: T[lang].user.deleteRolesError,
        showCancel: false,
      })
      return
    }
    wx.showModal({
      title: T[lang].user.deleteWarning.split('？')[0] + '？',
      content: T[lang].user.deleteWarning,
      confirmColor: '#ef4444',
      confirmText: T[lang].delete,
      success: async (res) => {
        if (!res.confirm) return
        try {
          await this._req(`${BASE}/api/users/${user.user_id}`, 'DELETE')
          this._loadAll()
        } catch (e) { wx.showToast({ title: T[this.data.lang].error.networkError, icon: 'none' }) }
      },
    })
  },

  handleDeleteCoach(e) {
    const coach = e.currentTarget.dataset.coach
    const { lang } = this.data
    wx.showModal({
      title: T[lang].coach.deleteWarning.split('？')[0] + '？',
      content: T[lang].coach.deleteWarning,
      confirmColor: '#ef4444',
      confirmText: T[lang].delete,
      success: async (res) => {
        if (!res.confirm) return
        try {
          await this._req(`${BASE}/api/coaches/${coach.id}`, 'DELETE')
          this._loadAll()
        } catch (e) { wx.showToast({ title: T[this.data.lang].error.networkError, icon: 'none' }) }
      },
    })
  },

  handleDeleteItem(e) {
    const item = e.currentTarget.dataset.item
    const { lang } = this.data
    wx.showModal({
      title: T[lang].store.deleteWarning.split('？')[0] + '？',
      content: T[lang].store.deleteWarning,
      confirmColor: '#ef4444',
      confirmText: T[lang].delete,
      success: async (res) => {
        if (!res.confirm) return
        try {
          await this._req(`${BASE}/api/store-items/${item.id}`, 'DELETE')
          this._loadAll()
        } catch (e) { wx.showToast({ title: T[this.data.lang].error.networkError, icon: 'none' }) }
      },
    })
  },

  handleUpdateOrderStatus(e) {
    const order = e.currentTarget.dataset.order
    const { lang } = this.data
    const t = T[lang]
    wx.showActionSheet({
      itemList: t.orderStatuses,
      success: async (res) => {
        const newStatus = t.orderStatusValues[res.tapIndex]
        try {
          await this._req(`${BASE}/api/orders/${order.id}`, 'PUT', { status: newStatus })
          this._loadAll()
        } catch (e) { wx.showToast({ title: t.error.networkError, icon: 'none' }) }
      },
    })
  },

  // ── Invites ───────────────────────────────────────────────────────────────────

  async generateInvite() {
    const { lang } = this.data
    const t = T[lang]
    const user = app.globalData.user
    const cid = this._channelId
    if (!cid) { wx.showToast({ title: t.error.networkError, icon: 'none' }); return }
    try {
      await this._req(`${BASE}/api/invitations`, 'POST', {
        created_by: user.user_id,
        channel_id: cid,
        type: 'channel',
      })
      this._loadAll()
    } catch (e) { wx.showToast({ title: t.error.networkError, icon: 'none' }) }
  },

  copyInvite(e) {
    const invite = e.currentTarget.dataset.invite
    const { lang } = this.data
    const t = T[lang]
    const path = `pages/login/login?invite=${invite.code}`
    wx.setClipboardData({
      data: path,
      success: () => wx.showToast({ title: t.invite.copied, icon: 'success' }),
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
        } catch (ex) { wx.showToast({ title: t.error.networkError, icon: 'none' }) }
      },
    })
  },

  // ── Rewards ───────────────────────────────────────────────────────────────────

  async _loadRewards() {
    const cid = this._channelId
    if (!cid) return
    this.setData({ rewardsLoading: true })
    try {
      const res = await this._req(`${BASE}/api/channel-rewards-summary?channel_id=${cid}`)
      const d = res.data || {}
      const lang = this.data.lang
      this.setData({
        rewardsThisMonth: `¥${Number(d.this_month_cny || 0).toFixed(2)}`,
        rewardsCoachBreakdown: (d.coach_breakdown || []).map(c => ({
          ...c,
          _thisMonth: `¥${Number(c.this_month || 0).toFixed(2)}`,
          _pending: `¥${Number(c.pending_total || 0).toFixed(2)}`,
        })),
        rewardsPendingPayouts: (d.pending_payouts || []).map(p => ({
          ...p,
          _amountFmt: `¥${Number(p.total_cny || 0).toFixed(2)}`,
        })),
        rewardsLoading: false,
      })
    } catch {
      this.setData({ rewardsLoading: false })
    }
  },

  async generateCoachPayouts() {
    const cid = this._channelId
    if (!cid) return
    const now = new Date()
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    this.setData({ rewardsGenerating: true })
    try {
      await this._req(`${BASE}/api/generate-coach-payouts`, 'POST', { channel_id: cid, period })
      await this._loadRewards()
    } catch {
      wx.showToast({ title: T[this.data.lang].error.networkError, icon: 'none' })
    } finally {
      this.setData({ rewardsGenerating: false })
    }
  },

  async updateCoachPayout(e) {
    const { payoutId, status } = e.currentTarget.dataset
    try {
      await this._req(`${BASE}/api/coach-payouts/${payoutId}`, 'PUT', { status, approved_by: app.globalData.user?.user_id })
      await this._loadRewards()
    } catch {
      wx.showToast({ title: T[this.data.lang].error.networkError, icon: 'none' })
    }
  },

  // ── HTTP helper ───────────────────────────────────────────────────────────────

  _req(url, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
      const opts = { url, method, header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.apiToken}` }, success: resolve, fail: reject }
      if (data) opts.data = data
      wx.request(opts)
    })
  },
})
