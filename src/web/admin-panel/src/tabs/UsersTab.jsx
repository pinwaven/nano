import React, { useState, useEffect, useCallback, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import DigitalBodyFigure from '../DigitalBodyFigure.jsx';
import axios from 'axios';
import {
  Users, UserCog, Activity, Calendar, Plus, Pencil, Trash2, X, Check,
  ChevronDown, ChevronRight, Coins, FileText,
} from 'lucide-react';
import { useLang, fmt, fmtDate, bioAgeColor, Badge, StatCard, RichStatCard, ALL_ROLES, EMPTY_USER, PERMS, hasPermission } from '../shared.jsx';
import { Sparkline } from './DotsTab.jsx';

// ── CoachSelect ───────────────────────────────────────────────────────────────

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

// ── BioMarker / Sub-age metadata ──────────────────────────────────────────────

const BM_META = [
  { key: 'hsCRP',     label: 'hsCRP',            unit: 'mg/L',      color: '#ef4444' },
  { key: 'GDF15',     label: 'GDF-15',           unit: 'pg/mL',     color: '#f97316' },
  { key: 'IL6',       label: 'IL-6',             unit: 'pg/mL',     color: '#a855f7' },
  { key: 'GA',        label: 'Glycated Albumin',  unit: '%',         color: '#3b82f6' },
  { key: 'CystatinC', label: 'Cystatin C',        unit: 'mg/L',      color: '#0ea5e9' },
  { key: 'CD38',      label: 'CD38',             unit: 'xBaseline', color: '#10b981' },
];

const SUB_AGE_META_DETAIL = [
  { key: 'ResilienceAge',    label: 'Resilience Age',     color: '#c084d4' },
  { key: 'CellularAge',      label: 'Cellular Age',       color: '#10b981' },
  { key: 'MetabolicAge',     label: 'Metabolic Age',      color: '#6375EC' },
  { key: 'MicroVascularAge', label: 'Micro-Vascular Age', color: '#0ea5e9' },
];

const SUB_AGE_KEYS_CONFIG = [
  { key: 'ResilienceAge',    defaultZh: '抗压年龄',   defaultEn: 'Resilience Age' },
  { key: 'CellularAge',      defaultZh: '细胞年龄',   defaultEn: 'Cellular Age' },
  { key: 'MetabolicAge',     defaultZh: '代谢年龄',   defaultEn: 'Metabolic Age' },
  { key: 'MicroVascularAge', defaultZh: '微血管年龄', defaultEn: 'Micro-Vascular Age' },
];

const CONDITION_LABELS = {
  blood_sugar_high:    'High Blood Sugar',
  blood_pressure_high: 'High Blood Pressure',
  blood_lipids_high:   'High Blood Lipids',
  cholesterol_high:    'High Cholesterol',
  heart_issues:        'Heart Problems',
  gout_uric_acid:      'Gout / Uric Acid',
  kidney_disease:      'Kidney Disease',
  sleep_deficiency:    'Sleep Deficiency',
  other:               'Other',
};

const CONDITION_LABELS_ZH = {
  blood_sugar_high:    '高血糖',
  blood_pressure_high: '高血压',
  blood_lipids_high:   '高血脂',
  cholesterol_high:    '高胆固醇',
  heart_issues:        '心血管问题',
  gout_uric_acid:      '痛风 / 高尿酸',
  kidney_disease:      '肾脏疾病',
  sleep_deficiency:    '睡眠不足',
  other:               '其他',
};

const subAgeMetaZh = {
  ResilienceAge: '抗压年龄',
  CellularAge: '细胞年龄',
  MetabolicAge: '代谢年龄',
  MicroVascularAge: '微血管年龄',
};

const bmLabelsZh = {
  hsCRP: '超敏 C 反应蛋白',
  GDF15: '生长分化因子-15',
  IL6: '白介素-6',
  GA: '糖化白蛋白',
  CystatinC: '胱抑素 C',
  CD38: 'CD38 表达量',
};

// ── UserDetailModal ───────────────────────────────────────────────────────────

function UserDetailModal({ user, onClose }) {
  const { t, lang } = useLang();
  const isZh = lang === 'zh';
  const [tab, setTab]                     = useState('health');
  const [records, setRecords]             = useState([]);
  const [bmLoading, setBmLoading]         = useState(true);
  const [twinData, setTwinData]           = useState(null);
  const [plans, setPlans]                 = useState(null);
  const [plansLoading, setPlansLoading]   = useState(false);
  const [messages, setMessages]           = useState(null);
  const [chatLoading, setChatLoading]     = useState(false);

  const [healthReports, setHealthReports]               = useState([]);
  const [healthReportsLoading, setHealthReportsLoading] = useState(false);
  const [selectedReport, setSelectedReport]             = useState(null);
  const [reportDetail, setReportDetail]                 = useState(null);
  const [reportDetailLoading, setReportDetailLoading]   = useState(false);

  const openid = user?.user_id || user?.id;

  useEffect(() => {
    if (!openid) return;
    setBmLoading(true);
    setTwinData(null);
    setHealthReportsLoading(true);

    axios.get(`/api/biomarkers?openid=${encodeURIComponent(openid)}`)
      .then(r => setRecords(r.data.records || []))
      .catch(() => setRecords([]))
      .finally(() => setBmLoading(false));
    axios.get(`/api/health-twin?openid=${encodeURIComponent(openid)}`)
      .then(r => setTwinData(r.data.twin || null))
      .catch(() => setTwinData(null));
    axios.get(`/api/health-reports?openid=${encodeURIComponent(openid)}`)
      .then(r => setHealthReports(r.data.reports || []))
      .catch(() => setHealthReports([]))
      .finally(() => setHealthReportsLoading(false));
  }, [openid]);

  const openReportDetail = async (rep) => {
    setSelectedReport(rep);
    setReportDetailLoading(true);
    setReportDetail({ report: rep, events: [] });
    try {
      const r = await axios.get(`/api/health-reports/${rep.id}`);
      setReportDetail(r.data);
    } catch (err) {
      console.error(err);
      setReportDetail(d => ({ ...d, events: [] }));
    } finally {
      setReportDetailLoading(false);
    }
  };

  const switchTab = (next) => {
    setTab(next);
    if (next === 'plans' && plans === null && !plansLoading) {
      setPlansLoading(true);
      axios.get(`/api/health-plans?openid=${encodeURIComponent(openid)}`)
        .then(r => setPlans(r.data.plans || []))
        .catch(() => setPlans([]))
        .finally(() => setPlansLoading(false));
    }
    if (next === 'chat' && messages === null && !chatLoading) {
      setChatLoading(true);
      axios.get(`/api/coach-user-chat?user_id=${encodeURIComponent(openid)}`)
        .then(r => setMessages(r.data.messages || []))
        .catch(() => setMessages([]))
        .finally(() => setChatLoading(false));
    }
  };

  if (!user) return null;

  const bioData      = user.bio_data || {};
  const kinoRecs     = records.filter(r => r.test_type === 'kino_chip');
  const latestRec    = [...kinoRecs].reverse().find(r => r.data?.estimated) || null;
  const latestBm     = latestRec?.data?.estimated || null;
  const subAgesRaw   = latestRec?.data?.bioage_profile?.SubAges || null;
  const rawBioAge    = latestRec?.bio_age
    ?? (kinoRecs.length > 0 ? kinoRecs[kinoRecs.length - 1]?.bio_age : null)
    ?? user.bio_age;
  const cAge         = user.chrono_age;
  const bAgeClr      = bioAgeColor(rawBioAge, cAge);
  const conditions   = bioData.health_conditions || [];

  const subAgeList = subAgesRaw
    ? SUB_AGE_META_DETAIL.map(({ key, label, color }) => {
        const v = subAgesRaw[key];
        const score = v != null && cAge != null
          ? Math.max(5, Math.min(95, Math.round((cAge + 15 - v) / 30 * 100)))
          : 50;
        const translatedLabel = isZh ? (subAgeMetaZh[key] || label) : label;
        return { key, label: translatedLabel, color, value: v != null ? v.toFixed(1) : '—', score };
      })
    : [];

  const trendFor = key => kinoRecs.slice(-10)
    .map(r => r.data?.estimated?.[key]).filter(v => v != null);

  const TABS = [
    { id: 'health', label: t.userDetail.tabHealth },
    { id: 'plans',  label: t.userDetail.tabPlans  },
    { id: 'chat',   label: t.userDetail.tabChat   },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-user-detail modal-tabbed" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="udm-header">
          <div className="udm-identity">
            {user.avatar_url
              ? <img src={user.avatar_url} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
              : <div className="avatar" style={{ width: 40, height: 40, fontSize: 16, background: '#3b82f620', color: '#3b82f6' }}>
                  {(user.nickname || 'U')[0].toUpperCase()}
                </div>
            }
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>{user.nickname || '—'}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', marginTop: 2 }}>{openid}</div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Tab nav */}
        <div className="modal-nav">
          {TABS.map(({ id, label }) => (
            <button key={id} className={`modal-nav-tab${tab === id ? ' active' : ''}`} onClick={() => switchTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="modal-body">

          {/* ── HEALTH ── */}
          {tab === 'health' && (
            <div className="udm-health">

              {/* Left: digital twin + profile + conditions */}
              <div className="udm-col-left">
                <DigitalBodyFigure subAges={subAgeList} bioAge={rawBioAge} chronoAge={cAge} isZh={isZh} />
                {twinData?.tags?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
                    {twinData.tags.map((tag, i) => (
                      <Badge key={i} color={tag.color}>{isZh ? (tag.labelZh || tag.labelEn) : tag.labelEn}</Badge>
                    ))}
                  </div>
                )}
                <div className="udm-section">
                  <div className="udm-section-title">{t.userDetail.profile}</div>
                  <div className="drawer-info-grid">
                    <span className="drawer-info-key">{t.userDetail.externalApp}</span>
                    <span className="drawer-info-val">{fmt(user.external_app)}</span>
                    <span className="drawer-info-key">{t.userDetail.externalId}</span>
                    <span className="drawer-info-val mono">{fmt(user.external_id)}</span>
                    <span className="drawer-info-key">{t.table.gender}</span>
                    <span className="drawer-info-val">{fmt(user.gender === 'male' ? t.modal.male : user.gender === 'female' ? t.modal.female : user.gender)}</span>
                    <span className="drawer-info-key">{t.table.birthDate}</span>
                    <span className="drawer-info-val">{fmtDate(user.birth_date)}</span>
                    <span className="drawer-info-key">{t.userDetail.height}</span>
                    <span className="drawer-info-val">{bioData.height != null ? `${bioData.height} cm` : '—'}</span>
                    <span className="drawer-info-key">{t.userDetail.weight}</span>
                    <span className="drawer-info-val">{bioData.weight != null ? `${bioData.weight} kg` : '—'}</span>
                    <span className="drawer-info-key">{t.table.language}</span>
                    <span className="drawer-info-val">{user.language === 'zh' ? t.modal.langZh : user.language === 'en' ? t.modal.langEn : (user.language || '—').toUpperCase()}</span>
                    <span className="drawer-info-key">{t.table.assignedCoach}</span>
                    <span className="drawer-info-val">{fmt(user.coach_name)}</span>
                    <span className="drawer-info-key">{t.userDetail.referredBy}</span>
                    <span className="drawer-info-val">{user.referred_by_user_id ? (user.referrer_nickname || user.referred_by_user_id) : '—'}</span>
                    <span className="drawer-info-key">{t.userDetail.invitedBy}</span>
                    <span className="drawer-info-val">{user.invited_by_invitation_id ? `${user.inviter_nickname || '—'} (${user.invite_code})` : '—'}</span>
                    <span className="drawer-info-key">{t.table.joined}</span>
                    <span className="drawer-info-val">{fmtDate(user.created_at)}</span>
                    <span className="drawer-info-key">{t.modal.phone}</span>
                    <span className="drawer-info-val">{fmt(user.phone)}</span>
                    <span className="drawer-info-key">{t.modal.email}</span>
                    <span className="drawer-info-val">{fmt(user.email)}</span>
                    <span className="drawer-info-key">{t.table.roles}</span>
                    <span className="drawer-info-val">
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {(user.roles || ['user']).map(r => {
                          const translatedRole = r === 'superadmin' ? t.modal.roleSuperadmin
                            : r === 'admin' ? t.modal.roleAdmin
                            : r === 'coach' ? t.modal.roleCoach
                            : t.modal.roleUser;
                          return (
                            <Badge key={r} color={r === 'superadmin' ? '#dc2626' : r === 'admin' ? '#f59e0b' : r === 'coach' ? '#8b5cf6' : '#64748b'}>{translatedRole}</Badge>
                          );
                        })}
                      </div>
                    </span>
                  </div>
                </div>

                {conditions.length > 0 && (
                  <div className="udm-section">
                    <div className="udm-section-title">{t.userDetail.healthConditions}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {conditions.map(c => {
                        const label = isZh ? (CONDITION_LABELS_ZH[c] || c) : (CONDITION_LABELS[c] || c);
                        return (
                          <Badge key={c} color="#6366f1">{label}</Badge>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Right: bio ages + biomarkers + trends */}
              <div className="udm-col-right">
                {bmLoading ? (
                  <div className="drawer-empty" style={{ padding: '24px 0' }}>{t.userDetail.loadingHealth}</div>
                ) : (
                  <>
                    <div className="udm-section">
                      <div className="udm-bioage-row">
                        <div className="udm-age-chip">
                          <div className="udm-age-val">{cAge ?? '—'}</div>
                          <div className="udm-age-label">{t.userDetail.chronoAge}</div>
                        </div>
                        <div className="udm-age-chip udm-age-chip-primary">
                          <div className="udm-age-val udm-bio-val" style={{ color: bAgeClr }}>
                            {rawBioAge ? Number(rawBioAge).toFixed(1) : '—'}
                          </div>
                          <div className="udm-age-label">{t.userDetail.bioAge}</div>
                        </div>
                        <span className="drawer-empty" style={{ padding: 0 }}>
                          {t.userDetail.testsCount(kinoRecs.length)}
                        </span>
                      </div>
                    </div>

                    {subAgeList.length > 0 && (
                      <div className="udm-section">
                        <div className="udm-section-title">{t.userDetail.subAges}</div>
                        <div className="udm-subages">
                          {subAgeList.map(({ key, label, color, value, score }) => (
                            <div key={key} className="udm-subage-row">
                              <span className="udm-subage-label">{label}</span>
                              <div className="udm-bar-wrap">
                                <div className="udm-bar-fill" style={{ width: `${score}%`, background: color }} />
                              </div>
                              <span className="udm-subage-val" style={{ color }}>{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="udm-section">
                      <div className="udm-section-title">{t.userDetail.latestBiomarkers}</div>
                      {latestBm ? (
                        <div className="bm-table">
                          {BM_META.map(({ key, label, unit, color }) => {
                            const translatedLabel = isZh ? (bmLabelsZh[key] || label) : label;
                            return (
                              <div key={key} className="bm-table-row">
                                <span className="bm-table-label">{translatedLabel}</span>
                                <span className="bm-table-val" style={{ color }}>{latestBm[key] ?? '—'}</span>
                                <span className="bm-table-unit">{unit}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="drawer-empty">{t.userDetail.noBiomarker}</div>
                      )}
                    </div>

                    {kinoRecs.length > 0 && (
                      <div className="udm-section">
                        <div className="udm-section-title">
                          {t.userDetail.biomarkerTrends(kinoRecs.length)}
                        </div>
                        <div className="trend-grid">
                          {BM_META.map(({ key, label, unit, color }) => {
                            const vals = trendFor(key);
                            const last = vals[vals.length - 1];
                            const translatedLabel = isZh ? (bmLabelsZh[key] || label) : label;
                            return (
                              <div key={key} className="trend-card">
                                <div className="trend-label">{translatedLabel}</div>
                                <div className="trend-val" style={{ color }}>
                                  {last != null ? last : '—'}<span className="trend-unit">{unit}</span>
                                </div>
                                <Sparkline values={vals} color={color} width={130} height={38} />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* ── Health Reports ── */}
                    <div className="udm-section" style={{ marginTop: 22 }}>
                      <div className="udm-section-title">{t.userDetail.healthReports}</div>
                      {healthReportsLoading ? (
                        <div className="drawer-empty">{t.userDetail.loadingReports}</div>
                      ) : healthReports.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {healthReports.map(rep => {
                            const sourceColor = { lab_api: '#6366f1', manual_upload: '#10b981', fhir_import: '#f59e0b' }[rep.source] || '#94a3b8';
                            const reportTypeColor = { lab_panel: '#3b82f6', annual_checkup: '#10b981' }[rep.report_type] || '#8b5cf6';
                            return (
                              <div
                                key={rep.id}
                                className="report-list-item"
                                onClick={() => openReportDetail(rep)}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                  <div style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: 6,
                                    background: `${reportTypeColor}15`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: reportTypeColor
                                  }}>
                                    <FileText size={16} />
                                  </div>
                                  <div>
                                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                                      {rep.institution || (isZh ? '未知机构' : 'Unknown Institution')}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                                      <span style={{ fontSize: 11, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                        <Calendar size={11} /> {rep.report_date}
                                      </span>
                                      <span style={{
                                        fontSize: 10,
                                        fontWeight: 700,
                                        color: sourceColor,
                                        background: `${sourceColor}10`,
                                        padding: '1px 6px',
                                        borderRadius: 4,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.04em'
                                      }}>
                                        {rep.source === 'lab_api' ? t.userDetail.labApiTag : rep.source === 'manual_upload' ? t.userDetail.manualTag : t.userDetail.fhirTag}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: reportTypeColor,
                                    background: `${reportTypeColor}10`,
                                    padding: '2px 8px',
                                    borderRadius: 12,
                                  }}>
                                    {rep.report_type === 'lab_panel' ? t.userDetail.labPanelTag : rep.report_type === 'annual_checkup' ? t.userDetail.annualCheckupTag : rep.report_type}
                                  </span>
                                  <ChevronRight size={16} style={{ color: 'var(--muted)' }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="drawer-empty">{t.userDetail.noReports}</div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── PLANS ── */}
          {tab === 'plans' && (
            <div className="udm-plans-fill">
              {plansLoading ? (
                <div className="drawer-empty">{t.userDetail.loadingPlans}</div>
              ) : !plans || plans.length === 0 ? (
                <div className="drawer-empty">{t.userDetail.noPlans}</div>
              ) : (
                <div className="udm-plans-grid">
                  {plans.map(p => (
                    <div key={p.id} className="udm-plan-card">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <Badge color={p.plan_type === 'primary' ? '#3b82f6' : '#8b5cf6'}>
                          {p.plan_type === 'primary' ? t.userDetail.primaryPlan : t.userDetail.secondaryPlan}
                        </Badge>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#1e293b', marginBottom: 4 }}>
                        {isZh ? (p.name_zh || p.custom_name_zh || p.name_en || p.custom_name_en) : (p.name_en || p.custom_name_en || p.name_zh || p.custom_name_zh || '—')}
                      </div>
                      {(isZh ? (p.custom_goal_zh || p.custom_goal_en) : (p.custom_goal_en || p.custom_goal_zh)) && (
                        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, lineHeight: 1.5 }}>
                          {isZh ? (p.custom_goal_zh || p.custom_goal_en) : (p.custom_goal_en || p.custom_goal_zh)}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#94a3b8' }}>
                        <span>{t.userDetail.checkins(p.checkin_count ?? 0)}</span>
                        {p.duration_weeks && <span>{t.userDetail.weeks(p.duration_weeks)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── CHAT ── */}
          {tab === 'chat' && (
            <div className="udm-chat-fill">
              {chatLoading ? (
                <div className="drawer-empty">{t.userDetail.loadingChat}</div>
              ) : !messages || messages.length === 0 ? (
                <div className="drawer-empty">{t.userDetail.noChat}</div>
              ) : (
                <div className="udm-chat-list">
                  {messages.map((msg, i) => (
                    <div key={msg.id || i} className={`udm-msg udm-msg-${msg.role}`}>
                      <div className="udm-msg-meta">
                        <span className="udm-msg-role">
                          {msg.role === 'user' ? t.userDetail.userRole : msg.role === 'ai' ? t.userDetail.aiRole : t.userDetail.coachRole}
                        </span>
                        <span className="udm-msg-time">
                          {msg.created_at ? new Date(msg.created_at).toLocaleString(isZh ? 'zh-CN' : 'en-US') : ''}
                        </span>
                      </div>
                      {msg.imageUrl
                        ? <img src={msg.imageUrl} alt="attachment"
                            style={{ maxWidth: 300, borderRadius: 8, marginTop: 4, display: 'block' }} />
                        : <div className="udm-msg-content">{msg.content}</div>
                      }
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Detail Modal Overlay */}
        {selectedReport && reportDetail && (
          <div className="modal-overlay" style={{ zIndex: 110 }} onClick={() => setSelectedReport(null)}>
            <div className="modal" style={{ maxWidth: 720, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <span>{t.userDetail.reportIdHeader(reportDetail.report.id, reportDetail.report.nickname || user.nickname || 'User', reportDetail.report.report_date)}</span>
                <button className="icon-btn" onClick={() => setSelectedReport(null)}><X size={16} /></button>
              </div>
              <div style={{ overflowY: 'auto', padding: '16px 24px', flex: 1 }}>
                {reportDetailLoading && <div style={{ color: '#94a3b8', textAlign: 'center', padding: 24 }}>{t.userDetail.loadingReportDetail}</div>}

                {/* ── Doctor Notes Section ── */}
                {!reportDetailLoading && reportDetail.report?.raw_data?.doctor_notes && (() => {
                  const dn = reportDetail.report.raw_data.doctor_notes;
                  return (
                    <div style={{ marginBottom: 20 }}>
                      {/* Attending physician */}
                      {dn.physician && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>👨‍⚕️</div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{isZh ? (dn.physician_zh || dn.physician) : dn.physician}</div>
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>
                              {isZh ? (dn.department_zh || dn.department) : dn.department} · {reportDetail.report.institution || (isZh ? '未知机构' : 'Unknown Institution')}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Vital signs summary */}
                      {dn.vital_summary && (
                        <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                          <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.userDetail.vitalSigns}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px' }}>
                            {Object.entries(dn.vital_summary).map(([k, v]) => (
                              <span key={k} style={{ fontSize: 12 }}>
                                <span style={{ color: '#94a3b8' }}>{k.replace(/_/g,' ')}: </span>
                                <span style={{ fontWeight: 600 }}>{v}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Diagnoses */}
                      {dn.diagnoses?.length > 0 && (
                        <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                          <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.userDetail.diagnoses}</div>
                          <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {dn.diagnoses.map((d, i) => (
                              <li key={i} style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 3 }}>{d}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Clinical narrative */}
                      {dn.clinical_summary && (
                        <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                          <div style={{ fontSize: 11, color: '#10b981', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.userDetail.clinicalSummary}</div>
                          <p style={{ margin: 0, fontSize: 13, color: '#cbd5e1', lineHeight: 1.65 }}>{dn.clinical_summary}</p>
                        </div>
                      )}

                      {/* Recommendations */}
                      {dn.recommendations?.length > 0 && (
                        <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                          <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.userDetail.recommendations}</div>
                          <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {dn.recommendations.map((r, i) => (
                              <li key={i} style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 3 }}>{r}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Follow-up */}
                      {dn.follow_up && (
                        <div style={{ fontSize: 12, color: '#94a3b8', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10, marginTop: 6 }}>
                          <span style={{ color: '#6366f1', fontWeight: 600 }}>{t.userDetail.followUp}: </span>{dn.follow_up}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ── Older diagnostics/doctor_advice format ── */}
                {!reportDetailLoading && !reportDetail.report?.raw_data?.doctor_notes && (
                  <>
                    {reportDetail.report?.raw_data?.diagnostics?.length > 0 && (
                      <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                        <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.userDetail.diagnostics}</div>
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {reportDetail.report.raw_data.diagnostics.map((d, i) => (
                            <li key={i} style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 3 }}>{d}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {reportDetail.report?.raw_data?.doctor_advice?.length > 0 && (
                      <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                        <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.userDetail.doctorAdvice}</div>
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {reportDetail.report.raw_data.doctor_advice.map((a, i) => (
                            <li key={i} style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 3 }}>{a}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}

                {/* ── Biomarker Observations Table ── */}
                {!reportDetailLoading && (reportDetail.events || []).length > 0 && (
                  <>
                    <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{t.userDetail.labObservations}</div>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>{isZh ? '化验项目' : 'Biomarker'}</th>
                          <th>LOINC</th>
                          <th>{isZh ? '测定值' : 'Value'}</th>
                          <th>{isZh ? '单位' : 'Unit'}</th>
                          <th>{isZh ? '关联维度' : 'Dimension'}</th>
                          <th>{isZh ? '检测日期' : 'Date'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(reportDetail.events || []).map(ev => {
                          const obsName = isZh ? (bmLabelsZh[ev.data?.key_name] || ev.data?.key_name) : ev.data?.key_name;
                          const obsDimension = isZh ? (subAgeMetaZh[ev.data?.nano_dimension] || ev.data?.nano_dimension) : ev.data?.nano_dimension;
                          return (
                            <tr key={ev.id}>
                              <td style={{ fontWeight: ev.data?.is_kino_core ? 600 : 400, color: ev.data?.is_kino_core ? '#a5b4fc' : undefined }}>
                                {obsName || '—'}
                                {ev.data?.is_kino_core && <span style={{ marginLeft: 4, fontSize: 10, color: '#6366f1', fontWeight: 700 }}>{t.userDetail.coreBiomarker}</span>}
                              </td>
                              <td style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{ev.data?.loinc_code || '—'}</td>
                              <td style={{ fontWeight: 600 }}>{ev.data?.value}</td>
                              <td style={{ color: '#94a3b8', fontSize: 12 }}>{ev.data?.unit}</td>
                              <td style={{ fontSize: 11, color: '#64748b' }}>{obsDimension || '—'}</td>
                              <td style={{ fontSize: 11, color: '#94a3b8' }}>{ev.data_date}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                )}
                {!reportDetailLoading && (reportDetail.events || []).length === 0 && !reportDetail.report?.raw_data?.doctor_notes && !reportDetail.report?.raw_data?.diagnostics && !reportDetail.report?.raw_data?.doctor_advice && (
                  <div style={{ color: '#94a3b8', textAlign: 'center', padding: 24 }}>{t.userDetail.noObservations}</div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setSelectedReport(null)}>{t.userDetail.close}</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ── UserCreditModal ───────────────────────────────────────────────────────────

function UserCreditModal({ user, onClose }) {
  const { t, lang } = useLang();
  const uc = t.userCredit;
  const isZh = lang === 'zh';
  const [balance, setBalance] = useState(null);
  const [currency, setCurrency] = useState('');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/admin/users/${user.user_id}/credit-history`);
      setBalance(res.data.balance);
      setCurrency(res.data.currency || 'pts');
      setHistory(res.data.history || []);
    } catch (e) {
      setFormError(e.response?.data?.error || uc.error);
    } finally {
      setLoading(false);
    }
  }, [user.user_id, uc.error]);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit(e) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || amt === 0) { setFormError(isZh ? '请输入非零金额' : 'Amount must be non-zero'); return; }
    if (!note.trim()) { setFormError(isZh ? '备注不能为空' : 'Note is required'); return; }
    setFormError('');
    setSaving(true);
    try {
      await axios.post(`/api/admin/users/${user.user_id}/credit-adjustments`, { amount: amt, note: note.trim() });
      setAmount('');
      setNote('');
      await load();
    } catch (e) {
      setFormError(e.response?.data?.error || uc.error);
    } finally {
      setSaving(false);
    }
  }

  const typeLabel = (type) => uc.types[type] || type;
  const fmtDateLocal = (d) => d ? new Date(d).toLocaleString(isZh ? 'zh-CN' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '—';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{uc.title} — {user.nickname || user.user_id}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>{uc.loading}</div>
        ) : (
          <>
            <div style={{ padding: '12px 20px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{uc.balance}:</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: balance > 0 ? '#10b981' : balance < 0 ? '#ef4444' : 'var(--text)' }}>
                {Number(balance || 0).toFixed(2)} {currency}
              </span>
            </div>

            <div style={{ maxHeight: 260, overflowY: 'auto', borderBottom: '1px solid var(--border)' }}>
              {history.length === 0 ? (
                <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{uc.noHistory}</div>
              ) : (
                <table className="data-table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>{isZh ? '日期' : 'Date'}</th>
                      <th>{isZh ? '类型' : 'Type'}</th>
                      <th style={{ textAlign: 'right' }}>{isZh ? '金额' : 'Amount'}</th>
                      <th>{isZh ? '备注' : 'Note'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(row => (
                      <tr key={row.id}>
                        <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateLocal(row.created_at)}</td>
                        <td><Badge color={row.type === 'withdrawal' ? '#ef4444' : row.type === 'adjustment' ? '#8b5cf6' : '#10b981'}>{typeLabel(row.type)}</Badge></td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: Number(row.amount) >= 0 ? '#10b981' : '#ef4444' }}>
                          {Number(row.amount) >= 0 ? '+' : ''}{Number(row.amount).toFixed(2)}
                        </td>
                        <td className="muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <form onSubmit={handleSubmit} style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{uc.adjustTitle}</div>
              <div className="form-row">
                <label className="form-label">{uc.amount}</label>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder={isZh ? '例：100 或 -20' : 'e.g. 100 or -20'}
                  className="form-input"
                  style={{ width: '100%' }}
                />
              </div>
              <div className="form-row">
                <label className="form-label">{uc.note}</label>
                <input
                  type="text"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder={uc.notePlaceholder}
                  className="form-input"
                  style={{ width: '100%' }}
                />
              </div>
              {formError && <div style={{ fontSize: 12, color: '#ef4444' }}>{formError}</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button type="button" className="btn-secondary" onClick={onClose}>{isZh ? '取消' : 'Cancel'}</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? uc.saving : uc.submit}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ── ReferralNetworkTab ────────────────────────────────────────────────────────

function ReferralNetworkTab({ channels, session }) {
  const { t, lang } = useLang();
  const isZh = lang === 'zh';
  const isSuperadmin = session?.role === 'superadmin';
  const [channelId, setChannelId] = useState(isSuperadmin ? (channels[0]?.id || '') : session?.channelId || '');
  const [graphData, setGraphData] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(false);
  const [detailUser, setDetailUser] = useState(null);
  const containerRef = useRef(null);
  const [width, setWidth] = useState(900);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!channelId) return;
    setLoading(true);
    axios.get(`/api/channel-referral-network?channel_id=${channelId}`)
      .then(r => {
        if (!r.data.success) return;
        const targetSet = new Set((r.data.links || []).map(l => l.target));
        const sourceSet = new Set((r.data.links || []).map(l => l.source));
        setGraphData({
          nodes: (r.data.nodes || []).map(n => ({
            ...n,
            _isRoot: !targetSet.has(n.id),
            _hasOutgoing: sourceSet.has(n.id),
          })),
          links: r.data.links || [],
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [channelId]);

  const hasLinks = graphData.links.length > 0;
  const Dot = ({ color, round }) => (
    <span style={{
      display: 'inline-block', width: 12, height: 12, verticalAlign: 'middle',
      background: color, borderRadius: round ? '50%' : 3, marginRight: 5,
    }} />
  );

  return (
    <div ref={containerRef} style={{ padding: '12px 16px 24px' }}>
      {isSuperadmin && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <label style={{ fontSize: 13, color: 'var(--muted)' }}>Channel</label>
          <select value={channelId} onChange={e => setChannelId(e.target.value)}
            style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }}>
            <option value="">Select channel…</option>
            {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <span style={{ width: 18, height: 18, border: '2px solid var(--border)', borderTopColor: 'var(--primary)', borderRadius: '50%', display: 'inline-block', animation: 'spin 1s linear infinite' }} />
        </div>
      )}

      {!loading && channelId && !hasLinks && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)', fontSize: 14 }}>
          {t.userDetail.networkEmpty}
        </div>
      )}

      {!loading && hasLinks && (
        <>
          <div style={{ borderRadius: 8, overflow: 'hidden', background: 'var(--card)', border: '1px solid var(--border)' }}>
            <ForceGraph2D
              graphData={graphData}
              width={width - 32}
              height={600}
              backgroundColor="transparent"
              nodeLabel={n => `${n.nickname || n.id}${n.referral_code ? ` · ${n.referral_code}` : ''}`}
              linkColor={l => l.type === 'referral' ? '#10b981' : l.type === 'invitation' ? '#8b5cf6' : '#f97316'}
              linkWidth={1.5}
              linkDirectionalArrowLength={6}
              linkDirectionalArrowRelPos={1}
              onNodeClick={node => setDetailUser(node)}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const isExt = node._isExternal;
                const r = isExt ? 6 : node._isRoot ? 8 : 5;
                const color = isExt ? '#ef4444' : node._isRoot ? '#f59e0b' : node._hasOutgoing ? '#6366f1' : '#64748b';
                ctx.beginPath();
                ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
                ctx.fillStyle = color;
                ctx.fill();
                if (isExt) {
                  ctx.strokeStyle = '#fff';
                  ctx.lineWidth = 1.5;
                  ctx.stroke();
                }
                const label = (node.nickname || node.id || '').slice(0, 12);
                const fontSize = Math.max(11 / globalScale, 2);
                ctx.font = `${isExt ? 'bold ' : ''}${fontSize}px Sans-Serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillStyle = isExt ? 'rgba(239,68,68,0.9)' : 'rgba(148,163,184,0.9)';
                ctx.fillText(label, node.x, node.y + r + 2);
              }}
              nodePointerAreaPaint={(node, color, ctx) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x, node.y, node._isExternal ? 6 : (node._isRoot ? 8 : 5), 0, 2 * Math.PI, false);
                ctx.fill();
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 20, marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
            <span><Dot color="#10b981" />{t.userDetail.networkLegendReferral}</span>
            <span><Dot color="#8b5cf6" />{t.userDetail.networkLegendInvite}</span>
            <span><Dot color="#f59e0b" round />{t.userDetail.networkLegendRoot}</span>
            <span><Dot color="#6366f1" round />{isZh ? '有推荐下级' : 'Has referrals'}</span>
            <span><Dot color="#f97316" />{isZh ? '分配教练' : 'Assigned coach'}</span>
            <span><Dot color="#ef4444" round />{isZh ? '外部教练节点' : 'External coach node'}</span>
          </div>
        </>
      )}

      {detailUser && <UserDetailModal user={detailUser} onClose={() => setDetailUser(null)} />}
    </div>
  );
}

// ── UsersTab ──────────────────────────────────────────────────────────────────

function UsersTab({ users, coaches, channels, session, isCmsAdmin, onRefresh }) {
  const { t, lang } = useLang();
  const [subTab, setSubTab] = useState('list');
  const [modal, setModal] = useState(null);
  const [detailUser, setDetailUser] = useState(null);
  const [loadedUsers, setLoadedUsers] = useState([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [tested, setTested] = useState(0);
  const [avgBioAge, setAvgBioAge] = useState('—');
  const [maleCount, setMaleCount] = useState(0);
  const [femaleCount, setFemaleCount] = useState(0);
  const [newUsers7d, setNewUsers7d] = useState(0);
  const [maleCoachCount, setMaleCoachCount] = useState(0);
  const [femaleCoachCount, setFemaleCoachCount] = useState(0);
  const [newCoaches7d, setNewCoaches7d] = useState(0);
  const [coachTotal, setCoachTotal] = useState(0);
  const [scansTotal, setScansTotal] = useState(0);
  const [scans7d, setScans7d] = useState(0);
  const [scans14d, setScans14d] = useState(0);
  const [scans30d, setScans30d] = useState(0);
  const [bioAgeDelta, setBioAgeDelta] = useState(null);
  const [tabLoading, setTabLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [sortField, setSortField] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [includeSubchannels, setIncludeSubchannels] = useState(true);

  const loaderRef = useRef(null);
  const abortRef = useRef(null);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setSearchQuery(searchInput);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchInput]);

  const loadUsers = useCallback((currentOffset, append = false) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setTabLoading(true);
    const cid = session?.channelId;
    const isChannel = session?.role === 'channel';
    const baseUrl = isChannel ? `/api/channel-users/${cid}` : '/api/users';

    const params = {
      limit: 50,
      offset: currentOffset,
      q: searchQuery.trim(),
      sort_field: sortField,
      sort_dir: sortDir,
    };

    if (isChannel) {
      if (includeSubchannels) {
        params.include_subchannels = 'true';
      }
    } else {
      if (channelFilter) {
        params.filter_channel_id = channelFilter;
      }
    }

    axios.get(baseUrl, { params, signal: abortRef.current.signal })
      .then(res => {
        if (res.data.success) {
          const fetchedUsers = res.data.users || [];
          setLoadedUsers(prev => append ? [...prev, ...fetchedUsers] : fetchedUsers);
          setTotal(res.data.total || 0);
          setTested(res.data.tested || 0);
          setAvgBioAge(res.data.avgBioAge || '—');
          if (!append) {
            setMaleCount(res.data.maleCount || 0);
            setFemaleCount(res.data.femaleCount || 0);
            setNewUsers7d(res.data.newUsers7d || 0);
            setMaleCoachCount(res.data.maleCoachCount || 0);
            setFemaleCoachCount(res.data.femaleCoachCount || 0);
            setNewCoaches7d(res.data.newCoaches7d || 0);
            setCoachTotal(res.data.coachTotal || 0);
            setScansTotal(res.data.scansTotal || 0);
            setScans7d(res.data.scans7d || 0);
            setScans14d(res.data.scans14d || 0);
            setScans30d(res.data.scans30d || 0);
            setBioAgeDelta(res.data.bioAgeDelta || null);
          }
        }
      })
      .catch(err => {
        if (axios.isCancel(err)) return;
        console.error('Failed to load users:', err);
      })
      .finally(() => {
        setTabLoading(false);
      });
  }, [session, searchQuery, sortField, sortDir, includeSubchannels, channelFilter]);

  // Reload when filters/sorting changes
  useEffect(() => {
    setOffset(0);
    loadUsers(0, false);
  }, [searchQuery, channelFilter, sortField, sortDir, includeSubchannels, loadUsers]);

  // Load more pagination helper
  const handleLoadMore = useCallback(() => {
    if (tabLoading || loadedUsers.length >= total) return;
    const nextOffset = offset + 50;
    setOffset(nextOffset);
    loadUsers(nextOffset, true);
  }, [offset, tabLoading, loadedUsers.length, total, loadUsers]);

  // Infinite scroll trigger using IntersectionObserver
  useEffect(() => {
    if (loadedUsers.length >= total || tabLoading) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        handleLoadMore();
      }
    }, {
      root: null,
      rootMargin: '150px',
      threshold: 0.1,
    });

    const currentLoader = loaderRef.current;
    if (currentLoader) {
      observer.observe(currentLoader);
    }

    return () => {
      if (currentLoader) {
        observer.unobserve(currentLoader);
      }
    };
  }, [loadedUsers.length, total, tabLoading, handleLoadMore]);

  // Refresh current view in-place (preserves pagination scroll)
  const refreshCurrentView = useCallback(() => {
    onRefresh();
    setTabLoading(true);
    const cid = session?.channelId;
    const isChannel = session?.role === 'channel';
    const baseUrl = isChannel ? `/api/channel-users/${cid}` : '/api/users';

    const params = {
      limit: offset + 50,
      offset: 0,
      q: searchQuery.trim(),
      sort_field: sortField,
      sort_dir: sortDir,
    };

    if (isChannel) {
      if (includeSubchannels) {
        params.include_subchannels = 'true';
      }
    } else {
      if (channelFilter) {
        params.filter_channel_id = channelFilter;
      }
    }

    axios.get(baseUrl, { params })
      .then(res => {
        if (res.data.success) {
          setLoadedUsers(res.data.users || []);
          setTotal(res.data.total || 0);
          setTested(res.data.tested || 0);
          setAvgBioAge(res.data.avgBioAge || '—');
          setMaleCount(res.data.maleCount || 0);
          setFemaleCount(res.data.femaleCount || 0);
          setNewUsers7d(res.data.newUsers7d || 0);
          setMaleCoachCount(res.data.maleCoachCount || 0);
          setFemaleCoachCount(res.data.femaleCoachCount || 0);
          setNewCoaches7d(res.data.newCoaches7d || 0);
          setCoachTotal(res.data.coachTotal || 0);
          setScansTotal(res.data.scansTotal || 0);
          setScans7d(res.data.scans7d || 0);
          setScans14d(res.data.scans14d || 0);
          setScans30d(res.data.scans30d || 0);
          setBioAgeDelta(res.data.bioAgeDelta || null);
        }
      })
      .catch(err => {
        console.error('Failed to refresh users:', err);
      })
      .finally(() => {
        setTabLoading(false);
      });
  }, [session, searchQuery, sortField, sortDir, includeSubchannels, channelFilter, offset, onRefresh]);

  const closeAndRefresh = () => {
    setModal(null);
    refreshCurrentView();
  };

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }) => (
    <span style={{ marginLeft: 4, opacity: sortField === field ? 1 : 0.3, color: sortField === field ? 'var(--primary)' : 'inherit' }}>
      {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );

  const isZh = t.count(1).includes('共');

  return (
    <>
      <div className="stat-row">
        <RichStatCard icon={Users} label={t.stats.totalUsers} value={total} color="#3b82f6" subs={[
          { label: t.stats.male, value: maleCount },
          { label: t.stats.female, value: femaleCount },
          { label: t.stats.new7d, value: newUsers7d, highlight: true },
        ]} />
        <RichStatCard icon={UserCog} label={t.stats.coaches} value={coachTotal || coaches.length} color="#10b981" subs={[
          { label: t.stats.male, value: maleCoachCount },
          { label: t.stats.female, value: femaleCoachCount },
          { label: t.stats.new7d, value: newCoaches7d, highlight: true },
        ]} />
        <RichStatCard icon={Activity} label={t.stats.tested} value={scansTotal || tested} color="#8b5cf6" subs={[
          { label: t.stats.days7, value: scans7d },
          { label: t.stats.days14, value: scans14d },
          { label: t.stats.days30, value: scans30d },
        ]} />
        <RichStatCard icon={Calendar} label={t.stats.avgBioAge} value={avgBioAge} color="#f59e0b" subs={
          bioAgeDelta != null ? [{
            label: parseFloat(bioAgeDelta) >= 0 ? t.stats.aboveChrono : t.stats.belowChrono,
            value: `${Math.abs(parseFloat(bioAgeDelta)).toFixed(1)}${isZh ? '岁' : 'y'}`,
            highlight: Math.abs(parseFloat(bioAgeDelta)) > 2,
          }] : []
        } />
      </div>
      <div className="card">
        <div className="subtab-row">
          <button className={`subtab-btn${subTab === 'list' ? ' active' : ''}`} onClick={() => setSubTab('list')}>
            <Users size={13} />{lang === 'zh' ? '用户列表' : 'List'}
          </button>
          <button className={`subtab-btn${subTab === 'network' ? ' active' : ''}`} onClick={() => setSubTab('network')}>
            <Activity size={13} />{t.userDetail.networkTab}
          </button>
        </div>

        {subTab === 'network' && <ReferralNetworkTab channels={channels} session={session} />}

        {subTab === 'list' && <><div className="table-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="table-count">
              {(searchQuery || channelFilter || includeSubchannels)
                ? (isZh ? `已加载 ${loadedUsers.length} / 共 ${total} 个用户` : `Loaded ${loadedUsers.length} / ${total} users`)
                : t.count(total)}
            </span>
            <input
              className="toolbar-search"
              type="text"
              placeholder={t.searchUsers}
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
            />
            {isCmsAdmin && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={includeSubchannels} onChange={e => setIncludeSubchannels(e.target.checked)} />
                Include sub-channels
              </label>
            )}
          </div>
          {hasPermission(session, PERMS.USERS_WRITE) && (
            <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
              <Plus size={14} />{t.addUser}
            </button>
          )}
        </div>
        {channels.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
            {channels.map(c => {
              const active = channelFilter === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setChannelFilter(active ? '' : c.id)}
                  style={{
                    padding: '3px 10px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
                    border: `1px solid ${active ? '#6366f1' : 'var(--border)'}`,
                    background: active ? '#6366f1' : 'transparent',
                    color: active ? '#fff' : 'var(--muted)',
                    fontWeight: active ? 600 : 400,
                    transition: 'all 0.15s',
                  }}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        )}
        <table className="data-table">
          <thead>
            <tr>
              <th className="sortable-th" onClick={() => toggleSort('user_id')}>{t.table.id}<SortIcon field="user_id" /></th>
              <th className="sortable-th" onClick={() => toggleSort('nickname')}>{t.table.nickname}<SortIcon field="nickname" /></th>
              <th className="sortable-th" onClick={() => toggleSort('channel_name')}>{t.table.channel}<SortIcon field="channel_name" /></th>
              <th>{t.table.roles}</th>
              <th>{t.table.gender}</th>
              <th className="sortable-th" onClick={() => toggleSort('birth_date')}>{t.table.birthDate}<SortIcon field="birth_date" /></th>
              <th>{t.table.language}</th>
              <th className="sortable-th" onClick={() => toggleSort('chrono_age')}>{t.table.chronoAge}<SortIcon field="chrono_age" /></th>
              <th className="sortable-th" onClick={() => toggleSort('bio_age')}>{t.table.bioAge}<SortIcon field="bio_age" /></th>
              <th>{t.table.assignedCoach}</th>
              <th className="sortable-th" onClick={() => toggleSort('created_at')}>{t.table.joined}<SortIcon field="created_at" /></th>
              <th>{t.modal.phone}</th><th>{t.modal.email}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {loadedUsers.length === 0 && (
              <tr>
                <td colSpan={14} className="empty-row">
                  {tabLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '20px 0' }}>
                      <span style={{ width: 14, height: 14, border: '2px solid var(--border)', borderTopColor: 'var(--primary)', borderRadius: '50%', display: 'inline-block', animation: 'spin 1s linear infinite' }} />
                      <span>{isZh ? '正在加载用户数据...' : 'Loading user data...'}</span>
                    </div>
                  ) : t.empty.users}
                </td>
              </tr>
            )}
            {loadedUsers.map(u => (
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
                <td className="muted">{fmt(u.chrono_age)}</td>
                <td style={{ fontWeight: 700, color: bioAgeColor(u.bio_age, u.chrono_age) }}>{fmt(u.bio_age)}</td>
                <td onClick={e => e.stopPropagation()}>
                  <CoachSelect userId={u.user_id} currentCoachId={u.coach_id} coaches={coaches} onAssign={refreshCurrentView} />
                </td>
                <td className="muted">{fmtDate(u.created_at)}</td>
                <td className="muted">{fmt(u.phone)}</td>
                <td className="muted">{fmt(u.email)}</td>
                <td onClick={e => e.stopPropagation()}>
                  <div className="row-actions">
                    <button className="icon-btn" title={isZh ? '积分管理' : 'Manage Credits'} onClick={() => setModal({ type: 'credits', user: u })}><Coins size={14} /></button>
                    {hasPermission(session, PERMS.USERS_WRITE) && <button className="icon-btn" title={t.modal.editUser} onClick={() => setModal({ type: 'edit', user: u })}><Pencil size={14} /></button>}
                    {hasPermission(session, PERMS.USERS_DELETE) && <button className="icon-btn danger" title={t.modal.deleteUser} onClick={() => setModal({ type: 'delete', user: u })}><Trash2 size={14} /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loadedUsers.length < total && (
          <div
            ref={loaderRef}
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '24px 0',
              borderTop: '1px solid var(--border)',
              alignItems: 'center'
            }}
          >
            {tabLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  width: 14,
                  height: 14,
                  border: '2px solid var(--border)',
                  borderTopColor: 'var(--primary)',
                  borderRadius: '50%',
                  display: 'inline-block',
                  animation: 'spin 1s linear infinite'
                }} />
                <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
                  {isZh ? '正在加载更多用户...' : 'Loading more users...'}
                </span>
              </div>
            ) : (
              <span style={{ fontSize: '13px', color: 'var(--muted)', opacity: 0.5 }}>
                {isZh ? '向下滚动自动加载' : 'Scroll down to load more'}
              </span>
            )}
          </div>
        )}
      </>}
      </div>
      {modal?.type === 'add'     && <UserModal user={null}       coaches={coaches} channels={channels} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit'    && <UserModal user={modal.user} coaches={coaches} channels={channels} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete'  && <DeleteConfirm user={modal.user} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
      {modal?.type === 'credits' && <UserCreditModal user={modal.user} onClose={() => setModal(null)} />}
      {detailUser && <UserDetailModal user={detailUser} onClose={() => setDetailUser(null)} />}
    </>
  );
}

export { UsersTab };
