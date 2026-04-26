import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import axios from 'axios';
import wavenLogo from '../../shared/assets/waven-logo-icon.png';
import {
  Users, Droplets, UserCog, RefreshCcw,
  ChevronDown, Activity, Calendar, Plus, Pencil, Trash2, X, Check, Globe, Layout,
  ShoppingBag, Package, Building2, Tag, Copy,
} from 'lucide-react';

axios.interceptors.request.use((config) => {
  const token = import.meta.env.VITE_API_TOKEN
  if (token) config.headers['Authorization'] = `Bearer ${token}`
  return config
})

// ── i18n ──────────────────────────────────────────────────────────────────────

const T = {
  en: {
    brand: 'Nano Admin',
    nav: { users: 'Users', coaches: 'Coaches', dots: 'Dots', store: 'Store', sims: 'Simulators', channels: 'Channels', invites: 'Invites' },
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
    },
    table: {
      id: 'ID', nickname: 'Nickname', gender: 'Gender', birthDate: 'Birth Date',
      language: 'Language', bioAge: 'Bio Age', chronoAge: 'Chrono Age',
      assignedCoach: 'Assigned Coach', joined: 'Joined',
      name: 'Name', email: 'Email', phone: 'Phone', customers: 'Users',
      key: 'Key', nameEn: 'Name (EN)', nameZh: 'Name (ZH)', color: 'Color',
      type: 'Type', description: 'Description',
      unassigned: 'Unassigned', channel: 'Channel', roles: 'Roles', linkedUser: 'Linked User',
      timing: 'Timing', group: 'Group', subAge: 'Sub-Age',
      code: 'Code', maxUses: 'Max Uses', useCount: 'Uses', creator: 'Creator',
    },
    empty: { users: 'No users found', coaches: 'No Coaches found', dots: 'No dots found', store: 'No items', orders: 'No orders', channels: 'No channels found', invites: 'No invitations found' },
    count: (n) => `${n} users`,
    addUser: 'Add User',
    addCoach: 'Add Coach', addDot: 'Add Dot', addItem: 'Add Item', addChannel: 'Add Channel', addInvite: 'Create Invite',
    countCoach: (n) => `${n} Coaches`,
    countDot: (n) => `${n} dots`,
    countItem: (n) => `${n} items`,
    countOrder: (n) => `${n} orders`,
    countChannel: (n) => `${n} channels`,
    countInvite: (n) => `${n} invites`,
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
    },
    dotType: { isolate: 'Isolate', blend: 'Blend' },
    store: {
      itemsTab: 'Items', ordersTab: 'Orders',
      priceCny: 'CNY (¥)', priceUsd: 'USD ($)', tag: 'Tag', active: 'Active',
      qty: 'Qty', status: 'Status', orderedAt: 'Ordered', yes: 'Yes', no: 'No',
      pending: 'Pending', confirmed: 'Confirmed', shipped: 'Shipped',
      delivered: 'Delivered', cancelled: 'Cancelled',
    },
    invites: { active: 'Active', deactivated: 'Deactivated', unlimited: 'Unlimited' },
  },
  zh: {
    brand: 'Nano 管理后台',
    nav: { users: '用户管理', coaches: 'Coach', dots: '原粒', store: '商城管理', sims: '模拟器', channels: '渠道管理', invites: '邀请码' },
    topbar: { refresh: '刷新', loading: '加载中…' },
    updated: '更新于',
    stats: {
      totalUsers: '总用户数', tested: '已检测', avgBioAge: '平均生物年龄',
      coaches: 'Coach 数', totalCoaches: 'Coach 总数',
      assignedUsers: '已分配用户', unassignedUsers: '未分配用户',
      totalDots: '原粒总数', isolates: '单体', blends: '复合',
      totalItems: '商品总数', activeItems: '上架中', totalOrders: '订单总数', pendingOrders: '待处理',
      totalChannels: '渠道数',
      totalInvites: '邀请码总数', activeInvites: '有效', usedInvites: '已使用',
    },
    table: {
      id: 'ID', nickname: '昵称', gender: '性别', birthDate: '出生日期',
      language: '语言', bioAge: '生物年龄', chronoAge: '实际年龄',
      assignedCoach: '负责 Coach', joined: '注册时间',
      name: '姓名', email: '邮箱', phone: '电话', customers: '用户数',
      key: '标识', nameEn: '名称 (英)', nameZh: '名称 (中)', color: '颜色',
      type: '类型', description: '描述',
      unassigned: '未分配', channel: '渠道', roles: '角色', linkedUser: '关联用户',
      timing: '服用时间', group: '功能分组', subAge: '目标年龄',
      code: '邀请码', maxUses: '上限', useCount: '已用', creator: '创建者',
    },
    empty: { users: '暂无用户', coaches: '暂无 Coach', dots: '暂无原粒', store: '暂无商品', orders: '暂无订单', channels: '暂无渠道', invites: '暂无邀请码' },
    count: (n) => `共 ${n} 位用户`,
    addUser: '添加用户',
    addCoach: '添加 Coach', addDot: '添加原粒', addItem: '添加商品', addChannel: '添加渠道', addInvite: '创建邀请码',
    countCoach: (n) => `共 ${n} 位 Coach`,
    countDot: (n) => `共 ${n} 个原粒`,
    countItem: (n) => `共 ${n} 件商品`,
    countOrder: (n) => `共 ${n} 笔订单`,
    countChannel: (n) => `共 ${n} 个渠道`,
    countInvite: (n) => `共 ${n} 个邀请码`,
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
    },
    dotType: { isolate: '单体', blend: '复合' },
    store: {
      itemsTab: '商品', ordersTab: '订单',
      priceCny: '售价 (CNY)', priceUsd: '售价 (USD)', tag: '标签', active: '上架',
      qty: '数量', status: '状态', orderedAt: '下单时间', yes: '是', no: '否',
      pending: '待处理', confirmed: '已确认', shipped: '已发货',
      delivered: '已送达', cancelled: '已取消',
    },
    invites: { active: '有效', deactivated: '已停用', unlimited: '不限' },
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
  timing: 'Morning', ingredients_summary: '', description: '', is_isolate: false,
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
            <div className="avatar" style={{ width: 32, height: 32, fontSize: 14, background: '#3b82f620', color: '#3b82f6' }}>
              {(user.nickname || 'U')[0].toUpperCase()}
            </div>
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
                    <div className="avatar" style={{ background: '#3b82f620', color: '#3b82f6' }}>
                      {(u.nickname || 'U')[0].toUpperCase()}
                    </div>
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
              <th>{t.table.timing}</th><th>{t.table.group}</th><th>{t.table.subAge}</th>
              <th>{t.table.color}</th><th>{t.table.type}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {dots.length === 0 && <tr><td colSpan={9} className="empty-row">{t.empty.dots}</td></tr>}
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
  tag: '', sort_order: 0, active: true,
};

