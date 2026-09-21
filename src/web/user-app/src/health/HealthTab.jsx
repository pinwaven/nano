// The 健康 tab — components/user-health (mode 'self'). Subtab strip (数字孪生 | Viva AG) when the
// AG add-on is live; the twin view mirrors user-health.wxml section for section: hero + avatar
// pills, edit-profile form, the four-layer completeness strip, the Kino-gated twin hero card
// (body figure + BioAge chart + sub-ages), cross-layer strips, 综合报告, Daily Monitoring
// (wearable card — read-only on the web — ring summary and charts), Precision Testing, Medical
// Records (lab snapshot, reports, food IgG), Personal Profile facts, 健康文档; then the report
// detail sheet and the chart modals.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, q } from '../api.js';
import { useApp } from '../store/AppContext.jsx';
import { themeColor } from '../theme.js';
import { ui } from '../components/ui/ui.js';
import mood from '@mini/mood.js';
import { useHealthData } from './useHealthData.js';
import { CONDITION_KEYS, SUB_AGE_META, chronoAge, fmtDate, bioAgeColor, _statusFor, _refTextFor, _reportTypeColor } from './helpers.js';
import { drawBioAgeChart, drawWeightFullChart, drawGenericChart, drawBpChart } from './charts.js';
import ChartCanvas from './ChartCanvas.jsx';
import HealthDocuments from './HealthDocuments.jsx';
import VivaAgPanel from './VivaAgPanel.jsx';

const { AVATAR_GALLERY, resolveAvatarUrl, DEFAULT_MOOD } = mood;
const HALO_INTERVAL_OPTS = { hr: [5, 10, 15, 30], spo2: [5, 15, 30, 60], temp: [15, 30, 60], hrv: [30, 60, 120] };
const HALO_INTERVAL_DEFAULTS = { hr: 10, spo2: 30, temp: 30, hrv: 60 };

function Pulse() { return <div className="center-wrap"><div className="pulse-dot" /><div className="pulse-dot" /><div className="pulse-dot" /></div>; }

function ChartSheet({ title, onClose, children }) {
  return (
    <div className="wchart-overlay" onClick={onClose}>
      <div className="wchart-sheet" onClick={e => e.stopPropagation()}>
        <div className="wchart-handle" />
        <div className="wchart-header"><span className="wchart-title">{title}</span><div className="wchart-close" onClick={onClose}><span>✕</span></div></div>
        {children}
      </div>
    </div>
  );
}

