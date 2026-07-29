import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { X, Plus, Pencil, Trash2, ChevronDown, BookOpen, ShieldCheck, Tags } from 'lucide-react';
import { useLang, fmt, StatCard, Badge } from '../shared.jsx';

const TIER_COLOR = { essential: '#8b5cf6', optional: '#3b82f6' };
const STATUS_COLOR = { active: '#10b981', inactive: '#94a3b8' };

function KnowledgeTab({ isSuperadmin }) {
  const { t } = useLang();
  const tk = t.knowledge || {};

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [tierFilter, setTierFilter] = useState('all');

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/knowledge-entries');
      setEntries(res.data?.entries || []);
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const handleDelete = async (id) => {
    if (!window.confirm(tk.confirmDelete || `Delete knowledge entry "${id}"?`)) return;
    try {
      await axios.delete(`/api/knowledge-entries/${encodeURIComponent(id)}`);
      fetchEntries();
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };

  const essentialCount = entries.filter(e => e.tier === 'essential').length;
  const optionalCount  = entries.filter(e => e.tier === 'optional').length;
  const activeCount    = entries.filter(e => e.status === 'active').length;

  const visible = tierFilter === 'all' ? entries : entries.filter(e => e.tier === tierFilter);

  if (!isSuperadmin) {
    return <p className="muted">{tk.superadminOnly || 'Knowledge entries are managed at the superadmin level.'}</p>;
  }

  return (
    <>
      <div className="stat-row">
        <StatCard icon={BookOpen}    label={tk.totalEntries    || 'Total Entries'}    value={entries.length}  color="#3b82f6" />
        <StatCard icon={ShieldCheck} label={tk.essentialCount  || 'Essential (always-on)'} value={essentialCount} color="#8b5cf6" />
        <StatCard icon={Tags}        label={tk.optionalCount   || 'Optional (matched)'}    value={optionalCount}  color="#f59e0b" />
        <StatCard icon={ShieldCheck} label={tk.activeCount     || 'Active'}           value={activeCount}     color="#10b981" />
      </div>

      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{entries.length} {tk.entries || 'entries'}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="select-wrap">
              <select value={tierFilter} onChange={e => setTierFilter(e.target.value)} className="inline-select">
                <option value="all">{tk.allTiers || 'All tiers'}</option>
                <option value="essential">{tk.tierEssential || 'Essential'}</option>
                <option value="optional">{tk.tierOptional || 'Optional'}</option>
              </select>
              <ChevronDown size={11} className="select-chevron" />
            </div>
            <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
              <Plus size={14} />{tk.addEntry || 'Add Entry'}
            </button>
          </div>
        </div>
        <table className="data-table">
          <thead><tr>
            <th>{tk.id || 'ID'}</th>
            <th>{tk.tier || 'Tier'}</th>
            <th>{tk.persona || 'Persona'}</th>
            <th>{tk.category || 'Category'}</th>
            <th>{tk.content || 'Content'}</th>
            <th>{tk.evidenceLevel || 'Evidence'}</th>
            <th>{tk.status || 'Status'}</th>
            <th>{tk.reviewed || 'Reviewed'}</th>
            <th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="empty-row">{t.topbar.loading}</td></tr>}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={9} className="empty-row">{tk.noEntries || 'No knowledge entries yet'}</td></tr>
            )}
            {visible.map(e => (
              <tr key={e.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.id}</td>
                <td><Badge color={TIER_COLOR[e.tier] || '#64748b'}>{e.tier}</Badge></td>
                <td className="muted">{e.persona_type}</td>
                <td className="muted">{fmt(e.category)}</td>
                <td style={{ fontSize: 12, maxWidth: 360 }}>
                  {e.content_zh?.length > 90 ? e.content_zh.slice(0, 90) + '…' : e.content_zh}
                </td>
                <td className="muted">{fmt(e.evidence_level)}</td>
                <td><Badge color={STATUS_COLOR[e.status] || '#64748b'}>{e.status}</Badge></td>
                <td className="muted" style={{ fontSize: 11 }}>
                  {fmt(e.last_reviewed)}{e.reviewed_by ? ` · ${e.reviewed_by}` : ''}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="icon-btn" title={tk.editEntry || 'Edit'} onClick={() => setModal({ type: 'edit', entry: e })}><Pencil size={14} /></button>
                    <button className="icon-btn danger" title={tk.deleteEntry || 'Delete'} onClick={() => handleDelete(e.id)}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(modal?.type === 'add' || modal?.type === 'edit') && (
        <KnowledgeEntryModal
          entry={modal.type === 'edit' ? modal.entry : null}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); fetchEntries(); }}
        />
      )}
    </>
  );
}

