const BASE = 'https://nano.fros.cc'

const T = {
  zh: {
    title: 'Nano 管理',
    tabs: { users: '用户', coaches: 'Coach', dots: '营养点', store: '商城' },
    refresh: '刷新', loading: '加载中…', back: '返回',
    add: '添加', edit: '编辑', delete: '删除', save: '保存', cancel: '取消',
    saving: '保存中…', deleting: '删除中…',
    empty: { users: '暂无用户', coaches: '暂无 Coach', dots: '暂无营养点', items: '暂无商品', orders: '暂无订单' },
    stats: {
      totalUsers: '总用户', tested: '已检测', avgBioAge: '平均生物年龄', coaches: 'Coach 数',
      totalCoaches: 'Coach 总数', assigned: '已分配', unassigned: '未分配',
      totalDots: '营养点', isolates: '单体', blends: '复合',
      totalItems: '商品', active: '上架中', totalOrders: '订单', pending: '待处理',
    },
    user: {
      nickname: '昵称', gender: '性别', birthDate: '出生日期', language: '语言',
      coach: '负责 Coach', phone: '电话', email: '邮箱', externalId: '外部 ID',
      externalApp: '外部应用', bioAge: '生物年龄', chronoAge: '实际年龄',
      joined: '注册时间', unassigned: '未分配',
      male: '男', female: '女', unknown: '未知',
      addTitle: '添加用户', editTitle: '编辑用户',
      deleteWarning: '确认删除此用户？将同时删除其所有检测记录和通知。',
    },
    coach: {
      name: '姓名', email: '邮箱', phone: '电话', language: '语言', users: '用户数',
      joined: '注册时间', addTitle: '添加 Coach', editTitle: '编辑 Coach',
      deleteWarning: '确认删除此 Coach？其名下用户将变为未分配状态。',
    },
    dot: {
      key: '标识', nameEn: '名称 (英)', nameZh: '名称 (中)', color: '颜色',
      type: '类型', desc: '描述', isolate: '单体', blend: '复合',
      addTitle: '添加营养点', editTitle: '编辑营养点',
      deleteWarning: '确认删除此营养点？此操作不可撤销。',
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
    typeOptions: ['复合', '单体'],
    typeValues: [false, true],
    tagOptions: ['无标签', '热销', '超值'],
    tagValues: ['', 'bestseller', 'value'],
    activeOptions: ['上架', '下架'],
    activeValues: [true, false],
    orderStatuses: ['待处理', '已确认', '已发货', '已送达', '已取消'],
    orderStatusValues: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'],
    error: { required: '此项为必填', saveFailed: '保存失败，请重试', networkError: '网络错误' },
  },
  en: {
    title: 'Nano Admin',
    tabs: { users: 'Users', coaches: 'Coaches', dots: 'Dots', store: 'Store' },
    refresh: 'Refresh', loading: 'Loading…', back: 'Back',
    add: 'Add', edit: 'Edit', delete: 'Delete', save: 'Save', cancel: 'Cancel',
    saving: 'Saving…', deleting: 'Deleting…',
    empty: { users: 'No users', coaches: 'No coaches', dots: 'No dots', items: 'No items', orders: 'No orders' },
    stats: {
      totalUsers: 'Users', tested: 'Tested', avgBioAge: 'Avg Bio Age', coaches: 'Coaches',
      totalCoaches: 'Coaches', assigned: 'Assigned', unassigned: 'Unassigned',
      totalDots: 'Dots', isolates: 'Isolates', blends: 'Blends',
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
    },
    coach: {
      name: 'Name', email: 'Email', phone: 'Phone', language: 'Language', users: 'Users',
      joined: 'Joined', addTitle: 'Add Coach', editTitle: 'Edit Coach',
      deleteWarning: 'Delete this coach? Their assigned users will become unassigned.',
    },
    dot: {
      key: 'Key', nameEn: 'Name (EN)', nameZh: 'Name (ZH)', color: 'Color',
      type: 'Type', desc: 'Description', isolate: 'Isolate', blend: 'Blend',
      addTitle: 'Add Dot', editTitle: 'Edit Dot',
      deleteWarning: 'Delete this dot? This cannot be undone.',
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
    typeOptions: ['Blend', 'Isolate'],
    typeValues: [false, true],
    tagOptions: ['No tag', 'Best Seller', 'Value Pack'],
    tagValues: ['', 'bestseller', 'value'],
    activeOptions: ['Active', 'Inactive'],
    activeValues: [true, false],
    orderStatuses: ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'],
    orderStatusValues: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'],
    error: { required: 'This field is required', saveFailed: 'Save failed, please retry', networkError: 'Network error' },
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

    users: [], coaches: [], dots: [], storeItems: [], orders: [],
    storeSubTab: 'items',

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
      name: '',
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
    formTypeIdx: 0,
    formTagIdx: 0,
    formActiveIdx: 0,
    coachPickerOptions: [],
    coachPickerValues: [],
  },

  onLoad() {
    const { statusBarHeight = 0 } = wx.getSystemInfoSync()
    const lang = 'zh'
    this.setData({ statusBarHeight, lang, t: T[lang] })
    this._loadAll()
  },

  // ── Data loading ──────────────────────────────────────────────────────────────

  async _loadAll() {
    this.setData({ loading: true })
    try {
      const [uRes, cRes, dRes, sRes, oRes] = await Promise.all([
        this._req(`${BASE}/api/users`),
        this._req(`${BASE}/api/coach-list`),
        this._req(`${BASE}/api/dots-inventory`),
        this._req(`${BASE}/api/store-items?all=true`),
        this._req(`${BASE}/api/orders`),
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
        dots: dRes.data?.dots || [],
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

  handleRefresh() { this._loadAll() },

  handleBack() { wx.navigateBack() },

  // ── Tabs ──────────────────────────────────────────────────────────────────────

  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }) },

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
    this.setData({
      modalOpen: true, modalType: 'coach', modalMode: 'add', modalTitle: T[this.data.lang].coach.addTitle, modalError: '', editTargetId: null,
      form: { name: '', email: '', phone: '', language: 'zh' },
      formLangIdx: 0,
    })
  },

  openEditCoach(e) {
    const c = e.currentTarget.dataset.coach
    const { lang } = this.data
    const langIdx = T[lang].langValues.indexOf(c.language || 'zh')
    this.setData({
      modalOpen: true, modalType: 'coach', modalMode: 'edit', modalTitle: T[lang].coach.editTitle, modalError: '', editTargetId: c.id,
      form: { name: c.name || '', email: c.email || '', phone: c.phone || '', language: c.language || 'zh' },
      formLangIdx: langIdx >= 0 ? langIdx : 0,
    })
  },

  openAddDot() {
    this.setData({
      modalOpen: true, modalType: 'dot', modalMode: 'add', modalTitle: T[this.data.lang].dot.addTitle, modalError: '', editTargetId: null,
      form: { key_name: '', name_en: '', name_zh: '', color: '', color_zh: '', description: '', is_isolate: false },
      formTypeIdx: 0,
    })
  },

  openEditDot(e) {
    const d = e.currentTarget.dataset.dot
    const { lang } = this.data
    const typeIdx = T[lang].typeValues.indexOf(!!d.is_isolate)
    this.setData({
      modalOpen: true, modalType: 'dot', modalMode: 'edit', modalTitle: T[lang].dot.editTitle, modalError: '', editTargetId: d.id,
      form: { key_name: d.key_name || '', name_en: d.name || '', name_zh: d.name_zh || '', color: d.color || '', color_zh: d.color_zh || '', description: d.description || '', is_isolate: !!d.is_isolate },
      formTypeIdx: typeIdx >= 0 ? typeIdx : 0,
    })
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

  onPickerType(e) {
    const { lang } = this.data
    const idx = Number(e.detail.value)
    this.setData({ formTypeIdx: idx, 'form.is_isolate': T[lang].typeValues[idx] })
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
        if (!form.name.trim()) { this.setData({ modalError: t.error.required, modalBusy: false }); return }
        if (modalMode === 'add') await this._req(`${BASE}/api/coaches`, 'POST', { name: form.name, email: form.email, phone: form.phone, language: form.language })
        else await this._req(`${BASE}/api/coaches/${editTargetId}`, 'PUT', { name: form.name, email: form.email, phone: form.phone, language: form.language })
      } else if (modalType === 'dot') {
        if (!form.key_name.trim() || !form.name_en.trim()) { this.setData({ modalError: t.error.required, modalBusy: false }); return }
        const payload = { key_name: form.key_name, name: form.name_en, name_zh: form.name_zh, color: form.color, color_zh: form.color_zh, description: form.description, is_isolate: form.is_isolate }
        if (modalMode === 'add') await this._req(`${BASE}/api/dots`, 'POST', payload)
        else await this._req(`${BASE}/api/dots/${editTargetId}`, 'PUT', payload)
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

  handleDeleteDot(e) {
    const dot = e.currentTarget.dataset.dot
    const { lang } = this.data
    wx.showModal({
      title: T[lang].dot.deleteWarning.split('？')[0] + '？',
      content: T[lang].dot.deleteWarning,
      confirmColor: '#ef4444',
      confirmText: T[lang].delete,
      success: async (res) => {
        if (!res.confirm) return
        try {
          await this._req(`${BASE}/api/dots/${dot.id}`, 'DELETE')
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

  // ── HTTP helper ───────────────────────────────────────────────────────────────

  _req(url, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
      const opts = { url, method, header: { 'Content-Type': 'application/json' }, success: resolve, fail: reject }
      if (data) opts.data = data
      wx.request(opts)
    })
  },
})
