import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import axios from 'axios';
import { marked } from 'marked';
import wavenLogo from '../../shared/assets/waven-logo-icon.png';
import {
  Users, Droplets, UserCog, RefreshCcw,
  ChevronDown, Activity, Calendar, Plus, Pencil, Trash2, X, Check, Globe, Layout,
  ShoppingBag, Package, Building2, Tag, Copy, Cpu, Layers, QrCode, Printer, ChevronLeft, ChevronRight, Download,
  Coins, TrendingUp, Settings2,
  GraduationCap, Video, FileText, Upload, ExternalLink, Play, BookOpen,
  Bug, AlertCircle, Image as ImageIcon,
  ClipboardList, ChevronUp, Send, Eye,
  BarChart2,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

axios.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('nano_admin_token') || import.meta.env.VITE_API_TOKEN
  if (token) config.headers['Authorization'] = `Bearer ${token}`
  return config
})

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await axios.post('/api/admin/login', { username, password })
      if (res.data?.token) {
        sessionStorage.setItem('nano_admin_token', res.data.token)
        sessionStorage.setItem('nano_admin_user', username)
        onLogin(res.data.token)
      } else {
        setError('Login failed')
      }
    } catch {
      setError('Invalid username or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0B1C2E' }}>
      <div style={{ background: '#0F2540', border: '1px solid rgba(99,117,236,0.25)', borderRadius: 16, padding: '48px 40px', width: 360, boxShadow: '0 16px 64px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <img src={wavenLogo} alt="Waven" style={{ width: 32, height: 32 }} />
          <span style={{ color: '#EEF2FF', fontWeight: 700, fontSize: 18, letterSpacing: 4 }}>NANO ADMIN</span>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ color: 'rgba(166,196,229,0.6)', fontSize: 12, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase' }}>Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              required
              style={{ background: '#162E4A', border: '1px solid rgba(99,117,236,0.25)', borderRadius: 8, padding: '10px 14px', color: '#EEF2FF', fontSize: 14, outline: 'none' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ color: 'rgba(166,196,229,0.6)', fontSize: 12, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase' }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{ background: '#162E4A', border: '1px solid rgba(99,117,236,0.25)', borderRadius: 8, padding: '10px 14px', color: '#EEF2FF', fontSize: 14, outline: 'none' }}
            />
          </div>
          {error && <div style={{ color: '#f87171', fontSize: 13, textAlign: 'center' }}>{error}</div>}
          <button
            type="submit"
            disabled={loading}
            style={{ marginTop: 8, background: 'linear-gradient(135deg, #6375EC, #8B9FFF)', border: 'none', borderRadius: 8, padding: '12px 0', color: '#fff', fontWeight: 700, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── i18n ──────────────────────────────────────────────────────────────────────

const T = {
  en: {
    brand: 'Nano Admin',
    nav: { users: 'Users', coaches: 'Coaches', dots: 'Dots', store: 'Store', sims: 'Simulators', channels: 'Channels', invites: 'Invites', kino: 'Kino', chips: 'Chips', rewards: 'Rewards', academy: 'Academy', tickets: 'Tickets', adminAccounts: 'Admin', questionnaires: 'Questionnaires', reports: 'Reports', healthPlans: 'Health Plans' },
    adminAccounts: { title: 'Admin Accounts', add: 'Add Admin', changePassword: 'Change Password', confirmDelete: 'Delete this admin account?', newPassword: 'New Password', usernameLabel: 'Username', passwordLabel: 'Password', count: (n) => `${n} account${n !== 1 ? 's' : ''}` },
    topbar: { refresh: 'Refresh', loading: 'Loading…' },
    updated: 'Updated',
    stats: {
      totalUsers: 'Total Users', tested: 'Tested', avgBioAge: 'Avg Bio Age',
      coaches: 'Coaches', totalCoaches: 'Total Coaches',
      assignedUsers: 'Assigned Users', unassignedUsers: 'Unassigned Users',
      totalDots: 'Total Dots', isolates: 'Isolates', blends: 'Blends',
      totalItems: 'Items', activeItems: 'Active', totalOrders: 'Orders', pendingOrders: 'Pending',
      totalChannels: 'Channels',
      totalInvites: 'Total Invites', activeInvites: 'Active', usedInvites: 'Used',
      totalDevices: 'Total Devices', activeDevices: 'Active', totalTests: 'Total Tests',
    },
    table: {
      id: 'ID', nickname: 'Nickname', gender: 'Gender', birthDate: 'Birth Date',
      language: 'Language', bioAge: 'Bio Age', chronoAge: 'Chrono Age',
      assignedCoach: 'Assigned Coach', joined: 'Joined',
      name: 'Name', email: 'Email', phone: 'Phone', customers: 'Users',
      key: 'Key', nameEn: 'Name (EN)', nameZh: 'Name (ZH)', color: 'Color',
      type: 'Type', description: 'Description',
      unassigned: 'Unassigned', channel: 'Channel', roles: 'Roles', linkedUser: 'Linked User',
      timing: 'Timing', coating: 'Coating', group: 'Group', subAge: 'Sub-Age',
      code: 'Code', maxUses: 'Max Uses', useCount: 'Uses', creator: 'Creator',
      serialNumber: 'Serial No.', lastUsed: 'Last Used', testCount: 'Tests', status: 'Status', notes: 'Notes',
    },
    empty: { users: 'No users found', coaches: 'No Coaches found', dots: 'No dots found', store: 'No items', orders: 'No orders', channels: 'No channels found', invites: 'No invitations found', kino: 'No Kino devices registered', chipBatches: 'No chip batches created', chipModels: 'No chip models defined', tickets: 'No tickets yet' },
    count: (n) => `${n} users`,
    addUser: 'Add User',
    addCoach: 'Add Coach', addDot: 'Add Dot', addItem: 'Add Item', addChannel: 'Add Channel', addInvite: 'Create Invite', addDevice: 'Register Device',
    countCoach: (n) => `${n} Coaches`,
    countDot: (n) => `${n} dots`,
    countItem: (n) => `${n} items`,
    countOrder: (n) => `${n} orders`,
    countChannel: (n) => `${n} channels`,
    countInvite: (n) => `${n} invites`,
    countDevice: (n) => `${n} device${n !== 1 ? 's' : ''}`,
    modal: {
      addUser: 'Add User', editUser: 'Edit User', deleteUser: 'Delete User',
      addCoach: 'Add Coach', editCoach: 'Edit Coach', deleteCoach: 'Delete Coach',
      addDot: 'Add Dot',   editDot: 'Edit Dot',   deleteDot: 'Delete Dot',
      externalId: 'External ID', externalIdPlaceholder: 'e.g. wx_abc123',
      externalApp: 'External App',
      nickname: 'Nickname', nicknamePlaceholder: 'Display name',
      gender: 'Gender', male: 'Male', female: 'Female',
      birthDate: 'Birth Date', language: 'Language',
      langZh: 'Chinese (ZH)', langEn: 'English (EN)',
      assignedCoach: 'Assigned Coach', unassigned: 'Unassigned',
      name: 'Name *', email: 'Email', phone: 'Phone',
      keyName: 'Key Name *', keyNamePlaceholder: 'e.g. omega3',
      nameEn: 'Name (EN) *', nameZh: 'Name (ZH)',
      color: 'Color', colorPlaceholder: '#FF6B35',
      colorZh: 'Color (ZH)', colorHex: 'Color Hex',
      description: 'Description',
      isIsolate: 'Type', isolate: 'Isolate', blend: 'Blend',
      timing: 'Timing', timingMorning: 'Morning', timingEvening: 'Evening',
      group: 'Group', subAge: 'Sub-Age Target',
      ingredientsSummary: 'Summary',
      coating: 'Coating', coatingGastric: 'Gastric (Stomach)', coatingEnteric: 'Enteric (Intestine)',
      ingredients: 'Ingredients', addIngredient: '+ Add Row',
      ingredientNameEn: 'EN Name', ingredientNameZh: 'ZH Name', ingredientMg: 'mg',
      cancel: 'Cancel', save: 'Save', saving: 'Saving…',
      delete: 'Delete', deleting: 'Deleting…',
      deleteWarning: (name) => `Delete ${name}? This will also remove all their biomarkers, scans, and notifications.`,
      deleteBlockedByRoles: (roles) => `Cannot delete: user has the roles "${roles}". Remove all extra roles first.`,
      deleteCoachWarning: (name) => `Delete Coach ${name}? Their assigned users will become unassigned.`,
      deleteDotWarning: (name) => `Delete dot "${name}"? This cannot be undone.`,
      addItem: 'Add Item', editItem: 'Edit Item', deleteItem: 'Delete Item',
      deleteItemWarning: (name) => `Delete "${name}"? This cannot be undone.`,
      descEn: 'Description (EN)', descZh: 'Description (ZH)',
      unitEn: 'Unit (EN)', unitZh: 'Unit (ZH)',
      priceCny: 'Price CNY *', priceUsd: 'Price USD *',
      tag: 'Tag', noTag: 'No tag', tagBestseller: 'Best Seller', tagValue: 'Value Pack',
      sortOrder: 'Sort Order', active: 'Active',
      externalIdRequired: 'External ID is required',
      nameRequired: 'Name is required',
      keyRequired: 'Key name is required',
      saveFailed: 'Save failed',
      addChannel: 'Add Channel', editChannel: 'Edit Channel', deleteChannel: 'Delete Channel',
      deleteChannelWarning: (name) => `Delete channel "${name}"? Coaches and users in this channel will be unassigned.`,
      channelKeyName: 'Key Name *', channelName: 'Display Name *', channelLogoUrl: 'Logo URL',
      channel: 'Channel', channelUnassigned: 'No channel',
      roles: 'Roles', roleUser: 'User', roleCoach: 'Coach', roleAdmin: 'Channel Admin', roleSuperadmin: 'Superadmin',
      linkedUserId: 'Linked User ID', linkedUserIdPlaceholder: 'WeChat user_id',
      addInvite: 'Create Invite', deactivateInvite: 'Deactivate',
      deleteInviteWarning: (code) => `Deactivate invite "${code}"? It can no longer be used.`,
      inviteType: 'Type', inviteTypeCoach: 'Coach', inviteTypeChannel: 'Channel', inviteTypeAdmin: 'Admin',
      inviteMaxUses: 'Max Uses', inviteMaxUsesPlaceholder: 'Blank = unlimited',
      inviteChannel: 'Channel *',
      addDevice: 'Register Kino Device', editDevice: 'Edit Kino Device', deleteDevice: 'Remove Device',
      deleteDeviceWarning: (sn) => `Remove Kino device "${sn}"? Historical biomarker links will be preserved but the device will no longer be tracked.`,
      serialNumber: 'Serial Number *', serialNumberPlaceholder: 'e.g. KNO-2024-0001',
      deviceName: 'Display Name', deviceNamePlaceholder: 'e.g. Clinic Unit A',
      deviceStatus: 'Status', statusActive: 'Active', statusInactive: 'Inactive', statusMaintenance: 'Maintenance',
      deviceNotes: 'Notes', deviceNotesPlaceholder: 'Optional notes…',
      assignedCoachDevice: 'Assigned Coach', assignedChannelDevice: 'Assigned Channel',
    },
    dotType: { isolate: 'Isolate', blend: 'Blend' },
    store: {
      itemsTab: 'Items', ordersTab: 'Orders',
      priceCny: 'CNY (¥)', priceUsd: 'USD ($)', tag: 'Tag', active: 'Active',
      qty: 'Qty', status: 'Status', orderedAt: 'Ordered', yes: 'Yes', no: 'No',
      pending: 'Pending', confirmed: 'Confirmed', shipped: 'Shipped',
      delivered: 'Delivered', cancelled: 'Cancelled',
      image: 'Image', uploadImage: 'Click to upload image (PNG / JPG)',
      uploading: 'Uploading…', uploadFailed: 'Image upload failed', removeImage: 'Remove image',
    },
    invites: { active: 'Active', deactivated: 'Deactivated', unlimited: 'Unlimited' },
    rewards: {
      settingsTab: 'Settings', channelPayoutsTab: 'Channel Payouts', coachCommissionsTab: 'Coach Commissions',
      role: 'Role', productType: 'Product Type', flatRate: 'Flat Rate (¥)', pct: 'Percentage (%)',
      coach: 'Coach', channel: 'Channel', chip: 'Chip', dot: 'Dot', subscription: 'Subscription',
      generatePayouts: 'Generate Payouts', period: 'Period (YYYY-MM)',
      channelName: 'Channel', totalCny: 'Total (¥)', status: 'Status', approvedAt: 'Approved',
      transferredAt: 'Transferred', approve: 'Approve', markTransferred: 'Mark Transferred',
      draft: 'Draft', approved: 'Approved', transferred: 'Transferred',
      coachName: 'Coach', channelCol: 'Channel', productTypeCol: 'Product', amountCny: 'Amount (¥)',
      orderId: 'Order', createdAt: 'Date',
      noSettings: 'No settings found', noPayouts: 'No payouts', noCommissions: 'No commissions',
      generate: 'Generate', generating: 'Generating…', saved: 'Saved', saveFailed: 'Save failed',
      totalPayouts: 'Channel Payouts', pendingPayouts: 'Pending', totalCommissions: 'Coach Commissions', totalEarned: 'Total Commissions',
    },
    addBatch: 'Add Batch', countBatch: (n) => `${n} batch${n !== 1 ? 'es' : ''}`,
    chips: {
      prefix: 'Prefix *', prefixHint: 'Auto-uppercased, e.g. KNC12345678 or MVNS0725122201',
      model: 'Model *', modelPlaceholder: 'e.g. K1, S2',
      quantity: 'Quantity *', quantityHint: 'Max 10,000',
      notes: 'Notes',
      total: 'Total', used: 'Used', available: 'Available', damaged: 'Damaged',
      addBatch: 'Add Batch', editBatch: 'Edit Batch', deleteBatch: 'Delete Batch',
      deleteBatchWarning: (p) => `Delete batch "${p}" and all its chips? This cannot be undone.`,
      viewChips: 'View Chips', printQR: 'Print QR',
      chipCode: 'Chip Code', status: 'Status', scannedBy: 'Scanned By',
      page: 'Page', of: 'of', noChips: 'No chips',
      batchesTab: 'Batches', modelsTab: 'Models',
      addModel: 'Add Model', editModel: 'Edit Model', deleteModel: 'Delete Model',
      deleteModelWarning: (c) => `Delete chip model "${c}"? This cannot be undone.`,
      modelCode: 'Code *', modelCodeHint: 'Auto-uppercased, e.g. K2, S1',
      modelName: 'Display Name', modelNamePlaceholder: 'e.g. Kino K2 (hsCRP)',
      biomarkerKeys: 'Biomarkers *', biomarkerKeysHint: 'Comma-separated, e.g. hsCRP, IL-6',
      configJson: 'Config (JSON) *', configJsonHint: 'scan_ppmm, top_list, var_list, …',
      guideVideo: 'Guide Video URL', guideText: 'Guide Text',
      modelStatus: 'Status', statusActive: 'Active', statusInactive: 'Inactive', statusRecalled: 'Recalled',
      batchStatus: 'Status',
      batchCount: 'Batches', chipCount: 'Chips',
      countModel: (n) => `${n} model${n !== 1 ? 's' : ''}`,
      modelInUse: (n) => `${n} batch(es) reference this model`,
      invalidJson: 'Config is not valid JSON',
      biomarkersRequired: 'At least one biomarker key is required',
    },
    tickets: {
      addTicket: 'New Ticket', editTicket: 'Edit Ticket', deleteTicket: 'Delete Ticket',
      deleteWarning: (title) => `Delete ticket "${title}"? Attached images will also be removed.`,
      title: 'Title *', titlePlaceholder: 'Brief summary',
      description: 'Description', descriptionPlaceholder: 'Steps to reproduce, expected vs actual, …',
      status: 'Status', priority: 'Priority',
      reporter: 'Reporter', reporterPlaceholder: 'Your name (optional)',
      images: 'Images', addImage: 'Add Image', uploading: 'Uploading…', removeImage: 'Remove',
      imageDropHint: 'Click to add an image (PNG / JPG)',
      statOpen: 'Open', statInProgress: 'In Progress', statResolved: 'Resolved', statClosed: 'Closed',
      sOpen: 'Open', sInProgress: 'In Progress', sResolved: 'Resolved', sClosed: 'Closed',
      pLow: 'Low', pNormal: 'Normal', pHigh: 'High',
      filterAll: 'All',
      countTicket: (n) => `${n} ticket${n !== 1 ? 's' : ''}`,
      titleRequired: 'Title is required',
      uploadFailed: 'Image upload failed',
      noImages: 'No images',
    },
    academy: {
      coursesTab: 'Courses', libraryTab: 'Library',
      uploadCourse: 'Upload Course', editCourse: 'Edit Course', deleteCourse: 'Delete Course',
      uploadDoc: 'Upload Document', deleteDoc: 'Delete Document',
      title: 'Title *', description: 'Description', status: 'Status', videoFile: 'Video File', mdFile: 'Markdown File',
      draft: 'Draft', published: 'Published',
      selectVideo: 'Click to select a video file', replaceVideo: 'Click to replace video',
      selectMd: 'Click to select a .md file',
      uploading: 'Uploading…', uploadFailed: 'Upload failed',
      titleRequired: 'Title is required', fileRequired: 'File is required',
      hasVideo: 'Video', fileSize: 'Size',
      totalCourses: 'Courses', totalDocs: 'Documents',
      countCourses: (n) => `${n} course${n !== 1 ? 's' : ''}`,
      countDocs: (n) => `${n} document${n !== 1 ? 's' : ''}`,
      noCourses: 'No courses yet', noDocs: 'No documents yet',
      deleteCourseWarning: (t) => `Delete course "${t}"? The video file will also be removed from storage.`,
      deleteDocWarning: (t) => `Delete document "${t}"? The file will also be removed from storage.`,
      viewVideo: 'View Video', viewDoc: 'View Document',
    },
    reports: {
      title: 'AI Reports',
      placeholder: 'Ask a question about your data… e.g. "Show user signups by month"',
      run: 'Run Report', running: 'Running…', newReport: 'New Report',
      exportCsv: 'Export CSV', showSql: 'Show SQL', hideSql: 'Hide SQL',
      insights: 'Insights', dataTable: 'Data Table', chart: 'Chart',
      history: 'History', emptyHistory: 'No previous reports', sqlLabel: 'Generated SQL',
      rowCount: (n) => `${n} row${n !== 1 ? 's' : ''}`, errorPrefix: 'Error: ',
      saved: 'Saved Reports', emptySaved: 'No saved reports yet',
      saveReport: 'Save Report', editReport: 'Edit Report',
      reportTitle: 'Report Title', reportQuery: 'Query',
      rerunSave: 'Re-run & Save',
      samples: [
        'Show user signups by month',
        'Top 5 channels by revenue',
        'How many users have completed a biomarker scan?',
        'Orders by status breakdown',
        'Coach commission totals this month',
        'Active vs inactive Kino devices',
      ],
    },
  },
  zh: {
    brand: 'Nano 管理后台',
    nav: { users: '用户管理', coaches: 'Coach', dots: '原粒', store: '商城管理', sims: '模拟器', channels: '渠道管理', invites: '邀请码', kino: 'Kino 设备', chips: '芯片管理', rewards: '奖励管理', academy: '学院', tickets: '工单', adminAccounts: '管理员', questionnaires: '问卷管理', reports: '数据报表', healthPlans: '健康方案' },
    adminAccounts: { title: '管理员账号', add: '添加管理员', changePassword: '修改密码', confirmDelete: '确认删除此管理员账号？', newPassword: '新密码', usernameLabel: '用户名', passwordLabel: '密码', count: (n) => `${n} 个账号` },
    topbar: { refresh: '刷新', loading: '加载中…' },
    updated: '更新于',
    stats: {
      totalUsers: '总用户数', tested: '已检测', avgBioAge: '平均生理年龄',
      coaches: 'Coach 数', totalCoaches: 'Coach 总数',
      assignedUsers: '已分配用户', unassignedUsers: '未分配用户',
      totalDots: '原粒总数', isolates: '单体', blends: '复合',
      totalItems: '商品总数', activeItems: '上架中', totalOrders: '订单总数', pendingOrders: '待处理',
      totalChannels: '渠道数',
      totalInvites: '邀请码总数', activeInvites: '有效', usedInvites: '已使用',
      totalDevices: '设备总数', activeDevices: '运行中', totalTests: '总检测次数',
    },
    table: {
      id: 'ID', nickname: '昵称', gender: '性别', birthDate: '出生日期',
      language: '语言', bioAge: '生理年龄', chronoAge: '实际年龄',
      assignedCoach: '负责 Coach', joined: '注册时间',
      name: '姓名', email: '邮箱', phone: '电话', customers: '用户数',
      key: '标识', nameEn: '名称 (英)', nameZh: '名称 (中)', color: '颜色',
      type: '类型', description: '描述',
      unassigned: '未分配', channel: '渠道', roles: '角色', linkedUser: '关联用户',
      timing: '服用时间', coating: '包衣', group: '功能分组', subAge: '目标年龄',
      code: '邀请码', maxUses: '上限', useCount: '已用', creator: '创建者',
      serialNumber: '序列号', lastUsed: '最后使用', testCount: '检测次数', status: '状态', notes: '备注',
    },
    empty: { users: '暂无用户', coaches: '暂无 Coach', dots: '暂无原粒', store: '暂无商品', orders: '暂无订单', channels: '暂无渠道', invites: '暂无邀请码', kino: '暂无 Kino 设备', chipBatches: '暂无芯片批次', chipModels: '暂无芯片型号', tickets: '暂无工单' },
    count: (n) => `共 ${n} 位用户`,
    addBatch: '新建批次', countBatch: (n) => `共 ${n} 批次`,
    chips: {
      prefix: '前缀 *', prefixHint: '自动转大写，例如 KNC12345678 或 MVNS0725122201',
      model: '型号 *', modelPlaceholder: '例如 K1、S2',
      quantity: '数量 *', quantityHint: '最多 10,000',
      notes: '备注',
      total: '总数', used: '已用', available: '可用', damaged: '损坏',
      addBatch: '新建批次', editBatch: '编辑批次', deleteBatch: '删除批次',
      deleteBatchWarning: (p) => `确认删除批次"${p}"及其所有芯片？此操作不可撤销。`,
      viewChips: '查看芯片', printQR: '打印二维码',
      chipCode: '芯片编码', status: '状态', scannedBy: '扫描用户',
      page: '第', of: '页 / 共', noChips: '暂无芯片',
      batchesTab: '批次', modelsTab: '型号',
      addModel: '新建型号', editModel: '编辑型号', deleteModel: '删除型号',
      deleteModelWarning: (c) => `确认删除芯片型号"${c}"？此操作不可撤销。`,
      modelCode: '型号代码 *', modelCodeHint: '自动转大写，例如 K2、S1',
      modelName: '显示名称', modelNamePlaceholder: '例如 Kino K2 (hsCRP)',
      biomarkerKeys: '生物标志物 *', biomarkerKeysHint: '逗号分隔，例如 hsCRP, IL-6',
      configJson: '配置 (JSON) *', configJsonHint: 'scan_ppmm、top_list、var_list 等',
      guideVideo: '操作视频 URL', guideText: '操作说明',
      modelStatus: '状态', statusActive: '启用', statusInactive: '停用', statusRecalled: '已召回',
      batchStatus: '状态',
      batchCount: '批次数', chipCount: '芯片数',
      countModel: (n) => `共 ${n} 个型号`,
      modelInUse: (n) => `${n} 个批次正在使用此型号`,
      invalidJson: '配置不是合法 JSON',
      biomarkersRequired: '至少需要一个生物标志物代码',
    },
    tickets: {
      addTicket: '新建工单', editTicket: '编辑工单', deleteTicket: '删除工单',
      deleteWarning: (title) => `确认删除工单"${title}"？相关图片也将被移除。`,
      title: '标题 *', titlePlaceholder: '简短描述',
      description: '详情', descriptionPlaceholder: '复现步骤、预期与实际现象等',
      status: '状态', priority: '优先级',
      reporter: '提交人', reporterPlaceholder: '你的名字（可选）',
      images: '图片', addImage: '添加图片', uploading: '上传中…', removeImage: '移除',
      imageDropHint: '点击添加图片（PNG / JPG）',
      statOpen: '待处理', statInProgress: '处理中', statResolved: '已解决', statClosed: '已关闭',
      sOpen: '待处理', sInProgress: '处理中', sResolved: '已解决', sClosed: '已关闭',
      pLow: '低', pNormal: '中', pHigh: '高',
      filterAll: '全部',
      countTicket: (n) => `共 ${n} 个工单`,
      titleRequired: '标题不能为空',
      uploadFailed: '图片上传失败',
      noImages: '暂无图片',
    },
    addUser: '添加用户',
    addCoach: '添加 Coach', addDot: '添加原粒', addItem: '添加商品', addChannel: '添加渠道', addInvite: '创建邀请码', addDevice: '注册设备',
    countCoach: (n) => `共 ${n} 位 Coach`,
    countDot: (n) => `共 ${n} 个原粒`,
    countItem: (n) => `共 ${n} 件商品`,
    countOrder: (n) => `共 ${n} 笔订单`,
    countChannel: (n) => `共 ${n} 个渠道`,
    countInvite: (n) => `共 ${n} 个邀请码`,
    countDevice: (n) => `共 ${n} 台设备`,
    modal: {
      addUser: '添加用户', editUser: '编辑用户', deleteUser: '删除用户',
      addCoach: '添加 Coach', editCoach: '编辑 Coach', deleteCoach: '删除 Coach',
      addDot: '添加原粒', editDot: '编辑原粒', deleteDot: '删除原粒',
      externalId: '外部 ID', externalIdPlaceholder: '例如 wx_abc123',
      externalApp: '外部应用',
      nickname: '昵称', nicknamePlaceholder: '显示名称',
      gender: '性别', male: '男', female: '女',
      birthDate: '出生日期', language: '语言',
      langZh: '中文 (ZH)', langEn: '英文 (EN)',
      assignedCoach: '负责 Coach', unassigned: '未分配',
      name: '姓名 *', email: '邮箱', phone: '电话',
      keyName: '标识 *', keyNamePlaceholder: '例如 omega3',
      nameEn: '名称 (英) *', nameZh: '名称 (中)',
      color: '颜色', colorPlaceholder: '#FF6B35',
      colorZh: '颜色 (中)', colorHex: '颜色十六进制',
      description: '描述',
      isIsolate: '类型', isolate: '单体', blend: '复合',
      timing: '服用时间', timingMorning: '早上', timingEvening: '晚上',
      group: '功能分组', subAge: '目标年龄',
      ingredientsSummary: '成分摘要',
      coating: '包衣', coatingGastric: '胃溶 (胃部)', coatingEnteric: '肠溶 (肠道)',
      ingredients: '成分列表', addIngredient: '+ 添加行',
      ingredientNameEn: '英文名', ingredientNameZh: '中文名', ingredientMg: 'mg',
      cancel: '取消', save: '保存', saving: '保存中…',
      delete: '删除', deleting: '删除中…',
      deleteWarning: (name) => `确认删除 ${name}？此操作将同时删除该用户的所有生物标志物、扫描记录和通知。`,
      deleteBlockedByRoles: (roles) => `无法删除：该用户拥有附加角色（${roles}），请先移除所有附加角色。`,
      deleteCoachWarning: (name) => `确认删除 Coach ${name}？其名下用户将变为未分配状态。`,
      deleteDotWarning: (name) => `确认删除原粒"${name}"？此操作不可撤销。`,
      addItem: '添加商品', editItem: '编辑商品', deleteItem: '删除商品',
      deleteItemWarning: (name) => `确认删除"${name}"？此操作不可撤销。`,
      descEn: '描述 (英)', descZh: '描述 (中)',
      unitEn: '单位 (英)', unitZh: '单位 (中)',
      priceCny: '售价 CNY *', priceUsd: '售价 USD *',
      tag: '标签', noTag: '无标签', tagBestseller: '热销', tagValue: '超值',
      sortOrder: '排序', active: '上架',
      externalIdRequired: '外部 ID 为必填项',
      nameRequired: '姓名为必填项',
      keyRequired: '标识为必填项',
      saveFailed: '保存失败',
      addChannel: '添加渠道', editChannel: '编辑渠道', deleteChannel: '删除渠道',
      deleteChannelWarning: (name) => `确认删除渠道"${name}"？该渠道下的 Coach 和用户将失去渠道关联。`,
      channelKeyName: '标识 *', channelName: '显示名称 *', channelLogoUrl: 'Logo URL',
      channel: '渠道', channelUnassigned: '无渠道',
      roles: '角色', roleUser: '用户', roleCoach: '教练', roleAdmin: '渠道管理员', roleSuperadmin: '超级管理员',
      linkedUserId: '关联用户 ID', linkedUserIdPlaceholder: '微信 user_id',
      addInvite: '创建邀请码', deactivateInvite: '停用',
      deleteInviteWarning: (code) => `确认停用邀请码"${code}"？该码将无法继续使用。`,
      inviteType: '类型', inviteTypeCoach: 'Coach', inviteTypeChannel: '渠道', inviteTypeAdmin: '管理员',
      inviteMaxUses: '使用上限', inviteMaxUsesPlaceholder: '留空 = 不限次数',
      inviteChannel: '渠道 *',
      addDevice: '注册 Kino 设备', editDevice: '编辑 Kino 设备', deleteDevice: '移除设备',
      deleteDeviceWarning: (sn) => `确认移除 Kino 设备"${sn}"？历史生物标志物关联将保留，但设备将不再被追踪。`,
      serialNumber: '序列号 *', serialNumberPlaceholder: '例如 KNO-2024-0001',
      deviceName: '显示名称', deviceNamePlaceholder: '例如 诊所 A 机',
      deviceStatus: '状态', statusActive: '运行中', statusInactive: '停用', statusMaintenance: '维护中',
      deviceNotes: '备注', deviceNotesPlaceholder: '可选备注…',
      assignedCoachDevice: '负责 Coach', assignedChannelDevice: '所属渠道',
    },
    dotType: { isolate: '单体', blend: '复合' },
    store: {
      itemsTab: '商品', ordersTab: '订单',
      priceCny: '售价 (CNY)', priceUsd: '售价 (USD)', tag: '标签', active: '上架',
      qty: '数量', status: '状态', orderedAt: '下单时间', yes: '是', no: '否',
      pending: '待处理', confirmed: '已确认', shipped: '已发货',
      delivered: '已送达', cancelled: '已取消',
      image: '图片', uploadImage: '点击上传图片（PNG / JPG）',
      uploading: '上传中…', uploadFailed: '图片上传失败', removeImage: '移除图片',
    },
    invites: { active: '有效', deactivated: '已停用', unlimited: '不限' },
    rewards: {
      settingsTab: '费率设置', channelPayoutsTab: '渠道结算', coachCommissionsTab: 'Coach 佣金',
      role: '角色', productType: '产品类型', flatRate: '固定佣金 (¥)', pct: '比例 (%)',
      coach: 'Coach', channel: '渠道', chip: '芯片', dot: '原粒', subscription: '订阅',
      generatePayouts: '生成结算单', period: '周期 (YYYY-MM)',
      channelName: '渠道', totalCny: '金额 (¥)', status: '状态', approvedAt: '审批时间',
      transferredAt: '转账时间', approve: '审批通过', markTransferred: '标记已转账',
      draft: '草稿', approved: '已审批', transferred: '已转账',
      coachName: 'Coach', channelCol: '渠道', productTypeCol: '产品', amountCny: '金额 (¥)',
      orderId: '订单', createdAt: '时间',
      noSettings: '暂无设置', noPayouts: '暂无结算单', noCommissions: '暂无佣金记录',
      generate: '生成', generating: '生成中…', saved: '已保存', saveFailed: '保存失败',
      totalPayouts: '渠道结算', pendingPayouts: '待审批', totalCommissions: 'Coach 佣金', totalEarned: '佣金总额',
    },
    academy: {
      coursesTab: '课程', libraryTab: '文库',
      uploadCourse: '上传课程', editCourse: '编辑课程', deleteCourse: '删除课程',
      uploadDoc: '上传文档', deleteDoc: '删除文档',
      title: '标题 *', description: '描述', status: '状态', videoFile: '视频文件', mdFile: 'Markdown 文件',
      draft: '草稿', published: '已发布',
      selectVideo: '点击选择视频文件', replaceVideo: '点击更换视频',
      selectMd: '点击选择 .md 文件',
      uploading: '上传中…', uploadFailed: '上传失败',
      titleRequired: '标题为必填项', fileRequired: '文件为必填项',
      hasVideo: '视频', fileSize: '大小',
      totalCourses: '课程总数', totalDocs: '文档总数',
      countCourses: (n) => `共 ${n} 门课程`,
      countDocs: (n) => `共 ${n} 份文档`,
      noCourses: '暂无课程', noDocs: '暂无文档',
      deleteCourseWarning: (t) => `确认删除课程"${t}"？视频文件也将从存储中移除。`,
      deleteDocWarning: (t) => `确认删除文档"${t}"？文件也将从存储中移除。`,
      viewVideo: '查看视频', viewDoc: '查看文档',
    },
    reports: {
      title: 'AI 数据报表',
      placeholder: '用自然语言提问，例如："按月显示用户注册数"',
      run: '运行报表', running: '运行中…', newReport: '新建报表',
      exportCsv: '导出 CSV', showSql: '查看 SQL', hideSql: '收起 SQL',
      insights: '洞察', dataTable: '数据表格', chart: '图表',
      history: '历史记录', emptyHistory: '暂无历史报表', sqlLabel: '生成的 SQL',
      rowCount: (n) => `${n} 行`, errorPrefix: '错误：',
      saved: '已保存报表', emptySaved: '暂无已保存报表',
      saveReport: '保存报表', editReport: '编辑报表',
      reportTitle: '报表名称', reportQuery: '查询语句',
      rerunSave: '重新运行并保存',
      samples: [
        '按月统计用户注册数',
        '按收入排名前5的渠道',
        '有多少用户完成了生物标志物检测？',
        '按状态分类的订单',
        '本月 Coach 佣金汇总',
        '活跃与非活跃 Kino 设备对比',
      ],
    },
  },
};

const LangCtx = createContext({ lang: 'en', t: T.en, toggleLang: () => {} });
const useLang = () => useContext(LangCtx);

// ── helpers ───────────────────────────────────────────────────────────────────

const fmt = (v) => (v == null || v === '' ? '—' : v);
const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';
const bioAgeColor = (bio, chrono) => {
  if (!bio || !chrono) return '#64748b';
  return Number(bio) <= Number(chrono) ? '#16a34a' : '#dc2626';
};
const ALL_ROLES = ['user', 'coach', 'admin', 'superadmin'];
const EMPTY_USER = { nickname: '', gender: '', birth_date: '', language: 'zh', external_id: '', external_app: 'wechat', coach_id: '', channel_id: '', phone: '', email: '', roles: ['user'] };

// ── shared components ─────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color = '#3b82f6' }) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ background: color + '1a', color }}>
        <Icon size={20} />
      </div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function Badge({ children, color = '#3b82f6' }) {
  return <span className="badge" style={{ background: color + '1a', color }}>{children}</span>;
}

function CoachSelect({ userId, currentCoachId, coaches, onAssign }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleChange = async (e) => {
    const coachId = e.target.value === '' ? null : parseInt(e.target.value);
    setBusy(true);
    try { await axios.post('/api/assign-coach', { user_id: userId, coach_id: coachId }); onAssign(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="select-wrap">
      <select value={currentCoachId ?? ''} onChange={handleChange} disabled={busy} className="inline-select">
        <option value="">{t.table.unassigned}</option>
        {coaches.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <ChevronDown size={11} className="select-chevron" />
    </div>
  );
}

// ── User modal ────────────────────────────────────────────────────────────────

function UserModal({ user, coaches, channels, onClose, onSave }) {
  const { t } = useLang();
  const isEdit = !!(user?.user_id || user?.id);
  const userId = user?.user_id || user?.id;
  const [form, setForm] = useState(isEdit
    ? { nickname: user.nickname || '', gender: user.gender || '', birth_date: user.birth_date ? user.birth_date.slice(0, 10) : '', language: user.language || 'zh', external_id: user.external_id || '', external_app: user.external_app || 'wechat', coach_id: user.coach_id ?? '', channel_id: user.channel_id ?? '', phone: user.phone || '', email: user.email || '', roles: user.roles || ['user'] }
    : { ...EMPTY_USER });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const toggleRole = (role) => {
    if (role === 'user') return; // 'user' is always required
    const current = form.roles || ['user'];
    const next = current.includes(role) ? current.filter(r => r !== role) : [...current, role];
    set('roles', next);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const payload = { ...form, coach_id: form.coach_id === '' ? null : parseInt(form.coach_id) };
      const finalPayload = { ...payload, channel_id: payload.channel_id === '' ? null : parseInt(payload.channel_id) };
      if (isEdit) await axios.put(`/api/users/${userId}`, finalPayload);
      else await axios.post('/api/users', finalPayload);
      onSave();
    } catch (err) { setError(err.response?.data?.error || t.modal.saveFailed); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEdit ? t.modal.editUser : t.modal.addUser}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field">
              <span>{t.modal.externalApp}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.external_app} onChange={e => set('external_app', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="wechat">WeChat</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="wavenapp">Waven App</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{t.modal.externalId}</span>
              <input value={form.external_id} onChange={e => set('external_id', e.target.value)} disabled={isEdit} placeholder={t.modal.externalIdPlaceholder} />
            </label>
            <label className="form-field">
              <span>{t.modal.nickname}</span>
              <input value={form.nickname} onChange={e => set('nickname', e.target.value)} placeholder={t.modal.nicknamePlaceholder} />
            </label>
            <label className="form-field">
              <span>{t.modal.gender}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.gender} onChange={e => set('gender', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="">—</option>
                  <option value="male">{t.modal.male}</option>
                  <option value="female">{t.modal.female}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{t.modal.birthDate}</span>
              <input type="date" value={form.birth_date} onChange={e => set('birth_date', e.target.value)} />
            </label>
            <label className="form-field">
              <span>{t.modal.language}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.language} onChange={e => set('language', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="zh">{t.modal.langZh}</option>
                  <option value="en">{t.modal.langEn}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{t.modal.assignedCoach}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.coach_id} onChange={e => set('coach_id', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="">{t.modal.unassigned}</option>
                  {coaches.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{t.modal.channel}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.channel_id} onChange={e => set('channel_id', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="">{t.modal.channelUnassigned}</option>
                  {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{t.modal.phone}</span>
              <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+86 138 0000 0000" />
            </label>
            <label className="form-field">
              <span>{t.modal.email}</span>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="user@example.com" />
            </label>
            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label-text">{t.modal.roles}</span>
              <div className="roles-row">
                {ALL_ROLES.map(role => {
                  const checked = (form.roles || ['user']).includes(role);
                  const labels = { user: t.modal.roleUser, coach: t.modal.roleCoach, admin: t.modal.roleAdmin, superadmin: t.modal.roleSuperadmin };
                  return (
                    <label key={role} className={`role-chip${checked ? ' checked' : ''}${role === 'user' ? ' locked' : ''}`} onClick={() => toggleRole(role)}>
                      <span className="role-chip-check">{checked ? '✓' : ''}</span>
                      {labels[role]}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <Check size={14} />{busy ? t.modal.saving : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delete confirm ────────────────────────────────────────────────────────────

function DeleteConfirm({ user, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const extraRoles = (user.roles || ['user']).filter(r => r !== 'user');
  const blocked = extraRoles.length > 0;
  const handleDelete = async () => {
    setBusy(true);
    try { await axios.delete(`/api/users/${user.user_id || user.id}`); onConfirm(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.modal.deleteUser}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {blocked ? (
            <p style={{ marginBottom: 20, color: '#dc2626' }}>
              {t.modal.deleteBlockedByRoles(extraRoles.join(', '))}
            </p>
          ) : (
            <p style={{ marginBottom: 20, color: '#475569' }}>
              {t.modal.deleteWarning(<strong>{user.nickname || user.external_id || user.user_id}</strong>)}
            </p>
          )}
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            {!blocked && (
              <button className="btn-danger" onClick={handleDelete} disabled={busy}>
                <Trash2 size={14} />{busy ? t.modal.deleting : t.modal.delete}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Coach modal ───────────────────────────────────────────────────────────────

const EMPTY_COACH = { name: '', email: '', phone: '', language: 'zh', channel_id: '', user_id: '' };

function CoachModal({ coach, channels, onClose, onSave }) {
  const { t } = useLang();
  const isEdit = !!coach?.id;
  const [form, setForm] = useState(isEdit
    ? { name: coach.name || '', email: coach.email || '', phone: coach.phone || '', language: coach.language || 'zh', channel_id: coach.channel_id ?? '', user_id: coach.user_id || '' }
    : { ...EMPTY_COACH });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError(t.modal.nameRequired); return; }
    setBusy(true); setError('');
    try {
      const coachPayload = { ...form, channel_id: form.channel_id === '' ? null : parseInt(form.channel_id), user_id: form.user_id.trim() || null };
      if (isEdit) await axios.put(`/api/coaches/${coach.id}`, coachPayload);
      else await axios.post('/api/coaches', coachPayload);
      onSave();
    } catch (err) { setError(err.response?.data?.error || t.modal.saveFailed); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEdit ? t.modal.editCoach : t.modal.addCoach}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal.name}</span>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder={t.modal.name.replace(' *', '')} />
            </label>
            <label className="form-field">
              <span>{t.modal.email}</span>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="coach@example.com" />
            </label>
            <label className="form-field">
              <span>{t.modal.phone}</span>
              <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+86 138 0000 0000" />
            </label>
            <label className="form-field">
              <span>{t.modal.language}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.language} onChange={e => set('language', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="zh">{t.modal.langZh}</option>
                  <option value="en">{t.modal.langEn}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{t.modal.channel}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.channel_id} onChange={e => set('channel_id', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="">{t.modal.channelUnassigned}</option>
                  {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal.linkedUserId}</span>
              <input value={form.user_id} onChange={e => set('user_id', e.target.value)} placeholder={t.modal.linkedUserIdPlaceholder} />
            </label>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <Check size={14} />{busy ? t.modal.saving : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteCoachConfirm({ coach, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleDelete = async () => {
    setBusy(true);
    try { await axios.delete(`/api/coaches/${coach.id}`); onConfirm(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.modal.deleteCoach}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 20, color: '#475569' }}>
            {t.modal.deleteCoachWarning(<strong>{coach.name}</strong>)}
          </p>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-danger" onClick={handleDelete} disabled={busy}>
              <Trash2 size={14} />{busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Dot modal ─────────────────────────────────────────────────────────────────

const GROUP_VALUES   = ['BioAge Reducing', 'Energy & Performance Boost', 'System Optimization'];
const GROUP_ZH       = ['生物减龄', '能量焕发', '系统调优'];
const SUB_AGE_VALUES = ['Cellular Age', 'Metabolic Age', 'Micro-Vascular Age', 'Resilience Age'];
const SUB_AGE_ZH     = ['细胞年龄', '代谢年龄', '微血管年龄', '抗压年龄'];

function mergeIngredients(en, zh) {
  const enArr = Array.isArray(en) ? en : [];
  const zhArr = Array.isArray(zh) ? zh : [];
  const len = Math.max(enArr.length, zhArr.length);
  return Array.from({ length: len }, (_, i) => ({
    name_en: enArr[i]?.name || '',
    name_zh: zhArr[i]?.name || '',
    mg: enArr[i]?.mg != null ? String(enArr[i].mg) : '',
  }));
}

const EMPTY_DOT = {
  key_name: '', name: '', name_zh: '', color: '', color_zh: '', color_hex: '',
  group_name: GROUP_VALUES[0], sub_age_target: SUB_AGE_VALUES[0],
  timing: 'Morning', coating: 'gastric', ingredients_summary: '', description: '', is_isolate: false,
  ingredients_combined: [],
};

function DotModal({ dot, onClose, onSave }) {
  const { t } = useLang();
  const isEdit = !!dot?.id;

  const initForm = () => isEdit ? {
    key_name: dot.key_name || '',
    name: dot.name || '', name_zh: dot.name_zh || '',
    color: dot.color || '', color_zh: dot.color_zh || '', color_hex: dot.color_hex || '',
    group_name: dot.group_name || GROUP_VALUES[0],
    sub_age_target: dot.sub_age_target || SUB_AGE_VALUES[0],
    timing: dot.timing || 'Morning',
    coating: dot.coating || 'gastric',
    ingredients_summary: dot.ingredients_summary || '',
    description: dot.description || '',
    is_isolate: !!dot.is_isolate,
    ingredients_combined: mergeIngredients(dot.ingredients, dot.ingredients_zh),
  } : { ...EMPTY_DOT };

  const [form, setForm] = useState(initForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const updateIngredient = (i, field, val) =>
    setForm(f => {
      const arr = [...f.ingredients_combined];
      arr[i] = { ...arr[i], [field]: val };
      return { ...f, ingredients_combined: arr };
    });

  const addIngredient = () =>
    setForm(f => ({ ...f, ingredients_combined: [...f.ingredients_combined, { name_en: '', name_zh: '', mg: '' }] }));

  const removeIngredient = (i) =>
    setForm(f => ({ ...f, ingredients_combined: f.ingredients_combined.filter((_, idx) => idx !== i) }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.key_name.trim()) { setError(t.modal.keyRequired); return; }
    if (!form.name.trim()) { setError(t.modal.nameRequired); return; }
    setBusy(true); setError('');
    try {
      const gIdx = GROUP_VALUES.indexOf(form.group_name);
      const sIdx = SUB_AGE_VALUES.indexOf(form.sub_age_target);
      const filled = form.ingredients_combined.filter(i => i.name_en.trim() || i.name_zh.trim());
      const payload = {
        key_name: form.key_name, name: form.name, name_zh: form.name_zh,
        color: form.color, color_zh: form.color_zh, color_hex: form.color_hex,
        group_name: form.group_name,
        group_name_zh: gIdx >= 0 ? GROUP_ZH[gIdx] : form.group_name,
        sub_age_target: form.sub_age_target,
        sub_age_target_zh: sIdx >= 0 ? SUB_AGE_ZH[sIdx] : form.sub_age_target,
        timing: form.timing,
        coating: form.coating,
        ingredients_summary: form.ingredients_summary,
        description: form.description,
        is_isolate: form.is_isolate,
        ingredients: filled.map(i => ({ name: i.name_en.trim(), mg: i.mg !== '' ? parseFloat(i.mg) : null })),
        ingredients_zh: filled.map(i => ({ name: i.name_zh.trim(), mg: i.mg !== '' ? parseFloat(i.mg) : null })),
      };
      if (isEdit) await axios.put(`/api/dots/${dot.id}`, payload);
      else await axios.post('/api/dots', payload);
      onSave();
    } catch (err) { setError(err.response?.data?.error || t.modal.saveFailed); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEdit ? t.modal.editDot : t.modal.addDot}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field">
              <span>{t.modal.keyName}</span>
              <input value={form.key_name} onChange={e => set('key_name', e.target.value)} disabled={isEdit} placeholder={t.modal.keyNamePlaceholder} />
            </label>
            <label className="form-field">
              <span>{t.modal.isIsolate}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.is_isolate ? 'true' : 'false'} onChange={e => set('is_isolate', e.target.value === 'true')} className="inline-select" style={{ width: '100%' }}>
                  <option value="false">{t.modal.blend}</option>
                  <option value="true">{t.modal.isolate}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{t.modal.nameEn}</span>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Omega-3" />
            </label>
            <label className="form-field">
              <span>{t.modal.nameZh}</span>
              <input value={form.name_zh} onChange={e => set('name_zh', e.target.value)} placeholder="例如 欧米伽-3" />
            </label>
            <label className="form-field">
              <span>{t.modal.timing}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.timing} onChange={e => set('timing', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="Morning">{t.modal.timingMorning}</option>
                  <option value="Evening">{t.modal.timingEvening}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{t.modal.coating}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.coating} onChange={e => set('coating', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="gastric">{t.modal.coatingGastric}</option>
                  <option value="enteric">{t.modal.coatingEnteric}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{t.modal.group}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.group_name} onChange={e => set('group_name', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  {GROUP_VALUES.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal.subAge}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.sub_age_target} onChange={e => set('sub_age_target', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  {SUB_AGE_VALUES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{t.modal.color}</span>
              <input value={form.color} onChange={e => set('color', e.target.value)} placeholder={t.modal.colorPlaceholder} />
            </label>
            <label className="form-field">
              <span>{t.modal.colorZh}</span>
              <input value={form.color_zh} onChange={e => set('color_zh', e.target.value)} placeholder={t.modal.colorPlaceholder} />
            </label>
            <label className="form-field">
              <span>{t.modal.colorHex}</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input value={form.color_hex} onChange={e => set('color_hex', e.target.value)} placeholder="#FF6B35" style={{ flex: 1 }} />
                {form.color_hex && <span style={{ width: 22, height: 22, borderRadius: 4, background: form.color_hex, border: '1px solid #e2e8f0', flexShrink: 0 }} />}
              </div>
            </label>
            <label className="form-field">
              <span>{t.modal.ingredientsSummary}</span>
              <input value={form.ingredients_summary} onChange={e => set('ingredients_summary', e.target.value)} placeholder="e.g. NMN 250mg + Resveratrol 100mg" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal.description}</span>
              <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="…" />
            </label>
            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label-text">{t.modal.ingredients}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                {form.ingredients_combined.map((ing, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input value={ing.name_en} onChange={e => updateIngredient(i, 'name_en', e.target.value)} placeholder={t.modal.ingredientNameEn} style={{ flex: 2 }} />
                    <input value={ing.name_zh} onChange={e => updateIngredient(i, 'name_zh', e.target.value)} placeholder={t.modal.ingredientNameZh} style={{ flex: 2 }} />
                    <input type="number" value={ing.mg} onChange={e => updateIngredient(i, 'mg', e.target.value)} placeholder={t.modal.ingredientMg} style={{ flex: 1 }} />
                    <button type="button" className="icon-btn danger" onClick={() => removeIngredient(i)}><X size={12} /></button>
                  </div>
                ))}
                <button type="button" className="btn-secondary" style={{ alignSelf: 'flex-start', fontSize: 12, padding: '4px 10px', marginTop: 2 }} onClick={addIngredient}>
                  {t.modal.addIngredient}
                </button>
              </div>
            </div>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <Check size={14} />{busy ? t.modal.saving : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteDotConfirm({ dot, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleDelete = async () => {
    setBusy(true);
    try { await axios.delete(`/api/dots/${dot.id}`); onConfirm(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.modal.deleteDot}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 20, color: '#475569' }}>
            {t.modal.deleteDotWarning(dot.name || dot.key_name)}
          </p>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-danger" onClick={handleDelete} disabled={busy}>
              <Trash2 size={14} />{busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sparkline chart ───────────────────────────────────────────────────────────

function Sparkline({ values, color = '#3b82f6', width = 120, height = 36 }) {
  if (!values || values.length < 2) {
    return <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 4;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * w;
    const y = pad + h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  const last = values[values.length - 1];
  const lx = pad + w;
  const ly = pad + h - ((last - min) / range) * h;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="2.5" fill={color} />
    </svg>
  );
}

// ── User detail drawer ────────────────────────────────────────────────────────

const BM_META = [
  { key: 'hsCRP',     label: 'hsCRP',           unit: 'mg/L',      color: '#ef4444' },
  { key: 'GDF15',     label: 'GDF-15',          unit: 'pg/mL',     color: '#f97316' },
  { key: 'IL6',       label: 'IL-6',            unit: 'pg/mL',     color: '#a855f7' },
  { key: 'GA',        label: 'Glycated Albumin', unit: '%',         color: '#3b82f6' },
  { key: 'CystatinC', label: 'Cystatin C',      unit: 'mg/L',      color: '#0ea5e9' },
  { key: 'CD38',      label: 'CD38',            unit: 'xBaseline', color: '#10b981' },
];

function UserDetailDrawer({ user, onClose }) {
  const { t } = useLang();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  const openid = user?.user_id || user?.id;

  useEffect(() => {
    if (!openid) return;
    setLoading(true);
    setFetchError(null);
    axios.get(`/api/biomarkers?openid=${encodeURIComponent(openid)}`)
      .then(r => {
        if (r.data.success === false) throw new Error(r.data.error || 'API error');
        setRecords(r.data.records || []);
      })
      .catch(err => {
        console.error('Biomarker fetch error:', err.message);
        setFetchError(err.message);
        setRecords([]);
      })
      .finally(() => setLoading(false));
  }, [openid]);

  if (!user) return null;

  const latestBm = records.length > 0 ? (records[records.length - 1].data?.estimated || {}) : null;
  const trendFor = (key) => records
    .map(r => r.data?.estimated?.[key])
    .filter(v => v != null);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-title">
            {user.avatar_url
              ? <img src={user.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
              : <div className="avatar" style={{ width: 32, height: 32, fontSize: 14, background: '#3b82f620', color: '#3b82f6' }}>{(user.nickname || 'U')[0].toUpperCase()}</div>
            }
            <span>{user.nickname || user.user_id}</span>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="drawer-body">
          {/* Profile */}
          <div className="drawer-section">
            <div className="drawer-section-title">Profile</div>
            <div className="drawer-info-grid">
              <span className="drawer-info-key">External App</span>
              <span className="drawer-info-val">{fmt(user.external_app)}</span>
              <span className="drawer-info-key">External ID</span>
              <span className="drawer-info-val mono">{fmt(user.external_id)}</span>
              <span className="drawer-info-key">{t.table.gender}</span>
              <span className="drawer-info-val">{fmt(user.gender)}</span>
              <span className="drawer-info-key">{t.table.birthDate}</span>
              <span className="drawer-info-val">{fmtDate(user.birth_date)}</span>
              <span className="drawer-info-key">{t.table.chronoAge}</span>
              <span className="drawer-info-val">{fmt(user.chrono_age)}</span>
              <span className="drawer-info-key">{t.table.bioAge}</span>
              <span className="drawer-info-val" style={{ fontWeight: 700, color: bioAgeColor(user.bio_age, user.chrono_age) }}>
                {fmt(user.bio_age)}
              </span>
              <span className="drawer-info-key">{t.table.language}</span>
              <span className="drawer-info-val">{(user.language || '—').toUpperCase()}</span>
              <span className="drawer-info-key">{t.table.assignedCoach}</span>
              <span className="drawer-info-val">{fmt(user.coach_name)}</span>
              <span className="drawer-info-key">{t.table.joined}</span>
              <span className="drawer-info-val">{fmtDate(user.created_at)}</span>
              <span className="drawer-info-key">{t.modal.phone}</span>
              <span className="drawer-info-val">{fmt(user.phone)}</span>
              <span className="drawer-info-key">{t.modal.email}</span>
              <span className="drawer-info-val">{fmt(user.email)}</span>
              <span className="drawer-info-key">{t.table.roles}</span>
              <span className="drawer-info-val">
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {(user.roles || ['user']).map(r => (
                    <Badge key={r} color={r === 'superadmin' ? '#dc2626' : r === 'admin' ? '#f59e0b' : r === 'coach' ? '#8b5cf6' : '#64748b'}>{r}</Badge>
                  ))}
                </div>
              </span>
            </div>
          </div>

          {/* Latest Biomarkers */}
          <div className="drawer-section">
            <div className="drawer-section-title">Latest Biomarkers</div>
            {loading ? (
              <div className="drawer-empty">Loading…</div>
            ) : fetchError ? (
              <div className="drawer-error">API error: {fetchError}</div>
            ) : latestBm ? (
              <div className="bm-table">
                {BM_META.map(({ key, label, unit, color }) => (
                  <div key={key} className="bm-table-row">
                    <span className="bm-table-label">{label}</span>
                    <span className="bm-table-val" style={{ color }}>{latestBm[key] ?? '—'}</span>
                    <span className="bm-table-unit">{unit}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="drawer-empty">No biomarker data yet.</div>
            )}
          </div>

          {/* Trend charts */}
          <div className="drawer-section">
            <div className="drawer-section-title">Biomarker Trends ({records.length} test{records.length !== 1 ? 's' : ''})</div>
            {loading ? (
              <div className="drawer-empty">Loading…</div>
            ) : fetchError ? (
              <div className="drawer-error">API error: {fetchError}</div>
            ) : records.length > 0 ? (
              <div className="trend-grid">
                {BM_META.map(({ key, label, unit, color }) => {
                  const vals = trendFor(key);
                  const last = vals[vals.length - 1];
                  return (
                    <div key={key} className="trend-card">
                      <div className="trend-label">{label}</div>
                      <div className="trend-val" style={{ color }}>
                        {last != null ? last : '—'}
                        <span className="trend-unit">{unit}</span>
                      </div>
                      <Sparkline values={vals} color={color} width={130} height={38} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="drawer-empty">No test history yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Users tab ─────────────────────────────────────────────────────────────────

function UsersTab({ users, coaches, channels, onRefresh }) {
  const { t } = useLang();
  const [modal, setModal] = useState(null);
  const [detailUser, setDetailUser] = useState(null);
  const tested = users.filter(u => u.bio_age).length;
  const avgBioAge = tested
    ? (users.filter(u => u.bio_age).reduce((s, u) => s + Number(u.bio_age), 0) / tested).toFixed(1)
    : '—';
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Users}    label={t.stats.totalUsers} value={users.length} color="#3b82f6" />
        <StatCard icon={Activity} label={t.stats.tested}     value={tested}       color="#8b5cf6" />
        <StatCard icon={Calendar} label={t.stats.avgBioAge}  value={avgBioAge}    color="#f59e0b" />
        <StatCard icon={UserCog}  label={t.stats.coaches}    value={coaches.length} color="#10b981" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{t.count(users.length)}</span>
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
            <Plus size={14} />{t.addUser}
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.table.id}</th><th>{t.table.nickname}</th><th>{t.table.channel}</th><th>{t.table.roles}</th><th>{t.table.gender}</th>
              <th>{t.table.birthDate}</th><th>{t.table.language}</th>
              <th>{t.table.bioAge}</th><th>{t.table.chronoAge}</th>
              <th>{t.table.assignedCoach}</th><th>{t.table.joined}</th>
              <th>{t.modal.phone}</th><th>{t.modal.email}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && <tr><td colSpan={14} className="empty-row">{t.empty.users}</td></tr>}
            {users.map(u => (
              <tr key={u.user_id} className="clickable-row" onClick={() => setDetailUser(u)}>
                <td className="muted">{u.user_id}</td>
                <td>
                  <div className="avatar-cell">
                    {u.avatar_url
                      ? <img src={u.avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                      : <div className="avatar" style={{ background: '#3b82f620', color: '#3b82f6' }}>{(u.nickname || 'U')[0].toUpperCase()}</div>
                    }
                    <span className="bold">{fmt(u.nickname)}</span>
                  </div>
                </td>
                <td>{u.channel_name ? <Badge color="#6366f1">{u.channel_name}</Badge> : '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {(u.roles || ['user']).map(r => (
                      <Badge key={r} color={r === 'superadmin' ? '#dc2626' : r === 'admin' ? '#f59e0b' : r === 'coach' ? '#8b5cf6' : '#64748b'}>{r}</Badge>
                    ))}
                  </div>
                </td>
                <td>{fmt(u.gender)}</td>
                <td className="muted">{fmtDate(u.birth_date)}</td>
                <td><Badge color={u.language === 'zh' ? '#16a34a' : '#2563eb'}>{(u.language || 'zh').toUpperCase()}</Badge></td>
                <td style={{ fontWeight: 700, color: bioAgeColor(u.bio_age, u.chrono_age) }}>{fmt(u.bio_age)}</td>
                <td className="muted">{fmt(u.chrono_age)}</td>
                <td onClick={e => e.stopPropagation()}>
                  <CoachSelect userId={u.user_id} currentCoachId={u.coach_id} coaches={coaches} onAssign={onRefresh} />
                </td>
                <td className="muted">{fmtDate(u.created_at)}</td>
                <td className="muted">{fmt(u.phone)}</td>
                <td className="muted">{fmt(u.email)}</td>
                <td onClick={e => e.stopPropagation()}>
                  <div className="row-actions">
                    <button className="icon-btn" title={t.modal.editUser} onClick={() => setModal({ type: 'edit', user: u })}><Pencil size={14} /></button>
                    <button className="icon-btn danger" title={t.modal.deleteUser} onClick={() => setModal({ type: 'delete', user: u })}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal?.type === 'add'    && <UserModal user={null}       coaches={coaches} channels={channels} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit'   && <UserModal user={modal.user} coaches={coaches} channels={channels} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete' && <DeleteConfirm user={modal.user} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
      {detailUser && <UserDetailDrawer user={detailUser} onClose={() => setDetailUser(null)} />}
    </>
  );
}

// ── Coach tab ─────────────────────────────────────────────────────────────────

function CoachTab({ coaches, users, channels, onRefresh }) {
  const { t } = useLang();
  const [modal, setModal] = useState(null);
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  return (
    <>
      <div className="stat-row">
        <StatCard icon={UserCog} label={t.stats.totalCoaches}    value={coaches.length}                         color="#10b981" />
        <StatCard icon={Users}   label={t.stats.assignedUsers}   value={users.filter(u => u.coach_id).length}  color="#3b82f6" />
        <StatCard icon={Users}   label={t.stats.unassignedUsers} value={users.filter(u => !u.coach_id).length} color="#f59e0b" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{t.countCoach(coaches.length)}</span>
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
            <Plus size={14} />{t.addCoach}
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr><th>{t.table.id}</th><th>{t.table.name}</th><th>{t.table.channel}</th><th>{t.table.linkedUser}</th><th>{t.table.email}</th><th>{t.table.phone}</th><th>{t.table.language}</th><th>{t.table.customers}</th><th>{t.table.joined}</th><th></th></tr>
          </thead>
          <tbody>
            {coaches.length === 0 && <tr><td colSpan={10} className="empty-row">{t.empty.coaches}</td></tr>}
            {coaches.map(p => (
              <tr key={p.id}>
                <td className="muted">{p.id}</td>
                <td>
                  <div className="avatar-cell">
                    <div className="avatar" style={{ background: '#10b98120', color: '#10b981' }}>{(p.name || 'C')[0].toUpperCase()}</div>
                    <span className="bold">{fmt(p.name)}</span>
                  </div>
                </td>
                <td>{p.channel_name ? <Badge color="#6366f1">{p.channel_name}</Badge> : '—'}</td>
                <td className="muted mono" style={{ fontSize: 11 }}>{p.user_id ? p.user_id : '—'}</td>
                <td className="muted">{fmt(p.email)}</td>
                <td className="muted">{fmt(p.phone)}</td>
                <td><Badge color={p.language === 'zh' ? '#16a34a' : '#2563eb'}>{(p.language || 'zh').toUpperCase()}</Badge></td>
                <td><Badge color="#3b82f6">{p.user_count || 0}</Badge></td>
                <td className="muted">{fmtDate(p.created_at)}</td>
                <td>
                  <div className="row-actions">
                    <button className="icon-btn" title={t.modal.editCoach} onClick={() => setModal({ type: 'edit', coach: p })}><Pencil size={14} /></button>
                    <button className="icon-btn danger" title={t.modal.deleteCoach} onClick={() => setModal({ type: 'delete', coach: p })}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal?.type === 'add'    && <CoachModal coach={null}        channels={channels} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit'   && <CoachModal coach={modal.coach} channels={channels} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete' && <DeleteCoachConfirm coach={modal.coach} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
    </>
  );
}

// ── Dots tab ──────────────────────────────────────────────────────────────────

function DotsTab({ dots, onRefresh }) {
  const { t } = useLang();
  const [modal, setModal] = useState(null);
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Droplets} label={t.stats.totalDots} value={dots.length}                            color="#8b5cf6" />
        <StatCard icon={Droplets} label={t.stats.isolates}  value={dots.filter(d => d.is_isolate).length}  color="#ec4899" />
        <StatCard icon={Droplets} label={t.stats.blends}    value={dots.filter(d => !d.is_isolate).length} color="#f59e0b" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{t.countDot(dots.length)}</span>
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
            <Plus size={14} />{t.addDot}
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.table.key}</th><th>{t.table.nameEn}</th><th>{t.table.nameZh}</th>
              <th>{t.table.timing}</th><th>{t.table.coating}</th><th>{t.table.group}</th><th>{t.table.subAge}</th>
              <th>{t.table.color}</th><th>{t.table.type}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {dots.length === 0 && <tr><td colSpan={10} className="empty-row">{t.empty.dots}</td></tr>}
            {dots.map(d => (
              <tr key={d.id}>
                <td><code className="code-tag">{d.key_name}</code></td>
                <td className="bold">{fmt(d.name)}</td>
                <td>{fmt(d.name_zh)}</td>
                <td>
                  <Badge color={d.timing === 'Evening' ? '#8b5cf6' : '#f59e0b'}>
                    {d.timing === 'Evening' ? t.modal.timingEvening : t.modal.timingMorning}
                  </Badge>
                </td>
                <td>
                  {d.coating === 'enteric' ? (
                    <Badge color="#10b981">{t.modal.coatingEnteric}</Badge>
                  ) : (
                    <span className="muted" style={{ fontSize: 11 }}>{t.modal.coatingGastric}</span>
                  )}
                </td>
                <td className="muted" style={{ fontSize: 11, maxWidth: 130 }}>{fmt(d.group_name)}</td>
                <td className="muted" style={{ fontSize: 11 }}>{fmt(d.sub_age_target)}</td>
                <td>
                  <div className="color-cell">
                    <span className="color-dot" style={{ background: d.color_hex || d.color?.toLowerCase() || '#ccc' }} />
                    {fmt(d.color)}
                  </div>
                </td>
                <td><Badge color={d.is_isolate ? '#ec4899' : '#f59e0b'}>{d.is_isolate ? t.dotType.isolate : t.dotType.blend}</Badge></td>
                <td>
                  <div className="row-actions">
                    <button className="icon-btn" title={t.modal.editDot} onClick={() => setModal({ type: 'edit', dot: d })}><Pencil size={14} /></button>
                    <button className="icon-btn danger" title={t.modal.deleteDot} onClick={() => setModal({ type: 'delete', dot: d })}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal?.type === 'add'    && <DotModal dot={null}       onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit'   && <DotModal dot={modal.dot} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete' && <DeleteDotConfirm dot={modal.dot} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
    </>
  );
}

// ── Store tab ─────────────────────────────────────────────────────────────────

const EMPTY_ITEM = {
  key_name: '', name_en: '', name_zh: '', desc_en: '', desc_zh: '',
  unit_en: '', unit_zh: '', price_cny: '', price_usd: '',
  tag: '', sort_order: 0, active: true, image_url: '',
};

function StoreItemModal({ item, onClose, onSave }) {
  const { t } = useLang();
  const isEdit = !!item?.id;
  const [form, setForm] = useState(isEdit
    ? { key_name: item.key_name, name_en: item.name_en || '', name_zh: item.name_zh || '',
        desc_en: item.desc_en || '', desc_zh: item.desc_zh || '',
        unit_en: item.unit_en || '', unit_zh: item.unit_zh || '',
        price_cny: item.price_cny ?? '', price_usd: item.price_usd ?? '',
        tag: item.tag || '', sort_order: item.sort_order ?? 0, active: item.active !== false,
        image_url: item.image_url || '' }
    : { ...EMPTY_ITEM });
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleImagePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true); setUploadProgress(0); setError('');
    try {
      const presignRes = await axios.get('/api/oss/presign', {
        params: { type: 'image', filename: file.name, category: 'store' },
      });
      if (!presignRes.data.success) throw new Error(presignRes.data.error || t.store.uploadFailed);
      const { url, get_url } = presignRes.data;
      await uploadToOSS(url, file, setUploadProgress);
      set('image_url', get_url);
    } catch (err) {
      setError(err.response?.data?.error || err.message || t.store.uploadFailed);
    } finally { setUploading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.key_name.trim()) { setError(t.modal.keyRequired); return; }
    if (!form.name_en.trim())  { setError(t.modal.nameRequired); return; }
    setBusy(true); setError('');
    try {
      if (isEdit) await axios.put(`/api/store-items/${item.id}`, form);
      else        await axios.post('/api/store-items', form);
      onSave();
    } catch (err) { setError(err.response?.data?.error || t.modal.saveFailed); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEdit ? t.modal.editItem : t.modal.addItem}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field">
              <span>{t.modal.keyName}</span>
              <input value={form.key_name} onChange={e => set('key_name', e.target.value)} disabled={isEdit} placeholder="e.g. kino-chip-1" />
            </label>
            <label className="form-field">
              <span>{t.modal.tag}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.tag} onChange={e => set('tag', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="">{t.modal.noTag}</option>
                  <option value="bestseller">{t.modal.tagBestseller}</option>
                  <option value="value">{t.modal.tagValue}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{t.modal.nameEn}</span>
              <input value={form.name_en} onChange={e => set('name_en', e.target.value)} placeholder="e.g. Kino Biomarker Test Chip" />
            </label>
            <label className="form-field">
              <span>{t.modal.nameZh}</span>
              <input value={form.name_zh} onChange={e => set('name_zh', e.target.value)} placeholder="例如 Kino 生物标志物检测芯片" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal.descEn}</span>
              <input value={form.desc_en} onChange={e => set('desc_en', e.target.value)} placeholder="Short description in English" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal.descZh}</span>
              <input value={form.desc_zh} onChange={e => set('desc_zh', e.target.value)} placeholder="中文简短描述" />
            </label>
            <label className="form-field">
              <span>{t.modal.unitEn}</span>
              <input value={form.unit_en} onChange={e => set('unit_en', e.target.value)} placeholder="e.g. 1 chip" />
            </label>
            <label className="form-field">
              <span>{t.modal.unitZh}</span>
              <input value={form.unit_zh} onChange={e => set('unit_zh', e.target.value)} placeholder="例如 1 片" />
            </label>
            <label className="form-field">
              <span>{t.modal.priceCny}</span>
              <input type="number" step="0.01" min="0" value={form.price_cny} onChange={e => set('price_cny', e.target.value)} placeholder="298.00" />
            </label>
            <label className="form-field">
              <span>{t.modal.priceUsd}</span>
              <input type="number" step="0.01" min="0" value={form.price_usd} onChange={e => set('price_usd', e.target.value)} placeholder="39.99" />
            </label>
            <label className="form-field">
              <span>{t.modal.sortOrder}</span>
              <input type="number" min="0" value={form.sort_order} onChange={e => set('sort_order', e.target.value)} />
            </label>
            <label className="form-field">
              <span>{t.modal.active}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.active ? 'true' : 'false'} onChange={e => set('active', e.target.value === 'true')} className="inline-select" style={{ width: '100%' }}>
                  <option value="true">{t.store.yes}</option>
                  <option value="false">{t.store.no}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>

            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label-text">{t.store.image}</span>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginTop: 6 }}>
                {form.image_url ? (
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <img src={form.image_url} alt=""
                         style={{ width: 80, height: 80, borderRadius: 8, objectFit: 'cover', border: '1px solid rgba(99,117,236,0.3)' }} />
                    <button type="button" className="icon-btn" title={t.store.removeImage}
                            onClick={() => set('image_url', '')}
                            style={{ position: 'absolute', top: -6, right: -6, background: '#0F2540', border: '1px solid rgba(99,117,236,0.4)', borderRadius: '50%', width: 22, height: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <X size={12} />
                    </button>
                  </div>
                ) : null}
                <label className="upload-zone" style={{ flex: 1, minHeight: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: uploading ? 'wait' : 'pointer', flexDirection: 'column', gap: 6 }}>
                  <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" style={{ display: 'none' }} onChange={handleImagePick} disabled={uploading} />
                  {uploading ? (
                    <>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{t.store.uploading}</span>
                      <div className="upload-progress" style={{ width: '80%' }}>
                        <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
                      </div>
                    </>
                  ) : (
                    <span className="upload-zone-hint" style={{ textAlign: 'center' }}>
                      {form.image_url ? '↺ ' : ''}{t.store.uploadImage}
                    </span>
                  )}
                </label>
              </div>
            </div>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={uploading}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy || uploading}>
              <Check size={14} />{busy ? t.modal.saving : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteStoreItemConfirm({ item, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleDelete = async () => {
    setBusy(true);
    try { await axios.delete(`/api/store-items/${item.id}`); onConfirm(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.modal.deleteItem}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 20, color: '#475569' }}>
            {t.modal.deleteItemWarning(<strong>{item.name_en || item.key_name}</strong>)}
          </p>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-danger" onClick={handleDelete} disabled={busy}>
              <Trash2 size={14} />{busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

function OrderStatusSelect({ orderId, status, onSave }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleChange = async (e) => {
    setBusy(true);
    try { await axios.put(`/api/orders/${orderId}`, { status: e.target.value }); onSave(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  const color = { pending: '#f59e0b', confirmed: '#3b82f6', shipped: '#8b5cf6', delivered: '#10b981', cancelled: '#94a3b8' }[status] || '#94a3b8';
  return (
    <div className="select-wrap">
      <select value={status} onChange={handleChange} disabled={busy} className="inline-select" style={{ color }}>
        {ORDER_STATUSES.map(s => <option key={s} value={s}>{t.store[s]}</option>)}
      </select>
      <ChevronDown size={11} className="select-chevron" />
    </div>
  );
}

function StoreTab({ storeItems, orders, onRefresh }) {
  const { t } = useLang();
  const [subTab, setSubTab] = useState('items');
  const [modal, setModal] = useState(null);
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  const activeCount  = storeItems.filter(i => i.active).length;
  const pendingCount = orders.filter(o => o.status === 'pending').length;

  return (
    <>
      <div className="stat-row">
        <StatCard icon={ShoppingBag} label={t.stats.totalItems}    value={storeItems.length} color="#6366f1" />
        <StatCard icon={ShoppingBag} label={t.stats.activeItems}   value={activeCount}       color="#10b981" />
        <StatCard icon={Package}     label={t.stats.totalOrders}   value={orders.length}     color="#3b82f6" />
        <StatCard icon={Package}     label={t.stats.pendingOrders} value={pendingCount}      color="#f59e0b" />
      </div>

      <div className="subtab-row">
        <button className={`subtab-btn${subTab === 'items' ? ' active' : ''}`} onClick={() => setSubTab('items')}>
          <ShoppingBag size={13} />{t.store.itemsTab}
        </button>
        <button className={`subtab-btn${subTab === 'orders' ? ' active' : ''}`} onClick={() => setSubTab('orders')}>
          <Package size={13} />{t.store.ordersTab}
        </button>
      </div>

      {subTab === 'items' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{t.countItem(storeItems.length)}</span>
            <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
              <Plus size={14} />{t.addItem}
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.store.image}</th>
                <th>{t.table.key}</th>
                <th>{t.table.nameEn}</th>
                <th>{t.table.nameZh}</th>
                <th>{t.store.priceCny}</th>
                <th>{t.store.priceUsd}</th>
                <th>{t.store.tag}</th>
                <th>{t.store.active}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {storeItems.length === 0 && <tr><td colSpan={9} className="empty-row">{t.empty.store}</td></tr>}
              {storeItems.map(item => (
                <tr key={item.id}>
                  <td>
                    {item.image_url
                      ? <img src={item.image_url} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', border: '1px solid rgba(99,117,236,0.25)', display: 'block' }} />
                      : <div style={{ width: 40, height: 40, borderRadius: 6, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ImageIcon size={16} style={{ color: '#475569' }} /></div>
                    }
                  </td>
                  <td><code className="code-tag">{item.key_name}</code></td>
                  <td className="bold">{fmt(item.name_en)}</td>
                  <td className="muted">{fmt(item.name_zh)}</td>
                  <td>¥{item.price_cny}</td>
                  <td className="muted">${item.price_usd}</td>
                  <td>{item.tag ? <Badge color="#6366f1">{item.tag}</Badge> : '—'}</td>
                  <td>
                    <Badge color={item.active ? '#10b981' : '#94a3b8'}>
                      {item.active ? t.store.yes : t.store.no}
                    </Badge>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" title={t.modal.editItem} onClick={() => setModal({ type: 'edit', item })}><Pencil size={14} /></button>
                      <button className="icon-btn danger" title={t.modal.deleteItem} onClick={() => setModal({ type: 'delete', item })}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'orders' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{t.countOrder(orders.length)}</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{t.table.nickname}</th>
                <th>{t.table.nameEn}</th>
                <th>{t.store.qty}</th>
                <th>{t.store.priceCny}</th>
                <th>{t.store.status}</th>
                <th>{t.store.orderedAt}</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && <tr><td colSpan={7} className="empty-row">{t.empty.orders}</td></tr>}
              {orders.map(o => (
                <tr key={o.id}>
                  <td><span className="mono muted">{o.id.slice(0, 8)}…</span></td>
                  <td>{fmt(o.nickname || o.user_id)}</td>
                  <td className="bold">{fmt(o.name_en)}</td>
                  <td>{o.quantity}</td>
                  <td>¥{o.price_cny}</td>
                  <td><OrderStatusSelect orderId={o.id} status={o.status} onSave={onRefresh} /></td>
                  <td className="muted">{fmtDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.type === 'add'    && <StoreItemModal item={null}       onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit'   && <StoreItemModal item={modal.item} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete' && <DeleteStoreItemConfirm item={modal.item} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
    </>
  );
}

// ── Academy helpers ───────────────────────────────────────────────────────────

function uploadToOSS(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: HTTP ${xhr.status}`));
    });
    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.send(file);
  });
}

function fmtBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Academy modals ────────────────────────────────────────────────────────────

function CourseModal({ course, onClose, onSave }) {
  const { t } = useLang();
  const ta = t.academy;
  const isEdit = !!course?.id;
  const [form, setForm] = useState({
    title: course?.title || '',
    description: course?.description || '',
    status: course?.status || 'draft',
  });
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setError(ta.titleRequired); return; }
    setBusy(true); setError(''); setProgress(0);
    try {
      let oss_key = course?.oss_key || null;
      if (file) {
        const presignRes = await axios.get('/api/oss/presign', { params: { type: 'video', filename: file.name } });
        if (!presignRes.data.success) throw new Error(presignRes.data.error || ta.uploadFailed);
        const { url, key } = presignRes.data;
        await uploadToOSS(url, file, setProgress);
        oss_key = key;
      }
      if (isEdit) {
        await axios.put(`/api/academy/courses/${course.id}`, { ...form, oss_key });
      } else {
        await axios.post('/api/academy/courses', { ...form, oss_key });
      }
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || err.message || ta.uploadFailed);
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEdit ? ta.editCourse : ta.uploadCourse}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.title}</span>
              <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Introduction to Longevity" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.description}</span>
              <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} style={{ resize: 'vertical' }} />
            </label>
            <label className="form-field">
              <span>{ta.status}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.status} onChange={e => set('status', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="draft">{ta.draft}</option>
                  <option value="published">{ta.published}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label-text">{ta.videoFile}</span>
              <label className="upload-zone">
                <input type="file" accept="video/*" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
                <Upload size={18} style={{ marginBottom: 6, color: 'var(--muted)' }} />
                <span className="upload-zone-hint">
                  {file ? file.name : (course?.oss_key ? ta.replaceVideo : ta.selectVideo)}
                </span>
              </label>
              {busy && (
                <div className="upload-progress">
                  <div className="upload-progress-bar" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <Check size={14} />{busy ? ta.uploading : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteCourseConfirm({ course, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleDelete = async () => {
    setBusy(true);
    try { await axios.delete(`/api/academy/courses/${course.id}`); onConfirm(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.academy.deleteCourse}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 20, color: '#475569' }}>{t.academy.deleteCourseWarning(course.title)}</p>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-danger" onClick={handleDelete} disabled={busy}>
              <Trash2 size={14} />{busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LibraryModal({ onClose, onSave }) {
  const { t } = useLang();
  const ta = t.academy;
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) { setError(ta.titleRequired); return; }
    if (!file) { setError(ta.fileRequired); return; }
    setBusy(true); setError(''); setProgress(0);
    try {
      const presignRes = await axios.get('/api/oss/presign', { params: { type: 'markdown', filename: file.name } });
      if (!presignRes.data.success) throw new Error(presignRes.data.error || ta.uploadFailed);
      const { url, key } = presignRes.data;
      await uploadToOSS(url, file, setProgress);
      await axios.post('/api/academy/library', { title, oss_key: key, file_size: file.size });
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || err.message || ta.uploadFailed);
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{ta.uploadDoc}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.title}</span>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Longevity Nutrition Guide" />
            </label>
            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label-text">{ta.mdFile}</span>
              <label className="upload-zone">
                <input type="file" accept=".md,text/markdown,text/plain" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
                <Upload size={18} style={{ marginBottom: 6, color: 'var(--muted)' }} />
                <span className="upload-zone-hint">{file ? file.name : ta.selectMd}</span>
              </label>
              {busy && (
                <div className="upload-progress">
                  <div className="upload-progress-bar" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <Check size={14} />{busy ? ta.uploading : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteLibraryItemConfirm({ item, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleDelete = async () => {
    setBusy(true);
    try { await axios.delete(`/api/academy/library/${item.id}`); onConfirm(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.academy.deleteDoc}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 20, color: '#475569' }}>{t.academy.deleteDocWarning(item.title)}</p>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-danger" onClick={handleDelete} disabled={busy}>
              <Trash2 size={14} />{busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Video player modal ────────────────────────────────────────────────────────

function VideoPlayerModal({ course, onClose }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get('/api/oss/presign', { params: { action: 'get', key: course.oss_key } })
      .then(res => setUrl(res.data.url))
      .catch(() => setError('Could not load video URL.'));
  }, [course.oss_key]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-video" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span><Video size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />{course.title}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          {error && <p style={{ padding: 20, color: '#dc2626' }}>{error}</p>}
          {!error && !url && <p style={{ padding: 20, color: 'var(--muted)' }}>Loading…</p>}
          {url && (
            <video
              src={url}
              controls
              autoPlay
              style={{ width: '100%', display: 'block', background: '#000', maxHeight: '70vh' }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MarkdownViewerModal({ item, onClose }) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const presign = await axios.get('/api/oss/presign', { params: { action: 'get', key: item.oss_key } });
        const raw = await fetch(presign.data.url);
        if (!raw.ok) throw new Error(`HTTP ${raw.status}`);
        const text = await raw.text();
        setHtml(marked.parse(text));
      } catch (err) {
        setError(`Could not load document: ${err.message}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [item.oss_key]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-markdown" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span><BookOpen size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />{item.title}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body md-body">
          {loading && <p style={{ color: 'var(--muted)' }}>Loading…</p>}
          {error   && <p style={{ color: '#dc2626' }}>{error}</p>}
          {!loading && !error && <div dangerouslySetInnerHTML={{ __html: html }} />}
        </div>
      </div>
    </div>
  );
}

// ── Academy tab ───────────────────────────────────────────────────────────────

function AcademyTab() {
  const { t } = useLang();
  const ta = t.academy;
  const [subTab, setSubTab] = useState('courses');
  const [courses, setCourses] = useState([]);
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, lRes] = await Promise.allSettled([
        axios.get('/api/academy/courses'),
        axios.get('/api/academy/library'),
      ]);
      setCourses(cRes.status === 'fulfilled' ? (cRes.value.data.courses || []) : []);
      setLibrary(lRes.status === 'fulfilled' ? (lRes.value.data.items || []) : []);
    } catch (err) { console.error('Academy fetch error:', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const closeAndRefresh = () => { setModal(null); fetchData(); };

  const publishedCount = courses.filter(c => c.status === 'published').length;

  const openVideo = (course) => setModal({ type: 'play-video', course });

  const openDoc = (item) => setModal({ type: 'view-doc', item });

  return (
    <>
      <div className="stat-row">
        <StatCard icon={GraduationCap} label={ta.totalCourses}  value={courses.length}   color="#6366f1" />
        <StatCard icon={Video}          label={ta.published}     value={publishedCount}   color="#10b981" />
        <StatCard icon={FileText}       label={ta.totalDocs}     value={library.length}   color="#3b82f6" />
      </div>

      <div className="subtab-row">
        <button className={`subtab-btn${subTab === 'courses' ? ' active' : ''}`} onClick={() => setSubTab('courses')}>
          <Video size={13} />{ta.coursesTab}
        </button>
        <button className={`subtab-btn${subTab === 'library' ? ' active' : ''}`} onClick={() => setSubTab('library')}>
          <FileText size={13} />{ta.libraryTab}
        </button>
      </div>

      {subTab === 'courses' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{ta.countCourses(courses.length)}</span>
            <button className="btn-primary" onClick={() => setModal({ type: 'add-course' })}>
              <Upload size={14} />{ta.uploadCourse}
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{ta.title.replace(' *', '')}</th>
                <th>{ta.description}</th>
                <th>{ta.status}</th>
                <th>{ta.hasVideo}</th>
                <th>{t.table.joined}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!loading && courses.length === 0 && (
                <tr><td colSpan={7} className="empty-row">{ta.noCourses}</td></tr>
              )}
              {courses.map(c => (
                <tr key={c.id}>
                  <td className="muted mono">{c.id}</td>
                  <td className="bold">{c.title}</td>
                  <td className="muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.description || '—'}
                  </td>
                  <td>
                    <Badge color={c.status === 'published' ? '#10b981' : '#94a3b8'}>
                      {c.status === 'published' ? ta.published : ta.draft}
                    </Badge>
                  </td>
                  <td>{c.oss_key ? <Badge color="#6366f1">✓</Badge> : '—'}</td>
                  <td className="muted">{fmtDate(c.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      {c.oss_key && (
                        <button className="icon-btn" title={ta.viewVideo} onClick={() => openVideo(c)}>
                          <Play size={14} />
                        </button>
                      )}
                      <button className="icon-btn" title={ta.editCourse} onClick={() => setModal({ type: 'edit-course', course: c })}>
                        <Pencil size={14} />
                      </button>
                      <button className="icon-btn danger" title={ta.deleteCourse} onClick={() => setModal({ type: 'delete-course', course: c })}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'library' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{ta.countDocs(library.length)}</span>
            <button className="btn-primary" onClick={() => setModal({ type: 'add-doc' })}>
              <Upload size={14} />{ta.uploadDoc}
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{ta.title.replace(' *', '')}</th>
                <th>{ta.fileSize}</th>
                <th>{t.table.joined}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!loading && library.length === 0 && (
                <tr><td colSpan={5} className="empty-row">{ta.noDocs}</td></tr>
              )}
              {library.map(item => (
                <tr key={item.id}>
                  <td className="muted mono">{item.id}</td>
                  <td className="bold">{item.title}</td>
                  <td className="muted">{fmtBytes(item.file_size)}</td>
                  <td className="muted">{fmtDate(item.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" title={ta.viewDoc} onClick={() => openDoc(item)}>
                        <BookOpen size={14} />
                      </button>
                      <button className="icon-btn danger" title={ta.deleteDoc} onClick={() => setModal({ type: 'delete-doc', item })}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.type === 'play-video'    && <VideoPlayerModal course={modal.course} onClose={() => setModal(null)} />}
      {modal?.type === 'add-course'    && <CourseModal course={null}        onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit-course'   && <CourseModal course={modal.course} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete-course' && <DeleteCourseConfirm course={modal.course} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
      {modal?.type === 'view-doc'      && <MarkdownViewerModal item={modal.item} onClose={() => setModal(null)} />}
      {modal?.type === 'add-doc'       && <LibraryModal onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete-doc'    && <DeleteLibraryItemConfirm item={modal.item} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
    </>
  );
}

// ── Rewards tab ───────────────────────────────────────────────────────────────

function RewardsTab() {
  const { t } = useLang();
  const r = t.rewards;
  const [subTab, setSubTab] = useState('settings');
  const [settings, setSettings] = useState([]);
  const [channelPayouts, setChannelPayouts] = useState([]);
  const [coachCommissions, setCoachCommissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generatePeriod, setGeneratePeriod] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, cpRes, ccRes] = await Promise.all([
        axios.get('/api/commission-settings'),
        axios.get('/api/channel-payouts'),
        axios.get('/api/coach-commissions'),
      ]);
      setSettings(sRes.data.settings || []);
      setChannelPayouts(cpRes.data.payouts || []);
      setCoachCommissions(ccRes.data.commissions || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveSetting(id, field, value) {
    const row = settings.find(s => s.id === id);
    if (!row) return;
    const patch = { flat_rate_cny: row.flat_rate_cny, percentage: row.percentage, [field]: value === '' ? null : Number(value) };
    try {
      await axios.put(`/api/commission-settings/${id}`, patch);
      setSettings(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    } catch {
      alert(r.saveFailed);
    }
  }

  async function generateChannelPayouts() {
    if (!generatePeriod) return;
    setGenerating(true);
    try {
      await axios.post('/api/generate-channel-payouts', { period: generatePeriod });
      await load();
    } finally {
      setGenerating(false);
    }
  }

  async function updateChannelPayout(id, status) {
    try {
      await axios.put(`/api/channel-payouts/${id}`, { status });
      setChannelPayouts(prev => prev.map(p => p.id === id ? { ...p, status } : p));
    } catch {
      alert(r.saveFailed);
    }
  }

  const productLabel = (pt) => ({ chip: r.chip, dot: r.dot, subscription: r.subscription }[pt] || pt);
  const statusLabel  = (s)  => ({ draft: r.draft, approved: r.approved, transferred: r.transferred }[s] || s);
  const statusBadgeColor = (s) => ({ draft: '#64748b', approved: '#2563eb', transferred: '#16a34a' }[s] || '#64748b');

  const pendingPayouts = channelPayouts.filter(p => p.status === 'draft').length;
  const totalCommissionsAmount = coachCommissions.reduce((sum, c) => sum + Number(c.amount_cny || 0), 0);

  return (
    <>
      <div className="stat-row">
        <StatCard icon={TrendingUp} label={r.totalPayouts}     value={channelPayouts.length}                           color="#6366f1" />
        <StatCard icon={TrendingUp} label={r.pendingPayouts}   value={pendingPayouts}                                  color="#f59e0b" />
        <StatCard icon={Coins}      label={r.totalCommissions} value={coachCommissions.length}                         color="#3b82f6" />
        <StatCard icon={Coins}      label={r.totalEarned}      value={`¥${totalCommissionsAmount.toFixed(0)}`}         color="#10b981" />
      </div>

      <div className="subtab-row">
        <button className={`subtab-btn${subTab === 'settings' ? ' active' : ''}`} onClick={() => setSubTab('settings')}>
          <Settings2 size={13} /> {r.settingsTab}
        </button>
        <button className={`subtab-btn${subTab === 'channel-payouts' ? ' active' : ''}`} onClick={() => setSubTab('channel-payouts')}>
          <TrendingUp size={13} /> {r.channelPayoutsTab}
        </button>
        <button className={`subtab-btn${subTab === 'coach-commissions' ? ' active' : ''}`} onClick={() => setSubTab('coach-commissions')}>
          <Coins size={13} /> {r.coachCommissionsTab}
        </button>
      </div>

      {loading && <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Loading…</div>}

      {!loading && subTab === 'settings' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{settings.length} rule{settings.length !== 1 ? 's' : ''}</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{r.role}</th><th>{r.productType}</th>
                <th>{r.flatRate}</th><th>{r.pct}</th>
              </tr>
            </thead>
            <tbody>
              {settings.length === 0 && <tr><td colSpan={4} className="empty-row">{r.noSettings}</td></tr>}
              {settings.map(row => (
                <tr key={row.id}>
                  <td><Badge color={row.role === 'coach' ? '#8b5cf6' : '#6366f1'}>{row.role === 'coach' ? r.coach : r.channel}</Badge></td>
                  <td><Badge color="#64748b">{productLabel(row.product_type)}</Badge></td>
                  <td>
                    {row.flat_rate_cny != null
                      ? <input type="number" step="0.01" defaultValue={row.flat_rate_cny}
                          onBlur={e => saveSetting(row.id, 'flat_rate_cny', e.target.value)}
                          style={{ width: 90 }} />
                      : <span className="muted">—</span>}
                  </td>
                  <td>
                    {row.percentage != null
                      ? <input type="number" step="0.1" defaultValue={row.percentage}
                          onBlur={e => saveSetting(row.id, 'percentage', e.target.value)}
                          style={{ width: 90 }} />
                      : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && subTab === 'channel-payouts' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{channelPayouts.length} payout{channelPayouts.length !== 1 ? 's' : ''}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={generatePeriod} onChange={e => setGeneratePeriod(e.target.value)}
                placeholder="YYYY-MM" style={{ width: 110 }} />
              <button className="btn-primary" onClick={generateChannelPayouts} disabled={generating}>
                <TrendingUp size={13} />{generating ? r.generating : r.generatePayouts}
              </button>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{r.channelName}</th><th>{r.period}</th><th>{r.totalCny}</th>
                <th>{r.status}</th><th>{r.approvedAt}</th><th>{r.transferredAt}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {channelPayouts.length === 0 && <tr><td colSpan={7} className="empty-row">{r.noPayouts}</td></tr>}
              {channelPayouts.map(p => (
                <tr key={p.id}>
                  <td className="bold">{p.channel_name || <span className="muted">—</span>}</td>
                  <td><code className="code-tag">{p.period}</code></td>
                  <td className="bold">¥{Number(p.total_cny).toFixed(2)}</td>
                  <td><Badge color={statusBadgeColor(p.status)}>{statusLabel(p.status)}</Badge></td>
                  <td className="muted">{fmtDate(p.approved_at)}</td>
                  <td className="muted">{fmtDate(p.transferred_at)}</td>
                  <td>
                    <div className="row-actions">
                      {p.status === 'draft' &&
                        <button className="icon-btn" title={r.approve} onClick={() => updateChannelPayout(p.id, 'approved')}>
                          <Check size={14} />
                        </button>}
                      {p.status === 'approved' &&
                        <button className="icon-btn" title={r.markTransferred} onClick={() => updateChannelPayout(p.id, 'transferred')}>
                          <ChevronRight size={14} />
                        </button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && subTab === 'coach-commissions' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{coachCommissions.length} commission{coachCommissions.length !== 1 ? 's' : ''}</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{r.coachName}</th><th>{r.channelCol}</th><th>{r.productTypeCol}</th>
                <th>{r.amountCny}</th><th>{r.status}</th><th>{r.createdAt}</th>
              </tr>
            </thead>
            <tbody>
              {coachCommissions.length === 0 && <tr><td colSpan={6} className="empty-row">{r.noCommissions}</td></tr>}
              {coachCommissions.map(c => (
                <tr key={c.id}>
                  <td className="bold">{c.coach_name || c.coach_id}</td>
                  <td>{c.channel_name || <span className="muted">—</span>}</td>
                  <td><Badge color="#64748b">{productLabel(c.product_type)}</Badge></td>
                  <td className="bold">¥{Number(c.amount_cny).toFixed(2)}</td>
                  <td><Badge color={statusBadgeColor(c.status)}>{statusLabel(c.status)}</Badge></td>
                  <td className="muted">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Simulators tab ────────────────────────────────────────────────────────────

const SIM_V = `?v=${__SIM_VERSION__}`;

function SimulatorsTab() {
  return (
    <div className="sims-grid">
      <div className="card sim-card">
        <div className="card-header">Kino Simulator</div>
        <iframe src={`/admin/sim/kino/${SIM_V}`} title="Kino" className="sim-iframe" />
      </div>
      <div className="card sim-card">
        <div className="card-header">Chat Simulator</div>
        <iframe src={`/admin/sim/chat/${SIM_V}`} title="Chat" className="sim-iframe" />
      </div>
      <div className="card sim-card">
        <div className="card-header">Coach Simulator</div>
        <iframe src={`/admin/sim/coach/${SIM_V}`} title="Coach" className="sim-iframe" />
      </div>
    </div>
  );
}

// ── Channel components ────────────────────────────────────────────────────────

const EMPTY_CHANNEL = { key_name: '', name: '', logo_url: '' };

function ChannelModal({ channel, onClose, onSave }) {
  const { t } = useLang();
  const isEdit = !!channel?.id;
  const [form, setForm] = useState(isEdit
    ? { key_name: channel.key_name, name: channel.name || '', logo_url: channel.logo_url || '' }
    : { ...EMPTY_CHANNEL });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.key_name.trim()) { setError(t.modal.keyRequired); return; }
    if (!form.name.trim())     { setError(t.modal.nameRequired); return; }
    setBusy(true); setError('');
    try {
      if (isEdit) await axios.put(`/api/channels/${channel.id}`, form);
      else        await axios.post('/api/channels', form);
      onSave();
    } catch (err) { setError(err.response?.data?.error || t.modal.saveFailed); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEdit ? t.modal.editChannel : t.modal.addChannel}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field">
              <span>{t.modal.channelKeyName}</span>
              <input value={form.key_name} onChange={e => set('key_name', e.target.value)} disabled={isEdit} placeholder="e.g. nanovate" />
            </label>
            <label className="form-field">
              <span>{t.modal.channelName}</span>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Nanovate" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal.channelLogoUrl}</span>
              <input value={form.logo_url} onChange={e => set('logo_url', e.target.value)} placeholder="https://..." />
            </label>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <Check size={14} />{busy ? t.modal.saving : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteChannelConfirm({ channel, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleDelete = async () => {
    setBusy(true);
    try { await axios.delete(`/api/channels/${channel.id}`); onConfirm(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.modal.deleteChannel}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 20, color: '#475569' }}>
            {t.modal.deleteChannelWarning(<strong>{channel.name}</strong>)}
          </p>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-danger" onClick={handleDelete} disabled={busy}>
              <Trash2 size={14} />{busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChannelTab({ channels, onRefresh }) {
  const { t } = useLang();
  const [modal, setModal] = useState(null);
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Building2} label={t.stats.totalChannels} value={channels.length} color="#6366f1" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{t.countChannel(channels.length)}</span>
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
            <Plus size={14} />{t.addChannel}
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.table.id}</th>
              <th>{t.modal.channelKeyName.replace(' *', '')}</th>
              <th>{t.modal.channelName.replace(' *', '')}</th>
              <th>{t.modal.channelLogoUrl}</th>
              <th>{t.table.customers}</th>
              <th>{t.stats.coaches}</th>
              <th>{t.table.joined}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {channels.length === 0 && <tr><td colSpan={8} className="empty-row">{t.empty.channels}</td></tr>}
            {channels.map(c => (
              <tr key={c.id}>
                <td className="muted">{c.id}</td>
                <td><code className="code-tag">{c.key_name}</code></td>
                <td className="bold">{fmt(c.name)}</td>
                <td className="muted">
                  {c.logo_url
                    ? <a href={c.logo_url} target="_blank" rel="noreferrer" style={{ color: '#6366f1', fontSize: 12 }}>View</a>
                    : '—'}
                </td>
                <td><Badge color="#3b82f6">{c.user_count || 0}</Badge></td>
                <td><Badge color="#10b981">{c.coach_count || 0}</Badge></td>
                <td className="muted">{fmtDate(c.created_at)}</td>
                <td>
                  <div className="row-actions">
                    <button className="icon-btn" title={t.modal.editChannel} onClick={() => setModal({ type: 'edit', channel: c })}><Pencil size={14} /></button>
                    <button className="icon-btn danger" title={t.modal.deleteChannel} onClick={() => setModal({ type: 'delete', channel: c })}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal?.type === 'add'    && <ChannelModal channel={null}          onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit'   && <ChannelModal channel={modal.channel} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete' && <DeleteChannelConfirm channel={modal.channel} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
    </>
  );
}

// ── Kino tab ──────────────────────────────────────────────────────────────────

const DEVICE_STATUSES = ['active', 'inactive', 'maintenance'];
const EMPTY_DEVICE = { serial_number: '', name: '', coach_id: '', channel_id: '', status: 'active', notes: '' };

function KinoModal({ device, coaches, channels, onClose, onSave }) {
  const { t } = useLang();
  const isEdit = !!device?.id;
  const [form, setForm] = useState(isEdit ? {
    serial_number: device.serial_number || '',
    name: device.name || '',
    coach_id: device.coach_id ?? '',
    channel_id: device.channel_id ?? '',
    status: device.status || 'active',
    notes: device.notes || '',
  } : { ...EMPTY_DEVICE });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.serial_number.trim()) { setError(t.modal.serialNumber.replace(' *', '') + ' is required'); return; }
    setBusy(true); setError('');
    try {
      const payload = {
        ...form,
        serial_number: form.serial_number.trim().toUpperCase(),
        coach_id:   form.coach_id   !== '' ? parseInt(form.coach_id)   : null,
        channel_id: form.channel_id !== '' ? parseInt(form.channel_id) : null,
      };
      let res;
      if (isEdit) res = await axios.put(`/api/kino-devices/${device.id}`, payload);
      else        res = await axios.post('/api/kino-devices', payload);
      if (res.data?.success === false) { setError(res.data.error || t.modal.saveFailed); return; }
      onSave();
    } catch (err) { setError(err.response?.data?.error || t.modal.saveFailed); }
    finally { setBusy(false); }
  };

  const statusColor = { active: '#10b981', inactive: '#94a3b8', maintenance: '#f59e0b' };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEdit ? t.modal.editDevice : t.modal.addDevice}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field">
              <span>{t.modal.serialNumber}</span>
              <input value={form.serial_number} onChange={e => set('serial_number', e.target.value)} disabled={isEdit} placeholder={t.modal.serialNumberPlaceholder} style={{ fontFamily: 'monospace' }} />
            </label>
            <label className="form-field">
              <span>{t.modal.deviceName}</span>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder={t.modal.deviceNamePlaceholder} />
            </label>
            <label className="form-field">
              <span>{t.modal.deviceStatus}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.status} onChange={e => set('status', e.target.value)} className="inline-select" style={{ width: '100%', color: statusColor[form.status] }}>
                  <option value="active">{t.modal.statusActive}</option>
                  <option value="inactive">{t.modal.statusInactive}</option>
                  <option value="maintenance">{t.modal.statusMaintenance}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{t.modal.assignedCoachDevice}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.coach_id} onChange={e => set('coach_id', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="">{t.modal.unassigned}</option>
                  {coaches.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal.assignedChannelDevice}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.channel_id} onChange={e => set('channel_id', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="">{t.modal.channelUnassigned}</option>
                  {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal.deviceNotes}</span>
              <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder={t.modal.deviceNotesPlaceholder} />
            </label>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <Check size={14} />{busy ? t.modal.saving : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteDeviceConfirm({ device, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleDelete = async () => {
    setBusy(true);
    try { await axios.delete(`/api/kino-devices/${device.id}`); onConfirm(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.modal.deleteDevice}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 20, color: '#475569' }}>
            {t.modal.deleteDeviceWarning(device.serial_number)}
          </p>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-danger" onClick={handleDelete} disabled={busy}>
              <Trash2 size={14} />{busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KinoTab({ devices, coaches, channels, onRefresh }) {
  const { t } = useLang();
  const [modal, setModal] = useState(null);
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  const activeCount = devices.filter(d => d.status === 'active').length;
  const totalTests  = devices.reduce((s, d) => s + (d.test_count || 0), 0);

  const statusColor = { active: '#10b981', inactive: '#94a3b8', maintenance: '#f59e0b' };
  const statusLabel = { active: t.modal.statusActive, inactive: t.modal.statusInactive, maintenance: t.modal.statusMaintenance };

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Cpu} label={t.stats.totalDevices}  value={devices.length} color="#6366f1" />
        <StatCard icon={Cpu} label={t.stats.activeDevices} value={activeCount}     color="#10b981" />
        <StatCard icon={Activity} label={t.stats.totalTests}   value={totalTests}     color="#3b82f6" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{t.countDevice(devices.length)}</span>
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
            <Plus size={14} />{t.addDevice}
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.table.serialNumber}</th>
              <th>{t.table.name}</th>
              <th>{t.table.status}</th>
              <th>{t.modal.assignedCoachDevice}</th>
              <th>{t.table.channel}</th>
              <th>{t.table.testCount}</th>
              <th>{t.table.lastUsed}</th>
              <th>{t.table.notes}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 && <tr><td colSpan={9} className="empty-row">{t.empty.kino}</td></tr>}
            {devices.map(d => (
              <tr key={d.id}>
                <td>
                  <div className="avatar-cell">
                    <div className="avatar" style={{ background: '#6366f120', color: '#6366f1', borderRadius: 6 }}>
                      <Cpu size={13} />
                    </div>
                    <code style={{ fontSize: 12, fontFamily: 'monospace', fontWeight: 700 }}>{d.serial_number}</code>
                  </div>
                </td>
                <td>{fmt(d.name)}</td>
                <td>
                  <Badge color={statusColor[d.status] || '#94a3b8'}>
                    {statusLabel[d.status] || d.status}
                  </Badge>
                </td>
                <td>{d.coach_name ? <Badge color="#10b981">{d.coach_name}</Badge> : '—'}</td>
                <td>{d.channel_name ? <Badge color="#6366f1">{d.channel_name}</Badge> : '—'}</td>
                <td><Badge color={d.test_count > 0 ? '#3b82f6' : '#94a3b8'}>{d.test_count || 0}</Badge></td>
                <td className="muted">{d.last_used_at ? fmtDate(d.last_used_at) : '—'}</td>
                <td className="muted desc-cell">{fmt(d.notes)}</td>
                <td>
                  <div className="row-actions">
                    <button className="icon-btn" title={t.modal.editDevice} onClick={() => setModal({ type: 'edit', device: d })}><Pencil size={14} /></button>
                    <button className="icon-btn danger" title={t.modal.deleteDevice} onClick={() => setModal({ type: 'delete', device: d })}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal?.type === 'add'    && <KinoModal device={null}          coaches={coaches} channels={channels} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit'   && <KinoModal device={modal.device}  coaches={coaches} channels={channels} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete' && <DeleteDeviceConfirm device={modal.device} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
    </>
  );
}

// ── Invites tab ───────────────────────────────────────────────────────────────

function InviteModal({ channels, onClose, onSave }) {
  const { t } = useLang();
  const [form, setForm] = useState({ channel_id: '', type: 'coach', max_uses: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.channel_id) { setError(t.modal.inviteChannel.replace(' *', '') + ' required'); return; }
    setBusy(true); setError('');
    try {
      await axios.post('/api/invitations', {
        channel_id: parseInt(form.channel_id),
        type: form.type,
        max_uses: form.max_uses !== '' ? parseInt(form.max_uses) : null,
      });
      onSave();
    } catch (err) { setError(err.response?.data?.error || t.modal.saveFailed); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.modal.addInvite}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field">
              <span>{t.modal.inviteChannel}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.channel_id} onChange={e => set('channel_id', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="">{t.modal.channelUnassigned}</option>
                  {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{t.modal.inviteType}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.type} onChange={e => set('type', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="coach">{t.modal.inviteTypeCoach}</option>
                  <option value="channel">{t.modal.inviteTypeChannel}</option>
                  <option value="admin">{t.modal.inviteTypeAdmin}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal.inviteMaxUses}</span>
              <input type="number" min="1" value={form.max_uses} onChange={e => set('max_uses', e.target.value)} placeholder={t.modal.inviteMaxUsesPlaceholder} />
            </label>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <Check size={14} />{busy ? t.modal.saving : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeactivateInviteConfirm({ invite, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleDeactivate = async () => {
    setBusy(true);
    try { await axios.delete(`/api/invitations/${invite.id}`); onConfirm(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.modal.deactivateInvite}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 20, color: '#475569' }}>
            {t.modal.deleteInviteWarning(invite.code)}
          </p>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-danger" onClick={handleDeactivate} disabled={busy}>
              <Trash2 size={14} />{busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InvitesTab({ invitations, channels, onRefresh }) {
  const { t } = useLang();
  const [modal, setModal] = useState(null);
  const [copied, setCopied] = useState(null);
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  const activeCount = invitations.filter(i => i.is_active).length;
  const usedTotal   = invitations.reduce((s, i) => s + (i.use_count || 0), 0);

  const copyCode = (code) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Tag} label={t.stats.totalInvites}  value={invitations.length} color="#6366f1" />
        <StatCard icon={Tag} label={t.stats.activeInvites} value={activeCount}         color="#10b981" />
        <StatCard icon={Tag} label={t.stats.usedInvites}   value={usedTotal}           color="#f59e0b" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{t.countInvite(invitations.length)}</span>
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
            <Plus size={14} />{t.addInvite}
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.table.code}</th>
              <th>{t.table.type}</th>
              <th>{t.table.channel}</th>
              <th>{t.table.creator}</th>
              <th>{t.table.maxUses}</th>
              <th>{t.table.useCount}</th>
              <th>Status</th>
              <th>{t.table.joined}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invitations.length === 0 && <tr><td colSpan={9} className="empty-row">{t.empty.invites}</td></tr>}
            {invitations.map(inv => (
              <tr key={inv.id}>
                <td>
                  <div className="avatar-cell" style={{ gap: 6 }}>
                    <code className="code-tag" style={{ letterSpacing: '0.1em', fontSize: 13 }}>{inv.code}</code>
                    <button className="icon-btn" title="Copy" onClick={() => copyCode(inv.code)} style={{ padding: 3 }}>
                      {copied === inv.code
                        ? <Check size={12} style={{ color: '#10b981' }} />
                        : <Copy size={12} />}
                    </button>
                  </div>
                </td>
                <td><Badge color="#8b5cf6">{inv.type}</Badge></td>
                <td>{inv.channel_name ? <Badge color="#6366f1">{inv.channel_name}</Badge> : '—'}</td>
                <td className="muted">{fmt(inv.creator_name)}</td>
                <td className="muted">{inv.max_uses != null ? inv.max_uses : t.invites.unlimited}</td>
                <td><Badge color={inv.use_count > 0 ? '#3b82f6' : '#94a3b8'}>{inv.use_count || 0}</Badge></td>
                <td>
                  <Badge color={inv.is_active ? '#10b981' : '#94a3b8'}>
                    {inv.is_active ? t.invites.active : t.invites.deactivated}
                  </Badge>
                </td>
                <td className="muted">{fmtDate(inv.created_at)}</td>
                <td>
                  {inv.is_active && (
                    <button className="icon-btn danger" title={t.modal.deactivateInvite} onClick={() => setModal({ type: 'deactivate', invite: inv })}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal?.type === 'add'        && <InviteModal channels={channels} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'deactivate' && <DeactivateInviteConfirm invite={modal.invite} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
    </>
  );
}

// ── Chip Batch components ─────────────────────────────────────────────────────

function ChipBatchModal({ batch, models, onClose, onSave }) {
  const { t } = useContext(LangCtx);
  const tc = t.chips;
  const isEdit = !!batch;

  const activeModels = (models || []).filter(m => m.status === 'active');
  const modelOptions = activeModels.length > 0 ? activeModels : (models || []);
  const fallbackModel = modelOptions[0]?.code || 'K2';

  const [batchNum] = useState(() =>
    String(Math.floor(Math.random() * 100000000)).padStart(8, '0')
  );

  const [form, setForm] = useState({
    prefix:   isEdit ? batch.prefix : `KNC${batchNum}`,
    model:    batch?.model    || fallbackModel,
    quantity: batch?.quantity || '',
    notes:    batch?.notes    || '',
    status:   batch?.status   || 'active',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const [prefixOverride, setPrefixOverride] = useState(false);

  const displayPrefix = form.prefix.trim().toUpperCase();
  const qty = parseInt(form.quantity) || 0;
  const previewEnd = qty > 0 ? String(Math.min(qty, 9999)).padStart(4, '0') : '????';
  const preview = `${displayPrefix || '???'}-0001  →  ${displayPrefix || '???'}-${previewEnd}`;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      let res;
      if (isEdit) {
        res = await axios.put(`/api/kino-chip-batches/${batch.id}`, { model: form.model, notes: form.notes, status: form.status });
      } else {
        res = await axios.post('/api/kino-chip-batches', { prefix: form.prefix, model: form.model, quantity: form.quantity, notes: form.notes });
      }
      if (res.data?.success === false) { setError(res.data.error || t.modal.saveFailed); return; }
      onSave();
    } catch (err) { setError(err.response?.data?.error || t.modal.saveFailed); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEdit ? tc.editBatch : tc.addBatch}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            {!isEdit && (
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{tc.prefix.replace(' *', '')}</span>
                  <code style={{ fontSize: 13, color: '#e2e8f0' }}>{displayPrefix}</code>
                  {!prefixOverride && (
                    <button type="button" style={{ fontSize: 11, color: '#38bdf8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      onClick={() => setPrefixOverride(true)}>Override</button>
                  )}
                </div>
                {prefixOverride && (
                  <input value={form.prefix} onChange={e => set('prefix', e.target.value.toUpperCase())}
                         placeholder={tc.prefixHint} required style={{ fontFamily: 'monospace', marginTop: 6 }} />
                )}
              </div>
            )}
            <label className="form-field">
              <span>{tc.model}</span>
              <select value={form.model} onChange={e => set('model', e.target.value)}>
                {modelOptions.length === 0 && <option value={form.model}>{form.model}</option>}
                {modelOptions.map(m => (
                  <option key={m.code} value={m.code}>
                    {m.name ? `${m.code} — ${m.name}` : m.code}
                  </option>
                ))}
              </select>
            </label>
            {!isEdit && (
              <label className="form-field">
                <span>{tc.quantity}</span>
                <input type="number" min="1" max="9999"
                       value={form.quantity} onChange={e => set('quantity', e.target.value)}
                       placeholder="1 – 9999" required />
              </label>
            )}
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tc.notes}</span>
              <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
            </label>
            {isEdit && (
              <label className="form-field">
                <span>{tc.batchStatus}</span>
                <select value={form.status} onChange={e => set('status', e.target.value)}>
                  <option value="active">{tc.statusActive}</option>
                  <option value="inactive">{tc.statusInactive}</option>
                  <option value="recalled">{tc.statusRecalled}</option>
                </select>
              </label>
            )}
          </div>
          {!isEdit && (
            <div style={{ margin: '12px 0 4px', padding: '10px 14px', background: '#0f172a', borderRadius: 6, border: '1px solid #1e293b' }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Chip code range preview</div>
              <code style={{ fontSize: 13, color: '#38bdf8', letterSpacing: '0.5px' }}>{preview}</code>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? t.modal.saving : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteBatchConfirm({ batch, onClose, onConfirm }) {
  const { t } = useContext(LangCtx);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const handleDelete = async () => {
    setBusy(true);
    try {
      const res = await axios.delete(`/api/kino-chip-batches/${batch.id}`);
      if (res.data?.success === false) { setError(res.data.error); return; }
      onConfirm();
    } catch (err) { setError(err.response?.data?.error || 'Delete failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><span>{t.chips.deleteBatch}</span><button className="icon-btn" onClick={onClose}><X size={16} /></button></div>
        <div className="modal-body">
          <p>{t.chips.deleteBatchWarning(batch.prefix)}</p>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-danger" onClick={handleDelete} disabled={busy}>
              {busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChipCard({ chip, index }) {
  const statusColor = { available: '#10b981', used: '#f59e0b', damaged: '#ef4444' };
  const color = statusColor[chip.status] || '#94a3b8';
  return (
    <div style={{
      background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10,
      padding: '14px 10px 10px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: 8, minWidth: 0,
    }}>
      <img
        src={`https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${encodeURIComponent(chip.chip_code)}&bgcolor=0f172a&color=e2e8f0&margin=4`}
        width={96} height={96} alt="QR"
        style={{ borderRadius: 6, display: 'block' }}
      />
      <code style={{ fontSize: 10, color: '#cbd5e1', letterSpacing: '0.3px', textAlign: 'center', wordBreak: 'break-all' }}>
        {chip.chip_code}
      </code>
      <span style={{
        fontSize: 10, fontWeight: 600, color, background: color + '1a',
        borderRadius: 99, padding: '2px 8px',
      }}>
        {chip.status}
      </span>
      {chip.nickname && (
        <span style={{ fontSize: 10, color: '#64748b' }}>{chip.nickname}</span>
      )}
    </div>
  );
}

function ChipListPanel({ batch, onClose }) {
  const { t } = useContext(LangCtx);
  const tc = t.chips;
  const [firstChips, setFirstChips] = useState([]);
  const [lastChip,   setLastChip]   = useState(null);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [printing,   setPrinting]   = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await axios.get(`/api/kino-chip-batches/${batch.id}/chips?page=1&limit=10`);
        const chips = res.data.chips || [];
        const tot   = res.data.total || 0;
        setFirstChips(chips);
        setTotal(tot);
        if (tot > 10) {
          const lastRes = await axios.get(`/api/kino-chip-batches/${batch.id}/chips?page=${tot}&limit=1`);
          setLastChip(lastRes.data.chips?.[0] || null);
        }
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    load();
  }, [batch.id]);

  const printQR = async () => {
    setPrinting(true);
    try {
      const pages = Math.ceil(batch.quantity / 100);
      let all = [];
      for (let p = 1; p <= pages; p++) {
        const res = await axios.get(`/api/kino-chip-batches/${batch.id}/chips?page=${p}&limit=100`);
        all = all.concat(res.data.chips || []);
      }
      const html = `<!DOCTYPE html><html><head><title>Batch ${batch.prefix}</title>
        <style>body{font-family:sans-serif;margin:16px}h2{margin-bottom:12px}
        .grid{display:flex;flex-wrap:wrap;gap:8px}
        .chip{text-align:center;border:1px solid #ccc;border-radius:6px;padding:10px;width:120px}
        .chip img{display:block;margin:0 auto 6px}
        .chip p{font-size:9px;margin:0;word-break:break-all;font-family:monospace}
        @media print{@page{size:A4;margin:12mm}.chip{page-break-inside:avoid}}</style>
        </head><body>
        <h2>Batch: ${batch.prefix} | Model: ${batch.model} | Total: ${batch.quantity}</h2>
        <div class="grid">${all.map(c =>
          `<div class="chip"><img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(c.chip_code)}" width="100" height="100"/><p>${c.chip_code}</p></div>`
        ).join('')}</div></body></html>`;
      const win = window.open('', '_blank');
      win.document.write(html);
      win.document.close();
      setTimeout(() => win.print(), 800);
    } catch (e) { console.error(e); }
    finally { setPrinting(false); }
  };

  const downloadCSV = async () => {
    setDownloading(true);
    try {
      const pages = Math.ceil(batch.quantity / 100);
      let all = [];
      for (let p = 1; p <= pages; p++) {
        const res = await axios.get(`/api/kino-chip-batches/${batch.id}/chips?page=${p}&limit=100`);
        all = all.concat(res.data.chips || []);
      }
      const csv = all.map(c => c.chip_code).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `${batch.prefix}_chips.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error(e); }
    finally { setDownloading(false); }
  };

  const hiddenCount = total > 10 ? total - 11 : 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720, width: '90vw' }}>
        <div className="modal-header">
          <div>
            <span style={{ fontWeight: 600 }}>{batch.prefix}</span>
            <span style={{ color: '#64748b', fontSize: 13, marginLeft: 8 }}>{batch.model} · {total} chips</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={downloadCSV} disabled={downloading}>
              <Download size={13} />{downloading ? 'Downloading…' : 'CSV'}
            </button>
            <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={printQR} disabled={printing}>
              <Printer size={13} />{printing ? 'Preparing…' : tc.printQR}
            </button>
            <button className="icon-btn" onClick={onClose}><X size={16} /></button>
          </div>
        </div>
        <div className="modal-body" style={{ padding: '20px 20px 24px' }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '32px 0' }}>{t.topbar.loading}</p>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                {firstChips.map((c, i) => <ChipCard key={c.id} chip={c} index={i + 1} />)}
              </div>

              {hiddenCount > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
                  <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
                  <span style={{ fontSize: 12, color: '#475569', whiteSpace: 'nowrap' }}>
                    · · · {hiddenCount.toLocaleString()} more chips · · ·
                  </span>
                  <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
                </div>
              )}

              {lastChip && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                  <ChipCard chip={lastChip} index={total} />
                </div>
              )}

              {firstChips.length === 0 && (
                <p style={{ textAlign: 'center', color: '#475569', padding: '32px 0' }}>{tc.noChips}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ChipsTab({ batches, models, onRefresh }) {
  const { t } = useContext(LangCtx);
  const tc = t.chips;
  const [subTab, setSubTab] = useState('batches');

  return (
    <>
      <div className="subtab-row" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`subtab-btn${subTab === 'batches' ? ' active' : ''}`} onClick={() => setSubTab('batches')}>
          <Layers size={13} />{tc.batchesTab}
        </button>
        <button className={`subtab-btn${subTab === 'models' ? ' active' : ''}`} onClick={() => setSubTab('models')}>
          <Cpu size={13} />{tc.modelsTab}
        </button>
      </div>

      {subTab === 'batches' && <ChipBatchesPanel batches={batches} models={models} onRefresh={onRefresh} />}
      {subTab === 'models'  && <ChipModelsPanel  models={models} onRefresh={onRefresh} />}
    </>
  );
}

function ChipBatchesPanel({ batches, models, onRefresh }) {
  const { t } = useContext(LangCtx);
  const tc = t.chips;
  const [modal, setModal]         = useState(null);
  const [viewBatch, setViewBatch] = useState(null);
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  const totalChips     = batches.reduce((s, b) => s + parseInt(b.quantity  || 0), 0);
  const availableChips = batches.reduce((s, b) => s + parseInt(b.available || 0), 0);
  const usedChips      = batches.reduce((s, b) => s + parseInt(b.used      || 0), 0);
  const damagedChips   = batches.reduce((s, b) => s + parseInt(b.damaged   || 0), 0);

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Layers}      label={t.countBatch(batches.length)} value={batches.length}  color="#3b82f6" />
        <StatCard icon={Package}     label={tc.total}                     value={totalChips}       color="#8b5cf6" />
        <StatCard icon={Check}       label={tc.available}                 value={availableChips}   color="#10b981" />
        <StatCard icon={Activity}    label={tc.used}                      value={usedChips}        color="#f59e0b" />
        <StatCard icon={Trash2}      label={tc.damaged}                   value={damagedChips}     color="#ef4444" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{t.countBatch(batches.length)}</span>
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
            <Plus size={14} />{t.addBatch}
          </button>
        </div>
      <table className="data-table">
        <thead><tr>
          <th>ID</th>
          <th>{tc.prefix || 'Prefix'}</th>
          <th>Model</th>
          <th>{tc.batchStatus}</th>
          <th>{tc.total}</th>
          <th style={{ color: '#10b981' }}>{tc.available}</th>
          <th style={{ color: '#94a3b8' }}>{tc.used}</th>
          <th style={{ color: '#ef4444' }}>{tc.damaged}</th>
          <th>Created</th>
          <th></th>
        </tr></thead>
        <tbody>
          {batches.length === 0 && <tr><td colSpan={10} className="empty-row">{t.empty.chipBatches}</td></tr>}
          {batches.map(b => (
            <tr key={b.id}>
              <td style={{ color: '#94a3b8', fontSize: 11 }}>{b.id}</td>
              <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{b.prefix}</td>
              <td>{b.model}</td>
              <td>
                <span style={{ fontSize: 11, color: b.status === 'active' ? '#10b981' : b.status === 'recalled' ? '#ef4444' : '#94a3b8' }}>
                  {b.status === 'active' ? tc.statusActive : b.status === 'recalled' ? tc.statusRecalled : tc.statusInactive}
                </span>
              </td>
              <td>{b.quantity}</td>
              <td style={{ color: '#10b981' }}>{b.available}</td>
              <td style={{ color: '#94a3b8' }}>{b.used}</td>
              <td style={{ color: b.damaged > 0 ? '#ef4444' : '#94a3b8' }}>{b.damaged}</td>
              <td style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(b.created_at).toLocaleDateString()}</td>
              <td>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="icon-btn" title={tc.viewChips} onClick={() => setViewBatch(b)}><QrCode size={14} /></button>
                  <button className="icon-btn" title={tc.editBatch} onClick={() => setModal({ type: 'edit', batch: b })}><Pencil size={14} /></button>
                  <button className="icon-btn" title={tc.deleteBatch} onClick={() => setModal({ type: 'delete', batch: b })}><Trash2 size={14} /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {modal?.type === 'add'    && <ChipBatchModal batch={null}        models={models} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit'   && <ChipBatchModal batch={modal.batch} models={models} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete' && <DeleteBatchConfirm batch={modal.batch} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
      {viewBatch && <ChipListPanel batch={viewBatch} onClose={() => setViewBatch(null)} />}
    </>
  );
}

function ChipModelsPanel({ models, onRefresh }) {
  const { t } = useContext(LangCtx);
  const tc = t.chips;
  const [modal, setModal] = useState(null);
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  const totalBatches = models.reduce((s, m) => s + (parseInt(m.batch_count) || 0), 0);
  const totalChips   = models.reduce((s, m) => s + (parseInt(m.chip_count)  || 0), 0);
  const activeCount  = models.filter(m => m.status === 'active').length;

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Cpu}     label={tc.countModel(models.length)} value={models.length} color="#3b82f6" />
        <StatCard icon={Check}   label={tc.statusActive}              value={activeCount}   color="#10b981" />
        <StatCard icon={Layers}  label={tc.batchCount}                value={totalBatches}  color="#8b5cf6" />
        <StatCard icon={Package} label={tc.chipCount}                 value={totalChips}    color="#f59e0b" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{tc.countModel(models.length)}</span>
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
            <Plus size={14} />{tc.addModel}
          </button>
        </div>
        <table className="data-table">
          <thead><tr>
            <th>{tc.modelCode.replace(' *', '')}</th>
            <th>{tc.modelName}</th>
            <th>{tc.biomarkerKeys.replace(' *', '')}</th>
            <th>{tc.modelStatus}</th>
            <th>{tc.batchCount}</th>
            <th>{tc.chipCount}</th>
            <th></th>
          </tr></thead>
          <tbody>
            {models.length === 0 && <tr><td colSpan={7} className="empty-row">{t.empty.chipModels}</td></tr>}
            {models.map(m => (
              <tr key={m.code}>
                <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{m.code}</td>
                <td>{m.name || <span style={{ color: '#64748b' }}>—</span>}</td>
                <td style={{ fontSize: 12 }}>
                  {(m.biomarker_keys || []).map(k => (
                    <span key={k} style={{ display: 'inline-block', padding: '2px 8px', marginRight: 4, marginBottom: 2, borderRadius: 10, background: '#162E4A', color: '#A6C4E5', fontSize: 11 }}>{k}</span>
                  ))}
                </td>
                <td>
                  <span style={{ fontSize: 11, color: m.status === 'active' ? '#10b981' : '#94a3b8' }}>
                    {m.status === 'active' ? tc.statusActive : tc.statusInactive}
                  </span>
                </td>
                <td>{m.batch_count}</td>
                <td>{m.chip_count}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="icon-btn" title={tc.editModel} onClick={() => setModal({ type: 'edit', model: m })}><Pencil size={14} /></button>
                    <button className="icon-btn" title={tc.deleteModel}
                            onClick={() => setModal({ type: 'delete', model: m })}
                            disabled={parseInt(m.batch_count) > 0}
                            style={parseInt(m.batch_count) > 0 ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(modal?.type === 'add' || modal?.type === 'edit') && (
        <ChipModelModal model={modal.type === 'edit' ? modal.model : null}
                        onClose={() => setModal(null)} onSave={closeAndRefresh} />
      )}
      {modal?.type === 'delete' && (
        <DeleteChipModelConfirm model={modal.model}
                                onClose={() => setModal(null)} onConfirm={closeAndRefresh} />
      )}
    </>
  );
}

function ChipModelModal({ model, onClose, onSave }) {
  const { t } = useContext(LangCtx);
  const tc = t.chips;
  const isEdit = !!model;

  const [form, setForm] = useState({
    code:           model?.code           || '',
    name:           model?.name           || '',
    biomarkers:     (model?.biomarker_keys || []).join(', '),
    config:         model?.config ? JSON.stringify(model.config, null, 2) : '{\n  \n}',
    guide_video:    model?.guide_video    || '',
    guide_text:     model?.guide_text     || '',
    status:         model?.status         || 'active',
    notes:          model?.notes          || '',
  });
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const code = form.code.trim().toUpperCase();
    if (!isEdit && !/^[A-Z0-9]{1,16}$/.test(code)) {
      setError('Code must be 1–16 uppercase letters/digits'); return;
    }
    const biomarker_keys = form.biomarkers.split(',').map(s => s.trim()).filter(Boolean);
    if (biomarker_keys.length === 0) { setError(tc.biomarkersRequired); return; }

    let config;
    try {
      config = JSON.parse(form.config);
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        setError(tc.invalidJson); return;
      }
    } catch (err) {
      setError(`${tc.invalidJson}: ${err.message}`); return;
    }

    const payload = {
      name:        form.name.trim() || null,
      biomarker_keys,
      config,
      guide_video: form.guide_video.trim() || null,
      guide_text:  form.guide_text.trim()  || null,
      status:      form.status,
      notes:       form.notes.trim() || null,
    };

    setBusy(true);
    try {
      let res;
      if (isEdit) {
        res = await axios.put(`/api/kino-chip-models/${encodeURIComponent(model.code)}`, payload);
      } else {
        res = await axios.post('/api/kino-chip-models', { code, ...payload });
      }
      if (res.data?.success === false) { setError(res.data.error || t.modal.saveFailed); return; }
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || t.modal.saveFailed);
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEdit ? tc.editModel : tc.addModel}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field">
              <span>{tc.modelCode}</span>
              <input value={form.code}
                     onChange={e => set('code', e.target.value.toUpperCase())}
                     placeholder="K2" disabled={isEdit} required={!isEdit} maxLength={16} />
              <small style={{ color: '#64748b', fontSize: 10 }}>{tc.modelCodeHint}</small>
            </label>
            <label className="form-field">
              <span>{tc.modelName}</span>
              <input value={form.name} onChange={e => set('name', e.target.value)}
                     placeholder={tc.modelNamePlaceholder} />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tc.biomarkerKeys}</span>
              <input value={form.biomarkers} onChange={e => set('biomarkers', e.target.value)}
                     placeholder="hsCRP, IL-6" required />
              <small style={{ color: '#64748b', fontSize: 10 }}>{tc.biomarkerKeysHint}</small>
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tc.configJson}</span>
              <textarea rows={12} value={form.config}
                        onChange={e => set('config', e.target.value)}
                        style={{ fontFamily: 'monospace', fontSize: 12 }} required />
              <small style={{ color: '#64748b', fontSize: 10 }}>{tc.configJsonHint}</small>
            </label>
            <label className="form-field">
              <span>{tc.modelStatus}</span>
              <select value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="active">{tc.statusActive}</option>
                <option value="inactive">{tc.statusInactive}</option>
              </select>
            </label>
            <label className="form-field">
              <span>{tc.guideVideo}</span>
              <input value={form.guide_video} onChange={e => set('guide_video', e.target.value)}
                     placeholder="https://…" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tc.guideText}</span>
              <textarea rows={2} value={form.guide_text} onChange={e => set('guide_text', e.target.value)} />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tc.notes}</span>
              <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? t.modal.saving : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteChipModelConfirm({ model, onClose, onConfirm }) {
  const { t } = useContext(LangCtx);
  const tc = t.chips;
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const inUse = parseInt(model.batch_count) > 0;

  const handleDelete = async () => {
    if (inUse) return;
    setBusy(true); setError('');
    try {
      const res = await axios.delete(`/api/kino-chip-models/${encodeURIComponent(model.code)}`);
      if (res.data?.success === false) { setError(res.data.error || 'Failed to delete'); return; }
      onConfirm();
    } catch (err) { setError(err.response?.data?.error || 'Failed to delete'); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{tc.deleteModel}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p>{tc.deleteModelWarning(model.code)}</p>
          {inUse && <p className="form-error">{tc.modelInUse(model.batch_count)}</p>}
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-primary danger" onClick={handleDelete} disabled={busy || inUse}>
              {busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tickets ───────────────────────────────────────────────────────────────────

const TICKET_STATUS_COLORS = {
  open:        '#ef4444',
  in_progress: '#f59e0b',
  resolved:    '#10b981',
  closed:      '#64748b',
};
const TICKET_PRIORITY_COLORS = {
  low:    '#64748b',
  normal: '#6375EC',
  high:   '#f87171',
};

function TicketStatusLabel({ status }) {
  const { t } = useContext(LangCtx);
  const tk = t.tickets;
  const map = { open: tk.sOpen, in_progress: tk.sInProgress, resolved: tk.sResolved, closed: tk.sClosed };
  const color = TICKET_STATUS_COLORS[status] || '#94a3b8';
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 10, background: `${color}22`, color, fontSize: 11, fontWeight: 600 }}>
      {map[status] || status}
    </span>
  );
}

function TicketPriorityLabel({ priority }) {
  const { t } = useContext(LangCtx);
  const tk = t.tickets;
  const map = { low: tk.pLow, normal: tk.pNormal, high: tk.pHigh };
  const color = TICKET_PRIORITY_COLORS[priority] || '#94a3b8';
  return (
    <span style={{ fontSize: 11, color, fontWeight: 600 }}>{map[priority] || priority}</span>
  );
}

function TicketImageThumb({ ossKey, onClick }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    axios.get('/api/oss/presign', { params: { action: 'get', key: ossKey } })
      .then(res => { if (alive && res.data?.success) setUrl(res.data.url); else if (alive) setErr(true); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [ossKey]);
  if (err) return <div style={{ width: 64, height: 64, borderRadius: 6, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 10 }}>!</div>;
  if (!url) return <div style={{ width: 64, height: 64, borderRadius: 6, background: '#1e293b' }} />;
  return (
    <img src={url} alt=""
         onClick={onClick}
         style={{ width: 64, height: 64, borderRadius: 6, objectFit: 'cover', cursor: onClick ? 'zoom-in' : 'default', border: '1px solid rgba(99,117,236,0.25)' }} />
  );
}

function TicketImageLightbox({ ossKey, onClose }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    axios.get('/api/oss/presign', { params: { action: 'get', key: ossKey } })
      .then(res => { if (alive && res.data?.success) setUrl(res.data.url); });
    return () => { alive = false; };
  }, [ossKey]);
  return (
    <div className="modal-overlay" onClick={onClose}
         style={{ background: 'rgba(0,0,0,0.85)' }}>
      {url && <img src={url} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8 }} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Questionnaires Tab
// ─────────────────────────────────────────────────────────────────────────────

const INPUT_TYPES = ['text', 'button_select', 'date_picker', 'slider_group', 'multi_select'];
const SAVE_TARGETS = ['user_field', 'bio_data_field', 'biomarker'];

function GenerateQuestionnaireModal({ channels, onClose, onSave }) {
  const [topic, setTopic] = useState('');
  const [channelId, setChannelId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');

  const generate = async () => {
    if (!topic.trim()) return;
    setGenerating(true); setError(''); setPreview(null);
    try {
      const res = await axios.post('/api/questionnaires/generate', { topic: topic.trim() });
      if (res.data.success) setPreview(res.data.questionnaire);
      else setError(res.data.error || 'Generation failed');
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setGenerating(false); }
  };

  const create = async () => {
    if (!preview) return;
    setSaving(true); setError('');
    try {
      const qRes = await axios.post('/api/questionnaires', {
        name: preview.name,
        name_zh: preview.name_zh || null,
        description: preview.description || null,
        description_zh: preview.description_zh || null,
        type: 'custom',
        channel_id: channelId === '' ? null : parseInt(channelId),
      });
      const qId = qRes.data.questionnaire.id;
      for (let i = 0; i < (preview.questions || []).length; i++) {
        const q = preview.questions[i];
        await axios.post(`/api/questionnaires/${qId}/questions`, {
          key: q.key,
          sort_order: i,
          input_type: q.input_type,
          prompt_zh: q.prompt_zh || '',
          prompt_en: q.prompt_en || '',
          config: q.config || {},
          completion_check: {},
        });
      }
      onSave();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  };

  const INPUT_TYPE_COLOR = { text: '#6366f1', button_select: '#0ea5e9', date_picker: '#f59e0b', slider_group: '#10b981', multi_select: '#8b5cf6' };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <div className="modal-header">
          <h3>✨ Generate Questionnaire with AI</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}
          <label>Describe the questionnaire topic</label>
          <textarea
            className="form-input"
            rows={3}
            placeholder="e.g. Sleep quality and recovery habits for longevity-focused users"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            disabled={generating || saving}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }}
          />
          <button className="btn-primary" onClick={generate} disabled={generating || saving || !topic.trim()} style={{ marginTop: 8 }}>
            {generating ? 'Generating…' : '✨ Generate'}
          </button>

          {preview && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #1e293b' }}>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {preview.name}
                  {preview.name_zh && <span style={{ color: '#64748b', fontWeight: 400, marginLeft: 8, fontSize: 13 }}>{preview.name_zh}</span>}
                </div>
                {preview.description && <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>{preview.description}</div>}
              </div>

              <label>Channel</label>
              <select className="form-input" value={channelId} onChange={e => setChannelId(e.target.value)}>
                <option value="">Global (all channels)</option>
                {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>

              <div style={{ color: '#64748b', fontSize: 11, margin: '14px 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {(preview.questions || []).length} Questions
              </div>
              {(preview.questions || []).map((q, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: '#0f172a', borderRadius: 6, marginBottom: 6, fontSize: 13 }}>
                  <span style={{ color: '#475569', minWidth: 18, paddingTop: 1 }}>{i + 1}.</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ marginBottom: 2 }}>{q.prompt_en}</div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>{q.prompt_zh}</div>
                  </div>
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: (INPUT_TYPE_COLOR[q.input_type] || '#475569') + '22', color: INPUT_TYPE_COLOR[q.input_type] || '#94a3b8', alignSelf: 'flex-start', whiteSpace: 'nowrap' }}>
                    {q.input_type}
                  </span>
                </div>
              ))}

              <div style={{ fontSize: 12, color: '#64748b', marginTop: 12 }}>
                Review the preview above. Click Create to save this questionnaire and all its questions.
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          {!preview && (
            <button className="btn-primary" onClick={generate} disabled={generating || !topic.trim()}>
              {generating ? 'Generating…' : '✨ Generate'}
            </button>
          )}
          {preview && (
            <button className="btn-primary" onClick={create} disabled={saving}>
              {saving ? 'Creating…' : 'Create Questionnaire'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionnaireModal({ questionnaire, channels, onClose, onSave }) {
  const isEdit = !!questionnaire;
  const [form, setForm] = useState({
    name: questionnaire?.name || '',
    name_zh: questionnaire?.name_zh || '',
    description: questionnaire?.description || '',
    description_zh: questionnaire?.description_zh || '',
    type: questionnaire?.type || 'custom',
    channel_id: questionnaire?.channel_id ?? '',
    is_active: questionnaire?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!form.name) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form, channel_id: form.channel_id === '' ? null : parseInt(form.channel_id) };
      if (isEdit) await axios.put(`/api/questionnaires/${questionnaire.id}`, payload);
      else await axios.post('/api/questionnaires', payload);
      onSave();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>{isEdit ? 'Edit Questionnaire' : 'New Questionnaire'}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}
          <label>Name (EN) *</label>
          <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <label>Name (中文)</label>
          <input className="form-input" value={form.name_zh} onChange={e => setForm(f => ({ ...f, name_zh: e.target.value }))} />
          <label>Description (EN)</label>
          <textarea className="form-input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <label>Description (中文)</label>
          <textarea className="form-input" rows={2} value={form.description_zh} onChange={e => setForm(f => ({ ...f, description_zh: e.target.value }))} />
          <label>Type</label>
          <select className="form-input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            <option value="custom">Custom</option>
            <option value="onboarding">Onboarding</option>
          </select>
          <label>Channel</label>
          <select className="form-input" value={form.channel_id} onChange={e => setForm(f => ({ ...f, channel_id: e.target.value }))}>
            <option value="">Global (all channels)</option>
            {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
            Active
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function QuestionModal({ question, questionnaireId, onClose, onSave }) {
  const isEdit = !!question;
  const [inputType, setInputType] = useState(question?.input_type || 'text');
  const [form, setForm] = useState({
    key: question?.key || '',
    sort_order: question?.sort_order ?? 0,
    prompt_zh: question?.prompt_zh || '',
    prompt_en: question?.prompt_en || '',
    is_active: question?.is_active ?? true,
    save_target: question?.save_target || '',
    save_field: question?.save_field || '',
    save_biomarker_type: question?.save_biomarker_type || '',
    completion_check: question?.completion_check ? JSON.stringify(question.completion_check, null, 2) : '{}',
    config: question?.config ? JSON.stringify(question.config, null, 2) : '{}',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!form.key || !form.prompt_zh || !form.prompt_en) { setError('Key, prompt ZH and EN required'); return; }
    let completion_check, config;
    try { completion_check = JSON.parse(form.completion_check); } catch { setError('Invalid JSON in Completion Check'); return; }
    try { config = JSON.parse(form.config); } catch { setError('Invalid JSON in Config'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        ...form, input_type: inputType, completion_check, config,
        save_target: form.save_target || null,
        save_field: form.save_field || null,
        save_biomarker_type: form.save_biomarker_type || null,
        sort_order: parseInt(form.sort_order) || 0,
      };
      if (isEdit) await axios.put(`/api/questionnaire-questions/${question.id}`, payload);
      else await axios.post(`/api/questionnaires/${questionnaireId}/questions`, payload);
      onSave();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <h3>{isEdit ? 'Edit Question' : 'New Question'}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label>Key *</label>
              <input className="form-input" value={form.key} onChange={e => setForm(f => ({ ...f, key: e.target.value }))} placeholder="e.g. nickname" />
            </div>
            <div>
              <label>Sort Order</label>
              <input className="form-input" type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} />
            </div>
          </div>
          <label>Input Type *</label>
          <select className="form-input" value={inputType} onChange={e => setInputType(e.target.value)}>
            {INPUT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <label>Prompt (中文) *</label>
          <textarea className="form-input" rows={2} value={form.prompt_zh} onChange={e => setForm(f => ({ ...f, prompt_zh: e.target.value }))} />
          <label>Prompt (EN) *</label>
          <textarea className="form-input" rows={2} value={form.prompt_en} onChange={e => setForm(f => ({ ...f, prompt_en: e.target.value }))} />
          <label>Save Target</label>
          <select className="form-input" value={form.save_target} onChange={e => setForm(f => ({ ...f, save_target: e.target.value }))}>
            <option value="">None (responses table only)</option>
            {SAVE_TARGETS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {(form.save_target === 'user_field' || form.save_target === 'bio_data_field') && (
            <>
              <label>Save Field (column / bio_data key)</label>
              <input className="form-input" value={form.save_field} onChange={e => setForm(f => ({ ...f, save_field: e.target.value }))} placeholder="e.g. nickname" />
            </>
          )}
          {form.save_target === 'biomarker' && (
            <>
              <label>Biomarker Type</label>
              <input className="form-input" value={form.save_biomarker_type} onChange={e => setForm(f => ({ ...f, save_biomarker_type: e.target.value }))} placeholder="e.g. body_composition" />
            </>
          )}
          <label>Completion Check (JSON) <span style={{ color: '#64748b', fontWeight: 400, fontSize: 11 }}>— how miniapp detects if already answered</span></label>
          <textarea className="form-input code-input" rows={3} value={form.completion_check} onChange={e => setForm(f => ({ ...f, completion_check: e.target.value }))} />
          <label>Config (JSON) <span style={{ color: '#64748b', fontWeight: 400, fontSize: 11 }}>— input-type-specific options</span></label>
          <textarea className="form-input code-input" rows={6} value={form.config} onChange={e => setForm(f => ({ ...f, config: e.target.value }))} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
            Active
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function AssignModal({ questionnaires, users, coaches, onClose, onSave }) {
  const [questionnaireId, setQuestionnaireId] = useState('');
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [filterCoach, setFilterCoach] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const filteredUsers = filterCoach
    ? users.filter(u => String(u.coach_id) === filterCoach)
    : users;

  const toggleUser = (uid) => setSelectedUsers(prev =>
    prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]
  );

  const save = async () => {
    if (!questionnaireId) { setError('Select a questionnaire'); return; }
    if (!selectedUsers.length) { setError('Select at least one user'); return; }
    setSaving(true); setError('');
    try {
      await axios.post('/api/questionnaire-assignments', {
        questionnaire_id: parseInt(questionnaireId),
        user_ids: selectedUsers,
      });
      onSave();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3>Assign Questionnaire</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}
          <label>Questionnaire *</label>
          <select className="form-input" value={questionnaireId} onChange={e => setQuestionnaireId(e.target.value)}>
            <option value="">— select —</option>
            {questionnaires.filter(q => q.is_active).map(q => (
              <option key={q.id} value={q.id}>{q.name}{q.type === 'onboarding' ? ' (onboarding)' : ''}</option>
            ))}
          </select>
          <label>Filter by Coach</label>
          <select className="form-input" value={filterCoach} onChange={e => setFilterCoach(e.target.value)}>
            <option value="">All coaches</option>
            {coaches.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label>Select Users ({selectedUsers.length} selected)</label>
          <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #1e293b', borderRadius: 6, padding: 4 }}>
            {filteredUsers.length === 0 && <div style={{ padding: 12, color: '#64748b', textAlign: 'center' }}>No users</div>}
            {filteredUsers.map(u => (
              <label key={u.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer', borderRadius: 4, background: selectedUsers.includes(u.user_id) ? '#1e3a5f' : 'transparent' }}>
                <input type="checkbox" checked={selectedUsers.includes(u.user_id)} onChange={() => toggleUser(u.user_id)} />
                <span>{u.nickname || u.user_id}</span>
                <span style={{ color: '#64748b', fontSize: 11 }}>{u.channel_name || ''}</span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setSelectedUsers(filteredUsers.map(u => u.user_id))}>Select all</button>
            <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setSelectedUsers([])}>Clear</button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Sending…' : `Send to ${selectedUsers.length} user${selectedUsers.length !== 1 ? 's' : ''}`}</button>
        </div>
      </div>
    </div>
  );
}

function ResponsesModal({ assignment, onClose }) {
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`/api/questionnaire-responses?assignment_id=${assignment.id}`)
      .then(r => setResponses(r.data.responses || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [assignment.id]);

  const formatAnswer = (answer, inputType) => {
    if (Array.isArray(answer)) return answer.join(', ');
    if (typeof answer === 'object' && answer !== null) return JSON.stringify(answer);
    return String(answer ?? '—');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3>Responses — {assignment.user_nickname || assignment.user_id}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {loading && <div style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>Loading…</div>}
          {!loading && responses.length === 0 && <div style={{ color: '#64748b' }}>No responses yet.</div>}
          {responses.map(r => (
            <div key={r.id} style={{ marginBottom: 12, padding: '10px 12px', background: '#0f172a', borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{r.key} · {r.input_type}</div>
              <div style={{ fontSize: 13 }}>{r.prompt_en}</div>
              <div style={{ marginTop: 6, fontWeight: 600, color: '#93c5fd' }}>{formatAnswer(r.answer, r.input_type)}</div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>{new Date(r.answered_at).toLocaleString()}</div>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

const STATUS_COLORS = { pending: '#f59e0b', in_progress: '#3b82f6', completed: '#22c55e' };

function QuestionnairesTab({ channels, users, coaches }) {
  const [subTab, setSubTab] = useState('builder');
  const [questionnaires, setQuestionnaires] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [expandedQ, setExpandedQ] = useState(null);
  const [questions, setQuestions] = useState({});
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterQId, setFilterQId] = useState('');

  const fetchQuestionnaires = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/questionnaires');
      setQuestionnaires(res.data.questionnaires || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterQId) params.questionnaire_id = filterQId;
      if (filterStatus !== 'all') params.status = filterStatus;
      const res = await axios.get('/api/questionnaire-assignments', { params });
      setAssignments(res.data.assignments || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filterQId, filterStatus]);

  useEffect(() => { fetchQuestionnaires(); }, [fetchQuestionnaires]);
  useEffect(() => { if (subTab === 'assignments') fetchAssignments(); }, [subTab, fetchAssignments]);

  const loadQuestions = async (qid) => {
    if (questions[qid]) return;
    const res = await axios.get(`/api/questionnaires/${qid}/questions`);
    setQuestions(prev => ({ ...prev, [qid]: res.data.questions || [] }));
  };

  const toggleExpand = async (qid) => {
    if (expandedQ === qid) { setExpandedQ(null); return; }
    await loadQuestions(qid);
    setExpandedQ(qid);
  };

  const reorderQuestion = async (qid, questionId, dir) => {
    const qs = [...(questions[qid] || [])];
    const idx = qs.findIndex(q => q.id === questionId);
    if ((dir === -1 && idx === 0) || (dir === 1 && idx === qs.length - 1)) return;
    const swapIdx = idx + dir;
    [qs[idx].sort_order, qs[swapIdx].sort_order] = [qs[swapIdx].sort_order, qs[idx].sort_order];
    [qs[idx], qs[swapIdx]] = [qs[swapIdx], qs[idx]];
    setQuestions(prev => ({ ...prev, [qid]: qs }));
    await axios.put('/api/questionnaire-questions/reorder', {
      items: [{ id: qs[idx].id, sort_order: qs[idx].sort_order }, { id: qs[swapIdx].id, sort_order: qs[swapIdx].sort_order }]
    });
  };

  const deleteQuestion = async (qid, questionId) => {
    if (!confirm('Delete this question?')) return;
    await axios.delete(`/api/questionnaire-questions/${questionId}`);
    setQuestions(prev => ({ ...prev, [qid]: prev[qid].filter(q => q.id !== questionId) }));
  };

  const deleteQuestionnaire = async (q) => {
    if (!confirm(`Deactivate "${q.name}"?`)) return;
    await axios.delete(`/api/questionnaires/${q.id}`);
    fetchQuestionnaires();
  };

  const closeAndRefreshBuilder = () => {
    setModal(null);
    fetchQuestionnaires();
    if (expandedQ) setQuestions(prev => { const n = { ...prev }; delete n[expandedQ]; return n; });
  };

  const closeAndRefreshAssignments = () => { setModal(null); fetchAssignments(); };

  return (
    <>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['builder', 'assignments'].map(st => (
          <button key={st} className={`subtab-btn${subTab === st ? ' active' : ''}`} onClick={() => setSubTab(st)}>
            {st === 'builder' ? 'Builder' : 'Assignments'}
          </button>
        ))}
      </div>

      {/* Builder sub-tab */}
      {subTab === 'builder' && (
        <div className="card">
          <div className="table-toolbar">
            <span style={{ fontWeight: 600 }}>Questionnaires ({questionnaires.length})</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-secondary" onClick={() => setModal({ type: 'generate-questionnaire' })}>
                ✨ Generate with AI
              </button>
              <button className="btn-primary" onClick={() => setModal({ type: 'new-questionnaire' })}>
                <Plus size={14} /> New Questionnaire
              </button>
            </div>
          </div>
          {loading && <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading…</div>}
          {!loading && questionnaires.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>No questionnaires yet.</div>}
          {questionnaires.map(q => (
            <div key={q.id} style={{ borderTop: '1px solid #1e293b' }}>
              {/* Questionnaire header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px' }}>
                <button className="icon-btn" onClick={() => toggleExpand(q.id)}>
                  {expandedQ === q.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600 }}>{q.name}</span>
                  {q.name_zh && <span style={{ color: '#64748b', marginLeft: 8, fontSize: 12 }}>{q.name_zh}</span>}
                  <span style={{ marginLeft: 10, fontSize: 11, padding: '2px 6px', borderRadius: 4, background: q.type === 'onboarding' ? '#1e3a5f' : '#1e293b', color: q.type === 'onboarding' ? '#93c5fd' : '#94a3b8' }}>{q.type}</span>
                  {!q.is_active && <span style={{ marginLeft: 6, fontSize: 11, color: '#ef4444' }}>inactive</span>}
                </div>
                <span style={{ fontSize: 11, color: '#64748b' }}>{q.channel_name || 'Global'}</span>
                <span style={{ fontSize: 11, color: '#64748b' }}>{q.question_count} questions</span>
                <button className="icon-btn" title="Edit" onClick={() => setModal({ type: 'edit-questionnaire', questionnaire: q })}><Pencil size={14} /></button>
                <button className="icon-btn" title="Deactivate" onClick={() => deleteQuestionnaire(q)}><Trash2 size={14} /></button>
              </div>

              {/* Expanded question list */}
              {expandedQ === q.id && (
                <div style={{ background: '#0f172a', padding: '8px 16px 12px 40px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: '#64748b' }}>Questions</span>
                    <button className="btn-primary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setModal({ type: 'new-question', questionnaireId: q.id })}>
                      <Plus size={12} /> Add Question
                    </button>
                  </div>
                  {(questions[q.id] || []).length === 0 && <div style={{ color: '#475569', fontSize: 12 }}>No questions yet.</div>}
                  {(questions[q.id] || []).map((qq, idx, arr) => (
                    <div key={qq.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: idx < arr.length - 1 ? '1px solid #1e293b' : 'none' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <button className="icon-btn" style={{ padding: 2 }} onClick={() => reorderQuestion(q.id, qq.id, -1)} disabled={idx === 0}><ChevronUp size={11} /></button>
                        <button className="icon-btn" style={{ padding: 2 }} onClick={() => reorderQuestion(q.id, qq.id, 1)} disabled={idx === arr.length - 1}><ChevronDown size={11} /></button>
                      </div>
                      <span style={{ fontSize: 11, color: '#475569', width: 20, textAlign: 'right' }}>{qq.sort_order}</span>
                      <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: '#1e293b', color: '#94a3b8', whiteSpace: 'nowrap' }}>{qq.input_type}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{qq.key}</div>
                        <div style={{ color: '#64748b', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{qq.prompt_en}</div>
                      </div>
                      {qq.save_target && <span style={{ fontSize: 11, color: '#a78bfa', whiteSpace: 'nowrap' }}>{qq.save_target}</span>}
                      {!qq.is_active && <span style={{ fontSize: 11, color: '#ef4444' }}>off</span>}
                      <button className="icon-btn" onClick={() => setModal({ type: 'edit-question', question: qq, questionnaireId: q.id })}><Pencil size={13} /></button>
                      <button className="icon-btn" onClick={() => deleteQuestion(q.id, qq.id)}><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Assignments sub-tab */}
      {subTab === 'assignments' && (
        <div className="card">
          <div className="table-toolbar">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select className="form-input" style={{ width: 'auto', fontSize: 12 }} value={filterQId} onChange={e => setFilterQId(e.target.value)}>
                <option value="">All questionnaires</option>
                {questionnaires.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
              </select>
              {['all', 'pending', 'in_progress', 'completed'].map(s => (
                <button key={s} className={`subtab-btn${filterStatus === s ? ' active' : ''}`} onClick={() => setFilterStatus(s)} style={{ fontSize: 11 }}>
                  {s === 'all' ? 'All' : s.replace('_', ' ')}
                </button>
              ))}
            </div>
            <button className="btn-primary" onClick={() => setModal({ type: 'assign' })}>
              <Send size={14} /> Assign
            </button>
          </div>
          <table className="data-table">
            <thead><tr>
              <th>User</th><th>Questionnaire</th><th>Assigned by</th><th>Status</th><th>Assigned</th><th>Completed</th><th></th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="empty-row">Loading…</td></tr>}
              {!loading && assignments.length === 0 && <tr><td colSpan={7} className="empty-row">No assignments found.</td></tr>}
              {assignments.map(a => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 500 }}>{a.user_nickname || a.user_id}</td>
                  <td>
                    {a.name}
                    <span style={{ marginLeft: 6, fontSize: 11, color: '#64748b' }}>{a.type === 'onboarding' ? '(onboarding)' : ''}</span>
                  </td>
                  <td style={{ fontSize: 12, color: '#64748b' }}>{a.assigned_by_name || a.assigned_by || <span style={{ color: '#475569' }}>system</span>}</td>
                  <td>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: STATUS_COLORS[a.status] + '22', color: STATUS_COLORS[a.status] }}>
                      {a.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(a.assigned_at).toLocaleDateString()}</td>
                  <td style={{ fontSize: 11, color: '#94a3b8' }}>{a.completed_at ? new Date(a.completed_at).toLocaleDateString() : '—'}</td>
                  <td>
                    <button className="icon-btn" title="View responses" onClick={() => setModal({ type: 'responses', assignment: a })}><Eye size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.type === 'generate-questionnaire' && (
        <GenerateQuestionnaireModal channels={channels} onClose={() => setModal(null)} onSave={closeAndRefreshBuilder} />
      )}
      {modal?.type === 'new-questionnaire' && (
        <QuestionnaireModal channels={channels} onClose={() => setModal(null)} onSave={closeAndRefreshBuilder} />
      )}
      {modal?.type === 'edit-questionnaire' && (
        <QuestionnaireModal questionnaire={modal.questionnaire} channels={channels} onClose={() => setModal(null)} onSave={closeAndRefreshBuilder} />
      )}
      {(modal?.type === 'new-question' || modal?.type === 'edit-question') && (
        <QuestionModal
          question={modal.type === 'edit-question' ? modal.question : null}
          questionnaireId={modal.questionnaireId}
          onClose={() => setModal(null)}
          onSave={() => {
            setModal(null);
            setQuestions(prev => { const n = { ...prev }; delete n[modal.questionnaireId]; return n; });
            loadQuestions(modal.questionnaireId);
            fetchQuestionnaires();
          }}
        />
      )}
      {modal?.type === 'assign' && (
        <AssignModal questionnaires={questionnaires} users={users} coaches={coaches} onClose={() => setModal(null)} onSave={closeAndRefreshAssignments} />
      )}
      {modal?.type === 'responses' && (
        <ResponsesModal assignment={modal.assignment} onClose={() => setModal(null)} />
      )}
    </>
  );
}

function TicketsTab({ tickets, onRefresh }) {
  const { t } = useContext(LangCtx);
  const tk = t.tickets;
  const [modal, setModal]     = useState(null);
  const [filter, setFilter]   = useState('all');
  const [lightbox, setLightbox] = useState(null);
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  const counts = {
    all:         tickets.length,
    open:        tickets.filter(t => t.status === 'open').length,
    in_progress: tickets.filter(t => t.status === 'in_progress').length,
    resolved:    tickets.filter(t => t.status === 'resolved').length,
    closed:      tickets.filter(t => t.status === 'closed').length,
  };
  const filtered = filter === 'all' ? tickets : tickets.filter(t => t.status === filter);

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Bug}         label={tk.statOpen}       value={counts.open}        color={TICKET_STATUS_COLORS.open}        />
        <StatCard icon={Activity}    label={tk.statInProgress} value={counts.in_progress} color={TICKET_STATUS_COLORS.in_progress} />
        <StatCard icon={Check}       label={tk.statResolved}   value={counts.resolved}    color={TICKET_STATUS_COLORS.resolved}    />
        <StatCard icon={X}           label={tk.statClosed}     value={counts.closed}      color={TICKET_STATUS_COLORS.closed}      />
      </div>

      <div className="card">
        <div className="table-toolbar">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['all', 'open', 'in_progress', 'resolved', 'closed'].map(s => (
              <button key={s}
                      className={`subtab-btn${filter === s ? ' active' : ''}`}
                      onClick={() => setFilter(s)}>
                {s === 'all' ? tk.filterAll : (s === 'open' ? tk.sOpen : s === 'in_progress' ? tk.sInProgress : s === 'resolved' ? tk.sResolved : tk.sClosed)}
                {' '}<span style={{ opacity: 0.6 }}>({counts[s]})</span>
              </button>
            ))}
          </div>
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
            <Plus size={14} />{tk.addTicket}
          </button>
        </div>
        <table className="data-table">
          <thead><tr>
            <th>ID</th>
            <th>{tk.title.replace(' *', '')}</th>
            <th>{tk.status}</th>
            <th>{tk.priority}</th>
            <th>{tk.images}</th>
            <th>{tk.reporter}</th>
            <th>Created</th>
            <th></th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={8} className="empty-row">{t.empty.tickets}</td></tr>}
            {filtered.map(ticket => (
              <tr key={ticket.id}>
                <td style={{ color: '#94a3b8', fontSize: 11 }}>#{ticket.id}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{ticket.title}</div>
                  {ticket.description && (
                    <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2, maxWidth: 480, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ticket.description}
                    </div>
                  )}
                </td>
                <td><TicketStatusLabel status={ticket.status} /></td>
                <td><TicketPriorityLabel priority={ticket.priority} /></td>
                <td>
                  {(ticket.images && ticket.images.length > 0) ? (
                    <div style={{ display: 'flex', gap: 4 }}>
                      {ticket.images.slice(0, 3).map(k => (
                        <TicketImageThumb key={k} ossKey={k} onClick={() => setLightbox(k)} />
                      ))}
                      {ticket.images.length > 3 && (
                        <div style={{ width: 64, height: 64, borderRadius: 6, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>
                          +{ticket.images.length - 3}
                        </div>
                      )}
                    </div>
                  ) : <span style={{ color: '#475569', fontSize: 11 }}>—</span>}
                </td>
                <td style={{ fontSize: 12 }}>{ticket.reporter || <span style={{ color: '#475569' }}>—</span>}</td>
                <td style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(ticket.created_at).toLocaleString()}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="icon-btn" title={tk.editTicket}   onClick={() => setModal({ type: 'edit', ticket })}><Pencil size={14} /></button>
                    <button className="icon-btn" title={tk.deleteTicket} onClick={() => setModal({ type: 'delete', ticket })}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(modal?.type === 'add' || modal?.type === 'edit') && (
        <TicketModal ticket={modal.type === 'edit' ? modal.ticket : null}
                     onClose={() => setModal(null)} onSave={closeAndRefresh} />
      )}
      {modal?.type === 'delete' && (
        <DeleteTicketConfirm ticket={modal.ticket}
                             onClose={() => setModal(null)} onConfirm={closeAndRefresh} />
      )}
      {lightbox && <TicketImageLightbox ossKey={lightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}

function TicketModal({ ticket, onClose, onSave }) {
  const { t } = useContext(LangCtx);
  const tk = t.tickets;
  const isEdit = !!ticket;

  const [form, setForm] = useState({
    title:       ticket?.title       || '',
    description: ticket?.description || '',
    status:      ticket?.status      || 'open',
    priority:    ticket?.priority    || 'normal',
    reporter:    ticket?.reporter    || '',
  });
  const [images, setImages]     = useState(ticket?.images || []);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handlePickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true); setProgress(0); setError('');
    try {
      const presignRes = await axios.get('/api/oss/presign', {
        params: { type: 'image', filename: file.name, category: 'tickets' },
      });
      if (!presignRes.data.success) throw new Error(presignRes.data.error || tk.uploadFailed);
      const { url, key } = presignRes.data;
      await uploadToOSS(url, file, setProgress);
      setImages(arr => [...arr, key]);
    } catch (err) {
      setError(err.response?.data?.error || err.message || tk.uploadFailed);
    } finally { setUploading(false); }
  };

  const removeImage = (key) => setImages(arr => arr.filter(k => k !== key));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setError(tk.titleRequired); return; }
    setBusy(true); setError('');
    try {
      const payload = { ...form, images };
      let res;
      if (isEdit) {
        res = await axios.put(`/api/tickets/${ticket.id}`, payload);
      } else {
        res = await axios.post('/api/tickets', payload);
      }
      if (res.data?.success === false) { setError(res.data.error || t.modal.saveFailed); return; }
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || t.modal.saveFailed);
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEdit ? tk.editTicket : tk.addTicket}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tk.title}</span>
              <input value={form.title}
                     onChange={e => set('title', e.target.value)}
                     placeholder={tk.titlePlaceholder} required autoFocus />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tk.description}</span>
              <textarea rows={5} value={form.description}
                        onChange={e => set('description', e.target.value)}
                        placeholder={tk.descriptionPlaceholder}
                        style={{ resize: 'vertical' }} />
            </label>
            <label className="form-field">
              <span>{tk.status}</span>
              <select value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="open">{tk.sOpen}</option>
                <option value="in_progress">{tk.sInProgress}</option>
                <option value="resolved">{tk.sResolved}</option>
                <option value="closed">{tk.sClosed}</option>
              </select>
            </label>
            <label className="form-field">
              <span>{tk.priority}</span>
              <select value={form.priority} onChange={e => set('priority', e.target.value)}>
                <option value="low">{tk.pLow}</option>
                <option value="normal">{tk.pNormal}</option>
                <option value="high">{tk.pHigh}</option>
              </select>
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tk.reporter}</span>
              <input value={form.reporter}
                     onChange={e => set('reporter', e.target.value)}
                     placeholder={tk.reporterPlaceholder} />
            </label>

            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label-text">{tk.images}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                {images.map(k => (
                  <div key={k} style={{ position: 'relative' }}>
                    <TicketImageThumb ossKey={k} />
                    <button type="button" className="icon-btn" title={tk.removeImage}
                            onClick={() => removeImage(k)}
                            style={{ position: 'absolute', top: -6, right: -6, background: '#0F2540', border: '1px solid rgba(99,117,236,0.4)', borderRadius: '50%', width: 22, height: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <label className="upload-zone" style={{ width: 64, height: 64, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: uploading ? 'wait' : 'pointer' }}>
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePickFile} disabled={uploading} />
                  {uploading ? <span style={{ fontSize: 10, color: '#94a3b8' }}>{progress}%</span> : <Plus size={18} style={{ color: 'var(--muted)' }} />}
                </label>
              </div>
              {!uploading && images.length === 0 && (
                <small style={{ color: '#64748b', fontSize: 11 }}>{tk.imageDropHint}</small>
              )}
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy || uploading}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy || uploading}>
              {busy ? t.modal.saving : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteTicketConfirm({ ticket, onClose, onConfirm }) {
  const { t } = useContext(LangCtx);
  const tk = t.tickets;
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setBusy(true); setError('');
    try {
      const res = await axios.delete(`/api/tickets/${ticket.id}`);
      if (res.data?.success === false) { setError(res.data.error || 'Failed to delete'); return; }
      onConfirm();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{tk.deleteTicket}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p>{tk.deleteWarning(ticket.title)}</p>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-primary danger" onClick={handleDelete} disabled={busy}>
              {busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Reports Tab ───────────────────────────────────────────────────────────────

const REPORT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

function ReportChart({ chart, data }) {
  if (!chart || !data || data.length === 0) return null;
  const { type, xKey, yKeys = [] } = chart;
  if (!xKey || yKeys.length === 0) return null;

  const tickFmt = (v) => {
    const s = String(v);
    return s.length > 14 ? s.slice(0, 12) + '…' : s;
  };

  if (type === 'pie') {
    const yk = yKeys[0];
    if (!yk) return null;
    return (
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie data={data} dataKey={yk.key} nameKey={xKey} cx="50%" cy="50%" outerRadius={110}
            label={({ name, percent }) => `${String(name).slice(0, 10)} ${(percent * 100).toFixed(0)}%`}>
            {data.map((_, i) => <Cell key={i} fill={REPORT_COLORS[i % REPORT_COLORS.length]} />)}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  const ChartComp   = type === 'area' ? AreaChart  : type === 'line' ? LineChart  : BarChart;
  const SeriesComp  = type === 'area' ? Area       : type === 'line' ? Line       : Bar;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ChartComp data={data} margin={{ top: 4, right: 20, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={tickFmt} />
        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} width={50} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        {yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {yKeys.map((yk, i) => (
          <SeriesComp
            key={yk.key}
            type="monotone"
            dataKey={yk.key}
            name={yk.label || yk.key}
            fill={yk.color || REPORT_COLORS[i % REPORT_COLORS.length]}
            stroke={yk.color || REPORT_COLORS[i % REPORT_COLORS.length]}
            fillOpacity={type === 'area' ? 0.2 : 1}
            radius={type === 'bar' ? [3, 3, 0, 0] : undefined}
          />
        ))}
      </ChartComp>
    </ResponsiveContainer>
  );
}

function ReportDataTable({ columns, data }) {
  const { t } = useLang();
  if (!data || data.length === 0) return <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>{t.reports.rowCount(0)}</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table">
        <thead>
          <tr>{columns.map(col => <th key={col}>{col}</th>)}</tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              {columns.map(col => (
                <td key={col}>
                  {row[col] == null ? '—' : typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportsTab() {
  const { t } = useLang();
  const tr = t.reports;
  const adminUser = sessionStorage.getItem('nano_admin_user') || '';

  // Run state
  const [query, setQuery]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [report, setReport]       = useState(null);
  const [llmHistory, setLlmHistory] = useState([]);
  const [showSql, setShowSql]     = useState(false);
  const [activeTab, setActiveTab] = useState('chart');

  // Session history (localStorage)
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('nano_report_history') || '[]'); } catch { return []; }
  });

  // Saved reports (DB, shared across admins)
  const [savedReports, setSavedReports]   = useState([]);
  const [savedLoading, setSavedLoading]   = useState(false);
  const [activeSavedId, setActiveSavedId] = useState(null);

  // Edit / save modal: null | { mode: 'save' | 'edit', title, query, savedId }
  const [modal, setModal] = useState(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  const textareaRef = React.useRef(null);

  const fetchSaved = useCallback(async () => {
    setSavedLoading(true);
    try {
      const res = await axios.get('/api/admin/saved-reports');
      setSavedReports(res.data.reports || []);
    } catch {} finally { setSavedLoading(false); }
  }, []);

  useEffect(() => { fetchSaved(); }, [fetchSaved]);

  const runReport = async (queryText) => {
    const q = (queryText || query).trim();
    if (!q || loading) return;
    setLoading(true);
    setError('');
    setShowSql(false);
    setActiveSavedId(null);
    try {
      const res = await axios.post('/api/admin/report', { query: q, history: llmHistory });
      if (res.data.success === false) throw new Error(res.data.error || 'Report failed');
      const newReport = { ...res.data, query: q };
      setReport(newReport);
      setActiveTab(newReport.chart && newReport.data?.length > 0 ? 'chart' : 'table');
      const summary = `Title: ${newReport.title}. SQL: ${(newReport.sql || '').slice(0, 200)}. Rows: ${newReport.data?.length}.`;
      setLlmHistory(prev => [...prev, { role: 'user', content: q }, { role: 'assistant', content: summary }].slice(-24));
      setHistory(prev => {
        const next = [{ id: Date.now(), query: q, report: newReport }, ...prev].slice(0, 20);
        try { localStorage.setItem('nano_report_history', JSON.stringify(next)); } catch {}
        return next;
      });
      setQuery('');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Unknown error');
    } finally { setLoading(false); }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runReport(); }
  };

  const loadFromHistory = (entry) => {
    setReport(entry.report);
    setShowSql(false);
    setError('');
    setActiveSavedId(null);
    setActiveTab(entry.report.chart && entry.report.data?.length > 0 ? 'chart' : 'table');
  };

  const loadSaved = (saved) => {
    const r = {
      title: saved.title,
      query: saved.query,
      sql: saved.sql,
      chart: saved.chart,
      insights: saved.insights,
      columns: saved.columns || [],
      data: saved.data || [],
    };
    setReport(r);
    setShowSql(false);
    setError('');
    setActiveSavedId(saved.id);
    setActiveTab(r.chart && r.data?.length > 0 ? 'chart' : 'table');
  };

  const startNew = () => {
    setReport(null); setQuery(''); setError(''); setShowSql(false);
    setLlmHistory([]); setActiveSavedId(null);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const exportCsv = () => {
    if (!report?.data?.length) return;
    const cols = report.columns;
    const rows = report.data.map(row =>
      cols.map(c => {
        const v = row[c] == null ? '' : String(row[c]);
        return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(',')
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([[cols.join(','), ...rows].join('\n')], { type: 'text/csv' }));
    a.download = `${(report.title || 'report').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.csv`;
    a.click();
  };

  // ── Save / Edit modal actions ───────────────────────────────────────────────
  const openSaveModal = () => {
    setModal({ mode: 'save', title: report?.title || '', query: report?.query || '' });
    setModalError('');
  };

  const openEditModal = (saved) => {
    setModal({ mode: 'edit', title: saved.title, query: saved.query, savedId: saved.id });
    setModalError('');
  };

  const closeModal = () => { setModal(null); setModalBusy(false); setModalError(''); };

  const handleModalSave = async (rerun = false) => {
    if (!modal?.title?.trim()) { setModalError('Title is required'); return; }
    setModalBusy(true);
    setModalError('');
    try {
      if (modal.mode === 'save') {
        // New save
        await axios.post('/api/admin/saved-reports', {
          title: modal.title.trim(),
          query: report.query || modal.query,
          sql: report.sql,
          chart: report.chart,
          insights: report.insights,
          columns: report.columns,
          data: report.data,
          created_by: adminUser,
        });
        await fetchSaved();
        closeModal();
      } else {
        // Edit existing
        if (rerun && modal.query?.trim()) {
          // Re-run query first, then update saved
          closeModal();
          setLoading(true);
          setError('');
          const res = await axios.post('/api/admin/report', { query: modal.query.trim(), history: [] });
          if (res.data.success === false) throw new Error(res.data.error || 'Report failed');
          const newReport = res.data;
          await axios.put(`/api/admin/saved-reports/${modal.savedId}`, {
            title: modal.title.trim(),
            query: modal.query.trim(),
            sql: newReport.sql,
            chart: newReport.chart,
            insights: newReport.insights,
            columns: newReport.columns,
            data: newReport.data,
            updated_by: adminUser,
          });
          setReport(newReport);
          setActiveSavedId(modal.savedId);
          setActiveTab(newReport.chart && newReport.data?.length > 0 ? 'chart' : 'table');
          await fetchSaved();
          setLoading(false);
        } else {
          // Title-only update
          await axios.put(`/api/admin/saved-reports/${modal.savedId}`, {
            title: modal.title.trim(),
            query: modal.query,
            sql: report?.sql || '',
            chart: report?.chart,
            insights: report?.insights,
            columns: report?.columns,
            data: report?.data,
            updated_by: adminUser,
          });
          setReport(prev => prev ? { ...prev, title: modal.title.trim() } : prev);
          await fetchSaved();
          closeModal();
        }
      }
    } catch (err) {
      if (modal) setModalError(err.response?.data?.error || err.message);
      setLoading(false);
    } finally {
      if (modal) setModalBusy(false);
    }
  };

  const handleDeleteSaved = async (saved) => {
    if (!window.confirm(`Delete saved report "${saved.title}"?`)) return;
    try {
      await axios.delete(`/api/admin/saved-reports/${saved.id}`);
      if (activeSavedId === saved.id) startNew();
      await fetchSaved();
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const isSavedLoaded = activeSavedId !== null;

  return (
    <div className="reports-layout">

      {/* ── Left sidebar ─────────────────────────────────────────── */}
      <div className="reports-sidebar">
        <div className="reports-sidebar-header">
          <span className="reports-sidebar-title">{tr.title}</span>
          <button className="btn-primary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={startNew}>
            <Plus size={12} />{tr.newReport}
          </button>
        </div>

        <div className="reports-history-list">
          {/* Saved reports section */}
          <div className="reports-section-label">{tr.saved}</div>
          {savedLoading && <div className="reports-history-empty">…</div>}
          {!savedLoading && savedReports.length === 0 && (
            <div className="reports-history-empty">{tr.emptySaved}</div>
          )}
          {savedReports.map(s => (
            <div key={s.id} className={`reports-saved-item${activeSavedId === s.id ? ' active' : ''}`}>
              <button className="reports-saved-main" onClick={() => loadSaved(s)}>
                <span className="reports-history-query">{s.title}</span>
                <span className="reports-history-title">{s.created_by ? `by ${s.created_by}` : ''}</span>
              </button>
              <div className="reports-saved-actions">
                <button title="Edit" onClick={() => openEditModal(s)}><Pencil size={11} /></button>
                <button title="Delete" onClick={() => handleDeleteSaved(s)}><Trash2 size={11} /></button>
              </div>
            </div>
          ))}

          <div className="reports-sidebar-divider" />

          {/* Session history section */}
          <div className="reports-section-label">{tr.history}</div>
          {history.length === 0 && <div className="reports-history-empty">{tr.emptyHistory}</div>}
          {history.map(entry => (
            <button key={entry.id}
              className={`reports-history-item${!isSavedLoaded && report === entry.report ? ' active' : ''}`}
              onClick={() => loadFromHistory(entry)}>
              <span className="reports-history-query">{entry.query}</span>
              <span className="reports-history-title">{entry.report.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main area ────────────────────────────────────────────── */}
      <div className="reports-main">

        {/* Empty state */}
        {!report && !loading && !error && (
          <div className="reports-empty-state">
            <BarChart2 size={48} color="#cbd5e1" />
            <h3 className="reports-empty-title">{tr.title}</h3>
            <p className="reports-empty-sub">Ask anything about your platform data.</p>
            <div className="reports-samples">
              {tr.samples.map((s, i) => (
                <button key={i} className="reports-sample-btn"
                  onClick={() => { setQuery(s); setTimeout(() => textareaRef.current?.focus(), 50); }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Result area */}
        {(report || loading || error) && (
          <div className="reports-result">
            {error && <div className="form-error" style={{ marginBottom: 16 }}>{tr.errorPrefix}{error}</div>}
            {loading && (
              <div className="reports-loading">
                <RefreshCcw size={18} style={{ animation: 'spin 1s linear infinite' }} />
                <span>{tr.running}</span>
              </div>
            )}
            {report && !loading && (
              <>
                <div className="reports-result-header">
                  <h2 className="reports-result-title">{report.title}</h2>
                  <div className="reports-result-actions">
                    {!isSavedLoaded && report.sql && (
                      <button className="btn-secondary" style={{ fontSize: 12 }} onClick={openSaveModal}>
                        <Check size={13} />{tr.saveReport}
                      </button>
                    )}
                    {isSavedLoaded && (
                      <button className="btn-secondary" style={{ fontSize: 12 }}
                        onClick={() => openEditModal(savedReports.find(s => s.id === activeSavedId) || { id: activeSavedId, title: report.title, query: report.query || '' })}>
                        <Pencil size={13} />{tr.editReport}
                      </button>
                    )}
                    {report.data?.length > 0 && (
                      <button className="btn-secondary" style={{ fontSize: 12 }} onClick={exportCsv}>
                        <Download size={13} />{tr.exportCsv}
                      </button>
                    )}
                    {report.sql && (
                      <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setShowSql(v => !v)}>
                        <Eye size={13} />{showSql ? tr.hideSql : tr.showSql}
                      </button>
                    )}
                  </div>
                </div>
                {report.data && (
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>{tr.rowCount(report.data.length)}</div>
                )}
                {showSql && report.sql && (
                  <div className="reports-sql-block">
                    <div className="reports-sql-label">{tr.sqlLabel}</div>
                    <pre className="reports-sql-pre">{report.sql}</pre>
                  </div>
                )}
                {report.insights && (
                  <div className="reports-insights">
                    <div className="reports-insights-label">{tr.insights}</div>
                    <p className="reports-insights-text">{report.insights}</p>
                  </div>
                )}
                {report.data && report.data.length > 0 && (
                  <>
                    <div className="subtab-row" style={{ marginBottom: 12 }}>
                      {report.chart && (
                        <button className={`subtab-btn${activeTab === 'chart' ? ' active' : ''}`} onClick={() => setActiveTab('chart')}>
                          {tr.chart}
                        </button>
                      )}
                      <button className={`subtab-btn${activeTab === 'table' ? ' active' : ''}`} onClick={() => setActiveTab('table')}>
                        {tr.dataTable}
                      </button>
                    </div>
                    <div className="card" style={{ overflow: 'hidden' }}>
                      {activeTab === 'chart' && report.chart && (
                        <div style={{ padding: '20px 16px' }}>
                          <ReportChart chart={report.chart} data={report.data} />
                        </div>
                      )}
                      {activeTab === 'table' && <ReportDataTable columns={report.columns} data={report.data} />}
                    </div>
                  </>
                )}
                {report.data && report.data.length === 0 && (
                  <div className="card"><div style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>{tr.rowCount(0)}</div></div>
                )}
              </>
            )}
          </div>
        )}

        {/* Query input */}
        <div className="reports-input-area">
          <div className="reports-input-box">
            <textarea
              ref={textareaRef}
              className="reports-textarea"
              placeholder={tr.placeholder}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              disabled={loading}
            />
            <button className="reports-send-btn" onClick={() => runReport()} disabled={!query.trim() || loading}>
              {loading
                ? <RefreshCcw size={16} style={{ animation: 'spin 1s linear infinite' }} />
                : <Send size={16} />}
            </button>
          </div>
          <div className="reports-input-hint">
            {navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to run
          </div>
        </div>
      </div>

      {/* ── Save / Edit modal ─────────────────────────────────────── */}
      {modal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{modal.mode === 'save' ? tr.saveReport : tr.editReport}</span>
              <button onClick={closeModal}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                <div className="form-field">
                  <span className="form-field-label">{tr.reportTitle}</span>
                  <input
                    autoFocus
                    value={modal.title}
                    onChange={e => setModal(m => ({ ...m, title: e.target.value }))}
                    placeholder="e.g. Monthly User Signups"
                  />
                </div>
                {modal.mode === 'edit' && (
                  <div className="form-field">
                    <span className="form-field-label">{tr.reportQuery}</span>
                    <textarea
                      className="form-field-textarea"
                      rows={3}
                      value={modal.query}
                      onChange={e => setModal(m => ({ ...m, query: e.target.value }))}
                      placeholder="Natural language query…"
                    />
                  </div>
                )}
              </div>
              {modalError && <div className="form-error">{modalError}</div>}
              <div className="modal-footer">
                <button className="btn-secondary" onClick={closeModal}>{t.modal.cancel}</button>
                {modal.mode === 'edit' && (
                  <button className="btn-secondary" disabled={modalBusy || loading} onClick={() => handleModalSave(true)}>
                    {tr.rerunSave}
                  </button>
                )}
                <button className="btn-primary" disabled={modalBusy} onClick={() => handleModalSave(false)}>
                  {modalBusy ? t.modal.saving : t.modal.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

function AdminAccountsTab({ accounts, onRefresh }) {
  const { t } = useLang();
  const ta = t.adminAccounts;
  const [modal, setModal] = useState(null); // { type: 'add' } | { type: 'password', account }
  const [form, setForm]   = useState({ username: '', password: '' });
  const [err, setErr]     = useState('');
  const [saving, setSaving] = useState(false);

  const openAdd      = () => { setForm({ username: '', password: '' }); setErr(''); setModal({ type: 'add' }); };
  const openPassword = (account) => { setForm({ password: '' }); setErr(''); setModal({ type: 'password', account }); };
  const close        = () => setModal(null);

  const save = async () => {
    setSaving(true); setErr('');
    try {
      if (modal.type === 'add') {
        await axios.post('/api/admin-accounts', { username: form.username, password: form.password });
      } else {
        await axios.put(`/api/admin-accounts/${modal.account.id}`, { password: form.password });
      }
      close(); onRefresh();
    } catch (e) {
      setErr(e.response?.data?.error || 'Error');
    } finally { setSaving(false); }
  };

  const del = async (account) => {
    if (!window.confirm(ta.confirmDelete)) return;
    try { await axios.delete(`/api/admin-accounts/${account.id}`); onRefresh(); }
    catch (e) { alert(e.response?.data?.error || 'Error'); }
  };

  return (
    <>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{ta.count(accounts.length)}</span>
          <button className="btn-primary" onClick={openAdd}><Plus size={14} />{ta.add}</button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>{ta.usernameLabel}</th>
              <th>{t.table.joined}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 && <tr><td colSpan={3} className="empty-row">No admin accounts</td></tr>}
            {accounts.map(a => (
              <tr key={a.id}>
                <td><strong style={{ color: '#EEF2FF' }}>{a.username}</strong></td>
                <td className="muted">{fmtDate(a.created_at)}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="icon-btn" title={ta.changePassword} onClick={() => openPassword(a)}>
                    <Pencil size={14} />
                  </button>
                  <button className="icon-btn danger" title="Delete" onClick={() => del(a)}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={close}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{modal.type === 'add' ? ta.add : ta.changePassword}</span>
              <button className="icon-btn" onClick={close}><X size={16} /></button>
            </div>
            <div className="modal-body">
              {modal.type === 'add' && (
                <label className="form-field">
                  <span>{ta.usernameLabel}</span>
                  <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} autoFocus />
                </label>
              )}
              {modal.type === 'password' && (
                <label className="form-field">
                  <span>{ta.usernameLabel}</span>
                  <input value={modal.account.username} disabled />
                </label>
              )}
              <label className="form-field">
                <span>{modal.type === 'add' ? ta.passwordLabel : ta.newPassword}</span>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} autoFocus={modal.type === 'password'} />
              </label>
              {err && <p className="form-error">{err}</p>}
              <div className="modal-footer">
                <button className="btn-secondary" onClick={close}>Cancel</button>
                <button className="btn-primary" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : <><Check size={14} />Save</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const SUB_AGES = ['CellularAge', 'MetabolicAge', 'MicroVascularAge', 'ResilienceAge'];

function HealthPlansTab({ dots, healthPlanTemplates, onRefresh }) {
  const { lang } = useContext(LangCtx);
  const isZh = lang === 'zh';
  const [subTab, setSubTab] = useState('templates');
  const [modal, setModal] = useState(null); // null | 'add' | 'edit'
  const [modalTab, setModalTab] = useState('basics');
  const [editingTpl, setEditingTpl] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [userPlans, setUserPlans] = useState([]);
  const [userPlansLoading, setUserPlansLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');

  const loadUserPlans = async () => {
    setUserPlansLoading(true);
    try {
      const res = await axios.get('/api/health-plans?all=true');
      setUserPlans(res.data.plans || []);
    } catch (e) { console.error(e); }
    finally { setUserPlansLoading(false); }
  };

  useEffect(() => { if (subTab === 'users' && userPlans.length === 0) loadUserPlans(); }, [subTab]);

  const parseJsonArr = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };

  const openAdd = () => {
    setForm({ key_name: '', name_zh: '', name_en: '', desc_zh: '', desc_en: '', goal_zh: '', goal_en: '', duration_weeks: 4, sort_order: 0, target_sub_ages: [], recommended_dot_ids: [], milestones: [], reminders: [], is_active: true });
    setEditingTpl(null);
    setModalTab('basics');
    setModal('add');
  };

  const openEdit = (tpl) => {
    setForm({
      ...tpl,
      target_sub_ages: tpl.target_sub_ages || [],
      recommended_dot_ids: tpl.recommended_dot_ids || [],
      milestones: parseJsonArr(tpl.milestones),
      reminders: parseJsonArr(tpl.reminders),
    });
    setEditingTpl(tpl);
    setModalTab('basics');
    setModal('edit');
  };

  const addReminder = () => setForm(f => ({ ...f, reminders: [...(f.reminders || []), { time: '08:00', label_zh: '', label_en: '', message_zh: '', message_en: '' }] }));
  const removeReminder = (idx) => setForm(f => ({ ...f, reminders: f.reminders.filter((_, i) => i !== idx) }));
  const updateReminder = (idx, field, value) => setForm(f => { const u = [...(f.reminders || [])]; u[idx] = { ...u[idx], [field]: value }; return { ...f, reminders: u }; });

  const addMilestone = () => setForm(f => ({ ...f, milestones: [...(f.milestones || []), { week: 1, label_zh: '', label_en: '' }] }));
  const removeMilestone = (idx) => setForm(f => ({ ...f, milestones: f.milestones.filter((_, i) => i !== idx) }));
  const updateMilestone = (idx, field, value) => setForm(f => { const u = [...(f.milestones || [])]; u[idx] = { ...u[idx], [field]: value }; return { ...f, milestones: u }; });

  const toggleSubAge = (key) => {
    setForm(f => ({ ...f, target_sub_ages: f.target_sub_ages.includes(key) ? f.target_sub_ages.filter(s => s !== key) : [...f.target_sub_ages, key] }));
  };

  const toggleDot = (id) => {
    setForm(f => ({ ...f, recommended_dot_ids: f.recommended_dot_ids.includes(id) ? f.recommended_dot_ids.filter(d => d !== id) : [...f.recommended_dot_ids, id] }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form, milestones: form.milestones || [], reminders: form.reminders || [] };
      if (modal === 'add') await axios.post('/api/health-plan-templates', payload);
      else await axios.put(`/api/health-plan-templates/${editingTpl.id}`, payload);
      setModal(null);
      onRefresh();
    } catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  };

  const deleteTpl = async (tpl) => {
    if (!window.confirm(isZh ? `确认删除「${tpl.name_zh}」？此操作不可撤销。` : `Delete "${tpl.name_en}"? This cannot be undone.`)) return;
    try {
      await axios.delete(`/api/health-plan-templates/${tpl.id}`);
      onRefresh();
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };

  const filteredUserPlans = userPlans.filter(p => p.status === statusFilter);

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['templates', 'users'].map(s => (
          <button key={s} className={`subtab-btn${subTab === s ? ' active' : ''}`} onClick={() => setSubTab(s)}>
            {s === 'templates' ? (isZh ? '方案模板' : 'Templates') : (isZh ? '用户方案' : 'User Plans')}
          </button>
        ))}
      </div>

      {subTab === 'templates' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{healthPlanTemplates.length} {isZh ? '个模板' : 'templates'}</span>
            <button className="btn-primary" onClick={openAdd}>
              <Plus size={14} /> {isZh ? '添加模板' : 'Add Template'}
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{isZh ? '标识' : 'Key'}</th>
                <th>{isZh ? '名称' : 'Name'}</th>
                <th>{isZh ? '周期' : 'Duration'}</th>
                <th>{isZh ? '目标维度' : 'Target Sub-Ages'}</th>
                <th>{isZh ? '排序' : 'Order'}</th>
                <th>{isZh ? '状态' : 'Status'}</th>
                <th>{isZh ? '在用' : 'Enrolled'}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {healthPlanTemplates.length === 0 && <tr><td colSpan={8} className="empty-row">{isZh ? '暂无模板' : 'No templates yet'}</td></tr>}
              {healthPlanTemplates.map(tpl => (
                <tr key={tpl.id}>
                  <td><code className="code-tag">{tpl.key_name}</code></td>
                  <td>
                    <div className="bold">{isZh ? tpl.name_zh : tpl.name_en}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{isZh ? tpl.name_en : tpl.name_zh}</div>
                  </td>
                  <td>{tpl.duration_weeks}w</td>
                  <td className="muted" style={{ fontSize: 11 }}>{(tpl.target_sub_ages || []).map(s => s.replace('Age', '')).join(', ')}</td>
                  <td className="muted">{tpl.sort_order}</td>
                  <td>
                    <Badge color={tpl.is_active ? '#10b981' : '#94a3b8'}>
                      {tpl.is_active ? (isZh ? '启用' : 'Active') : (isZh ? '停用' : 'Inactive')}
                    </Badge>
                  </td>
                  <td>{tpl.active_enrollments || 0}</td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" onClick={() => openEdit(tpl)}><Pencil size={13} /></button>
                      <button className="icon-btn danger" onClick={() => deleteTpl(tpl)}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'users' && (
        <div className="card">
          <div className="table-toolbar">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['active', 'completed', 'abandoned', 'paused'].map(s => (
                <button key={s} className={`subtab-btn${statusFilter === s ? ' active' : ''}`} style={{ fontSize: 11 }} onClick={() => setStatusFilter(s)}>
                  {s}
                </button>
              ))}
            </div>
            <button className="icon-btn" onClick={loadUserPlans}><RefreshCcw size={13} /></button>
          </div>
          {userPlansLoading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>{isZh ? '加载中…' : 'Loading…'}</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{isZh ? '用户' : 'User'}</th>
                  <th>{isZh ? '方案' : 'Plan'}</th>
                  <th>{isZh ? '类型' : 'Type'}</th>
                  <th>{isZh ? '来源' : 'Source'}</th>
                  <th>{isZh ? '打卡数' : 'Check-ins'}</th>
                  <th>{isZh ? '进度' : 'Progress'}</th>
                  <th>{isZh ? '开始日期' : 'Start Date'}</th>
                </tr>
              </thead>
              <tbody>
                {filteredUserPlans.length === 0 && <tr><td colSpan={7} className="empty-row">{isZh ? '暂无数据' : 'No data'}</td></tr>}
                {filteredUserPlans.map(p => {
                  const weeksElapsed = Math.max(0, Math.floor((Date.now() - new Date(p.start_date).getTime()) / (7 * 86400000)));
                  const totalWeeks = p.duration_weeks || p.template_duration_weeks || 4;
                  return (
                    <tr key={p.id}>
                      <td className="bold">{p.user_nickname || p.user_id}</td>
                      <td>{isZh ? (p.name_zh || p.custom_name_zh) : (p.name_en || p.custom_name_en)}</td>
                      <td><Badge color={p.plan_type === 'primary' ? '#6375EC' : '#10b981'}>{p.plan_type}</Badge></td>
                      <td className="muted" style={{ fontSize: 11 }}>{p.source}</td>
                      <td>{p.checkin_count || 0}</td>
                      <td className="muted" style={{ fontSize: 11 }}>{weeksElapsed}/{totalWeeks}w</td>
                      <td className="muted" style={{ fontSize: 11 }}>{p.start_date}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal modal-tabbed" style={{ width: 700 }} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="modal-header">
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {modal === 'add' ? (isZh ? '添加方案模板' : 'Add Plan Template') : (isZh ? '编辑方案模板' : 'Edit Plan Template')}
                </div>
                {modal === 'edit' && editingTpl && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}><code>{editingTpl.key_name}</code></div>
                )}
              </div>
              <button className="icon-btn" onClick={() => setModal(null)}><X size={16} /></button>
            </div>

            {/* Tab nav */}
            <div className="modal-nav">
              {[
                { key: 'basics',   zh: '基本信息', en: 'Basics'   },
                { key: 'content',  zh: '描述内容', en: 'Content'  },
                { key: 'targets',  zh: '目标配置', en: 'Targets'  },
                { key: 'schedule', zh: '日程提醒', en: 'Schedule' },
              ].map(t => (
                <button key={t.key} className={`modal-nav-tab${modalTab === t.key ? ' active' : ''}`} onClick={() => setModalTab(t.key)}>
                  {isZh ? t.zh : t.en}
                </button>
              ))}
            </div>

            {/* Tab body */}
            <div className="modal-body">

              {/* ── Basics ── */}
              {modalTab === 'basics' && (
                <>
                  <div className="form-section">
                    <div className="form-section-title">{isZh ? '标识与周期' : 'Identity & Duration'}</div>
                    <div className="form-row-3">
                      <label className="form-field">
                        <span>{isZh ? '标识符' : 'Key Name'}</span>
                        <input value={form.key_name || ''} onChange={e => setForm(f => ({ ...f, key_name: e.target.value }))} placeholder="e.g. weight_loss" disabled={modal === 'edit'} />
                      </label>
                      <label className="form-field">
                        <span>{isZh ? '周期（周）' : 'Weeks'}</span>
                        <input type="number" min={1} value={form.duration_weeks || 4} onChange={e => setForm(f => ({ ...f, duration_weeks: parseInt(e.target.value) || 4 }))} />
                      </label>
                      <label className="form-field">
                        <span>{isZh ? '排序' : 'Order'}</span>
                        <input type="number" value={form.sort_order ?? 0} onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))} />
                      </label>
                    </div>
                  </div>

                  <div className="form-section">
                    <div className="form-section-title">{isZh ? '名称' : 'Name'}</div>
                    <div className="form-row-2">
                      <label className="form-field">
                        <span>{isZh ? '中文' : 'Chinese'}</span>
                        <input value={form.name_zh || ''} onChange={e => setForm(f => ({ ...f, name_zh: e.target.value }))} placeholder={isZh ? '代谢减重' : 'e.g. 代谢减重'} />
                      </label>
                      <label className="form-field">
                        <span>{isZh ? '英文' : 'English'}</span>
                        <input value={form.name_en || ''} onChange={e => setForm(f => ({ ...f, name_en: e.target.value }))} placeholder="e.g. Metabolic Weight Loss" />
                      </label>
                    </div>
                  </div>

                  <div className="form-section">
                    <div className="form-section-title">{isZh ? '方案目标（简短一句话）' : 'Goal (one-liner)'}</div>
                    <div className="form-row-2">
                      <label className="form-field">
                        <span>{isZh ? '中文' : 'Chinese'}</span>
                        <input value={form.goal_zh || ''} onChange={e => setForm(f => ({ ...f, goal_zh: e.target.value }))} placeholder={isZh ? '降低代谢年龄，改善体脂比例' : ''} />
                      </label>
                      <label className="form-field">
                        <span>{isZh ? '英文' : 'English'}</span>
                        <input value={form.goal_en || ''} onChange={e => setForm(f => ({ ...f, goal_en: e.target.value }))} placeholder="Reduce metabolic age and improve body composition" />
                      </label>
                    </div>
                  </div>

                  <div className="form-section">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={form.is_active !== false} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                      {isZh ? '启用此模板（用户可见）' : 'Template is active (visible to users)'}
                    </label>
                  </div>
                </>
              )}

              {/* ── Content ── */}
              {modalTab === 'content' && (
                <>
                  <div className="form-section">
                    <div className="form-section-title">{isZh ? '详细描述' : 'Description'}</div>
                    <div className="form-row-2">
                      <label className="form-field">
                        <span>{isZh ? '中文' : 'Chinese'}</span>
                        <textarea className="form-field-textarea" rows={12} value={form.desc_zh || ''} onChange={e => setForm(f => ({ ...f, desc_zh: e.target.value }))} placeholder={isZh ? '介绍方案的背景、适用人群和预期效果…' : ''} />
                      </label>
                      <label className="form-field">
                        <span>{isZh ? '英文' : 'English'}</span>
                        <textarea className="form-field-textarea" rows={12} value={form.desc_en || ''} onChange={e => setForm(f => ({ ...f, desc_en: e.target.value }))} placeholder="Describe the plan background, target audience, and expected outcomes…" />
                      </label>
                    </div>
                  </div>
                </>
              )}

              {/* ── Targets ── */}
              {modalTab === 'targets' && (
                <>
                  <div className="form-section">
                    <div className="form-section-title">{isZh ? '目标生理年龄维度' : 'Target Bio-Age Dimensions'}</div>
                    <p className="form-section-hint" style={{ marginBottom: 10 }}>
                      {isZh ? '选择此方案主要改善的维度，将显示在方案卡片和用户详情中。' : 'Select which sub-age dimensions this plan targets. Shown on the plan card and user detail.'}
                    </p>
                    <div className="chips-grid">
                      {SUB_AGES.map(s => (
                        <button key={s} type="button"
                          className={`subtab-btn${(form.target_sub_ages || []).includes(s) ? ' active' : ''}`}
                          onClick={() => toggleSubAge(s)}>
                          {s.replace('Age', '')}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="form-section">
                    <div className="form-section-title">{isZh ? '推荐原粒' : 'Recommended Dots'}</div>
                    <p className="form-section-hint" style={{ marginBottom: 10 }}>
                      {isZh ? '选择方案期间推荐使用的原粒，将显示在用户方案指导页。' : 'Select dots recommended during this plan. Shown in the guidance tab.'}
                    </p>
                    <div className="chips-grid">
                      {dots.map(d => (
                        <button key={d.id} type="button"
                          className={`subtab-btn${(form.recommended_dot_ids || []).includes(d.id) ? ' active' : ''}`}
                          onClick={() => toggleDot(d.id)}
                          style={{ fontSize: 11 }}>
                          {d.key_name} · {isZh && d.name_zh ? d.name_zh : d.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* ── Schedule ── */}
              {modalTab === 'schedule' && (
                <>
                  <div className="form-section">
                    <div className="form-section-header">
                      <div>
                        <div className="form-section-title">{isZh ? '里程碑' : 'Milestones'}</div>
                        <p className="form-section-hint">{isZh ? '在特定周数提示用户做 Kino 检测或回顾进展' : 'Prompt users to do a Kino scan or review progress at specific weeks'}</p>
                      </div>
                      <button type="button" className="btn-secondary btn-sm" onClick={addMilestone}>
                        + {isZh ? '添加里程碑' : 'Add Milestone'}
                      </button>
                    </div>
                    {(form.milestones || []).length === 0 && (
                      <p className="form-empty-hint">{isZh ? '暂无里程碑' : 'No milestones yet.'}</p>
                    )}
                    {(form.milestones || []).map((m, idx) => (
                      <div key={idx} className="schedule-item">
                        <div className="schedule-item-row">
                          <span className="si-label">{isZh ? '第' : 'Wk'}</span>
                          <input type="number" min={1} value={m.week ?? 1}
                            onChange={e => updateMilestone(idx, 'week', parseInt(e.target.value) || 1)}
                            className="si-input si-week" />
                          <input type="text" placeholder={isZh ? '标签（中文）' : 'Label (Chinese)'}
                            value={m.label_zh || ''} onChange={e => updateMilestone(idx, 'label_zh', e.target.value)}
                            className="si-input" />
                          <input type="text" placeholder={isZh ? '标签（英文）' : 'Label (English)'}
                            value={m.label_en || ''} onChange={e => updateMilestone(idx, 'label_en', e.target.value)}
                            className="si-input" />
                          <button type="button" className="schedule-item-del" onClick={() => removeMilestone(idx)}>×</button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="form-section">
                    <div className="form-section-header">
                      <div>
                        <div className="form-section-title">{isZh ? '每日提醒' : 'Daily Reminders'}</div>
                        <p className="form-section-hint">{isZh ? '加入方案时自动为用户创建每日定时提醒' : 'Auto-created for users when they join this plan'}</p>
                      </div>
                      <button type="button" className="btn-secondary btn-sm" onClick={addReminder}>
                        + {isZh ? '添加提醒' : 'Add Reminder'}
                      </button>
                    </div>
                    {(form.reminders || []).length === 0 && (
                      <p className="form-empty-hint">{isZh ? '暂无提醒' : 'No reminders configured.'}</p>
                    )}
                    {(form.reminders || []).map((r, idx) => (
                      <div key={idx} className="schedule-item">
                        <div className="schedule-item-row">
                          <span className="si-label">{isZh ? '时间' : 'Time'}</span>
                          <input type="time" value={r.time || '08:00'}
                            onChange={e => updateReminder(idx, 'time', e.target.value)}
                            className="si-input si-time" />
                          <input type="text" placeholder={isZh ? '标签（中文）' : 'Label (Chinese)'}
                            value={r.label_zh || ''} onChange={e => updateReminder(idx, 'label_zh', e.target.value)}
                            className="si-input" />
                          <input type="text" placeholder={isZh ? '标签（英文）' : 'Label (English)'}
                            value={r.label_en || ''} onChange={e => updateReminder(idx, 'label_en', e.target.value)}
                            className="si-input" />
                          <button type="button" className="schedule-item-del" onClick={() => removeReminder(idx)}>×</button>
                        </div>
                        <div className="schedule-item-row">
                          <span className="si-label" style={{ width: 28, textAlign: 'right' }}>{isZh ? '内容' : 'Msg'}</span>
                          <input type="text" placeholder={isZh ? '提醒内容（中文）' : 'Message (Chinese)'}
                            value={r.message_zh || ''} onChange={e => updateReminder(idx, 'message_zh', e.target.value)}
                            className="si-input" />
                          <input type="text" placeholder={isZh ? '提醒内容（英文）' : 'Message (English)'}
                            value={r.message_en || ''} onChange={e => updateReminder(idx, 'message_en', e.target.value)}
                            className="si-input" />
                          <button type="button" className="schedule-item-del" style={{ visibility: 'hidden' }} tabIndex={-1}>×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

            </div>

            {/* Footer */}
            <div className="modal-footer-bar">
              <button className="btn-secondary" onClick={() => setModal(null)}>{isZh ? '取消' : 'Cancel'}</button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? (isZh ? '保存中…' : 'Saving…') : (isZh ? '保存' : 'Save')}
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  );
}

function AdminPanel({ onLogout }) {
  const [lang, setLang] = useState('en');
  const t = T[lang];
  const toggleLang = () => setLang(l => l === 'en' ? 'zh' : 'en');

  const [tab, setTab] = useState('users');
  const [data, setData] = useState({ users: [], dots: [], coaches: [], storeItems: [], orders: [], channels: [], invitations: [], kinoDevices: [], chipBatches: [], chipModels: [], tickets: [], adminAccounts: [] });
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const ok = (res) => res.status === 'fulfilled' ? res.value.data : {};
    try {
      const [uRes, dRes, pRes, sRes, oRes, chRes, invRes, kinoRes, cbRes, cmRes, tkRes, aaRes, hptRes] = await Promise.allSettled([
        axios.get('/api/users'),
        axios.get('/api/dots-inventory'),
        axios.get('/api/coach-list'),
        axios.get('/api/store-items?all=true'),
        axios.get('/api/orders'),
        axios.get('/api/channels'),
        axios.get('/api/invitations'),
        axios.get('/api/kino-devices'),
        axios.get('/api/kino-chip-batches'),
        axios.get('/api/kino-chip-models'),
        axios.get('/api/tickets'),
        axios.get('/api/admin-accounts'),
        axios.get('/api/health-plan-templates?all=true'),
      ]);
      setData({
        users:               ok(uRes).users              || [],
        dots:                ok(dRes).dots               || [],
        coaches:             ok(pRes).coaches            || [],
        storeItems:          ok(sRes).items              || [],
        orders:              ok(oRes).orders             || [],
        channels:            ok(chRes).channels          || [],
        invitations:         ok(invRes).invitations      || [],
        kinoDevices:         ok(kinoRes).devices         || [],
        chipBatches:         ok(cbRes).batches           || [],
        chipModels:          ok(cmRes).models            || [],
        tickets:             ok(tkRes).tickets           || [],
        adminAccounts:       ok(aaRes).accounts          || [],
        healthPlanTemplates: ok(hptRes).templates        || [],
      });
      setLastRefresh(new Date());
    } catch (err) { console.error('Admin fetch error:', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const NAV = [
    { id: 'users',    label: t.nav.users,    icon: Users       },
    { id: 'coaches',  label: t.nav.coaches,  icon: UserCog     },
    { id: 'dots',     label: t.nav.dots,     icon: Droplets    },
    { id: 'store',    label: t.nav.store,    icon: ShoppingBag },
    { id: 'channels', label: t.nav.channels, icon: Building2   },
    { id: 'kino',     label: t.nav.kino,     icon: Cpu         },
    { id: 'chips',    label: t.nav.chips,    icon: Layers      },
    { id: 'invites',  label: t.nav.invites,  icon: Tag         },
    { id: 'rewards',  label: t.nav.rewards,  icon: Coins          },
    { id: 'academy',  label: t.nav.academy,  icon: GraduationCap  },
    { id: 'questionnaires', label: t.nav.questionnaires, icon: ClipboardList },
    { id: 'health-plans',   label: t.nav.healthPlans,    icon: Activity      },
    { id: 'reports',        label: t.nav.reports,        icon: BarChart2     },
    { id: 'tickets',  label: t.nav.tickets,  icon: Bug            },
    { id: 'sims',     label: t.nav.sims,     icon: Layout,      disabled: true },
    { id: 'admin-accounts', label: t.nav.adminAccounts, icon: Settings2 },
  ];

  return (
    <LangCtx.Provider value={{ lang, t, toggleLang }}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={wavenLogo} alt="Waven" className="brand-logo" />
          {t.brand}
        </div>
        <nav className="sidebar-nav">
          {NAV.map(({ id, label, icon: Icon, disabled }) => (
            <button key={id}
              className={`nav-item${tab === id ? ' active' : ''}${disabled ? ' disabled' : ''}`}
              onClick={() => !disabled && setTab(id)}
              style={disabled ? { opacity: 0.35, cursor: 'not-allowed' } : undefined}
              title={disabled ? 'Coming soon' : undefined}
            >
              <Icon size={15} />{label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="lang-toggle" onClick={toggleLang}>
            <Globe size={13} />{lang === 'en' ? '中文' : 'English'}
          </button>
          <button className="lang-toggle" onClick={onLogout} style={{ color: '#f87171' }}>
            Sign Out
          </button>
          {lastRefresh && <span>{t.updated} {lastRefresh.toLocaleTimeString()}</span>}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">{NAV.find(n => n.id === tab)?.label}</div>
          <button className="refresh-btn" onClick={fetchData} disabled={loading}>
            <RefreshCcw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            {loading ? t.topbar.loading : t.topbar.refresh}
          </button>
        </header>
        <div className="content">
          {tab === 'users'    && <UsersTab    users={data.users} coaches={data.coaches} channels={data.channels} onRefresh={fetchData} />}
          {tab === 'coaches'  && <CoachTab    coaches={data.coaches} users={data.users} channels={data.channels} onRefresh={fetchData} />}
          {tab === 'dots'     && <DotsTab     dots={data.dots} onRefresh={fetchData} />}
          {tab === 'store'    && <StoreTab    storeItems={data.storeItems} orders={data.orders} onRefresh={fetchData} />}
          {tab === 'channels' && <ChannelTab  channels={data.channels} onRefresh={fetchData} />}
          {tab === 'kino'     && <KinoTab      devices={data.kinoDevices} coaches={data.coaches} channels={data.channels} onRefresh={fetchData} />}
          {tab === 'chips'    && <ChipsTab    batches={data.chipBatches} models={data.chipModels} onRefresh={fetchData} />}
          {tab === 'invites'  && <InvitesTab  invitations={data.invitations} channels={data.channels} onRefresh={fetchData} />}
          {tab === 'rewards'  && <RewardsTab />}
          {tab === 'academy'  && <AcademyTab />}
          {tab === 'questionnaires' && <QuestionnairesTab channels={data.channels} users={data.users} coaches={data.coaches} />}
          {tab === 'health-plans'   && <HealthPlansTab dots={data.dots} healthPlanTemplates={data.healthPlanTemplates || []} onRefresh={fetchData} />}
          {tab === 'reports'        && <ReportsTab />}
          {tab === 'tickets'  && <TicketsTab tickets={data.tickets} onRefresh={fetchData} />}
          {tab === 'sims'     && <SimulatorsTab />}
          {tab === 'admin-accounts' && <AdminAccountsTab accounts={data.adminAccounts} onRefresh={fetchData} />}
        </div>
      </div>
    </LangCtx.Provider>
  );
}

export default function App() {
  const [session, setSession] = useState(() => sessionStorage.getItem('nano_admin_token'));
  if (!session) return <LoginScreen onLogin={(token) => setSession(token)} />;
  return <AdminPanel onLogout={() => { sessionStorage.removeItem('nano_admin_token'); setSession(null); }} />;
}
