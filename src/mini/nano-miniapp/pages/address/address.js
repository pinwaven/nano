const app = getApp()
const { BASE } = require('../../utils/config.js')

const TEXT = {
  zh: {
    title: '地址管理',
    loading: '加载中…',
    empty: '暂无联系地址',
    defaultLabel: '默认',
    add: '新增地址',
    addTitle: '新增地址',
    editTitle: '编辑地址',
    edit: '编辑',
    delete: '删除',
    setDefault: '设为默认',
    namePh: '联系人',
    phonePh: '手机号',
    regionPh: '选择省市区',
    addressPh: '详细地址',
    postalPh: '邮编（选填）',
    defaultToggle: '设为默认地址',
    cancel: '取消',
    save: '保存',
    saving: '保存中…',
    required: '请填写联系人、手机号、地区和详细地址',
    saved: '已保存',
    failed: '操作失败，请重试',
    confirmDelete: '删除这个地址？',
  },
  en: {
    title: 'Addresses',
    loading: 'Loading...',
    empty: 'No addresses yet',
    defaultLabel: 'Default',
    add: 'Add Address',
    addTitle: 'Add Address',
    editTitle: 'Edit Address',
    edit: 'Edit',
    delete: 'Delete',
    setDefault: 'Default',
    namePh: 'Contact name',
    phonePh: 'Phone',
    regionPh: 'Province / city / district',
    addressPh: 'Street address',
    postalPh: 'Postal code',
    defaultToggle: 'Set as default',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving...',
    required: 'Please complete contact, phone, region and address',
    saved: 'Saved',
    failed: 'Failed. Please retry.',
    confirmDelete: 'Delete this address?',
  },
}

const emptyForm = () => ({
  contact_name: '',
  phone: '',
  province: '',
  city: '',
  district: '',
  address_line1: '',
  postal_code: '',
  is_default: true,
})

Page({
  data: {
    statusBarHeight: 0,
    theme: 'dark',
    lang: 'zh',
    t: TEXT.zh,
    mode: '',
    loading: true,
    saving: false,
    addresses: [],
    formOpen: false,
    editingId: null,
    form: emptyForm(),
    region: [],
    regionText: '',
  },

  onLoad(options = {}) {
    const { statusBarHeight = 0 } = wx.getSystemInfoSync()
    const user = app.globalData.user
    const lang = app.globalData.lang || user?.language || 'zh'
    const theme = app.globalData.theme || user?.theme || 'dark'
    this.setData({ statusBarHeight, lang, theme, t: TEXT[lang] || TEXT.zh, mode: options.mode || '' })
    this.loadAddresses()
  },

  async loadAddresses() {
    const user = app.globalData.user
    if (!user?.user_id) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.setData({ loading: true })
    try {
      const res = await this._req(`${BASE}/api/addresses?openid=${encodeURIComponent(user.user_id)}`)
      const addresses = res.data?.addresses || []
      this.setData({ addresses, loading: false })
      if (addresses.length === 0 && this.data.mode === 'checkout') this.openAdd()
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: this.data.t.failed, icon: 'none' })
    }
  },

  openAdd() {
    this.setData({
      formOpen: true,
      editingId: null,
      form: emptyForm(),
      region: [],
      regionText: '',
    })
  },

  editAddress(e) {
    const item = e.currentTarget.dataset.item
    const region = [item.province || '', item.city || '', item.district || '']
    this.setData({
      formOpen: true,
      editingId: item.id,
      form: {
        contact_name: item.contact_name || '',
        phone: item.phone || '',
        province: item.province || '',
        city: item.city || '',
        district: item.district || '',
        address_line1: item.address_line1 || '',
        postal_code: item.postal_code || '',
        is_default: !!item.is_default,
      },
      region,
      regionText: region.filter(Boolean).join(' '),
    })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  onRegionChange(e) {
    const region = e.detail.value || []
    this.setData({
      region,
      regionText: region.join(' '),
      'form.province': region[0] || '',
      'form.city': region[1] || '',
      'form.district': region[2] || '',
    })
  },

  toggleDefault() {
    this.setData({ 'form.is_default': !this.data.form.is_default })
  },

  closeForm() {
    this.setData({ formOpen: false, saving: false })
  },

  noop() {},

  async saveAddress() {
    if (this.data.saving) return
    const user = app.globalData.user
    const { form, editingId, t } = this.data
    if (!form.contact_name || !form.phone || !form.province || !form.city || !form.address_line1) {
      wx.showToast({ title: t.required, icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      const payload = { ...form, openid: user.user_id }
      if (editingId) {
        await this._req(`${BASE}/api/addresses/${editingId}`, 'PUT', payload)
      } else {
        await this._req(`${BASE}/api/addresses`, 'POST', payload)
      }
      wx.showToast({ title: t.saved, icon: 'success' })
      this.setData({ formOpen: false, saving: false })
      await this.loadAddresses()
      if (this.data.mode === 'checkout') {
        wx.setStorageSync('nano_checkout_address_ready', '1')
        wx.navigateBack()
      }
    } catch (e) {
      this.setData({ saving: false })
      wx.showToast({ title: t.failed, icon: 'none' })
    }
  },

  async makeDefault(e) {
    const item = e.currentTarget.dataset.item
    try {
      await this._req(`${BASE}/api/addresses/${item.id}`, 'PUT', {
        openid: app.globalData.user.user_id,
        contact_name: item.contact_name,
        phone: item.phone,
        province: item.province,
        city: item.city,
        district: item.district,
        address_line1: item.address_line1,
        postal_code: item.postal_code || '',
        is_default: true,
      })
      await this.loadAddresses()
    } catch (e) {
      wx.showToast({ title: this.data.t.failed, icon: 'none' })
    }
  },

  deleteAddress(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: this.data.t.confirmDelete,
      confirmColor: '#ef4444',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await this._req(`${BASE}/api/addresses/${id}`, 'DELETE', { openid: app.globalData.user.user_id })
          await this.loadAddresses()
        } catch (err) {
          wx.showToast({ title: this.data.t.failed, icon: 'none' })
        }
      },
    })
  },

  goBack() {
    wx.navigateBack()
  },

  _req(url, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
      const opts = {
        url,
        method,
        header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.apiToken}` },
        success: resolve,
        fail: reject,
      }
      if (data) opts.data = data
      wx.request(opts)
    })
  },
})
