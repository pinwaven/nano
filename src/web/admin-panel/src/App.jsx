import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import axios from 'axios';
import wavenLogo from '../../shared/assets/waven-logo-icon.png';
import {
  Users, Droplets, UserCog, RefreshCcw,
  ChevronDown, Activity, Calendar, Plus, Pencil, Trash2, X, Check, Globe, Layout,
  ShoppingBag, Package,
} from 'lucide-react';

// ── i18n ──────────────────────────────────────────────────────────────────────

const T = {
  en: {
    brand: 'Nano Admin',
    nav: { users: 'Users', coaches: 'Coaches', dots: 'Precision Dots', store: 'Store', sims: 'Simulators' },
    topbar: { refresh: 'Refresh', loading: 'Loading…' },
    updated: 'Updated',
    stats: {
      totalUsers: 'Total Users', tested: 'Tested', avgBioAge: 'Avg Bio Age',
      coaches: 'Coaches', totalCoaches: 'Total Coaches',
      assignedUsers: 'Assigned Users', unassignedUsers: 'Unassigned Users',
      totalDots: 'Total Dots', isolates: 'Isolates', blends: 'Blends',
      totalItems: 'Items', activeItems: 'Active', totalOrders: 'Orders', pendingOrders: 'Pending',
    },
    table: {
      id: 'ID', nickname: 'Nickname', gender: 'Gender', birthDate: 'Birth Date',
      language: 'Language', bioAge: 'Bio Age', chronoAge: 'Chrono Age',
      assignedCoach: 'Assigned Coach', joined: 'Joined',
      name: 'Name', email: 'Email', phone: 'Phone', customers: 'Users',
      key: 'Key', nameEn: 'Name (EN)', nameZh: 'Name (ZH)', color: 'Color',
      type: 'Type', description: 'Description',
      unassigned: 'Unassigned',
    },
    empty: { users: 'No users found', coaches: 'No Coaches found', dots: 'No dots found', store: 'No items', orders: 'No orders' },
    count: (n) => `${n} users`,
    addUser: 'Add User',
    addCoach: 'Add Coach', addDot: 'Add Dot', addItem: 'Add Item',
    countCoach: (n) => `${n} Coaches`,
    countDot: (n) => `${n} dots`,
    countItem: (n) => `${n} items`,
    countOrder: (n) => `${n} orders`,
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
      colorZh: 'Color (ZH)', description: 'Description',
      isIsolate: 'Type', isolate: 'Isolate', blend: 'Blend',
      cancel: 'Cancel', save: 'Save', saving: 'Saving…',
      delete: 'Delete', deleting: 'Deleting…',
      deleteWarning: (name) => `Delete ${name}? This will also remove all their biomarkers, scans, and notifications.`,
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
    },
    dotType: { isolate: 'Isolate', blend: 'Blend' },
    store: {
      itemsTab: 'Items', ordersTab: 'Orders',
      priceCny: 'CNY (¥)', priceUsd: 'USD ($)', tag: 'Tag', active: 'Active',
      qty: 'Qty', status: 'Status', orderedAt: 'Ordered', yes: 'Yes', no: 'No',
      pending: 'Pending', confirmed: 'Confirmed', shipped: 'Shipped',
      delivered: 'Delivered', cancelled: 'Cancelled',
    },
  },
  zh: {
    brand: 'Nano 管理后台',
    nav: { users: '用户管理', coaches: 'Coach', dots: '精准营养点', store: '商城管理', sims: '模拟器' },
    topbar: { refresh: '刷新', loading: '加载中…' },
    updated: '更新于',
    stats: {
      totalUsers: '总用户数', tested: '已检测', avgBioAge: '平均生物年龄',
      coaches: 'Coach 数', totalCoaches: 'Coach 总数',
      assignedUsers: '已分配用户', unassignedUsers: '未分配用户',
      totalDots: '营养点总数', isolates: '单体', blends: '复合',
      totalItems: '商品总数', activeItems: '上架中', totalOrders: '订单总数', pendingOrders: '待处理',
    },
    table: {
      id: 'ID', nickname: '昵称', gender: '性别', birthDate: '出生日期',
      language: '语言', bioAge: '生物年龄', chronoAge: '实际年龄',
      assignedCoach: '负责 Coach', joined: '注册时间',
      name: '姓名', email: '邮箱', phone: '电话', customers: '用户数',
      key: '标识', nameEn: '名称 (英)', nameZh: '名称 (中)', color: '颜色',
      type: '类型', description: '描述',
      unassigned: '未分配',
    },
    empty: { users: '暂无用户', coaches: '暂无 Coach', dots: '暂无营养点', store: '暂无商品', orders: '暂无订单' },
    count: (n) => `共 ${n} 位用户`,
    addUser: '添加用户',
    addCoach: '添加 Coach', addDot: '添加营养点', addItem: '添加商品',
    countCoach: (n) => `共 ${n} 位 Coach`,
    countDot: (n) => `共 ${n} 个营养点`,
    countItem: (n) => `共 ${n} 件商品`,
    countOrder: (n) => `共 ${n} 笔订单`,
    modal: {
      addUser: '添加用户', editUser: '编辑用户', deleteUser: '删除用户',
      addCoach: '添加 Coach', editCoach: '编辑 Coach', deleteCoach: '删除 Coach',
      addDot: '添加营养点', editDot: '编辑营养点', deleteDot: '删除营养点',
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
      colorZh: '颜色 (中)', description: '描述',
      isIsolate: '类型', isolate: '单体', blend: '复合',
      cancel: '取消', save: '保存', saving: '保存中…',
      delete: '删除', deleting: '删除中…',
      deleteWarning: (name) => `确认删除 ${name}？此操作将同时删除该用户的所有生物标志物、扫描记录和通知。`,
      deleteCoachWarning: (name) => `确认删除 Coach ${name}？其名下用户将变为未分配状态。`,
      deleteDotWarning: (name) => `确认删除营养点"${name}"？此操作不可撤销。`,
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
    },
    dotType: { isolate: '单体', blend: '复合' },
    store: {
      itemsTab: '商品', ordersTab: '订单',
      priceCny: '售价 (CNY)', priceUsd: '售价 (USD)', tag: '标签', active: '上架',
      qty: '数量', status: '状态', orderedAt: '下单时间', yes: '是', no: '否',
      pending: '待处理', confirmed: '已确认', shipped: '已发货',
      delivered: '已送达', cancelled: '已取消',
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
const EMPTY_USER = { nickname: '', gender: '', birth_date: '', language: 'zh', external_id: '', external_app: 'wechat', coach_id: '', phone: '', email: '' };

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

function UserModal({ user, coaches, onClose, onSave }) {
  const { t } = useLang();
  const isEdit = !!(user?.user_id || user?.id);
  const userId = user?.user_id || user?.id;
  const [form, setForm] = useState(isEdit
    ? { nickname: user.nickname || '', gender: user.gender || '', birth_date: user.birth_date ? user.birth_date.slice(0, 10) : '', language: user.language || 'zh', external_id: user.external_id || '', external_app: user.external_app || 'wechat', coach_id: user.coach_id ?? '', phone: user.phone || '', email: user.email || '' }
    : { ...EMPTY_USER });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const payload = { ...form, coach_id: form.coach_id === '' ? null : parseInt(form.coach_id) };
      if (isEdit) await axios.put(`/api/users/${userId}`, payload);
      else await axios.post('/api/users', payload);
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
              <span>{t.modal.phone}</span>
              <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+86 138 0000 0000" />
            </label>
            <label className="form-field">
              <span>{t.modal.email}</span>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="user@example.com" />
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

// ── Delete confirm ────────────────────────────────────────────────────────────

function DeleteConfirm({ user, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
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
          <p style={{ marginBottom: 20, color: '#475569' }}>
            {t.modal.deleteWarning(<strong>{user.nickname || user.external_id || user.user_id}</strong>)}
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

// ── Coach modal ───────────────────────────────────────────────────────────────

const EMPTY_COACH = { name: '', email: '', phone: '', language: 'zh' };

function CoachModal({ coach, onClose, onSave }) {
  const { t } = useLang();
  const isEdit = !!coach?.id;
  const [form, setForm] = useState(isEdit
    ? { name: coach.name || '', email: coach.email || '', phone: coach.phone || '', language: coach.language || 'zh' }
    : { ...EMPTY_COACH });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError(t.modal.nameRequired); return; }
    setBusy(true); setError('');
    try {
      if (isEdit) await axios.put(`/api/coaches/${coach.id}`, form);
      else await axios.post('/api/coaches', form);
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

const EMPTY_DOT = { key_name: '', name: '', name_zh: '', color: '', color_zh: '', description: '', is_isolate: false };

function DotModal({ dot, onClose, onSave }) {
  const { t } = useLang();
  const isEdit = !!dot?.id;
  const [form, setForm] = useState(isEdit
    ? { key_name: dot.key_name || '', name: dot.name || '', name_zh: dot.name_zh || '', color: dot.color || '', color_zh: dot.color_zh || '', description: dot.description || '', is_isolate: !!dot.is_isolate }
    : { ...EMPTY_DOT });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.key_name.trim()) { setError(t.modal.keyRequired); return; }
    if (!form.name.trim()) { setError(t.modal.nameRequired); return; }
    setBusy(true); setError('');
    try {
      if (isEdit) await axios.put(`/api/dots/${dot.id}`, form);
      else await axios.post('/api/dots', form);
      onSave();
    } catch (err) { setError(err.response?.data?.error || t.modal.saveFailed); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
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
              <span>{t.modal.color}</span>
              <input value={form.color} onChange={e => set('color', e.target.value)} placeholder={t.modal.colorPlaceholder} />
            </label>
            <label className="form-field">
              <span>{t.modal.colorZh}</span>
              <input value={form.color_zh} onChange={e => set('color_zh', e.target.value)} placeholder={t.modal.colorPlaceholder} />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal.description}</span>
              <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="…" />
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

function UsersTab({ users, coaches, onRefresh }) {
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
              <th>{t.table.id}</th><th>{t.table.nickname}</th><th>{t.table.gender}</th>
              <th>{t.table.birthDate}</th><th>{t.table.language}</th>
              <th>{t.table.bioAge}</th><th>{t.table.chronoAge}</th>
              <th>{t.table.assignedCoach}</th><th>{t.table.joined}</th>
              <th>{t.modal.phone}</th><th>{t.modal.email}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && <tr><td colSpan={12} className="empty-row">{t.empty.users}</td></tr>}
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
      {modal?.type === 'add'    && <UserModal user={null}       coaches={coaches} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit'   && <UserModal user={modal.user} coaches={coaches} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete' && <DeleteConfirm user={modal.user} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
      {detailUser && <UserDetailDrawer user={detailUser} onClose={() => setDetailUser(null)} />}
    </>
  );
}

// ── Coach tab ─────────────────────────────────────────────────────────────────

function CoachTab({ coaches, users, onRefresh }) {
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
            <tr><th>{t.table.id}</th><th>{t.table.name}</th><th>{t.table.email}</th><th>{t.table.phone}</th><th>{t.table.language}</th><th>{t.table.customers}</th><th>{t.table.joined}</th><th></th></tr>
          </thead>
          <tbody>
            {coaches.length === 0 && <tr><td colSpan={8} className="empty-row">{t.empty.coaches}</td></tr>}
            {coaches.map(p => (
              <tr key={p.id}>
                <td className="muted">{p.id}</td>
                <td>
                  <div className="avatar-cell">
                    <div className="avatar" style={{ background: '#10b98120', color: '#10b981' }}>{(p.name || 'C')[0].toUpperCase()}</div>
                    <span className="bold">{fmt(p.name)}</span>
                  </div>
                </td>
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
      {modal?.type === 'add'    && <CoachModal coach={null}       onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit'   && <CoachModal coach={modal.coach} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
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
            <tr><th>{t.table.key}</th><th>{t.table.nameEn}</th><th>{t.table.nameZh}</th><th>{t.table.color}</th><th>{t.table.type}</th><th>{t.table.description}</th><th></th></tr>
          </thead>
          <tbody>
            {dots.length === 0 && <tr><td colSpan={7} className="empty-row">{t.empty.dots}</td></tr>}
            {dots.map(d => (
              <tr key={d.id}>
                <td><code className="code-tag">{d.key_name}</code></td>
                <td className="bold">{fmt(d.name)}</td>
                <td>{fmt(d.name_zh)}</td>
                <td>
                  <div className="color-cell">
                    <span className="color-dot" style={{ background: d.color?.toLowerCase() || '#ccc' }} />
                    {fmt(d.color)}
                  </div>
                </td>
                <td><Badge color={d.is_isolate ? '#ec4899' : '#f59e0b'}>{d.is_isolate ? t.dotType.isolate : t.dotType.blend}</Badge></td>
                <td className="muted desc-cell">{fmt(d.description)}</td>
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

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [lang, setLang] = useState('en');
  const t = T[lang];
  const toggleLang = () => setLang(l => l === 'en' ? 'zh' : 'en');

  const [tab, setTab] = useState('users');
  const [data, setData] = useState({ users: [], dots: [], coaches: [], storeItems: [], orders: [] });
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, dRes, pRes, sRes, oRes] = await Promise.all([
        axios.get('/api/users'),
        axios.get('/api/dots-inventory'),
        axios.get('/api/coach-list'),
        axios.get('/api/store-items?all=true'),
        axios.get('/api/orders'),
      ]);
      setData({
        users: uRes.data.users || [],
        dots: dRes.data.dots || [],
        coaches: pRes.data.coaches || [],
        storeItems: sRes.data.items || [],
        orders: oRes.data.orders || [],
      });
      setLastRefresh(new Date());
    } catch (err) { console.error('Admin fetch error:', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const NAV = [
    { id: 'users',   label: t.nav.users,   icon: Users    },
    { id: 'coaches', label: t.nav.coaches, icon: UserCog  },
    { id: 'dots',    label: t.nav.dots,    icon: Droplets    },
    { id: 'store',   label: t.nav.store,   icon: ShoppingBag },
    { id: 'sims',    label: t.nav.sims,    icon: Layout      },
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
          {tab === 'users'   && <UsersTab   users={data.users} coaches={data.coaches} onRefresh={fetchData} />}
          {tab === 'coaches' && <CoachTab   coaches={data.coaches} users={data.users} onRefresh={fetchData} />}
          {tab === 'dots'    && <DotsTab    dots={data.dots} onRefresh={fetchData} />}
          {tab === 'store'   && <StoreTab   storeItems={data.storeItems} orders={data.orders} onRefresh={fetchData} />}
          {tab === 'sims'    && <SimulatorsTab />}
        </div>
      </div>
    </LangCtx.Provider>
  );
}