export default function HealthTab({ visible, onGuestTap }) {
  const app = useApp();
  const { user, lang, t: T, theme, isGuest, vivaAgActive, saveUser, updateUser, on, emit } = app;
  const t = T.health;
  const isZh = lang !== 'en';
  const tc = hex => themeColor(hex, theme);
  const userId = user?.user_id;
  const [subTab, setSubTab] = useState('twin');
  const showAgTab = !!vivaAgActive && !isGuest;
  const h = useHealthData({ userId: isGuest ? null : userId, user, lang, t });
  const { d } = h;
  const rootRef = useRef(null);
  const [frameW, setFrameW] = useState(390);
  useEffect(() => { const el = rootRef.current; if (!el) return; const ro = new ResizeObserver(() => setFrameW(el.clientWidth || 390)); ro.observe(el); return () => ro.disconnect(); }, []);
  const chartW = frameW - 72;

  useEffect(() => on('health:refresh', () => h.loadHealth()), [on, h.loadHealth]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => on('tab:switch', tab => { if (tab === 'health') h.refreshIfStale(30000); }), [on, h.refreshIfStale]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!showAgTab && subTab !== 'twin') setSubTab('twin'); }, [showAgTab, subTab]);

  // ── avatar ───────────────────────────────────────────────────────────────
  const [pillsVisible, setPillsVisible] = useState(false);
  const pillTimer = useRef(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [avatarUpdating, setAvatarUpdating] = useState(false);
  const onAvatarTap = () => { clearTimeout(pillTimer.current); setPillsVisible(true); pillTimer.current = setTimeout(() => setPillsVisible(false), 5000); };
  const chooseAvatar = async avatarId => {
    setPickerOpen(false);
    const url = avatarId ? resolveAvatarUrl(avatarId, DEFAULT_MOOD) : null;
    if (!url) return;
    setAvatarUpdating(true);
    try { await saveUser({ avatar_url: url, avatar_character: avatarId }); updateUser({ avatar_url: url, avatar_character: avatarId }); } catch { /* ignore */ }
    setAvatarUpdating(false);
  };
  const avatarLetter = (user?.nickname || 'U').slice(-1).toUpperCase();

  // ── edit profile (startEdit / saveEdit) ──────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [form, setForm] = useState(null);
  const startEdit = () => {
    clearTimeout(pillTimer.current); setPillsVisible(false);
    const bio = user?.bio_data || {};
    const cur = bio.health_conditions || [];
    setForm({ nickname: user?.nickname || '', gender: user?.gender || '', birth_date: user?.birth_date ? String(user.birth_date).substring(0, 10) : '',
      height: (d.rawHeight ?? bio.height) != null ? String(d.rawHeight ?? bio.height) : '', weight: (d.rawWeight ?? bio.weight) != null ? String(d.rawWeight ?? bio.weight) : '',
      health_conditions: [...cur], health_conditions_other: bio.health_conditions_other || '' });
    setEditing(true);
  };
  const saveEdit = async () => {
    if (editSaving || !form) return;
    setEditSaving(true);
    try {
      const { nickname, gender, birth_date, height, weight, health_conditions, health_conditions_other } = form;
      const bio_data_update = { health_conditions, health_conditions_other: health_conditions_other || '' };
      if (height !== '' && height != null) bio_data_update.height = Number(height);
      if (weight !== '' && weight != null) bio_data_update.weight = Number(weight);
      // Deliberately omits phone/email/language/coach_id (see the miniapp's saveEdit comment).
      await api.put(`/users/${q(user.user_id)}`, { nickname, gender, birth_date, bio_data: bio_data_update });
      const newBioData = { ...(user.bio_data || {}), ...bio_data_update };
      updateUser({ nickname, gender, birth_date, bio_data: newBioData });
      const hVal = height !== '' ? Number(height) : (newBioData.height ?? null);
      const wVal = weight !== '' ? Number(weight) : (newBioData.weight ?? null);
      const cAge = chronoAge(birth_date);
      h.patch({ cAge, bAgeColor: bioAgeColor(d.bAge, cAge), rawHeight: hVal, rawWeight: wVal, rawBmi: hVal && wVal ? Number((wVal / Math.pow(hVal / 100, 2)).toFixed(1)) : null, hasConditionsData: true,
        healthConditionsList: health_conditions.map(key => ({ key, label: key === 'other' && health_conditions_other ? `${t.conditionLabels[key]}（${health_conditions_other}）` : (t.conditionLabels[key] || key) })) });
      h.recomputeTwinLayers();
      setEditing(false);
      ui.toast(t.saveOk);
    } catch { ui.toast(t.saveFail); }
    setEditSaving(false);
  };

  // ── charts / modals ──────────────────────────────────────────────────────
  const [bioAgeOpen, setBioAgeOpen] = useState(false);
  const [flashSubAge, setFlashSubAge] = useState('');
  const [modal, setModal] = useState(null); // { kind, key?, title, unit?, color?, history?, valKey? }
  const openGeneric = (kind, history, valKey, unit, color, title) => { if (history.length > 1) setModal({ kind, history, valKey, unit, color, title }); };
  const openSubAge = key => { const history = d.subAgeHistory[key] || []; if (history.length < 2) return; const meta = SUB_AGE_META.find(m => m.key === key); setModal({ kind: 'generic', history, valKey: 'value', unit: '', color: meta ? meta.color : '#6375EC', title: T.subAgeLabels[key] }); };
  const openLab = key => { const series = (d.labSeries || {})[key]; const points = series ? series.points || [] : []; if (points.length < 2) return; setModal({ kind: 'generic', history: points, valKey: 'value', unit: series.unit || '', color: '#0ea5e9', title: `${isZh ? (series.display_name_zh || key) : (series.display_name || key)}${series.unit ? ` (${series.unit})` : ''}` }); };

  // ── reports ──────────────────────────────────────────────────────────────
  const [activeReport, setActiveReport] = useState(null);
  const openReport = async id => {
    setActiveReport({ id, loading: true });
    try {
      const res = await api.get(`/health-reports/${id}?openid=${q(userId)}`);
      const report = res?.report || {}; const events = res?.events || []; const items = res?.items || [];
      const raw = report.raw_data || {};
      const statusRow = status => ({ status, statusLabel: status === 'high' ? t.rptHigh : status === 'low' ? t.rptLow : t.rptNormal, statusColor: status === 'high' ? '#ef4444' : status === 'low' ? '#0ea5e9' : '#10b981' });
      const mapped = items.filter(i => i.key_name);
      const enriched = (mapped.length > 0 ? mapped : events).map(row => {
        const x = row.data || row; const key = x.key_name;
        const v = x.value_num != null ? Number(x.value_num) : (x.value != null ? Number(x.value) : null);
        const info = { ref_low: row.ref_low, ref_high: row.ref_high };
        const status = row.flag === 'high' || row.flag === 'low' ? row.flag : _statusFor(key, v, info);
        return { key_name: (isZh ? (row.display_name_zh || x.label) : (row.display_name || x.label)) || key || '—', value: v != null ? String(v) : (x.value_text || '—'), unit: x.unit || '', ...statusRow(status), refText: row.ref_text || _refTextFor(key, info, x.unit) };
      });
      const otherItems = items.filter(i => !i.key_name).map(i => ({
        key_name: i.section ? `${i.section} · ${i.label}` : i.label, value: i.value_num != null ? String(Number(i.value_num)) : (i.value_text || '—'), unit: i.unit || '',
        ...statusRow(i.flag === 'high' || i.flag === 'low' ? i.flag : 'normal'), flagged: i.flag === 'high' || i.flag === 'low', refText: i.ref_text || '',
        suggested: i.suggested_key ? `${t.rptMaybe} ${lang === 'en' ? (i.suggested_name || i.suggested_name_zh || i.suggested_key) : (i.suggested_name_zh || i.suggested_name || i.suggested_key)}` : '',
      }));
      const dn = raw.doctor_notes || null;
      const doctorNotes = dn ? { physician: dn.physician || '', department: dn.department || '', vitals: dn.vital_summary ? Object.entries(dn.vital_summary).map(([k, v]) => ({ key: k, value: String(v) })) : [], clinical_summary: dn.clinical_summary || '', recommendations: Array.isArray(dn.recommendations) ? dn.recommendations : [], follow_up: dn.follow_up || '' } : null;
      setActiveReport({
        id, loading: false, institution: report.institution || '—', report_date: fmtDate(report.report_date, lang), report_type: t.reportTypeLabels[report.report_type] || report.report_type,
        type_color: _reportTypeColor(report.report_type), image_url: raw.image_url || '', hasDiag: Array.isArray(raw.diagnostics) && raw.diagnostics.length > 0, hasAdvice: Array.isArray(raw.doctor_advice) && raw.doctor_advice.length > 0,
        hasDoctorNotes: !!doctorNotes, events: enriched, otherItems, diag: raw.diagnostics || [], advice: raw.doctor_advice || [], doctorNotes,
      });
    } catch { setActiveReport(r => (r ? { ...r, loading: false } : null)); }
  };

  // ── twin reports ─────────────────────────────────────────────────────────
  const [reportOpening, setReportOpening] = useState(false);
  const openTwinReport = async (jobUid, index) => {
    if (reportOpening || !jobUid) return;
    setReportOpening(true);
    const win = window.open('', '_blank');
    try {
      const res = await api.get(`/twin-reports/file?openid=${q(userId)}&job_uid=${q(jobUid)}&index=${Number(index) || 0}`);
      if (!res?.success) throw new Error(res?.reason || 'no url');
      if (win) win.location.href = res.url; else window.open(res.url, '_blank');
    } catch { win?.close(); ui.toast(t.reportsErrOpen); }
    setReportOpening(false);
  };
  const twinReportList = async () => {
    const reports = d.twinReports; if (!reports.length) return;
    try { const r = await ui.actionSheet({ itemList: reports.slice(0, 6).map(x => `${x.completed_date} · ${x.title}`) }); const x = reports[r.tapIndex]; if (x) openTwinReport(x.job_uid, x.primary_index); } catch { /* cancel */ }
  };

  // ── wearable (read-only on the web) ──────────────────────────────────────
  const [ringSettingsOpen, setRingSettingsOpen] = useState(false);
  const wearableNotice = () => ui.confirm({ title: '', content: T.wearableWebNotice, showCancel: false });
  const hint = d.wearableServerHint;
  const wearableBound = !!hint || !!d.ringData;
  const wearableName = hint?.name || (hint?.brand === 'halo' ? 'Halo Ring' : hint?.brand === 'v8' ? 'V8 Band' : hint?.brand === 'aizo' ? 'Aizo Ring' : hint?.brand ? 'Colmi Ring' : '');
  const brand = hint?.brand === 'x3' ? 'halo' : hint?.brand;
  const ecgWhen = (iso) => {
    const dt = new Date(iso); if (isNaN(dt)) return '';
    const now = new Date(); const same = (a, b) => a.toDateString() === b.toDateString();
    const hm = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    if (now - dt < 5 * 60 * 1000) return t.ecgJustNow;
    if (same(dt, now)) return `${t.ecgToday} ${hm}`;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (same(dt, y)) return `${t.ecgYesterday} ${hm}`;
    return `${dt.getMonth() + 1}/${dt.getDate()} ${hm}`;
  };
  const rd = d.ringData;
  const sa = d.subAgeZ;
  const zoneStyle = key => sa[key] ? { background: sa[key].fill, boxShadow: `0 0 ${sa[key].glow}px ${sa[key].color}`, borderColor: `${tc(sa[key].color)}88` } : {};
  const pulseCls = key => (sa[key]?.pulse ? ' dt-fig-pulse' : '');
  const onZoneTap = key => { if (!key || bioAgeOpen) return; setFlashSubAge(key); setTimeout(() => setFlashSubAge(''), 1400); };
  const avatarUrl = h.avatarDisplayUrl || user?.avatar_url;

  if (isGuest) {
    return (
      <div className="health-tab uh-root" ref={rootRef}>
        <div className="health-scroll uh-scroll">
          <div className="guest-lock-card" onClick={onGuestTap}><span className="guest-lock-icon">🔬</span><span className="guest-lock-title">{t.guestHealthCta}</span><div className="guest-lock-btn"><span>{t.guestJoinBtn}</span></div></div>
        </div>
      </div>
    );
  }

  return (
    <div className="health-tab uh-root" ref={rootRef}>
      {showAgTab && (
        <div className="uh-tab-bar">
          <div className={`uh-tab${subTab === 'twin' ? ' uh-tab-active' : ''}`} onClick={() => setSubTab('twin')}><span className="uh-tab-text">{t.agTabTwin}</span></div>
          <div className={`uh-tab${subTab === 'ag' ? ' uh-tab-active' : ''}`} onClick={() => setSubTab('ag')}><span className="uh-tab-text">{t.agTabAg}</span></div>
        </div>
      )}
      {(!showAgTab || subTab === 'twin') && (
        <div className="health-scroll uh-scroll">
          {d.bioLoading ? <Pulse /> : (
            <>
              <div className="health-hero">
                <div className="health-hero-bg" />
                <div className="avatar-area">
                  {!editing && <div className={`avatar-side-pill${pillsVisible ? ' avatar-pill-show' : ''}`} onClick={e => { e.stopPropagation(); setPillsVisible(false); setPickerOpen(true); }}><span className="avatar-pill-text">{t.changeAvatar}</span></div>}
                  <div className="health-avatar-container" onClick={onAvatarTap}>
                    <div className="health-avatar-wrap">{avatarUrl ? <img className="health-avatar-img" src={avatarUrl} alt="" /> : <div className="health-avatar-placeholder"><span className="health-avatar-letter">{avatarLetter}</span></div>}</div>
                    {avatarUpdating && <div className="health-avatar-ring" />}
                  </div>
                  {!editing && <div className={`avatar-side-pill${pillsVisible ? ' avatar-pill-show' : ''}`} onClick={e => { e.stopPropagation(); startEdit(); }}><span className="avatar-pill-text">✎  {t.editProfile}</span></div>}
                </div>
              </div>

              {pickerOpen && (
                <div className="ap-overlay" onClick={() => setPickerOpen(false)}>
                  <div className="ap-sheet" onClick={e => e.stopPropagation()}>
                    <div className="ap-header"><span className="ap-title">{isZh ? '选择头像' : 'Choose an Avatar'}</span><div className="ap-close" onClick={() => setPickerOpen(false)}><span className="ap-close-icon">✕</span></div></div>
                    <div className="ap-grid-scroll uh-scroll"><div className="ap-grid">
                      {/* An applied generated set (miniapp-only upload flow, avatar-gallery.md §6) stays selectable here; re-picking it is a no-op. */}
                      {user?.avatar_moods && (user.avatar_moods.thumb || user.avatar_moods[DEFAULT_MOOD]) && <div className={`ap-item${user?.avatar_character === 'custom' ? ' ap-item-selected' : ''}`} onClick={() => setPickerOpen(false)}><img className="ap-item-img" src={user.avatar_moods.thumb || user.avatar_moods[DEFAULT_MOOD]} alt="" /></div>}
                      {AVATAR_GALLERY.map(item => <div key={item.id} className={`ap-item${item.id === user?.avatar_character ? ' ap-item-selected' : ''}`} onClick={() => chooseAvatar(item.id)}><img className="ap-item-img" src={item.thumb} alt="" /></div>)}
                    </div></div>
                  </div>
                </div>
              )}

              {editing && form && (
                <div className="health-section"><div className="edit-form">
                  <div className="edit-row"><span className="edit-label">{t.name}</span><input className="edit-input" value={form.nickname} onChange={e => setForm(f => ({ ...f, nickname: e.target.value }))} placeholder="—" /></div>
                  <div className="edit-row"><span className="edit-label">{t.gender}</span><div className="gender-btns">
                    {['male', 'female'].map(g => <div key={g} className={`gender-btn${form.gender === g ? ' gender-btn-active' : ''}`} onClick={() => setForm(f => ({ ...f, gender: g }))}><span>{t.genderMap[g]}</span></div>)}
                  </div></div>
                  <div className="edit-row"><span className="edit-label">{t.born}</span><div className="edit-picker"><input type="date" className="edit-picker-val picker-native" value={form.birth_date} onChange={e => setForm(f => ({ ...f, birth_date: e.target.value }))} /></div></div>
                  <div className="edit-row"><span className="edit-label">{t.height}</span><div className="edit-input-unit"><input className="edit-input" inputMode="decimal" value={form.height} onChange={e => setForm(f => ({ ...f, height: e.target.value }))} placeholder="—" /><span className="edit-unit-text">cm</span></div></div>
                  <div className="edit-row"><span className="edit-label">{t.weight}</span><div className="edit-input-unit"><input className="edit-input" inputMode="decimal" value={form.weight} onChange={e => setForm(f => ({ ...f, weight: e.target.value }))} placeholder="—" /><span className="edit-unit-text">kg</span></div></div>
                  <span className="edit-section-label">{t.healthConditions}</span>
                  <div className="edit-cond-list">
                    {CONDITION_KEYS.map(key => { const checked = form.health_conditions.includes(key); return (
                      <div key={key} className="edit-cond-item" onClick={() => setForm(f => ({ ...f, health_conditions: checked ? f.health_conditions.filter(k => k !== key) : [...f.health_conditions, key] }))}>
                        <div className={`edit-cond-box${checked ? ' edit-cond-box-checked' : ''}`}>{checked && <span className="edit-cond-tick">✓</span>}</div><span className="edit-cond-text">{t.conditionLabels[key] || key}</span>
                      </div>); })}
                  </div>
                  {form.health_conditions.includes('other') && <div className="edit-other-row"><input className="edit-input" value={form.health_conditions_other} onChange={e => setForm(f => ({ ...f, health_conditions_other: e.target.value }))} placeholder={t.otherPlaceholder} /></div>}
                  <div className="edit-actions"><div className="edit-cancel-btn" onClick={() => setEditing(false)}><span>{t.cancel}</span></div><div className="edit-save-btn" onClick={saveEdit}><span>{editSaving ? '…' : t.save}</span></div></div>
                </div></div>
              )}

              <div className="twin-umbrella">
                <div className="twin-umbrella-row"><span className="twin-umbrella-title">{t.digitalTwin}</span><span className="twin-umbrella-count">{t.twinComplete} {d.twinLayersDone}/4</span></div>
                <div className="twin-layer-strip">
                  {d.twinLayers.map(l => <div key={l.key} className={`twin-layer${l.hasData ? ' twin-layer-active' : ''}`}><div className="twin-layer-dot" /><span className="twin-layer-label">{l.label}</span><span className="twin-layer-date">{l.hasData ? (l.lastDate || '✓') : l.emptyLabel}</span></div>)}
                </div>
              </div>

              {d.subAgeList.length > 0 && (
                <div className="dt-hero-card" onClick={() => bioAgeOpen && setBioAgeOpen(false)}>
                  <div className="dt-body-row">
                    <div className="dt-fig-col"><div className="dt-body-fig">
                      <div className={`dt-fig-head${pulseCls('ResilienceAge')}`} style={zoneStyle('ResilienceAge')} onClick={e => { e.stopPropagation(); onZoneTap('ResilienceAge'); }} />
                      <div className="dt-fig-neck" style={{ background: sa.ResilienceAge?.fill }} />
                      <div className="dt-fig-mid-row">
                        <div className={`dt-fig-arm${pulseCls('MicroVascularAge')}`} style={zoneStyle('MicroVascularAge')} onClick={e => { e.stopPropagation(); onZoneTap('MicroVascularAge'); }} />
                        <div className={`dt-fig-chest${pulseCls('CellularAge')}`} style={zoneStyle('CellularAge')} onClick={e => { e.stopPropagation(); onZoneTap('CellularAge'); }}><div className="dt-fig-heart" style={{ background: sa.CellularAge?.color, boxShadow: `0 0 4px ${sa.CellularAge?.color}` }} /></div>
                        <div className={`dt-fig-arm${pulseCls('MicroVascularAge')}`} style={zoneStyle('MicroVascularAge')} onClick={e => { e.stopPropagation(); onZoneTap('MicroVascularAge'); }} />
                      </div>
                      <div className={`dt-fig-abdomen${pulseCls('MetabolicAge')}`} style={zoneStyle('MetabolicAge')} onClick={e => { e.stopPropagation(); onZoneTap('MetabolicAge'); }} />
                      <div className="dt-fig-hips" style={{ background: sa.MetabolicAge?.fill }} />
                      <div className="dt-fig-leg-row">
                        <div className={`dt-fig-leg${pulseCls('MicroVascularAge')}`} style={zoneStyle('MicroVascularAge')} onClick={e => { e.stopPropagation(); onZoneTap('MicroVascularAge'); }} />
                        <div className={`dt-fig-leg${pulseCls('MicroVascularAge')}`} style={zoneStyle('MicroVascularAge')} onClick={e => { e.stopPropagation(); onZoneTap('MicroVascularAge'); }} />
                      </div>
                    </div></div>
                    <div className="dt-sa-col">
                      {(d.bAge || d.cAge) && (!bioAgeOpen ? (
                        <div className="dt-age-chips">
                          <div className="bio-chip bio-chip-dim"><span className="bio-num bio-num-chrono">{d.cAge || '—'}</span><span className="bio-unit">{t.chronoAge}</span></div>
                          <div className="bio-chip bio-chip-primary" onClick={e => { e.stopPropagation(); setBioAgeOpen(true); }}><span className="bio-num bio-num-primary" style={{ color: tc(d.bAgeColor) }}>{d.bAge || '—'}</span><span className="bio-unit">{t.bioAge}</span></div>
                        </div>
                      ) : (
                        <div className="dt-bioage-open" onClick={e => { e.stopPropagation(); setBioAgeOpen(false); }}>
                          <ChartCanvas className="dt-bioage-canvas" width={Math.round(frameW * 330 / 750)} deps={[d.bioAgeHistory, theme, lang]}
                            draw={(cv, idx) => drawBioAgeChart(cv, { bioAgeHistory: d.bioAgeHistory, W: Math.round(frameW * 330 / 750), bAge: d.bAge, cAge: d.cAge, bAgeColor: d.bAgeColor, t, theme }, idx)} />
                        </div>
                      ))}
                      {!bioAgeOpen && d.subAgeList.map(item => {
                        const hasTrend = (d.subAgeHistory[item.key] || []).length > 1;
                        return (
                          <div key={item.key} className={`dt-sa-row${flashSubAge === item.key ? ' dt-sa-row-flash' : ''}`} onClick={e => { e.stopPropagation(); if (hasTrend) openSubAge(item.key); }}>
                            <div className={`dt-sa-accent${pulseCls(item.key)}`} style={{ background: item.color, boxShadow: `0 0 3px ${item.color}` }} />
                            <div className="dt-sa-info">
                              <div className="dt-sa-top"><span className="dt-sa-label">{item.label}</span><span className="dt-sa-val" style={{ color: tc(item.color) }}>{item.value}</span></div>
                              <div className="dt-sa-bar"><div className="dt-sa-bar-fill" style={{ width: `${item.score}%`, background: item.color }} /></div>
                            </div>
                            {hasTrend && <span className="dt-sa-trend-hint">›</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div className="dt-hero-card dt-hero-card-strips">
                <div className="dt-tags-strip">
                  {d.healthTags.map((tag, i) => <div key={i} className="dt-htag" style={{ borderColor: `${tc(tag.color)}55`, color: tc(tag.color) }}><div className="dt-htag-dot" style={{ background: tag.color }} /><span className="dt-htag-label">{tag.label}</span></div>)}
                  {d.healthTags.length === 0 && <div className="dt-htag dt-htag-empty"><span className="dt-htag-label">{t.noHealthSignals}</span></div>}
                </div>
                <div className="dt-metrics-strip">
                  <div className={`dt-metric${d.weightHistory.length > 1 ? ' dt-metric-tappable' : ''}`} onClick={() => d.weightHistory.length > 1 && setModal({ kind: 'weight', title: t.weightTrend })}>
                    <div className="dt-metric-val-row"><span className="dt-metric-val">{d.rawWeight != null ? d.rawWeight : '—'}</span>{d.rawWeight != null && <span className="dt-metric-unit">kg</span>}</div>
                    <span className="dt-metric-label">{t.weight}</span>{d.weightHistory.length > 1 && <span className="dt-metric-trend-hint">›</span>}
                  </div>
                  <div className="dt-metric-divider" />
                  <div className={`dt-metric${d.bmiHistory.length > 1 ? ' dt-metric-tappable' : ''}`} onClick={() => openGeneric('generic', d.bmiHistory, 'bmi', '', '#6375EC', 'BMI')}>
                    <span className="dt-metric-val">{d.rawBmi != null ? d.rawBmi : '—'}</span><span className="dt-metric-label">BMI</span>{d.bmiHistory.length > 1 && <span className="dt-metric-trend-hint">›</span>}
                  </div>
                  <div className="dt-metric-divider" />
                  <div className={`dt-metric${d.stepsHistory.length > 1 ? ' dt-metric-tappable' : ''}`} onClick={() => openGeneric('generic', d.stepsHistory, 'steps', '', '#0ea5e9', t.ringSteps)}>
                    <span className="dt-metric-val">{rd && rd.hasSteps ? rd.stepsStr : '—'}</span><span className="dt-metric-label">{t.ringSteps}</span>{d.stepsHistory.length > 1 && <span className="dt-metric-trend-hint">›</span>}
                  </div>
                  <div className="dt-metric-divider" />
                  <div className={`dt-metric${d.hrvHistory.length > 1 ? ' dt-metric-tappable' : ''}`} onClick={() => openGeneric('generic', d.hrvHistory, 'hrv', 'ms', '#10b981', 'HRV')}>
                    <div className="dt-metric-val-row"><span className="dt-metric-val" style={rd && rd.hasHrv ? { color: tc(rd.hrvColor) } : undefined}>{rd && rd.hasHrv ? rd.hrv : '—'}</span>{rd && rd.hasHrv && <span className="dt-metric-unit">ms</span>}</div>
                    <span className="dt-metric-label">{t.ringHrv}</span>{d.hrvHistory.length > 1 && <span className="dt-metric-trend-hint">›</span>}
                  </div>
                  <div className="dt-metric-divider" />
                  <div className={`dt-metric${d.stressHistory.length > 1 ? ' dt-metric-tappable' : ''}`} onClick={() => openGeneric('generic', d.stressHistory, 'stress', '', '#f97316', t.ringStress)}>
                    <span className="dt-metric-val" style={rd && rd.hasStress ? { color: tc(rd.stressColor) } : undefined}>{rd && rd.hasStress ? rd.stress : '—'}</span><span className="dt-metric-label">{t.ringStress}</span>{d.stressHistory.length > 1 && <span className="dt-metric-trend-hint">›</span>}
                  </div>
                </div>
                {(d.latestBp || d.latestGlucose) && (
                  <div className="dt-metrics-strip dt-metrics-strip-secondary">
                    {d.latestBp && <div className={`dt-metric${d.bpHistory.length > 1 ? ' dt-metric-tappable' : ''}`} onClick={() => d.bpHistory.length > 1 && setModal({ kind: 'bp', title: t.metricBp })}><div className="dt-metric-val-row"><span className="dt-metric-val">{d.latestBp.systolic}/{d.latestBp.diastolic}</span><span className="dt-metric-unit">mmHg</span></div><span className="dt-metric-label">{t.metricBp}</span>{d.bpHistory.length > 1 && <span className="dt-metric-trend-hint">›</span>}</div>}
                    {d.latestBp && d.latestGlucose && <div className="dt-metric-divider" />}
                    {d.latestGlucose && <div className={`dt-metric${d.glucoseHistory.length > 1 ? ' dt-metric-tappable' : ''}`} onClick={() => openGeneric('generic', d.glucoseHistory, 'glucose', 'mmol/L', '#a855f7', t.metricGlucose)}><div className="dt-metric-val-row"><span className="dt-metric-val">{d.latestGlucose.glucose}</span><span className="dt-metric-unit">mmol/L</span></div><span className="dt-metric-label">{t.metricGlucose}</span>{d.glucoseHistory.length > 1 && <span className="dt-metric-trend-hint">›</span>}</div>}
                  </div>
                )}
              </div>

              {d.twinReportLatest && (
                <div className="health-section">
                  <div className="section-title-row"><span className="section-title">{t.reportsTitle}</span>{d.twinReports.length > 1 && <span className="tr-count" onClick={twinReportList}>{t.reportsCount} {d.twinReports.length} ›</span>}</div>
                  <div className="tr-card" onClick={() => openTwinReport(d.twinReportLatest.job_uid, d.twinReportLatest.primary_index)}>
                    <div className="tr-icon"><span>📄</span></div>
                    <div className="tr-body"><span className="tr-title">{d.twinReportLatest.title}</span><span className="tr-meta">{d.twinReportLatest.metaLine}</span>{d.twinReportLatest.summary && <span className="tr-summary">{d.twinReportLatest.summary}</span>}</div>
                    <div className="tr-open"><span>{reportOpening ? t.reportsOpening : t.reportsOpen}</span></div>
                  </div>
                </div>
              )}

              {/* ── Daily Monitoring ── */}
              <div className="health-section">
                <span className="section-title">{t.layerDaily}</span>
                <div className="wd-inner">
                  {!wearableBound ? (
                    <div className="wd-empty-card" onClick={wearableNotice}><div className="wd-ring-icon">◉</div><div className="wd-empty-text-wrap"><span className="wd-bind-label">{t.bindSmartRing}</span></div><span className="wd-chevron">›</span></div>
                  ) : (
                    <div className="wd-card">
                      <div className="wd-card-row">
                        <div className="wd-info">
                          <div className="wd-name-row"><div className={`wd-dot${d.wearableConnected ? ' wd-dot-on' : ''}`} /><span className="wd-device-name">{wearableName || (hint?.brand || '')}</span></div>
                          <span className="wd-status-text">{d.wearableConnected ? t.wearableConnected : t.wearableDisconnected}</span>
                        </div>
                        <div className="wd-card-actions">
                          <div className="wd-sync-btn" onClick={wearableNotice}><span className="wd-sync-btn-text">{t.wearableSyncNow}</span></div>
                          <div className={`wd-gear-btn${ringSettingsOpen ? ' wd-gear-btn-active' : ''}`} onClick={() => setRingSettingsOpen(o => !o)}><span className="wd-gear-glyph">⚙</span></div>
                        </div>
                      </div>
                      {ringSettingsOpen && (
                        <div className="wd-settings-panel">
                          {(brand === 'halo' || brand === 'v8') && (
                            <div className="wd-interval-section">
                              <span className="wd-interval-title">{t.haloIntervalTitle}</span>
                              {[['hr', t.metricHr], ['spo2', t.metricSpo2], ['temp', t.metricTemp], ['hrv', t.metricHrv]].map(([k, label]) => (
                                <div key={k} className="wd-interval-row">
                                  <div className="wd-interval-label-col"><span className="wd-interval-label">{label}</span></div>
                                  <div className="wd-interval-opts">{HALO_INTERVAL_OPTS[k].map(m => <div key={m} className={`wd-int-btn${HALO_INTERVAL_DEFAULTS[k] === m ? ' wd-int-btn-on' : ''}`} onClick={wearableNotice}>{m}{t.haloIntervalUnit}</div>)}</div>
                                </div>
                              ))}
                            </div>
                          )}
                          <span className="wd-settings-loading-txt">{T.wearableWebNotice}</span>
                          <div className="wd-settings-footer"><div className="wd-unbind-btn" onClick={wearableNotice}><span className="wd-unbind-txt">{t.wearableUnbind}</span></div></div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {rd && (
                  <div className="ring-summary-card">
                    <div className="ring-sum-metrics">
                      <div className="ring-sum-item">{rd.hasSteps ? <div className="ring-sum-val-row"><span className="ring-sum-val">{rd.stepsStr}</span></div> : <span className="ring-sum-na">—</span>}<span className="ring-sum-sub">{t.ringSteps}</span>{rd.hasSteps && <div className="ring-sum-bar"><div className="ring-sum-bar-fill ring-steps-fill" style={{ width: `${rd.stepsPct}%` }} /></div>}</div>
                      <div className="ring-sum-item">{rd.hasSleep ? <div className="ring-sum-val-row"><span className="ring-sum-val">{rd.sleepStr}</span></div> : <span className="ring-sum-na">—</span>}<span className="ring-sum-sub">{t.ringSleep}</span>{rd.hasSleep && <div className="ring-sum-bar ring-sleep-segs"><div className="ring-sum-bar-seg ring-deep-seg" style={{ width: `${rd.sleepDeepPct}%` }} /><div className="ring-sum-bar-seg ring-rem-seg" style={{ width: `${rd.sleepRemPct}%` }} /><div className="ring-sum-bar-seg ring-light-seg" style={{ width: `${rd.sleepLightPct}%` }} /><div className="ring-sum-bar-seg ring-awake-seg" style={{ width: `${rd.sleepAwakePct}%` }} /></div>}</div>
                      <div className="ring-sum-item">{rd.hasHr ? <div className="ring-sum-val-row"><span className="ring-sum-val">{rd.restingHr}</span><span className="ring-sum-unit">bpm</span></div> : <span className="ring-sum-na">—</span>}<span className="ring-sum-sub">{t.ringHr}</span>{rd.hasHr && <div className="ring-sum-bar"><div className="ring-sum-bar-fill ring-hr-fill" style={{ width: `${rd.restingHr < 65 ? 90 : rd.restingHr < 80 ? 65 : 40}%` }} /></div>}</div>
                      <div className="ring-sum-item">{rd.hasHrv ? <div className="ring-sum-val-row"><span className="ring-sum-val" style={{ color: tc(rd.hrvColor) }}>{rd.hrv}</span><span className="ring-sum-unit">ms</span></div> : <span className="ring-sum-na">—</span>}<span className="ring-sum-sub">{t.ringHrv}</span>{rd.hasHrv && <div className="ring-sum-bar"><div className="ring-sum-bar-fill" style={{ width: `${rd.hrvPct}%`, background: rd.hrvColor }} /></div>}</div>
                      <div className="ring-sum-item">{rd.hasStress ? <div className="ring-sum-val-row"><span className="ring-sum-val" style={{ color: tc(rd.stressColor) }}>{rd.stress}</span></div> : <span className="ring-sum-na">—</span>}<span className="ring-sum-sub">{t.ringStress}</span>{rd.hasStress && <div className="ring-sum-bar"><div className="ring-sum-bar-fill" style={{ width: `${rd.stress}%`, background: rd.stressColor }} /></div>}{rd.hasStress && <span className="ring-sum-stress-label" style={{ color: tc(rd.stressColor) }}>{rd.stressLabel}</span>}</div>
                      <div className="ring-sum-item">{rd.hasSpo2 ? <div className="ring-sum-val-row"><span className="ring-sum-val" style={{ color: tc(rd.spo2Color) }}>{rd.spo2}</span><span className="ring-sum-unit">%</span></div> : <span className="ring-sum-na">—</span>}<span className="ring-sum-sub">SpO₂</span>{rd.hasSpo2 && <div className="ring-sum-bar"><div className="ring-sum-bar-fill" style={{ width: `${rd.spo2Pct}%`, background: rd.spo2Color }} /></div>}</div>
                      {rd.hasBodyTemp && <div className="ring-sum-item"><div className="ring-sum-val-row"><span className="ring-sum-val" style={{ color: tc(rd.tempColor) }}>{rd.bodyTempC}</span><span className="ring-sum-unit">°C</span></div><span className="ring-sum-sub">{t.ringBodyTemp}</span><div className="ring-sum-bar"><div className="ring-sum-bar-fill" style={{ width: `${rd.tempPct}%`, background: rd.tempColor }} /></div></div>}
                    </div>
                    <span className="ring-sum-footer">{rd.syncLabel}</span>
                  </div>
                )}

                {rd && rd.hasSlotCharts && (
                  <div className="ring-detail-card">
                    {rd.stepsBars && <div className="ring-chart-block"><span className="ring-chart-label">{t.ringStepsChart}</span><div className="ring-chart-bars">{rd.stepsBars.map((b, i) => <div key={i} className="ring-chart-col"><div className={`ring-chart-bar${b.active ? '' : ' ring-chart-bar-empty'}`} style={{ height: `${(b.heightRpx > 0 ? b.heightRpx : 3) / 2}px`, background: b.active ? '#0ea5e9' : 'rgba(99,117,236,0.1)' }} /><span className="ring-chart-hlabel">{b.h}</span></div>)}</div></div>}
                    {rd.hrBars && <div className="ring-chart-block"><span className="ring-chart-label">{t.ringHrChart}</span><div className="ring-chart-bars">{rd.hrBars.map((b, i) => <div key={i} className="ring-chart-col"><div className="ring-chart-bar" style={{ height: `${b.heightRpx / 2}px`, background: b.color }} /><span className="ring-chart-hlabel">{b.h}</span></div>)}</div></div>}
                    {rd.hrvDayBars && <div className="ring-chart-block"><span className="ring-chart-label">{t.ringHrvTrend}</span><div className="ring-chart-bars">{rd.hrvDayBars.map(b => <div key={b.label} className="ring-chart-day-col"><span className="ring-chart-day-avg">{b.avg}</span><div className="ring-chart-bar" style={{ height: `${b.heightRpx / 2}px`, background: b.color }} /><span className="ring-chart-day-label">{b.label}</span></div>)}</div></div>}
                    {rd.spo2DayBars && <div className="ring-chart-block"><span className="ring-chart-label">{t.ringSpo2Trend}</span><div className="ring-chart-bars">{rd.spo2DayBars.map(b => <div key={b.label} className="ring-chart-day-col"><span className="ring-chart-day-avg">{b.avg}%</span><div className="ring-chart-bar" style={{ height: `${b.heightRpx / 2}px`, background: b.color }} /><span className="ring-chart-day-label">{b.label}</span></div>)}</div></div>}
                    {rd.sleepWeek && (
                      <div className="ring-chart-block">
                        <span className="ring-chart-label">{t.ringSleepWeek}</span>
                        <div className="ring-sleepweek-wrap">
                          <div className="ring-sleepweek-axis" style={{ height: `${rd.sleepAxisHeightRpx / 2}px` }}>{['12', '18', '24', '06', '12'].map((l, i) => <span key={i} className="ring-sleepweek-axis-lbl">{l}</span>)}</div>
                          <div className="ring-sleepweek-days">
                            {rd.sleepWeek.map(day => (
                              <div key={day.date} className="ring-sleepweek-daycol">
                                <div className="ring-sleepweek-track" style={{ height: `${rd.sleepAxisHeightRpx / 2}px` }}>
                                  {[0, 25, 50, 75].map(p => <div key={p} className="ring-sleepweek-gridline" style={{ top: `${p}%` }} />)}
                                  {day.blocks.map(blk => <div key={blk.key} className={`ring-sleepweek-block${blk.isNap ? ' ring-sleepweek-block-nap' : ''}`} style={{ top: `${blk.topRpx / 2}px`, height: `${blk.heightRpx / 2}px`, background: blk.color }} />)}
                                </div>
                                <span className="ring-sleepweek-total">{day.totalLabel}</span><span className="ring-sleepweek-daylabel">{day.label}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="ring-sleep-legend"><div className="ring-sleep-leg-item"><div className="ring-sleep-leg-dot" style={{ background: '#10b981' }} /><span className="ring-sleep-leg-txt">{t.ringNightSleep}</span></div><div className="ring-sleep-leg-item"><div className="ring-sleep-leg-dot" style={{ background: '#f59e0b' }} /><span className="ring-sleep-leg-txt">{t.ringNap}</span></div></div>
                      </div>
                    )}
                    {[['hrvChart', t.ringHrv, 'ms'], ['spo2Chart', 'SpO₂', '%'], ['stressChart', t.ringStress, '']].map(([k, label, unit]) => rd[k]?.hasData && (
                      <div key={k} className="ring-chart-block">
                        <div className="ring-linechart-header"><span className="ring-chart-label">{label}</span><div className="ring-linechart-latest-row"><span className="ring-linechart-latest" style={{ color: tc(rd[k].latestColor) }}>{rd[k].latestVal}</span>{unit && <span className="ring-linechart-unit">{unit}</span>}{rd[k].latestEstimated && <span className="ring-lc-estimated-marker">~</span>}</div></div>
                        <div className="ring-lc-bars">{rd[k].bars.map((b, i) => <div key={i} className="ring-lc-col"><div className={`ring-lc-bar${b.estimated ? ' ring-lc-bar-estimated' : ''}`} style={{ height: `${b.heightRpx / 2}px`, background: b.color }} /></div>)}</div>
                        <div className="ring-linechart-range"><span className="ring-linechart-bound">{rd[k].minVal}{unit ? ` ${unit}` : ''}</span><span className="ring-linechart-count">{rd[k].count} 次</span><span className="ring-linechart-bound">{rd[k].maxVal}{unit ? ` ${unit}` : ''}</span></div>
                        {rd[k].estimatedCount > 0 && <div className="ring-lc-smoothed-note">{rd[k].estimatedCount}{t.ringSmoothedNote}</div>}
                      </div>
                    ))}
                    {rd.sleepSegs && (
                      <div className="ring-chart-block">
                        <div className="ring-chart-header"><span className="ring-chart-label">{t.ringSleepChart}</span><div className="ring-chart-header-right">{rd.sleepDateLabel && <span className="ring-chart-date">{rd.sleepDateLabel}</span>}{rd.sleepTimeRange && <span className="ring-chart-time">{rd.sleepTimeRange}</span>}</div></div>
                        <div className="ring-sleep-timeline">{rd.sleepSegs.map((s, i) => <div key={i} className="ring-sleep-tl-seg" style={{ width: `${s.widthPct}%`, background: s.color }} />)}</div>
                        <div className="ring-sleep-legend">
                          {[['#6375EC', t.ringDeep, rd.sleepDeep], ['#a855f7', t.ringRem, rd.sleepRem], ['#0ea5e9', t.ringLight, rd.sleepLight], ['rgba(166,196,229,0.4)', t.ringAwake, rd.sleepAwake]].map(([c, l, v]) => <div key={l} className="ring-sleep-leg-item"><div className="ring-sleep-leg-dot" style={{ background: c }} /><span className="ring-sleep-leg-txt">{l} {v}m</span></div>)}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 心电节律 — V8 strips from GET /api/ecg. Read-only here: recording needs the
                    band over BLE, which only the Mini Program has. */}
                {(brand === 'v8' || d.ecgLatest) && (
                  <div className="ecg-card">
                    <div className="ecg-card-row">
                      <div className="ecg-card-main">
                        <span className="ecg-card-title">{t.ecgTitle}</span>
                        {d.ecgLatest ? (
                          <div className="ecg-card-hero">
                            <span className="ecg-card-bpm">{d.ecgLatest.bpm}</span><span className="ecg-card-unit">bpm</span>
                            <span className="ecg-card-meta">{ecgWhen(d.ecgLatest.recorded_at)} · {d.ecgLatest.accepted_beats} {t.ecgBeats} · RR±{d.ecgLatest.rr_sd_ms}ms</span>
                          </div>
                        ) : <span className="ecg-card-empty">{t.ecgEmptySelf}</span>}
                      </div>
                      {brand === 'v8' && <div className="wd-sync-btn" onClick={wearableNotice}><span className="wd-sync-btn-text">{t.ecgRecord}</span></div>}
                    </div>
                    {d.ecgList.length > 1 && (
                      <div className="ecg-card-list">{d.ecgList.slice(1, 5).map(it => <div key={it.id} className="ecg-card-list-row"><span className="ecg-card-list-when">{ecgWhen(it.recorded_at)}</span><span className="ecg-card-list-val">{it.bpm} bpm · RR±{it.rr_sd_ms}ms</span></div>)}</div>
                    )}
                    <span className="ecg-card-foot">{t.ecgNotDiagnosis}</span>
                  </div>
                )}
                {/* 脉搏波 — raw PPG strips from GET /api/ppg, V8 band and Halo ring. Same card. */}
                {(brand === 'v8' || brand === 'halo' || d.ppgLatest) && (
                  <div className="ecg-card">
                    <div className="ecg-card-row">
                      <div className="ecg-card-main">
                        <span className="ecg-card-title">{t.ppgTitle}</span>
                        {d.ppgLatest ? (
                          <div className="ecg-card-hero">
                            <span className="ecg-card-bpm">{d.ppgLatest.bpm}</span><span className="ecg-card-unit">bpm</span>
                            <span className="ecg-card-meta">{ecgWhen(d.ppgLatest.recorded_at)} · {d.ppgLatest.accepted_beats} {t.ecgBeats} · PP±{d.ppgLatest.rr_sd_ms}ms</span>
                          </div>
                        ) : <span className="ecg-card-empty">{t.ppgEmptySelf}</span>}
                      </div>
                      {(brand === 'v8' || brand === 'halo') && <div className="wd-sync-btn" onClick={wearableNotice}><span className="wd-sync-btn-text">{t.ppgRecord}</span></div>}
                    </div>
                    {d.ppgList.length > 1 && (
                      <div className="ecg-card-list">{d.ppgList.slice(1, 5).map(it => <div key={it.id} className="ecg-card-list-row"><span className="ecg-card-list-when">{ecgWhen(it.recorded_at)}</span><span className="ecg-card-list-val">{it.bpm} bpm · PP±{it.rr_sd_ms}ms</span></div>)}</div>
                    )}
                    <span className="ecg-card-foot">{t.ppgNotDiagnosis}</span>
                  </div>
                )}

                {d.hasTwinData ? (d.twinBodyBar && (
                  <div className="ht-body-card">
                    <div className="ht-body-header"><span className="ht-body-title">{t.dtBody}</span>{d.twinBody && <span className="ht-body-vals">{d.twinBody}</span>}</div>
                    <div className="ht-body-bar"><div className="ht-body-lean" style={{ width: `${d.twinBodyBar.leanPct}%` }} /><div className="ht-body-fat-fill" style={{ width: `${d.twinBodyBar.fatPct}%` }} /></div>
                    <div className="ht-body-legend"><div className="ht-body-legend-item"><div className="ht-body-dot ht-lean-dot" /><span className="ht-body-lbl">{t.dtLean}  {d.twinBodyBar.leanPct}%</span></div><div className="ht-body-legend-item"><div className="ht-body-dot ht-fat-dot" /><span className="ht-body-lbl">{t.dtFat}  {d.twinBodyBar.fatPct}%</span></div></div>
                  </div>
                )) : (!d.twinLoading && <span className="health-empty">{t.noTwinData}</span>)}
              </div>

              {/* ── Precision Testing ── */}
              <div className="health-section">
                <div className="section-title-row"><span className="section-title">{t.layerPrecision}</span>{d.recordCount > 0 && <div className="section-badge"><span>{d.recordCount} {t.tests}</span></div>}</div>
                {d.recordCount > 0 ? (
                  <div className="trend-grid">
                    {d.trendList.map(item => (
                      <div key={item.key} className="trend-card">
                        <span className="trend-label">{item.label}</span>
                        <div className="trend-val-row"><span className="trend-val" style={{ color: tc(item.color) }}>{item.lastVal !== null ? item.lastVal : '—'}</span><span className="trend-unit">{item.unit}</span></div>
                        {item.sparkBars.length > 1 && <div className="spark-row">{item.sparkBars.map((bar, i) => <div key={i} className={`spark-bar${bar.empty ? ' spark-bar-empty' : ''}`} style={{ height: `${bar.h / 2}px`, background: bar.color }} />)}</div>}
                      </div>
                    ))}
                  </div>
                ) : <span className="health-empty">{t.noHistory}</span>}
              </div>

              {/* ── Medical Records ── */}
              <div className="health-section">
                <div className="section-title-row">
                  <span className="section-title">{t.layerMedical}</span>
                  {d.labPanelAbnormal > 0 ? <div className="ht-lab-alert"><span className="ht-lab-alert-text">{d.labPanelAbnormal} {t.labAbnormal}</span></div>
                    : d.labPanel.length > 0 ? <div className="ht-lab-ok"><span className="ht-lab-ok-text">{t.labAllNormal}</span></div> : null}
                </div>
                {d.labPanel.length > 0 && (
                  <div className="ht-lab-snapshot-wrap">
                    <div className="ht-lab-snapshot-header"><span className="ht-lab-snapshot-title">{t.labPanel}</span><span className="ht-lab-date">{d.labPanelMeta || d.labPanelDate}</span></div>
                    <div className="ht-lab-grid">
                      {d.labPanel.map(item => (
                        <div key={item.key} className={`ht-lab-item${item.status !== 'normal' ? ' ht-lab-item-abn' : ''}${item.hasTrend ? ' ht-lab-item-trend' : ''}`} style={{ borderColor: `${tc(item.statusColor)}22` }} onClick={() => openLab(item.key)}>
                          <span className="ht-lab-name" style={{ color: tc(item.status !== 'normal' ? item.statusColor : 'rgba(166,196,229,0.55)') }}>{item.displayName}</span>
                          <span className="ht-lab-val" style={{ color: tc(item.statusColor) }}>{item.value}</span>
                          <span className="ht-lab-unit">{item.unit}</span>
                          {(item.dateShort || item.hasTrend) && <span className="ht-lab-sub">{item.dateShort}{item.dateShort && item.hasTrend ? ' · ' : ''}{item.hasTrend ? '↗' : ''}</span>}
                        </div>
                      ))}
                    </div>
                    <span className="ht-lab-hint">{t.labPanelHint}</span>
                  </div>
                )}
                {d.reportsLoading ? <Pulse /> : d.healthReports.length > 0 ? (
                  <div className="rpt-list">
                    {d.healthReports.map(item => (
                      <div key={item.id} className="rpt-card" onClick={() => openReport(item.id)}>
                        {item.image_url && <img className="rpt-thumb" src={item.image_url} alt="" onClick={e => { e.stopPropagation(); window.open(item.image_url, '_blank'); }} />}
                        <div className="rpt-card-left" style={{ borderLeftColor: tc(item.type_color) }}><span className="rpt-institution">{item.institution}</span><span className="rpt-date">{item.report_date}{item.items_label ? ' · ' + item.items_label : ''}</span></div>
                        <div className="rpt-type-badge" style={{ background: `${item.type_color}18`, borderColor: `${tc(item.type_color)}44` }}><span className="rpt-type-text" style={{ color: tc(item.type_color) }}>{item.report_type}</span></div>
                        <span className="rpt-arrow">›</span>
                      </div>
                    ))}
                  </div>
                ) : (!d.reportsLoading && d.labPanel.length === 0 && !d.foodPanel && <span className="health-empty">{t.noReports}</span>)}
                {d.foodPanel && (
                  <div className="fs-block">
                    <div className="ht-lab-snapshot-header"><span className="ht-lab-snapshot-title">{t.foodPanelTitle}</span><span className="ht-lab-date">{d.foodPanel.report_date}</span></div>
                    <span className="fs-summary">{d.foodSummary}</span>
                    {d.foodPositives.length > 0 && (
                      <div className="fs-list">
                        {d.foodPositives.map(item => (
                          <div key={item.food_key} className="fs-row" style={{ borderColor: `${tc(item.color)}44` }}>
                            <div className="fs-row-head"><span className="fs-food">{item.name}</span><span className="fs-class" style={{ color: tc(item.color) }}>{item.classLabel}</span><span className="fs-val">{item.valueText}</span></div>
                            {item.windowText && <span className="fs-window">{item.windowText}</span>}
                            {item.substitutes && <span className="fs-subs">{t.foodSubstitutes}{item.substitutes}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    <span className="fs-footnote">{t.foodPanelNote}</span>
                  </div>
                )}
              </div>

              {/* ── Personal Profile ── */}
              {d.userFactsLoaded && (
                <div className="health-section">
                  <span className="section-title">{t.layerProfile}</span>
                  {d.userFacts.length > 0 ? (
                    <div className="fact-list">
                      {d.userFacts.map(f => <div key={f.id} className="fact-chip" style={{ borderColor: `${tc(f.color)}44` }}><span className="fact-cat" style={{ color: tc(f.color) }}>{f.categoryLabel}</span><span className="fact-text">{f.fact}</span></div>)}
                      <span className="fact-footnote">{t.factsFootnote}</span>
                    </div>
                  ) : <span className="health-empty">{t.noFactsSelf}</span>}
                </div>
              )}

              <HealthDocuments userId={userId} canUpload onLoaded={h.onDocsLoaded} />
              <div style={{ height: 32 }} />
            </>
          )}
        </div>
      )}

      {showAgTab && subTab === 'ag' && <VivaAgPanel userId={userId} visible={visible} onGoToChat={reason => { app.setTab('chat'); emit('chat:checkQuestionnaire', reason); }} />}

      {activeReport && (
        <div className="rpt-overlay" onClick={() => setActiveReport(null)}>
          <div className="rpt-sheet" onClick={e => e.stopPropagation()}>
            <div className="rpt-sheet-handle" />
            <div className="rpt-sheet-header">
              <div className="rpt-sheet-title-group"><span className="rpt-sheet-institution">{activeReport.institution}</span><span className="rpt-sheet-date">{activeReport.report_date}</span></div>
              {activeReport.type_color && <div className="rpt-sheet-type-badge" style={{ background: `${activeReport.type_color}18`, borderColor: `${tc(activeReport.type_color)}44` }}><span style={{ color: tc(activeReport.type_color), fontSize: 10, fontWeight: 700 }}>{activeReport.report_type}</span></div>}
              <div className="rpt-close-btn" onClick={() => setActiveReport(null)}><span className="rpt-close-x">✕</span></div>
            </div>
            <div className="rpt-events-scroll uh-scroll">
              {activeReport.loading ? <Pulse /> : (
                <>
                  {activeReport.image_url && <div className="rpt-section"><img className="rpt-photo" src={activeReport.image_url} alt="" onClick={() => window.open(activeReport.image_url, '_blank')} /></div>}
                  {activeReport.hasDoctorNotes && (
                    <div className="rpt-section">
                      <div className="rpt-section-header"><span className="rpt-section-icon">🩺</span><span className="rpt-section-title">{t.rptDoctorTitle}</span></div>
                      {activeReport.doctorNotes.physician && <div className="rpt-dn-meta"><span className="rpt-dn-key">{t.rptPhysician}</span><span className="rpt-dn-val">{activeReport.doctorNotes.physician}{activeReport.doctorNotes.department ? ' · ' + activeReport.doctorNotes.department : ''}</span></div>}
                      {activeReport.doctorNotes.vitals.length > 0 && <div className="rpt-vitals-grid">{activeReport.doctorNotes.vitals.map(v => <div key={v.key} className="rpt-vital-item"><span className="rpt-vital-key">{v.key}</span><span className="rpt-vital-val">{v.value}</span></div>)}</div>}
                      {activeReport.doctorNotes.clinical_summary && <div className="rpt-clinical"><span className="rpt-clinical-label">{t.rptClinicalSummary}</span><span className="rpt-clinical-text">{activeReport.doctorNotes.clinical_summary}</span></div>}
                      {activeReport.doctorNotes.recommendations.length > 0 && <div className="rpt-dn-subsection"><div className="rpt-section-header rpt-advice-header" style={{ paddingLeft: 0 }}><span className="rpt-section-icon">💊</span><span className="rpt-section-title">{t.rptRecommendations}</span></div><div className="rpt-advice-list">{activeReport.doctorNotes.recommendations.map((r, i) => <div key={i} className="rpt-advice-item"><span className="rpt-advice-num">{i + 1}</span><span className="rpt-advice-text">{r}</span></div>)}</div></div>}
                      {activeReport.doctorNotes.follow_up && <div className="rpt-followup"><span className="rpt-followup-label">{t.rptFollowUp}</span><span className="rpt-followup-text">{activeReport.doctorNotes.follow_up}</span></div>}
                    </div>
                  )}
                  {activeReport.hasDiag && <div className="rpt-section"><div className="rpt-section-header rpt-diag-header"><span className="rpt-section-icon">🔬</span><span className="rpt-section-title">{t.rptDiagTitle}</span></div><div className="rpt-diag-list">{activeReport.diag.map((x, i) => <div key={i} className="rpt-diag-item"><div className="rpt-diag-bullet" /><span className="rpt-diag-text">{x}</span></div>)}</div></div>}
                  {activeReport.hasAdvice && <div className="rpt-section"><div className="rpt-section-header rpt-advice-header"><span className="rpt-section-icon">💊</span><span className="rpt-section-title">{t.rptAdviceTitle}</span></div><div className="rpt-advice-list">{activeReport.advice.map((x, i) => <div key={i} className="rpt-advice-item"><span className="rpt-advice-num">{i + 1}</span><span className="rpt-advice-text">{x}</span></div>)}</div></div>}
                  {activeReport.events.length > 0 && (
                    <div className="rpt-section">
                      {(activeReport.hasDiag || activeReport.hasAdvice || activeReport.otherItems.length > 0) && <div className="rpt-section-header"><span className="rpt-section-icon">📊</span><span className="rpt-section-title">{t.rptMarkersTitle}</span></div>}
                      <div className="rpt-events-list">{activeReport.events.map((ev, i) => (
                        <div key={i} className="rpt-ev-row">
                          <div className="rpt-ev-left"><div className="rpt-ev-dot" style={{ background: ev.statusColor }} /><div className="rpt-ev-info"><span className="rpt-ev-name">{ev.key_name}</span>{ev.refText && <span className="rpt-ev-ref">{t.rptRefRange}  {ev.refText}</span>}</div></div>
                          <div className="rpt-ev-right"><span className="rpt-ev-val">{ev.value}</span><span className="rpt-ev-unit"> {ev.unit}</span><div className="rpt-ev-status" style={{ background: `${ev.statusColor}18`, borderColor: `${tc(ev.statusColor)}44` }}><span style={{ color: tc(ev.statusColor), fontSize: 9, fontWeight: 700 }}>{ev.statusLabel}</span></div></div>
                        </div>))}</div>
                    </div>
                  )}
                  {activeReport.otherItems.length > 0 && (
                    <div className="rpt-section">
                      <div className="rpt-section-header"><span className="rpt-section-icon">📄</span><span className="rpt-section-title">{t.rptOtherItemsTitle}</span></div>
                      <div className="rpt-events-list">{activeReport.otherItems.map((ev, i) => (
                        <div key={i} className="rpt-ev-row">
                          <div className="rpt-ev-left"><div className="rpt-ev-dot" style={{ background: ev.flagged ? ev.statusColor : 'rgba(166,196,229,0.25)' }} /><div className="rpt-ev-info"><span className="rpt-ev-name">{ev.key_name}</span>{ev.refText && <span className="rpt-ev-ref">{t.rptRefRange}  {ev.refText}</span>}{ev.suggested && <span className="rpt-ev-ref rpt-ev-maybe">{ev.suggested}</span>}</div></div>
                          <div className="rpt-ev-right"><span className="rpt-ev-val">{ev.value}</span><span className="rpt-ev-unit"> {ev.unit}</span>{ev.flagged && <div className="rpt-ev-status" style={{ background: `${ev.statusColor}18`, borderColor: `${tc(ev.statusColor)}44` }}><span style={{ color: tc(ev.statusColor), fontSize: 9, fontWeight: 700 }}>{ev.statusLabel}</span></div>}</div>
                        </div>))}</div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {modal && (
        <ChartSheet title={modal.title} onClose={() => setModal(null)}>
          {modal.kind === 'bp' && <div className="bp-chart-legend"><div className="bp-legend-item"><div className="bp-legend-dot bp-legend-sys" /><span className="bp-legend-label">SYS</span></div><div className="bp-legend-item"><div className="bp-legend-dot bp-legend-dia" /><span className="bp-legend-label">DIA</span></div></div>}
          <ChartCanvas className="weight-chart-full" width={chartW} deps={[modal, theme]} draw={(cv, idx) => (
            modal.kind === 'weight' ? drawWeightFullChart(cv, { weightHistory: d.weightHistory, W: chartW, theme })
              : modal.kind === 'bp' ? drawBpChart(cv, { bpHistory: d.bpHistory, W: chartW })
              : drawGenericChart(cv, { history: modal.history, valKey: modal.valKey, unit: modal.unit, color: modal.color, W: chartW, theme }, idx)
          )} />
        </ChartSheet>
      )}
    </div>
  );
}
