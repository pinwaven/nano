import React, { useState } from 'react';
import axios from 'axios';
import {
  X, Check, Trash2, Plus, Pencil, ChevronDown, Droplets,
} from 'lucide-react';
import { useLang, fmt, Badge, StatCard } from '../shared.jsx';

// ── Dots constants ─────────────────────────────────────────────────────────────

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

// ── DotsTab ───────────────────────────────────────────────────────────────────

export default function DotsTab({ dots, onRefresh }) {
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

export { Sparkline };
