import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import axios from 'axios';
import {
  Users, Droplets, UserCog, RefreshCcw,
  ChevronDown, Activity, Calendar, Plus, Pencil, Trash2, X, Check, Globe, Layout
} from 'lucide-react';

// ── i18n ──────────────────────────────────────────────────────────────────────

const T = {
  en: {
    brand: 'Nano Admin',
    nav: { users: 'Users', phms: 'PHMs', dots: 'Precision Dots', sims: 'Simulators' },
    topbar: { refresh: 'Refresh', loading: 'Loading…' },
    updated: 'Updated',
    stats: {
      totalUsers: 'Total Users', tested: 'Tested', avgBioAge: 'Avg Bio Age',
      phmCoaches: 'PHMs', totalCoaches: 'Total PHMs',
      assignedUsers: 'Assigned Users', unassignedUsers: 'Unassigned Users',
      totalDots: 'Total Dots', isolates: 'Isolates', blends: 'Blends',
    },
    table: {
      id: 'ID', nickname: 'Nickname', gender: 'Gender', birthDate: 'Birth Date',
      language: 'Language', bioAge: 'Bio Age', chronoAge: 'Chrono Age',
      assignedPhm: 'Assigned PHM', joined: 'Joined',
      name: 'Name', email: 'Email', phone: 'Phone', customers: 'Users',
      key: 'Key', nameEn: 'Name (EN)', nameZh: 'Name (ZH)', color: 'Color',
      type: 'Type', description: 'Description',
      unassigned: 'Unassigned',
    },
    empty: { users: 'No users found', phms: 'No PHMs found', dots: 'No dots found' },
    count: (n) => `${n} users`,
    addUser: 'Add User',
    addPhm: 'Add PHM', addDot: 'Add Dot',
    countPhm: (n) => `${n} PHMs`,
    countDot: (n) => `${n} dots`,
    modal: {
      addUser: 'Add User', editUser: 'Edit User', deleteUser: 'Delete User',
      addPhm: 'Add PHM', editPhm: 'Edit PHM', deletePhm: 'Delete PHM',
      addDot: 'Add Dot',   editDot: 'Edit Dot',   deleteDot: 'Delete Dot',
      openId: 'WeChat OpenID *', openIdPlaceholder: 'e.g. wx_abc123',
      nickname: 'Nickname', nicknamePlaceholder: 'Display name',
      gender: 'Gender', male: 'Male', female: 'Female',
      birthDate: 'Birth Date', language: 'Language',
      langZh: 'Chinese (ZH)', langEn: 'English (EN)',
      assignedPhm: 'Assigned PHM', unassigned: 'Unassigned',
      name: 'Name *', email: 'Email', phone: 'Phone',
      keyName: 'Key Name *', keyNamePlaceholder: 'e.g. omega3',
      nameEn: 'Name (EN) *', nameZh: 'Name (ZH)',
      color: 'Color', colorPlaceholder: '#FF6B35',
      colorZh: 'Color (ZH)', description: 'Description',
      isIsolate: 'Type', isolate: 'Isolate', blend: 'Blend',
      cancel: 'Cancel', save: 'Save', saving: 'Saving…',
      delete: 'Delete', deleting: 'Deleting…',
      deleteWarning: (name) => `Delete ${name}? This will also remove all their biomarkers, scans, and notifications.`,
      deletePhmWarning: (name) => `Delete PHM ${name}? Their assigned users will become unassigned.`,
      deleteDotWarning: (name) => `Delete dot "${name}"? This cannot be undone.`,
      openIdRequired: 'WeChat OpenID is required',
      nameRequired: 'Name is required',
      keyRequired: 'Key name is required',
      saveFailed: 'Save failed',
    },
    dotType: { isolate: 'Isolate', blend: 'Blend' },
  },
  zh: {
    brand: 'Nano 管理后台',
    nav: { users: '用户管理', phms: 'PHM', dots: '精准营养点', sims: '模拟器' },
    topbar: { refresh: '刷新', loading: '加载中…' },
    updated: '更新于',
    stats: {
      totalUsers: '总用户数', tested: '已检测', avgBioAge: '平均生物年龄',
      phmCoaches: 'PHM 数', totalCoaches: 'PHM 总数',
      assignedUsers: '已分配用户', unassignedUsers: '未分配用户',
      totalDots: '营养点总数', isolates: '单体', blends: '复合',
    },
    table: {
      id: 'ID', nickname: '昵称', gender: '性别', birthDate: '出生日期',
      language: '语言', bioAge: '生物年龄', chronoAge: '实际年龄',
      assignedPhm: '负责 PHM', joined: '注册时间',
      name: '姓名', email: '邮箱', phone: '电话', customers: '用户数',
      key: '标识', nameEn: '名称 (英)', nameZh: '名称 (中)', color: '颜色',
      type: '类型', description: '描述',
      unassigned: '未分配',
    },
    empty: { users: '暂无用户', phms: '暂无 PHM', dots: '暂无营养点' },
    count: (n) => `共 ${n} 位用户`,
    addUser: '添加用户',
    addPhm: '添加 PHM', addDot: '添加营养点',
    countPhm: (n) => `共 ${n} 位 PHM`,
    countDot: (n) => `共 ${n} 个营养点`,
    modal: {
      addUser: '添加用户', editUser: '编辑用户', deleteUser: '删除用户',
      addPhm: '添加 PHM', editPhm: '编辑 PHM', deletePhm: '删除 PHM',
      addDot: '添加营养点', editDot: '编辑营养点', deleteDot: '删除营养点',
      openId: '微信 OpenID *', openIdPlaceholder: '例如 wx_abc123',
      nickname: '昵称', nicknamePlaceholder: '显示名称',
      gender: '性别', male: '男', female: '女',
      birthDate: '出生日期', language: '语言',
      langZh: '中文 (ZH)', langEn: '英文 (EN)',
      assignedPhm: '负责 PHM', unassigned: '未分配',
      name: '姓名 *', email: '邮箱', phone: '电话',
      keyName: '标识 *', keyNamePlaceholder: '例如 omega3',
      nameEn: '名称 (英) *', nameZh: '名称 (中)',
      color: '颜色', colorPlaceholder: '#FF6B35',
      colorZh: '颜色 (中)', description: '描述',
      isIsolate: '类型', isolate: '单体', blend: '复合',
      cancel: '取消', save: '保存', saving: '保存中…',
      delete: '删除', deleting: '删除中…',
      deleteWarning: (name) => `确认删除 ${name}？此操作将同时删除该用户的所有生物标志物、扫描记录和通知。`,
      deletePhmWarning: (name) => `确认删除 PHM ${name}？其名下用户将变为未分配状态。`,
      deleteDotWarning: (name) => `确认删除营养点"${name}"？此操作不可撤销。`,
      openIdRequired: '微信 OpenID 为必填项',
      nameRequired: '姓名为必填项',
      keyRequired: '标识为必填项',
      saveFailed: '保存失败',
    },
    dotType: { isolate: '单体', blend: '复合' },
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
const EMPTY_USER = { nickname: '', gender: '', birth_date: '', language: 'zh', wechat_openid: '', phm_id: '' };

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

function PHMSelect({ userId, currentPhmId, phms, onAssign }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleChange = async (e) => {
    const phmId = e.target.value === '' ? null : parseInt(e.target.value);
    setBusy(true);
    try { await axios.post('/api/assign-phm', { user_id: userId, phm_id: phmId }); onAssign(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="select-wrap">
      <select value={currentPhmId ?? ''} onChange={handleChange} disabled={busy} className="inline-select">
        <option value="">{t.table.unassigned}</option>
        {phms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <ChevronDown size={11} className="select-chevron" />
    </div>
  );
}

// ── User modal ────────────────────────────────────────────────────────────────

function UserModal({ user, phms, onClose, onSave }) {
  const { t } = useLang();
  const isEdit = !!user?.id;
  const [form, setForm] = useState(isEdit
    ? { nickname: user.nickname || '', gender: user.gender || '', birth_date: user.birth_date ? user.birth_date.slice(0, 10) : '', language: user.language || 'zh', wechat_openid: user.wechat_openid || '', phm_id: user.phm_id ?? '' }
    : { ...EMPTY_USER });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.wechat_openid.trim()) { setError(t.modal.openIdRequired); return; }
    setBusy(true); setError('');
    try {
      const payload = { ...form, phm_id: form.phm_id === '' ? null : parseInt(form.phm_id) };
      if (isEdit) await axios.put(`/api/users/${user.id}`, payload);
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
              <span>{t.modal.openId}</span>
              <input value={form.wechat_openid} onChange={e => set('wechat_openid', e.target.value)} disabled={isEdit} placeholder={t.modal.openIdPlaceholder} />
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
              <span>{t.modal.assignedPhm}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.phm_id} onChange={e => set('phm_id', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="">{t.modal.unassigned}</option>
                  {phms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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

// ── Delete confirm ────────────────────────────────────────────────────────────

function DeleteConfirm({ user, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleDelete = async () => {
    setBusy(true);
    try { await axios.delete(`/api/users/${user.id}`); onConfirm(); }
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
            {t.modal.deleteWarning(<strong>{user.nickname || user.wechat_openid}</strong>)}
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

// ── PHM modal ─────────────────────────────────────────────────────────────────

const EMPTY_PHM = { name: '', email: '', phone: '' };

function PHMModal({ phm, onClose, onSave }) {
  const { t } = useLang();
  const isEdit = !!phm?.id;
  const [form, setForm] = useState(isEdit
    ? { name: phm.name || '', email: phm.email || '', phone: phm.phone || '' }
    : { ...EMPTY_PHM });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError(t.modal.nameRequired); return; }
    setBusy(true); setError('');
    try {
      if (isEdit) await axios.put(`/api/phms/${phm.id}`, form);
      else await axios.post('/api/phms', form);
      onSave();
    } catch (err) { setError(err.response?.data?.error || t.modal.saveFailed); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEdit ? t.modal.editPhm : t.modal.addPhm}</span>
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
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="phm@example.com" />
            </label>
            <label className="form-field">
              <span>{t.modal.phone}</span>
              <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+86 138 0000 0000" />
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

function DeletePHMConfirm({ phm, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleDelete = async () => {
    setBusy(true);
    try { await axios.delete(`/api/phms/${phm.id}`); onConfirm(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.modal.deletePhm}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 20, color: '#475569' }}>
            {t.modal.deletePhmWarning(<strong>{phm.name}</strong>)}
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

// ── Users tab ─────────────────────────────────────────────────────────────────

function UsersTab({ users, phms, onRefresh }) {
  const { t } = useLang();
  const [modal, setModal] = useState(null);
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
        <StatCard icon={UserCog}  label={t.stats.phmCoaches} value={phms.length}  color="#10b981" />
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
              <th>{t.table.assignedPhm}</th><th>{t.table.joined}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && <tr><td colSpan={10} className="empty-row">{t.empty.users}</td></tr>}
            {users.map(u => (
              <tr key={u.id}>
                <td className="muted">{u.id}</td>
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
                <td><PHMSelect userId={u.id} currentPhmId={u.phm_id} phms={phms} onAssign={onRefresh} /></td>
                <td className="muted">{fmtDate(u.created_at)}</td>
                <td>
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
      {modal?.type === 'add'    && <UserModal user={null}       phms={phms} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit'   && <UserModal user={modal.user} phms={phms} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete' && <DeleteConfirm user={modal.user} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
    </>
  );
}

// ── PHM tab ───────────────────────────────────────────────────────────────────

function PHMTab({ phms, users, onRefresh }) {
  const { t } = useLang();
  const [modal, setModal] = useState(null);
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  return (
    <>
      <div className="stat-row">
        <StatCard icon={UserCog} label={t.stats.totalCoaches}    value={phms.length}                         color="#10b981" />
        <StatCard icon={Users}   label={t.stats.assignedUsers}   value={users.filter(u => u.phm_id).length}  color="#3b82f6" />
        <StatCard icon={Users}   label={t.stats.unassignedUsers} value={users.filter(u => !u.phm_id).length} color="#f59e0b" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{t.countPhm(phms.length)}</span>
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
            <Plus size={14} />{t.addPhm}
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr><th>{t.table.id}</th><th>{t.table.name}</th><th>{t.table.email}</th><th>{t.table.phone}</th><th>{t.table.customers}</th><th>{t.table.joined}</th><th></th></tr>
          </thead>
          <tbody>
            {phms.length === 0 && <tr><td colSpan={7} className="empty-row">{t.empty.phms}</td></tr>}
            {phms.map(p => (
              <tr key={p.id}>
                <td className="muted">{p.id}</td>
                <td>
                  <div className="avatar-cell">
                    <div className="avatar" style={{ background: '#10b98120', color: '#10b981' }}>{(p.name || 'P')[0].toUpperCase()}</div>
                    <span className="bold">{fmt(p.name)}</span>
                  </div>
                </td>
                <td className="muted">{fmt(p.email)}</td>
                <td className="muted">{fmt(p.phone)}</td>
                <td><Badge color="#3b82f6">{p.user_count || 0}</Badge></td>
                <td className="muted">{fmtDate(p.created_at)}</td>
                <td>
                  <div className="row-actions">
                    <button className="icon-btn" title={t.modal.editPhm} onClick={() => setModal({ type: 'edit', phm: p })}><Pencil size={14} /></button>
                    <button className="icon-btn danger" title={t.modal.deletePhm} onClick={() => setModal({ type: 'delete', phm: p })}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal?.type === 'add'    && <PHMModal phm={null}       onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit'   && <PHMModal phm={modal.phm} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete' && <DeletePHMConfirm phm={modal.phm} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
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

// ── Simulators tab ────────────────────────────────────────────────────────────

function SimulatorsTab() {
  return (
    <div className="sims-grid">
      <div className="card sim-card">
        <div className="card-header">Kino Simulator</div>
        <iframe src="/admin/sim/kino/" title="Kino" className="sim-iframe" />
      </div>
      <div className="card sim-card">
        <div className="card-header">Chat Simulator</div>
        <iframe src="/admin/sim/chat/" title="Chat" className="sim-iframe" />
      </div>
      <div className="card sim-card">
        <div className="card-header">PHM Simulator</div>
        <iframe src="/admin/sim/phm/" title="PHM" className="sim-iframe" />
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
  const [data, setData] = useState({ users: [], dots: [], phms: [] });
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, dRes, pRes] = await Promise.all([
        axios.get('/api/users'),
        axios.get('/api/dots-inventory'),
        axios.get('/api/phm-list'),
      ]);
      setData({ users: uRes.data.users || [], dots: dRes.data.dots || [], phms: pRes.data.phms || [] });
      setLastRefresh(new Date());
    } catch (err) { console.error('Admin fetch error:', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const NAV = [
    { id: 'users', label: t.nav.users, icon: Users    },
    { id: 'phms',  label: t.nav.phms,  icon: UserCog  },
    { id: 'dots',  label: t.nav.dots,  icon: Droplets },
    { id: 'sims',  label: t.nav.sims,  icon: Layout   },
  ];

  return (
    <LangCtx.Provider value={{ lang, t, toggleLang }}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-dot" />
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
          {tab === 'users' && <UsersTab users={data.users} phms={data.phms} onRefresh={fetchData} />}
          {tab === 'phms'  && <PHMTab  phms={data.phms}   users={data.users} onRefresh={fetchData} />}
          {tab === 'dots'  && <DotsTab dots={data.dots} onRefresh={fetchData} />}
          {tab === 'sims'  && <SimulatorsTab />}
        </div>
      </div>
    </LangCtx.Provider>
  );
}