function KnowledgeEntryModal({ entry, onClose, onSave }) {
  const { t } = useLang();
  const tk = t.knowledge || {};
  const isEdit = !!entry;

  const [form, setForm] = useState({
    id:             entry?.id             || '',
    persona_type:   entry?.persona_type   || 'viva',
    tier:           entry?.tier           || 'optional',
    category:       entry?.category       || '',
    topic:          (entry?.topic || []).join(', '),
    content_zh:     entry?.content_zh     || '',
    evidence_level: entry?.evidence_level || 'observational',
    status:         entry?.status         || 'inactive',
    sort_order:     entry?.sort_order ?? 0,
    reviewed_by:    entry?.reviewed_by    || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const id = form.id.trim().toLowerCase();
    if (!isEdit && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
      setError(tk.idHint || 'ID must be lowercase kebab-case (letters, digits, hyphens)'); return;
    }
    if (!form.content_zh.trim()) { setError(tk.contentRequired || 'Content is required'); return; }
    const topic = form.topic.split(',').map(s => s.trim()).filter(Boolean);
    if (form.tier === 'optional' && topic.length === 0) {
      setError(tk.topicRequired || 'At least one topic tag is required for optional-tier entries'); return;
    }
    if (form.status === 'active' && !form.reviewed_by.trim()) {
      setError(tk.reviewedByRequired || 'reviewed_by is required before an entry can be set to active'); return;
    }

    const payload = {
      persona_type:   form.persona_type.trim() || 'viva',
      tier:           form.tier,
      category:       form.category.trim() || null,
      topic,
      content_zh:     form.content_zh.trim(),
      evidence_level: form.tier === 'optional' ? form.evidence_level : null,
      status:         form.status,
      sort_order:     parseInt(form.sort_order, 10) || 0,
      last_reviewed:  new Date().toISOString().slice(0, 10),
      reviewed_by:    form.reviewed_by.trim() || null,
    };

    setBusy(true);
    try {
      let res;
      if (isEdit) {
        res = await axios.put(`/api/knowledge-entries/${encodeURIComponent(entry.id)}`, payload);
      } else {
        res = await axios.post('/api/knowledge-entries', { id, ...payload });
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
          <span>{isEdit ? (tk.editEntry || 'Edit Knowledge Entry') : (tk.addEntry || 'Add Knowledge Entry')}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field">
              <span>{tk.id || 'ID'}</span>
              <input value={form.id} onChange={e => set('id', e.target.value.toLowerCase())}
                     placeholder="aldh2-flush" disabled={isEdit} required={!isEdit} maxLength={64} />
              <small style={{ color: '#64748b', fontSize: 10 }}>{tk.idHint || 'lowercase kebab-case, permanent once created'}</small>
            </label>
            <label className="form-field">
              <span>{tk.persona || 'Persona'}</span>
              <input value={form.persona_type} onChange={e => set('persona_type', e.target.value)} placeholder="viva" />
            </label>
            <label className="form-field">
              <span>{tk.tier || 'Tier'}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.tier} onChange={e => set('tier', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="essential">{tk.tierEssential || 'Essential — always injected'}</option>
                  <option value="optional">{tk.tierOptional || 'Optional — matched on request'}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{tk.category || 'Category'}</span>
              <input value={form.category} onChange={e => set('category', e.target.value)} placeholder="tcm_gene_variant" />
            </label>
            {form.tier === 'optional' && (
              <>
                <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                  <span>{tk.topic || 'Topic tags (comma-separated)'}</span>
                  <input value={form.topic} onChange={e => set('topic', e.target.value)} placeholder="ALDH2, 酒精代谢, 亚洲红脸" required={form.tier === 'optional'} />
                  <small style={{ color: '#64748b', fontSize: 10 }}>{tk.topicHint || 'Matched as a substring of the user\'s message'}</small>
                </label>
                <label className="form-field">
                  <span>{tk.evidenceLevel || 'Evidence Level'}</span>
                  <div className="select-wrap" style={{ width: '100%' }}>
                    <select value={form.evidence_level} onChange={e => set('evidence_level', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                      <option value="rct">rct</option>
                      <option value="meta_analysis">meta_analysis</option>
                      <option value="observational">observational</option>
                      <option value="mechanistic_plausible">mechanistic_plausible</option>
                      <option value="insufficient">insufficient</option>
                    </select>
                    <ChevronDown size={11} className="select-chevron" />
                  </div>
                </label>
                <label className="form-field">
                  <span>{tk.sortOrder || 'Sort Order'}</span>
                  <input type="number" value={form.sort_order} onChange={e => set('sort_order', e.target.value)} />
                </label>
              </>
            )}
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tk.content || 'Content (Simplified Chinese)'}</span>
              <textarea rows={form.tier === 'essential' ? 14 : 4} value={form.content_zh}
                        onChange={e => set('content_zh', e.target.value)}
                        style={{ resize: 'vertical' }} required />
            </label>
            <label className="form-field">
              <span>{tk.status || 'Status'}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.status} onChange={e => set('status', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="inactive">{tk.statusInactive || 'Inactive'}</option>
                  <option value="active">{tk.statusActive || 'Active'}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{tk.reviewedBy || 'Reviewed By'}</span>
              <input value={form.reviewed_by} onChange={e => set('reviewed_by', e.target.value)} placeholder="name/handle" />
              <small style={{ color: '#64748b', fontSize: 10 }}>{tk.reviewedByHint || 'Required before status can be set to Active'}</small>
            </label>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>{t.modal?.cancel || 'Cancel'}</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? (t.modal?.saving || '…') : (t.modal?.save || 'Save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export { KnowledgeTab };
