import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Users, FlaskConical, FileText, Check, Plus, Pencil, Trash2, X, Activity, Upload, Eye } from 'lucide-react';
import { StatCard } from '../shared.jsx';

function LabTab({ users, onRefresh }) {
  const [subTab, setSubTab] = useState('providers');
  return (
    <>
      <div className="subtab-row" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`subtab-btn${subTab === 'providers' ? ' active' : ''}`} onClick={() => setSubTab('providers')}>
          <FlaskConical size={13} />Providers
        </button>
        <button className={`subtab-btn${subTab === 'mappings' ? ' active' : ''}`} onClick={() => setSubTab('mappings')}>
          <Users size={13} />Patient Mappings
        </button>
        <button className={`subtab-btn${subTab === 'reports' ? ' active' : ''}`} onClick={() => setSubTab('reports')}>
          <FileText size={13} />Reports
        </button>
      </div>
      {subTab === 'providers' && <LabProvidersPanel onRefresh={onRefresh} />}
      {subTab === 'mappings'  && <LabMappingsPanel users={users} onRefresh={onRefresh} />}
      {subTab === 'reports'   && <LabReportsPanel users={users} />}
    </>
  );
}

// ── Providers panel ───────────────────────────────────────────────────────────

function LabProvidersPanel({ onRefresh }) {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState(null); // null | { type: 'add' | 'edit', provider? }
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await axios.get('/api/lab-providers'); setProviders(r.data.providers || []); }
    catch { setProviders([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openAdd  = () => setModal({ type: 'add', form: { lab_name: '', label: '', api_base_url: '', api_key: '', webhook_secret: '', poll_enabled: true } });
  const openEdit = (p) => setModal({ type: 'edit', provider: p, form: { lab_name: p.lab_name, label: p.label || '', api_base_url: p.api_base_url, api_key: '', webhook_secret: '', poll_enabled: p.poll_enabled, is_active: p.is_active } });
  const close    = () => { setModal(null); setErr(''); };

  const toggle = async (p, field) => {
    try { await axios.put(`/api/lab-providers/${p.id}`, { [field]: !p[field] }); load(); }
    catch (e) { alert(e.response?.data?.error || 'Update failed'); }
  };

  const save = async () => {
    setBusy(true); setErr('');
    try {
      if (modal.type === 'add') {
        await axios.post('/api/lab-providers', modal.form);
      } else {
        const body = { ...modal.form };
        if (!body.api_key) delete body.api_key;
        if (!body.webhook_secret) delete body.webhook_secret;
        await axios.put(`/api/lab-providers/${modal.provider.id}`, body);
      }
      close(); load(); onRefresh?.();
    } catch (e) { setErr(e.response?.data?.error || 'Save failed'); }
    finally { setBusy(false); }
  };

  const del = async (p) => {
    if (!confirm(`Delete provider "${p.label || p.lab_name}"?`)) return;
    try { await axios.delete(`/api/lab-providers/${p.id}`); load(); onRefresh?.(); }
    catch (e) { alert(e.response?.data?.error || 'Delete failed'); }
  };

  const setField = (k, v) => setModal(m => ({ ...m, form: { ...m.form, [k]: v } }));

  return (
    <>
      <div className="stat-row">
        <StatCard icon={FlaskConical} label="Total Providers"  value={providers.length}                        color="#6366f1" />
        <StatCard icon={Check}        label="Active"           value={providers.filter(p => p.is_active).length}  color="#10b981" />
        <StatCard icon={Activity}     label="Poll Enabled"     value={providers.filter(p => p.poll_enabled && p.is_active).length} color="#3b82f6" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{providers.length} provider{providers.length !== 1 ? 's' : ''}</span>
          <button className="btn-primary" onClick={openAdd}><Plus size={14} />Add Provider</button>
        </div>
        <table className="data-table">
          <thead><tr>
            <th>ID</th><th>Adapter Key</th><th>Label</th><th>API Base URL</th>
            <th>Poll</th><th>Active</th><th>Last Polled</th><th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="empty-row">Loading…</td></tr>}
            {!loading && providers.length === 0 && <tr><td colSpan={8} className="empty-row">No providers configured yet.</td></tr>}
            {providers.map(p => (
              <tr key={p.id}>
                <td style={{ color: '#94a3b8', fontSize: 11 }}>{p.id}</td>
                <td><code style={{ fontSize: 12, color: '#a5b4fc' }}>{p.lab_name}</code></td>
                <td>{p.label || <span style={{ color: '#475569' }}>—</span>}</td>
                <td style={{ fontSize: 12, color: '#94a3b8', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.api_base_url}</td>
                <td>
                  <button className={`subtab-btn${p.poll_enabled ? ' active' : ''}`} style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => toggle(p, 'poll_enabled')}>
                    {p.poll_enabled ? 'On' : 'Off'}
                  </button>
                </td>
                <td>
                  <button className={`subtab-btn${p.is_active ? ' active' : ''}`} style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => toggle(p, 'is_active')}>
                    {p.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td style={{ fontSize: 11, color: '#94a3b8' }}>
                  {p.last_polled_at ? new Date(p.last_polled_at).toLocaleString() : <span style={{ color: '#475569' }}>Never</span>}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="icon-btn" onClick={() => openEdit(p)} title="Edit"><Pencil size={13} /></button>
                    <button className="icon-btn" style={{ color: '#ef4444' }} onClick={() => del(p)} title="Delete"><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={close}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{modal.type === 'add' ? 'Add Lab Provider' : `Edit — ${modal.provider.label || modal.provider.lab_name}`}</span>
              <button className="icon-btn" onClick={close}><X size={16} /></button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Adapter Key *', key: 'lab_name',    placeholder: 'kingmed', disabled: modal.type === 'edit' },
                { label: 'Label',         key: 'label',       placeholder: 'KingMed Shanghai' },
                { label: 'API Base URL *', key: 'api_base_url', placeholder: 'https://api.lab.com/v1' },
                { label: modal.type === 'edit' ? 'API Key (leave blank to keep current)' : 'API Key', key: 'api_key', placeholder: '••••••', type: 'password' },
                { label: modal.type === 'edit' ? 'Webhook Secret (leave blank to keep)' : 'Webhook Secret', key: 'webhook_secret', placeholder: '••••••', type: 'password' },
              ].map(({ label, key, placeholder, disabled, type }) => (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, color: '#94a3b8' }}>{label}</label>
                  <input
                    type={type || 'text'}
                    value={modal.form[key] || ''}
                    onChange={e => setField(key, e.target.value)}
                    placeholder={placeholder}
                    disabled={disabled}
                    style={{ background: '#162E4A', border: '1px solid rgba(99,117,236,0.25)', borderRadius: 6, padding: '8px 10px', color: '#EEF2FF', fontSize: 13 }}
                  />
                </div>
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#94a3b8', cursor: 'pointer' }}>
                <input type="checkbox" checked={modal.form.poll_enabled} onChange={e => setField('poll_enabled', e.target.checked)} />
                Enable polling (timer trigger every 4 h)
              </label>
              {err && <div style={{ color: '#f87171', fontSize: 13 }}>{err}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={close}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Patient mappings panel ────────────────────────────────────────────────────

function LabMappingsPanel({ users, onRefresh }) {
  const [mappings, setMappings]   = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState(false);
  const [form, setForm]           = useState({ user_id: '', lab_name: '', lab_patient_id: '' });
  const [search, setSearch]       = useState('');
  const [busy, setBusy]           = useState(false);
  const [err, setErr]             = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mr, pr] = await Promise.all([axios.get('/api/lab-user-mappings'), axios.get('/api/lab-providers')]);
      setMappings(mr.data.mappings || []);
      setProviders(pr.data.providers || []);
    } catch { setMappings([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = search
    ? mappings.filter(m => m.nickname?.toLowerCase().includes(search.toLowerCase()) || m.lab_name.includes(search) || m.lab_patient_id.includes(search))
    : mappings;

  const del = async (m) => {
    if (!confirm(`Remove mapping ${m.lab_patient_id} → ${m.nickname}?`)) return;
    try { await axios.delete(`/api/lab-user-mappings/${m.id}`); load(); }
    catch (e) { alert(e.response?.data?.error || 'Delete failed'); }
  };

  const save = async () => {
    setBusy(true); setErr('');
    try {
      await axios.post('/api/lab-user-mappings', form);
      setModal(false); setForm({ user_id: '', lab_name: '', lab_patient_id: '' }); load(); onRefresh?.();
    } catch (e) { setErr(e.response?.data?.error || 'Save failed'); }
    finally { setBusy(false); }
  };

  const labNames = [...new Set(providers.map(p => p.lab_name))];

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Users}        label="Total Mappings" value={mappings.length}                                          color="#6366f1" />
        <StatCard icon={FlaskConical} label="Labs Connected" value={new Set(mappings.map(m => m.lab_name)).size}              color="#3b82f6" />
        <StatCard icon={Users}        label="Users Linked"   value={new Set(mappings.map(m => m.user_id)).size}               color="#10b981" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <input
            placeholder="Search user, lab, patient ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ background: '#162E4A', border: '1px solid rgba(99,117,236,0.2)', borderRadius: 6, padding: '6px 10px', color: '#EEF2FF', fontSize: 13, width: 240 }}
          />
          <span className="table-count" style={{ flex: 1 }}>{filtered.length} mapping{filtered.length !== 1 ? 's' : ''}</span>
          <button className="btn-primary" onClick={() => setModal(true)}><Plus size={14} />Link Patient</button>
        </div>
        <table className="data-table">
          <thead><tr><th>User</th><th>Lab</th><th>Lab Patient ID</th><th>Linked</th><th></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="empty-row">Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={5} className="empty-row">No mappings yet. Add one to start receiving lab results.</td></tr>}
            {filtered.map(m => (
              <tr key={m.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{m.nickname}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{m.user_id}</div>
                </td>
                <td><code style={{ fontSize: 12, color: '#a5b4fc' }}>{m.lab_name}</code></td>
                <td><code style={{ fontSize: 12 }}>{m.lab_patient_id}</code></td>
                <td style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(m.created_at).toLocaleDateString()}</td>
                <td><button className="icon-btn" style={{ color: '#ef4444' }} onClick={() => del(m)}><Trash2 size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>Link Lab Patient ID</span>
              <button className="icon-btn" onClick={() => setModal(false)}><X size={16} /></button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, color: '#94a3b8' }}>Nano User *</label>
                <select value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}
                  style={{ background: '#162E4A', border: '1px solid rgba(99,117,236,0.25)', borderRadius: 6, padding: '8px 10px', color: '#EEF2FF', fontSize: 13 }}>
                  <option value="">Select user…</option>
                  {users.map(u => <option key={u.user_id} value={u.user_id}>{u.nickname} ({u.user_id})</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, color: '#94a3b8' }}>Lab *</label>
                <select value={form.lab_name} onChange={e => setForm(f => ({ ...f, lab_name: e.target.value }))}
                  style={{ background: '#162E4A', border: '1px solid rgba(99,117,236,0.25)', borderRadius: 6, padding: '8px 10px', color: '#EEF2FF', fontSize: 13 }}>
                  <option value="">Select lab…</option>
                  {labNames.map(n => <option key={n} value={n}>{n}</option>)}
                  <option value="__custom">Other (type below)</option>
                </select>
                {form.lab_name === '__custom' && (
                  <input placeholder="adapter key, e.g. kingmed" value={form._custom_lab || ''} onChange={e => setForm(f => ({ ...f, _custom_lab: e.target.value }))}
                    style={{ marginTop: 4, background: '#162E4A', border: '1px solid rgba(99,117,236,0.25)', borderRadius: 6, padding: '8px 10px', color: '#EEF2FF', fontSize: 13 }} />
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 12, color: '#94a3b8' }}>Lab Patient ID *</label>
                <input value={form.lab_patient_id} onChange={e => setForm(f => ({ ...f, lab_patient_id: e.target.value }))} placeholder="as shown on the lab's system"
                  style={{ background: '#162E4A', border: '1px solid rgba(99,117,236,0.25)', borderRadius: 6, padding: '8px 10px', color: '#EEF2FF', fontSize: 13 }} />
              </div>
              {err && <div style={{ color: '#f87171', fontSize: 13 }}>{err}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => {
                const resolved = { ...form, lab_name: form.lab_name === '__custom' ? (form._custom_lab || '') : form.lab_name };
                setForm(f => ({ ...f, ...resolved }));
                save();
              }} disabled={busy}>{busy ? 'Saving…' : 'Link'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Reports panel ─────────────────────────────────────────────────────────────

function LabReportsPanel({ users }) {
  const [reports, setReports]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [detail, setDetail]     = useState(null); // { report, events }
  const [detailLoading, setDetailLoading] = useState(false);
  const [filterUser, setFilterUser] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterUser ? `?user_id=${filterUser}` : '';
      const r = await axios.get(`/api/lab/reports${params}`);
      setReports(r.data.reports || []);
    } catch { setReports([]); }
    finally { setLoading(false); }
  }, [filterUser]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (rep) => {
    setDetailLoading(true); setDetail({ report: rep, events: [] });
    try { const r = await axios.get(`/api/health-reports/${rep.id}`); setDetail(r.data); }
    catch { setDetail(d => ({ ...d, events: [] })); }
    finally { setDetailLoading(false); }
  };

  const SOURCE_COLOR = { lab_api: '#6366f1', manual_upload: '#10b981', fhir_import: '#f59e0b' };
  const STATUS_COLOR = { parsed: '#10b981', pending: '#f59e0b', error: '#ef4444' };

  return (
    <>
      <div className="stat-row">
        <StatCard icon={FileText}     label="Total Reports"  value={reports.length}                                             color="#6366f1" />
        <StatCard icon={Activity}     label="Parsed"         value={reports.filter(r => r.status === 'parsed').length}          color="#10b981" />
        <StatCard icon={FlaskConical} label="From Lab API"   value={reports.filter(r => r.source === 'lab_api').length}         color="#3b82f6" />
        <StatCard icon={Upload}       label="Manual Uploads" value={reports.filter(r => r.source === 'manual_upload').length}   color="#f59e0b" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)}
            style={{ background: '#162E4A', border: '1px solid rgba(99,117,236,0.2)', borderRadius: 6, padding: '6px 10px', color: '#EEF2FF', fontSize: 13, width: 200 }}>
            <option value="">All users</option>
            {users.map(u => <option key={u.user_id} value={u.user_id}>{u.nickname}</option>)}
          </select>
          <span className="table-count" style={{ flex: 1 }}>{reports.length} report{reports.length !== 1 ? 's' : ''}</span>
        </div>
        <table className="data-table">
          <thead><tr><th>User</th><th>Date</th><th>Source</th><th>Institution</th><th>Status</th><th>Events</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="empty-row">Loading…</td></tr>}
            {!loading && reports.length === 0 && <tr><td colSpan={8} className="empty-row">No reports yet.</td></tr>}
            {reports.map(r => (
              <tr key={r.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{r.nickname}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{r.user_id}</div>
                </td>
                <td>{r.report_date}</td>
                <td><span style={{ fontSize: 11, color: SOURCE_COLOR[r.source] || '#94a3b8', fontWeight: 600 }}>{r.source}</span></td>
                <td style={{ color: '#94a3b8', fontSize: 12 }}>{r.institution || '—'}</td>
                <td><span style={{ fontSize: 11, color: STATUS_COLOR[r.status] || '#94a3b8', fontWeight: 600 }}>{r.status}</span></td>
                <td style={{ color: '#94a3b8' }}>{r.event_count}</td>
                <td style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(r.created_at).toLocaleDateString()}</td>
                <td><button className="icon-btn" onClick={() => openDetail(r)} title="View observations"><Eye size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" style={{ maxWidth: 720, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>Report #{detail.report.id} — {detail.report.nickname || detail.report?.user_id} — {detail.report.report_date}</span>
              <button className="icon-btn" onClick={() => setDetail(null)}><X size={16} /></button>
            </div>
            <div style={{ overflowY: 'auto', padding: '16px 24px', flex: 1 }}>
              {detailLoading && <div style={{ color: '#94a3b8', textAlign: 'center', padding: 24 }}>Loading report…</div>}

              {/* ── Doctor Notes Section ── */}
              {!detailLoading && detail.report?.raw_data?.doctor_notes && (() => {
                const dn = detail.report.raw_data.doctor_notes;
                return (
                  <div style={{ marginBottom: 20 }}>
                    {/* Attending physician */}
                    {dn.physician && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>👨‍⚕️</div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{dn.physician}</div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>{dn.department} · {detail.report.institution}</div>
                        </div>
                      </div>
                    )}

                    {/* Vital signs summary */}
                    {dn.vital_summary && (
                      <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                        <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Vital Signs</div>
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
                        <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Diagnoses / Findings</div>
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
                        <div style={{ fontSize: 11, color: '#10b981', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Clinical Summary</div>
                        <p style={{ margin: 0, fontSize: 13, color: '#cbd5e1', lineHeight: 1.65 }}>{dn.clinical_summary}</p>
                      </div>
                    )}

                    {/* Recommendations */}
                    {dn.recommendations?.length > 0 && (
                      <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                        <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recommendations</div>
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
                        <span style={{ color: '#6366f1', fontWeight: 600 }}>Follow-up: </span>{dn.follow_up}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Biomarker Observations Table ── */}
              {!detailLoading && (detail.events || []).length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Lab Observations</div>
                  <table className="data-table">
                    <thead><tr><th>Biomarker</th><th>LOINC</th><th>Value</th><th>Unit</th><th>Dimension</th><th>Date</th></tr></thead>
                    <tbody>
                      {(detail.events || []).map(ev => (
                        <tr key={ev.id}>
                          <td style={{ fontWeight: ev.data?.is_kino_core ? 600 : 400, color: ev.data?.is_kino_core ? '#a5b4fc' : undefined }}>
                            {ev.data?.key_name || '—'}
                            {ev.data?.is_kino_core && <span style={{ marginLeft: 4, fontSize: 10, color: '#6366f1', fontWeight: 700 }}>CORE</span>}
                          </td>
                          <td style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{ev.data?.loinc_code || '—'}</td>
                          <td style={{ fontWeight: 600 }}>{ev.data?.value}</td>
                          <td style={{ color: '#94a3b8', fontSize: 12 }}>{ev.data?.unit}</td>
                          <td style={{ fontSize: 11, color: '#64748b' }}>{ev.data?.nano_dimension || '—'}</td>
                          <td style={{ fontSize: 11, color: '#94a3b8' }}>{ev.data_date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              {!detailLoading && (detail.events || []).length === 0 && !detail.report?.raw_data?.doctor_notes && (
                <div style={{ color: '#94a3b8', textAlign: 'center', padding: 24 }}>No observations linked to this report.</div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { LabTab };