function StoreItemModal({ item, onClose, onSave }) {
  const { t } = useLang();
  const isEdit = !!item?.id;
  const [form, setForm] = useState(isEdit
    ? { key_name: item.key_name, name_en: item.name_en || '', name_zh: item.name_zh || '',
        desc_en: item.desc_en || '', desc_zh: item.desc_zh || '',
        unit_en: item.unit_en || '', unit_zh: item.unit_zh || '',
        price_cny: item.price_cny ?? '', price_usd: item.price_usd ?? '',
        tag: item.tag || '', sort_order: item.sort_order ?? 0, active: item.active !== false }
    : { ...EMPTY_ITEM });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

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
              {storeItems.length === 0 && <tr><td colSpan={8} className="empty-row">{t.empty.store}</td></tr>}
              {storeItems.map(item => (
                <tr key={item.id}>
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

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [lang, setLang] = useState('en');
  const t = T[lang];
  const toggleLang = () => setLang(l => l === 'en' ? 'zh' : 'en');

  const [tab, setTab] = useState('users');
  const [data, setData] = useState({ users: [], dots: [], coaches: [], storeItems: [], orders: [], channels: [], invitations: [] });
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, dRes, pRes, sRes, oRes, chRes, invRes] = await Promise.all([
        axios.get('/api/users'),
        axios.get('/api/dots-inventory'),
        axios.get('/api/coach-list'),
        axios.get('/api/store-items?all=true'),
        axios.get('/api/orders'),
        axios.get('/api/channels'),
        axios.get('/api/invitations'),
      ]);
      setData({
        users: uRes.data.users || [],
        dots: dRes.data.dots || [],
        coaches: pRes.data.coaches || [],
        storeItems: sRes.data.items || [],
        orders: oRes.data.orders || [],
        channels: chRes.data.channels || [],
        invitations: invRes.data.invitations || [],
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
    { id: 'invites',  label: t.nav.invites,  icon: Tag         },
    { id: 'sims',     label: t.nav.sims,     icon: Layout      },
  ];

  return (
    <LangCtx.Provider value={{ lang, t, toggleLang }}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={wavenLogo} alt="Waven" className="brand-logo" />
          {t.brand}
        </div>
        <nav className="sidebar-nav">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
              <Icon size={15} />{label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="lang-toggle" onClick={toggleLang}>
            <Globe size={13} />{lang === 'en' ? '中文' : 'English'}
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
          {tab === 'invites'  && <InvitesTab  invitations={data.invitations} channels={data.channels} onRefresh={fetchData} />}
          {tab === 'sims'     && <SimulatorsTab />}
        </div>
      </div>
    </LangCtx.Provider>
  );
}
