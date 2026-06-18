import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Plus, Pencil, Trash2, X, Check, Copy, Tag, UserCog, Settings2,
  Building2, Users, Cpu, Activity,
} from 'lucide-react';
import { useLang, fmt, fmtDate, Badge, StatCard } from '../shared.jsx';

const EMPTY_CHANNEL = {
  key_name: '',
  name: '',
  logo_url: '',
  parent_channel_id: '',
  persona_type: 'nano',
  locale: 'zh',
  credit_exchange_rate: '1.0',
  currency: 'CNY'
};

const SUB_AGE_KEYS_CONFIG = [
  { key: 'ResilienceAge',    defaultZh: '抗压年龄',   defaultEn: 'Resilience Age' },
  { key: 'CellularAge',      defaultZh: '细胞年龄',   defaultEn: 'Cellular Age' },
  { key: 'MetabolicAge',     defaultZh: '代谢年龄',   defaultEn: 'Metabolic Age' },
  { key: 'MicroVascularAge', defaultZh: '微血管年龄', defaultEn: 'Micro-Vascular Age' },
];

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

function ChannelModal({ channel, channels, isSuperadmin, parentChannel, onClose, onSave }) {
  const { t } = useLang();
  const ch = t.channels;
  const isEdit = !!channel?.id;
  const [form, setForm] = useState(isEdit
    ? { key_name: channel.key_name, name: channel.name || '', logo_url: channel.logo_url || '', parent_channel_id: channel.parent_channel_id || '', persona_type: channel.config?.persona_type ?? 'nano', locale: channel.config?.locale ?? 'zh', credit_exchange_rate: channel.config?.credit_exchange_rate ?? '1.0', currency: channel.config?.currency ?? 'CNY' }
    : { ...EMPTY_CHANNEL, parent_channel_id: parentChannel?.id || '', persona_type: parentChannel?.config?.persona_type ?? 'nano', locale: parentChannel?.config?.locale ?? 'zh' });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleLogoPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true); setUploadProgress(0); setError('');
    try {
      const presignRes = await axios.get('/api/oss/presign', {
        params: { type: 'logo', filename: file.name, category: 'channels' },
      });
      if (!presignRes.data.success) throw new Error(presignRes.data.error || t.modal.uploadChannelLogoFailed);
      const { url, get_url } = presignRes.data;
      await uploadToOSS(url, file, setUploadProgress);
      set('logo_url', get_url);
    } catch (err) {
      setError(err.response?.data?.error || err.message || t.modal.uploadChannelLogoFailed);
    } finally { setUploading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.key_name.trim()) { setError(t.modal.keyRequired); return; }
    if (!form.name.trim())     { setError(t.modal.nameRequired); return; }
    setBusy(true); setError('');
    try {
      if (isEdit) await axios.put(`/api/channels/${channel.id}`, form);
      else        await axios.post('/api/channels', { ...form, parent_channel_id: form.parent_channel_id || undefined });
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
            {!isEdit && parentChannel && (
              <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span>{ch.parentChannel}</span>
                <div style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border)', fontSize: 13, color: '#94a3b8' }}>
                  {parentChannel.name}
                </div>
              </label>
            )}
            {!isEdit && !parentChannel && isSuperadmin && (channels || []).length > 0 && (
              <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span>{ch.parentChannelOptional}</span>
                <select value={form.parent_channel_id} onChange={e => set('parent_channel_id', e.target.value)}>
                  <option value="">{ch.parentChannelNone}</option>
                  {(channels || []).map(c => {
                    const depth = c.depth != null ? c.depth : 0;
                    const indent = '   '.repeat(depth);
                    return <option key={c.id} value={c.id}>{indent}{c.name}</option>;
                  })}
                </select>
              </label>
            )}
            <label className="form-field">
              <span>{t.modal.channelPersonaType}</span>
              <select value={form.persona_type} onChange={e => set('persona_type', e.target.value)}>
                <option value="nano">{t.modal.channelPersonaNano}</option>
                <option value="viva">{t.modal.channelPersonaViva}</option>
              </select>
            </label>
            <label className="form-field">
              <span>{t.modal.channelLocale}</span>
              <select value={form.locale} onChange={e => set('locale', e.target.value)}>
                <option value="zh">{t.modal.channelLocaleZh}</option>
                <option value="en">{t.modal.channelLocaleEn}</option>
              </select>
            </label>
            <label className="form-field">
              <span>{t.modal.channelExchangeRate}</span>
              <input type="number" step="0.01" min="0.01" value={form.credit_exchange_rate}
                onChange={e => set('credit_exchange_rate', e.target.value)}
                placeholder={t.modal.channelExchangeRateHint} />
            </label>
            <label className="form-field">
              <span>{t.modal.channelCurrency}</span>
              <input value={form.currency} onChange={e => set('currency', e.target.value.toUpperCase())}
                placeholder={t.modal.channelCurrencyHint} maxLength={10} />
            </label>
            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal.channelLogoUrl}</span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
                {form.logo_url ? (
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <img src={form.logo_url} alt=""
                         style={{ width: 80, height: 80, borderRadius: 8, objectFit: 'cover', border: '1px solid rgba(99,117,236,0.3)' }} />
                    <button type="button" className="icon-btn" title={t.modal.removeChannelLogo}
                            onClick={() => set('logo_url', '')}
                            style={{ position: 'absolute', top: -6, right: -6, background: '#0F2540', border: '1px solid rgba(99,117,236,0.4)', borderRadius: '50%', width: 22, height: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <X size={12} />
                    </button>
                  </div>
                ) : null}
                <label className="upload-zone" style={{ flex: 1, minHeight: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: uploading ? 'wait' : 'pointer', flexDirection: 'column', gap: 6 }}>
                  <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" style={{ display: 'none' }} onChange={handleLogoPick} disabled={uploading} />
                  {uploading ? (
                    <>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{t.store.uploading}</span>
                      <div className="upload-progress" style={{ width: '80%' }}>
                        <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
                      </div>
                    </>
                  ) : (
                    <span className="upload-zone-hint" style={{ textAlign: 'center' }}>
                      {form.logo_url ? '↺ ' : ''}{t.modal.uploadChannelLogo}
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

const CONFIGURABLE_TABS = [
  { id: 'users',          label: 'Users' },
  { id: 'coaches',        label: 'Coaches' },
  { id: 'dots',           label: 'Dots' },
  { id: 'store',          label: 'Store' },
  { id: 'inventory',      label: 'Inventory' },
  { id: 'kino',           label: 'Kino' },
  { id: 'chips',          label: 'Chips' },
  { id: 'invites',        label: 'Invites' },
  { id: 'rewards',        label: 'Rewards' },
  { id: 'academy',        label: 'Academy' },
  { id: 'questionnaires', label: 'Questionnaires' },
  { id: 'health-plans',   label: 'Health Plans' },
  { id: 'reports',        label: 'Reports' },
  { id: 'tickets',        label: 'Tickets' },
  { id: 'lab',            label: 'Lab' },
  { id: 'subchannels',    label: 'Sub-channels (requires grant)' },
  { id: 'admin-accounts', label: 'Admin Accounts (requires grant)' },
];

function ChannelAdminTabsModal({ channel, onClose, onSave }) {
  const currentTabs = Array.isArray(channel.config?.admin_tabs) ? channel.config.admin_tabs : [];
  const [selected, setSelected] = useState(new Set(currentTabs));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const save = async () => {
    setBusy(true); setError('');
    try {
      await axios.put(`/api/channels/${channel.id}/admin-tabs`, { tabs: [...selected] });
      onSave();
    } catch (err) { setError(err.response?.data?.error || 'Save failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>Admin Tabs — {channel.name}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 12, color: '#94a3b8', fontSize: 13 }}>Select tabs channel admins can access:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {CONFIGURABLE_TABS.map(tab => (
              <label key={tab.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#EEF2FF', fontSize: 14 }}>
                <input type="checkbox" checked={selected.has(tab.id)} onChange={() => toggle(tab.id)} />
                {tab.label}
              </label>
            ))}
          </div>
          {error && <p className="form-error" style={{ marginTop: 8 }}>{error}</p>}
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={busy}>
              <Check size={14} />{busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChannelSubAgeLabelsModal({ channel, onClose, onSave }) {
  const existing = channel.config?.sub_age_display_names || {};
  const [labels, setLabels] = useState(
    Object.fromEntries(
      SUB_AGE_KEYS_CONFIG.map(({ key }) => [
        key,
        { zh: existing[key]?.zh || '', en: existing[key]?.en || '' },
      ])
    )
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (key, lang, val) =>
    setLabels(prev => ({ ...prev, [key]: { ...prev[key], [lang]: val } }));

  const save = async () => {
    setBusy(true); setError('');
    const payload = Object.fromEntries(
      SUB_AGE_KEYS_CONFIG
        .filter(({ key }) => labels[key].zh.trim() || labels[key].en.trim())
        .map(({ key }) => [key, { zh: labels[key].zh.trim(), en: labels[key].en.trim() }])
    );
    try {
      await axios.put(`/api/channels/${channel.id}/sub-age-labels`, { sub_age_display_names: payload });
      onSave();
    } catch (err) { setError(err.response?.data?.error || 'Save failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>Sub-Age Labels — {channel.name}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 12, color: '#94a3b8', fontSize: 13 }}>
            Override display names per dimension. Leave blank to use defaults.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: '#94a3b8', fontSize: 12 }}>Dimension</th>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: '#94a3b8', fontSize: 12 }}>Chinese (zh)</th>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: '#94a3b8', fontSize: 12 }}>English (en)</th>
              </tr>
            </thead>
            <tbody>
              {SUB_AGE_KEYS_CONFIG.map(({ key, defaultZh, defaultEn }) => (
                <tr key={key}>
                  <td style={{ padding: '6px 8px', fontSize: 13, color: '#1e293b', fontWeight: 500, whiteSpace: 'nowrap' }}>{key}</td>
                  <td style={{ padding: '4px 8px' }}>
                    <input className="form-input" placeholder={defaultZh} value={labels[key].zh}
                      onChange={e => set(key, 'zh', e.target.value)} />
                  </td>
                  <td style={{ padding: '4px 8px' }}>
                    <input className="form-input" placeholder={defaultEn} value={labels[key].en}
                      onChange={e => set(key, 'en', e.target.value)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {error && <p className="form-error" style={{ marginTop: 8 }}>{error}</p>}
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={busy}>
              <Check size={14} />{busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SubchannelAdminsModal({ subchannel, onClose, onSave }) {
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({ username: '', password: '' });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/api/admin-accounts')
      .then(r => setAccounts((r.data.accounts || []).filter(a => a.channel_id === subchannel.id)))
      .catch(() => setAccounts([]))
      .finally(() => setLoading(false));
  }, [subchannel.id]);

  const addAccount = async () => {
    if (!form.username || !form.password) return;
    setSaving(true); setErr('');
    try {
      await axios.post('/api/admin-accounts', { username: form.username, password: form.password, channel_id: subchannel.id });
      setForm({ username: '', password: '' });
      const r = await axios.get('/api/admin-accounts');
      setAccounts((r.data.accounts || []).filter(a => a.channel_id === subchannel.id));
    } catch (e) { setErr(e.response?.data?.error || 'Error'); }
    finally { setSaving(false); }
  };

  const delAccount = async (id) => {
    if (!window.confirm('Delete this admin account?')) return;
    try {
      await axios.delete(`/api/admin-accounts/${id}`);
      setAccounts(prev => prev.filter(a => a.id !== id));
      onSave();
    } catch (e) { alert(e.response?.data?.error || 'Error'); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>Admins — {subchannel.name}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {loading ? <p style={{ color: '#94a3b8' }}>Loading…</p> : (
            <>
              <table className="data-table" style={{ marginBottom: 16 }}>
                <thead><tr><th>Username</th><th>Created</th><th></th></tr></thead>
                <tbody>
                  {accounts.length === 0 && <tr><td colSpan={3} className="empty-row">No admins yet</td></tr>}
                  {accounts.map(a => (
                    <tr key={a.id}>
                      <td><strong>{a.username}</strong></td>
                      <td className="muted">{fmtDate(a.created_at)}</td>
                      <td><button className="icon-btn danger" onClick={() => delAccount(a.id)}><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>Add admin account</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input className="form-input" placeholder="Username" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} style={{ flex: 1, minWidth: 120 }} />
                <input className="form-input" type="password" placeholder="Password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} style={{ flex: 1, minWidth: 120 }} />
                <button className="btn-primary" onClick={addAccount} disabled={saving || !form.username || !form.password}>
                  {saving ? 'Adding…' : <><Plus size={14} />Add</>}
                </button>
              </div>
              {err && <p className="form-error" style={{ marginTop: 8 }}>{err}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SubchannelInvitesModal({ subchannel, onClose }) {
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    axios.get(`/api/invitations?channel_id=${subchannel.id}`)
      .then(r => setInvitations(r.data.invitations || []))
      .catch(() => setInvitations([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [subchannel.id]);

  const create = async () => {
    setCreating(true);
    try {
      await axios.post('/api/invitations', { channel_id: subchannel.id, type: 'channel' });
      load();
    } catch { /* silent */ } finally { setCreating(false); }
  };

  const deactivate = async (id) => {
    try { await axios.delete(`/api/invitations/${id}`); load(); } catch { /* silent */ }
  };

  const copy = (code) => {
    navigator.clipboard?.writeText(`pages/login/login?invite=${code}`);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>Invites — {subchannel.name}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn-primary" onClick={create} disabled={creating}>
              <Plus size={14} />{creating ? 'Creating…' : 'New Invite'}
            </button>
          </div>
          {loading ? <p style={{ color: '#94a3b8' }}>Loading…</p> : (
            <table className="data-table">
              <thead><tr><th>Code</th><th>Uses</th><th>Active</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {invitations.length === 0 && <tr><td colSpan={5} className="empty-row">No invites yet</td></tr>}
                {invitations.map(inv => (
                  <tr key={inv.id}>
                    <td><code className="code-tag">{inv.code}</code></td>
                    <td>{inv.use_count}{inv.max_uses ? ` / ${inv.max_uses}` : ''}</td>
                    <td><Badge color={inv.is_active ? '#10b981' : '#64748b'}>{inv.is_active ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="muted">{fmtDate(inv.created_at)}</td>
                    <td>
                      <div className="row-actions">
                        <button className="icon-btn" title="Copy link" onClick={() => copy(inv.code)}><Copy size={14} /></button>
                        {inv.is_active && <button className="icon-btn danger" title="Deactivate" onClick={() => deactivate(inv.id)}><Trash2 size={14} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function SubchannelsTab_UNUSED({ subchannels, adminAccounts, invitations, session, onRefresh }) {
  const [modal, setModal] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [togglingId, setTogglingId] = useState(null);
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  const rootId = parseInt(session?.channelId);

  const childrenOf = {};
  subchannels.forEach(c => {
    const pid = c.parent_channel_id;
    if (!childrenOf[pid]) childrenOf[pid] = [];
    childrenOf[pid].push(c);
  });

  const toggleExpand = (id) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const toggleCms = async (channel) => {
    setTogglingId(channel.id);
    try {
      await axios.put(`/api/channels/${channel.id}/manage-subchannels`, { can_manage_subchannels: !channel.can_manage_subchannels });
      onRefresh();
    } catch { } finally { setTogglingId(null); }
  };

  function renderRows(parentId, indent) {
    return (childrenOf[parentId] || []).flatMap(c => {
      const hasChildren = !!(childrenOf[c.id]?.length);
      const isOpen = expanded.has(c.id);
      return [
        <tr key={c.id}>
          <td className="muted">{c.id}</td>
          <td>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: indent * 20 }}>
              {hasChildren ? (
                <button className="icon-btn" style={{ padding: 0, width: 18, height: 18, flexShrink: 0, fontSize: 11 }} onClick={() => toggleExpand(c.id)}>
                  {isOpen ? '▾' : '▸'}
                </button>
              ) : (
                <span style={{ display: 'inline-block', width: 18, flexShrink: 0 }} />
              )}
              <code className="code-tag">{c.key_name}</code>
            </span>
          </td>
          <td className="bold">{c.name}</td>
          <td>
            {c.logo_url
              ? <img src={c.logo_url} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }} />
              : <span className="muted">—</span>}
          </td>
          <td><Badge color="#3b82f6">{c.user_count || 0}</Badge></td>
          <td><Badge color="#10b981">{c.coach_count || 0}</Badge></td>
          <td className="muted">{fmtDate(c.created_at)}</td>
          <td>
            <div className="row-actions">
              {c.autonomous && (
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, background: 'rgba(99,102,241,0.2)', color: '#818cf8', borderRadius: 4, padding: '2px 6px', textTransform: 'uppercase', border: '1px solid rgba(99,102,241,0.35)' }}>
                  AUTO
                </span>
              )}
              {session?.canManageSubchannels && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: 10, padding: '2px 6px', opacity: togglingId === c.id ? 0.5 : 1 }}
                  onClick={() => toggleCms(c)}
                  disabled={togglingId === c.id}
                  title={c.can_manage_subchannels ? 'Revoke sub-channel management' : 'Grant sub-channel management'}
                >
                  {c.can_manage_subchannels ? '✓ Sub-ch' : '+ Sub-ch'}
                </button>
              )}
              <button className="icon-btn" title="Edit" onClick={() => setModal({ type: 'edit', channel: c })}><Pencil size={14} /></button>
              <button className="icon-btn" title="Channel settings" onClick={() => setModal({ type: 'admin-tabs', channel: c })}><Settings2 size={14} /></button>
              <button className="icon-btn" title="Manage admins" onClick={() => setModal({ type: 'admins', channel: c })}><UserCog size={14} /></button>
              <button className="icon-btn" title="Manage invites" onClick={() => setModal({ type: 'invites', channel: c })}><Tag size={14} /></button>
              <button className="icon-btn danger" title="Delete" onClick={() => setModal({ type: 'delete', channel: c })}><Trash2 size={14} /></button>
            </div>
          </td>
        </tr>,
        ...(isOpen ? renderRows(c.id, indent + 1) : [])
      ];
    });
  }

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Building2} label="Sub-channels" value={subchannels.length} color="#6366f1" />
        <StatCard icon={Settings2} label="Sub-channel Admins" value={adminAccounts.length} color="#8b5cf6" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{subchannels.length} sub-channel{subchannels.length !== 1 ? 's' : ''}</span>
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
            <Plus size={14} />Add Sub-channel
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Key</th>
              <th>Name</th>
              <th>Logo</th>
              <th>Users</th>
              <th>Coaches</th>
              <th>Joined</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {subchannels.length === 0 && <tr><td colSpan={8} className="empty-row">No sub-channels yet. Create one to get started.</td></tr>}
            {renderRows(rootId, 0)}
          </tbody>
        </table>
      </div>
      {modal?.type === 'add'       && <ChannelModal channel={null}          onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit'      && <ChannelModal channel={modal.channel} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete'    && <DeleteChannelConfirm channel={modal.channel} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
      {modal?.type === 'admin-tabs' && <ChannelAdminTabsModal channel={modal.channel} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'admins'    && <SubchannelAdminsModal subchannel={modal.channel} onClose={() => setModal(null)} onSave={onRefresh} />}
      {modal?.type === 'invites'   && <SubchannelInvitesModal subchannel={modal.channel} onClose={() => setModal(null)} />}
    </>
  );
}

function ChannelConfigModal({ channel, isSuperadmin, canGrantSubch, hasSubchannels, subchannels, onClose, onSave, onRefreshData }) {
  const { t } = useLang();
  const ch = t.channels;
  const [activeTab, setActiveTab] = useState('general');

  // ── General ──────────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    key_name: channel.key_name,
    name: channel.name || '',
    logo_url: channel.logo_url || '',
    persona_type: channel.config?.persona_type ?? 'nano',
    credit_exchange_rate: channel.config?.credit_exchange_rate ?? '1.0',
    currency: channel.config?.currency ?? 'CNY',
  });
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [generalBusy, setGeneralBusy] = useState(false);
  const [generalError, setGeneralError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleLogoPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true); setUploadProgress(0); setGeneralError('');
    try {
      const presignRes = await axios.get('/api/oss/presign', { params: { type: 'logo', filename: file.name, category: 'channels' } });
      if (!presignRes.data.success) throw new Error(presignRes.data.error || t.modal.uploadChannelLogoFailed);
      await uploadToOSS(presignRes.data.url, file, setUploadProgress);
      set('logo_url', presignRes.data.get_url);
    } catch (err) { setGeneralError(err.response?.data?.error || err.message || t.modal.uploadChannelLogoFailed); }
    finally { setUploading(false); }
  };

  const saveGeneral = async () => {
    if (!form.name.trim()) { setGeneralError(t.modal.nameRequired); return; }
    setGeneralBusy(true); setGeneralError('');
    try { await axios.put(`/api/channels/${channel.id}`, form); onSave(); }
    catch (err) { setGeneralError(err.response?.data?.error || t.modal.saveFailed); }
    finally { setGeneralBusy(false); }
  };

  // Grant sub-channel toggle (in General tab)
  const [cmsValue, setCmsValue] = useState(channel.can_manage_subchannels ?? false);
  const [cmsToggling, setCmsToggling] = useState(false);
  const toggleCms = async () => {
    setCmsToggling(true);
    try {
      await axios.put(`/api/channels/${channel.id}/manage-subchannels`, { can_manage_subchannels: !cmsValue });
      setCmsValue(v => !v);
    } catch { } finally { setCmsToggling(false); }
  };

  // ── Admin Tabs ────────────────────────────────────────────────────────────────
  const [selectedTabs, setSelectedTabs] = useState(new Set(Array.isArray(channel.config?.admin_tabs) ? channel.config.admin_tabs : []));
  const [tabsBusy, setTabsBusy] = useState(false);
  const [tabsError, setTabsError] = useState('');
  const toggleTab = (id) => setSelectedTabs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const saveTabs = async () => {
    setTabsBusy(true); setTabsError('');
    try { await axios.put(`/api/channels/${channel.id}/admin-tabs`, { tabs: [...selectedTabs] }); onSave(); }
    catch (err) { setTabsError(err.response?.data?.error || 'Save failed'); }
    finally { setTabsBusy(false); }
  };

  // ── Sub-age Labels ────────────────────────────────────────────────────────────
  const existing = channel.config?.sub_age_display_names || {};
  const [labels, setLabels] = useState(
    Object.fromEntries(SUB_AGE_KEYS_CONFIG.map(({ key }) => [key, { zh: existing[key]?.zh || '', en: existing[key]?.en || '' }]))
  );
  const [labelsBusy, setLabelsBusy] = useState(false);
  const [labelsError, setLabelsError] = useState('');
  const setLabel = (key, lang, val) => setLabels(prev => ({ ...prev, [key]: { ...prev[key], [lang]: val } }));
  const saveLabels = async () => {
    setLabelsBusy(true); setLabelsError('');
    const payload = Object.fromEntries(
      SUB_AGE_KEYS_CONFIG
        .filter(({ key }) => labels[key].zh.trim() || labels[key].en.trim())
        .map(({ key }) => [key, { zh: labels[key].zh.trim(), en: labels[key].en.trim() }])
    );
    try { await axios.put(`/api/channels/${channel.id}/sub-age-labels`, { sub_age_display_names: payload }); onSave(); }
    catch (err) { setLabelsError(err.response?.data?.error || 'Save failed'); }
    finally { setLabelsBusy(false); }
  };

  // ── Admins tab ────────────────────────────────────────────────────────────────
  const [admins, setAdmins] = useState([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [adminForm, setAdminForm] = useState({ username: '', password: '' });
  const [adminErr, setAdminErr] = useState('');
  const [adminSaving, setAdminSaving] = useState(false);

  useEffect(() => {
    if (activeTab !== 'admins') return;
    setAdminsLoading(true);
    axios.get('/api/admin-accounts')
      .then(r => setAdmins((r.data.accounts || []).filter(a => a.channel_id === channel.id)))
      .catch(() => setAdmins([]))
      .finally(() => setAdminsLoading(false));
  }, [activeTab, channel.id]);

  const addAdmin = async () => {
    if (!adminForm.username || !adminForm.password) return;
    setAdminSaving(true); setAdminErr('');
    try {
      await axios.post('/api/admin-accounts', { username: adminForm.username, password: adminForm.password, channel_id: channel.id });
      setAdminForm({ username: '', password: '' });
      const r = await axios.get('/api/admin-accounts');
      setAdmins((r.data.accounts || []).filter(a => a.channel_id === channel.id));
    } catch (e) { setAdminErr(e.response?.data?.error || 'Error'); }
    finally { setAdminSaving(false); }
  };

  const delAdmin = async (id) => {
    if (!window.confirm(ch.confirmDeleteAdmin)) return;
    try {
      await axios.delete(`/api/admin-accounts/${id}`);
      setAdmins(prev => prev.filter(a => a.id !== id));
    } catch (e) { alert(e.response?.data?.error || 'Error'); }
  };

  // ── Invites tab ───────────────────────────────────────────────────────────────
  const [invites, setInvites] = useState([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteCreating, setInviteCreating] = useState(false);

  const loadInvites = () => {
    setInvitesLoading(true);
    axios.get(`/api/invitations?channel_id=${channel.id}`)
      .then(r => setInvites(r.data.invitations || []))
      .catch(() => setInvites([]))
      .finally(() => setInvitesLoading(false));
  };

  useEffect(() => { if (activeTab === 'invites') loadInvites(); }, [activeTab, channel.id]);

  const createInvite = async () => {
    setInviteCreating(true);
    try { await axios.post('/api/invitations', { channel_id: channel.id, type: 'channel' }); loadInvites(); }
    catch { } finally { setInviteCreating(false); }
  };

  const deactivateInvite = async (id) => {
    try { await axios.delete(`/api/invitations/${id}`); loadInvites(); } catch { }
  };

  // ── Danger tab ────────────────────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const doDelete = async () => {
    setDeleting(true); setDeleteError('');
    try { await axios.delete(`/api/channels/${channel.id}`); onSave(); }
    catch (e) { setDeleteError(e.response?.data?.error || 'Delete failed'); setDeleting(false); }
  };

  // ── Rewards tab ───────────────────────────────────────────────────────────────
  const [rewardsData, setRewardsData] = useState(null);
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [rewardsError, setRewardsError] = useState('');
  const [rewardsSaving, setRewardsSaving] = useState(false);
  const PRODUCT_TYPES = ['chip', 'dot', 'subscription'];
  const RATE_ROLES = ['coach', 'channel'];

  const emptyRatesForm = () => Object.fromEntries(
    PRODUCT_TYPES.flatMap(pt => RATE_ROLES.flatMap(role => [
      [`${role}_${pt}_flat`, ''],
      [`${role}_${pt}_pct`, ''],
    ]))
  );

  const [ratesForm, setRatesForm] = useState(emptyRatesForm);
  const [referralRate, setReferralRate] = useState('');

  const loadRewards = async () => {
    setRewardsLoading(true); setRewardsError('');
    try {
      const r = await axios.get(`/api/channels/${channel.id}/rewards-config`);
      setRewardsData(r.data);
      const cfg = r.data.commission_config || {};
      const form = emptyRatesForm();
      Object.keys(form).forEach(k => { if (cfg[k] != null) form[k] = String(cfg[k]); });
      setRatesForm(form);
      setReferralRate(r.data.referral_commission_rate != null ? String(r.data.referral_commission_rate) : '');
    } catch (e) { setRewardsError(e.response?.data?.error || 'Failed to load'); }
    finally { setRewardsLoading(false); }
  };

  const isRoot = !channel.parent_channel_id;
  const canEditRates = isSuperadmin || isRoot || channel.can_customize_rewards;

  // ── Partner Tiers tab ─────────────────────────────────────────────────────────
  const [chPartnerTypes, setChPartnerTypes] = useState([]);
  const [tierCfgData, setTierCfgData] = useState(null);
  const [tierCfgForm, setTierCfgForm] = useState(null);
  const [tierCfgLoading, setTierCfgLoading] = useState(false);
  const [tierCfgSaving, setTierCfgSaving] = useState(false);
  const [tierCfgError, setTierCfgError] = useState('');
  const [tierCfgMsg, setTierCfgMsg] = useState('');

  const canEditTierCfg = isSuperadmin || isRoot || channel.can_customize_partner_tiers;

  const loadTierCfg = async () => {
    setTierCfgLoading(true); setTierCfgError('');
    try {
      const [r, ptRes] = await Promise.all([
        axios.get(`/api/channels/${channel.id}/partner-tiers-config`),
        axios.get('/api/partner-types'),
      ]);
      const types = ptRes.data.types || [];
      setChPartnerTypes(types);
      setTierCfgData(r.data);
      const effective = r.data.partner_tiers_config || {};
      const merged = {};
      types.forEach(t => {
        merged[t.key] = { label: t.label, label_zh: t.label_zh || '', entry_fee: Number(t.entry_fee || 0), color: t.color, description: t.description || '', ...(effective[t.key] || {}) };
      });
      setTierCfgForm(merged);
    } catch (e) { setTierCfgError(e.response?.data?.error || 'Failed to load'); }
    finally { setTierCfgLoading(false); }
  };

  useEffect(() => {
    if (activeTab === 'rewards') loadRewards();
    if (activeTab === 'partner-tiers') loadTierCfg();
  }, [activeTab, channel.id]);

  const saveTierCfg = async () => {
    setTierCfgSaving(true); setTierCfgError(''); setTierCfgMsg('');
    try {
      await axios.put(`/api/channels/${channel.id}/partner-tiers-config`, { partner_tiers_config: tierCfgForm });
      setTierCfgMsg(ch.tierSaved);
      setTimeout(() => setTierCfgMsg(''), 3000);
      await loadTierCfg();
    } catch (e) { setTierCfgError(e.response?.data?.error || 'Save failed'); }
    finally { setTierCfgSaving(false); }
  };

  const resetTierCfg = async () => {
    if (!window.confirm('Clear custom tier config and revert to inherited?')) return;
    setTierCfgSaving(true); setTierCfgError('');
    try {
      await axios.put(`/api/channels/${channel.id}/partner-tiers-config`, { partner_tiers_config: null });
      await loadTierCfg();
    } catch (e) { setTierCfgError(e.response?.data?.error || 'Reset failed'); }
    finally { setTierCfgSaving(false); }
  };

  const toggleSubchTierPermission = async (subch) => {
    try {
      await axios.put(`/api/channels/${subch.id}/partner-tiers-permission`, { can_customize_partner_tiers: !subch.can_customize_partner_tiers });
      onRefreshData?.();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const toggleSubchStorePermission = async (subch) => {
    try {
      await axios.put(`/api/channels/${subch.id}/store-permission`, { can_customize_store: !subch.can_customize_store });
      onRefreshData?.();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const toggleOwnStorePermission = async () => {
    try {
      await axios.put(`/api/channels/${channel.id}/store-permission`, { can_customize_store: !channel.can_customize_store });
      onRefreshData?.();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const toggleSubchWarehousePermission = async (subch) => {
    try {
      await axios.put(`/api/channels/${subch.id}/warehouse-permission`, { can_manage_warehouses: !subch.can_manage_warehouses });
      onRefreshData?.();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const toggleOwnWarehousePermission = async () => {
    try {
      await axios.put(`/api/channels/${channel.id}/warehouse-permission`, { can_manage_warehouses: !channel.can_manage_warehouses });
      onRefreshData?.();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const toggleAutonomous = async () => {
    try {
      await axios.put(`/api/channels/${channel.id}/autonomous`, { autonomous: !channel.autonomous });
      onRefreshData?.();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  // ── Partner System tab ───────────────────────────────────────────────────────
  const [psTypes, setPsTypes] = useState([]);
  const [psRules, setPsRules] = useState([]);
  const [globalTypes, setGlobalTypes] = useState([]);
  const [psLoading, setPsLoading] = useState(false);
  const [psError, setPsError] = useState('');
  const [psMsg, setPsMsg] = useState('');

  // Type form state
  const psTypeEmpty = { key: '', label: '', label_zh: '', color: '#64748b', entry_fee: 0, sort_order: 0, description: '', is_active: true };
  const [psTypeForm, setPsTypeForm] = useState(psTypeEmpty);
  const [editingPsType, setEditingPsType] = useState(null);
  const [showPsTypeForm, setShowPsTypeForm] = useState(false);
  const [psTypeBusy, setPsTypeBusy] = useState(false);

  // Rule form state
  const psRuleEmpty = { event_type: 'referral', upline_level: '', earner_type: '', subject_type: '', rate: '', description: '', sort_order: 0 };
  const [psRuleForm, setPsRuleForm] = useState(psRuleEmpty);
  const [editingPsRule, setEditingPsRule] = useState(null);
  const [showPsRuleForm, setShowPsRuleForm] = useState(false);
  const [psRuleBusy, setPsRuleBusy] = useState(false);

  const loadPartnerSystem = async () => {
    setPsLoading(true); setPsError('');
    try {
      const [typesRes, rulesRes, globalRes] = await Promise.all([
        axios.get('/api/partner-types', { params: { channel_id: channel.id } }),
        axios.get('/api/partner-commission-rules', { params: { channel_id: channel.id } }),
        axios.get('/api/partner-types'),
      ]);
      setPsTypes(typesRes.data.types || []);
      setPsRules(rulesRes.data.rules || []);
      setGlobalTypes(globalRes.data.types || []);
    } catch (e) { setPsError(e.response?.data?.error || 'Failed to load'); }
    finally { setPsLoading(false); }
  };

  useEffect(() => { if (activeTab === 'partner-system') loadPartnerSystem(); }, [activeTab, channel.id]);

  const savePsType = async () => {
    setPsTypeBusy(true); setPsError('');
    try {
      if (editingPsType) {
        await axios.put(`/api/partner-types/${editingPsType.key}`, { ...psTypeForm, channel_id: channel.id });
      } else {
        await axios.post('/api/partner-types', { ...psTypeForm, channel_id: channel.id });
      }
      setShowPsTypeForm(false); setEditingPsType(null); setPsTypeForm(psTypeEmpty);
      setPsMsg('Saved'); setTimeout(() => setPsMsg(''), 2000);
      await loadPartnerSystem();
    } catch (e) { setPsError(e.response?.data?.error || 'Save failed'); }
    finally { setPsTypeBusy(false); }
  };

  const deactivatePsType = async (t) => {
    if (!window.confirm(`Deactivate type "${t.key}"?`)) return;
    try {
      await axios.delete(`/api/partner-types/${t.key}`, { data: { channel_id: channel.id } });
      await loadPartnerSystem();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const savePsRule = async () => {
    setPsRuleBusy(true); setPsError('');
    try {
      const payload = {
        event_type: psRuleForm.event_type,
        upline_level: psRuleForm.upline_level !== '' ? Number(psRuleForm.upline_level) : null,
        earner_type: psRuleForm.earner_type || null,
        subject_type: psRuleForm.subject_type || null,
        rate: Number(psRuleForm.rate),
        description: psRuleForm.description || null,
        sort_order: Number(psRuleForm.sort_order) || 0,
        channel_id: channel.id,
      };
      if (editingPsRule) {
        await axios.put(`/api/partner-commission-rules/${editingPsRule.id}`, payload);
      } else {
        await axios.post('/api/partner-commission-rules', payload);
      }
      setShowPsRuleForm(false); setEditingPsRule(null); setPsRuleForm(psRuleEmpty);
      setPsMsg('Saved'); setTimeout(() => setPsMsg(''), 2000);
      await loadPartnerSystem();
    } catch (e) { setPsError(e.response?.data?.error || 'Save failed'); }
    finally { setPsRuleBusy(false); }
  };

  const deletePsRule = async (rule) => {
    if (!window.confirm(`Delete rule "${rule.description || rule.event_type}"?`)) return;
    try {
      await axios.delete(`/api/partner-commission-rules/${rule.id}`);
      await loadPartnerSystem();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const toggleSubchPartnerSystemPermission = async (subch) => {
    try {
      await axios.put(`/api/channels/${subch.id}/partner-system-permission`, { can_customize_partner_system: !subch.can_customize_partner_system });
      onRefreshData?.();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const toggleOwnPartnerSystemPermission = async () => {
    try {
      await axios.put(`/api/channels/${channel.id}/partner-system-permission`, { can_customize_partner_system: !channel.can_customize_partner_system });
      onRefreshData?.();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  const saveRates = async () => {
    setRewardsSaving(true); setRewardsError('');
    try {
      const commission_config = {};
      Object.entries(ratesForm).forEach(([k, v]) => {
        if (v !== '') commission_config[k] = Number(v);
      });
      await axios.put(`/api/channels/${channel.id}/rewards-config`, {
        commission_config: Object.keys(commission_config).length ? commission_config : null,
        referral_commission_rate: referralRate !== '' ? Number(referralRate) : undefined,
      });
      await loadRewards();
    } catch (e) { setRewardsError(e.response?.data?.error || 'Save failed'); }
    finally { setRewardsSaving(false); }
  };

  const resetRates = async () => {
    if (!window.confirm('Clear custom rates and revert to inherited rates?')) return;
    setRewardsSaving(true); setRewardsError('');
    try {
      await axios.put(`/api/channels/${channel.id}/rewards-config`, { commission_config: null });
      await loadRewards();
    } catch (e) { setRewardsError(e.response?.data?.error || 'Reset failed'); }
    finally { setRewardsSaving(false); }
  };

  const toggleSubchRewardsPermission = async (subch) => {
    try {
      await axios.put(`/api/channels/${subch.id}/rewards-permission`, { can_customize_rewards: !subch.can_customize_rewards });
      onRefreshData?.();
    } catch (e) { alert(e.response?.data?.error || 'Failed'); }
  };

  // ── Tab list ──────────────────────────────────────────────────────────────────
  const configTabs = [
    { id: 'general', label: ch.tabGeneral },
    { id: 'admins', label: ch.tabAdmins },
    { id: 'invites', label: ch.tabInvites },
    { id: 'rewards', label: ch.tabRewards },
    { id: 'partner-tiers', label: ch.tabPartnerTiers },
    ...(isSuperadmin || channel.can_customize_partner_system ? [{ id: 'partner-system', label: ch.tabPartnerSystem }] : []),
    { id: 'store', label: ch.tabStore },
    ...(isSuperadmin ? [{ id: 'sub-age', label: ch.tabSubAge }] : []),
    { id: 'danger', label: ch.tabDanger, danger: true },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{ch.configTitle(channel.name)}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 10, flexWrap: 'wrap' }}>
            {configTabs.map(ct => (
              <button key={ct.id} onClick={() => setActiveTab(ct.id)} style={{
                padding: '4px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13,
                fontWeight: activeTab === ct.id ? 600 : 400,
                background: activeTab === ct.id ? (ct.danger ? 'rgba(239,68,68,0.15)' : 'rgba(99,102,241,0.15)') : 'transparent',
                color: activeTab === ct.id ? (ct.danger ? '#f87171' : '#818cf8') : (ct.danger ? '#f87171' : '#94a3b8'),
              }}>{ct.label}</button>
            ))}
          </div>

          {activeTab === 'general' && (
            <div className="form-grid">
              <label className="form-field">
                <span>{t.modal.channelKeyName}</span>
                <input value={form.key_name} disabled />
              </label>
              <label className="form-field">
                <span>{t.modal.channelName}</span>
                <input value={form.name} onChange={e => set('name', e.target.value)} />
              </label>
              <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span>{t.modal.channelPersonaType}</span>
                <select value={form.persona_type} onChange={e => set('persona_type', e.target.value)}>
                  <option value="nano">{t.modal.channelPersonaNano}</option>
                  <option value="viva">{t.modal.channelPersonaViva}</option>
                </select>
              </label>
              <label className="form-field">
                <span>{t.modal.channelExchangeRate}</span>
                <input type="number" step="0.01" min="0.01" value={form.credit_exchange_rate} onChange={e => set('credit_exchange_rate', e.target.value)} />
              </label>
              <label className="form-field">
                <span>{t.modal.channelCurrency}</span>
                <input value={form.currency} onChange={e => set('currency', e.target.value.toUpperCase())} maxLength={10} />
              </label>
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span>{t.modal.channelLogoUrl}</span>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
                  {form.logo_url && (
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <img src={form.logo_url} alt="" style={{ width: 80, height: 80, borderRadius: 8, objectFit: 'cover', border: '1px solid rgba(99,117,236,0.3)' }} />
                      <button type="button" className="icon-btn" onClick={() => set('logo_url', '')}
                        style={{ position: 'absolute', top: -6, right: -6, background: '#0F2540', border: '1px solid rgba(99,117,236,0.4)', borderRadius: '50%', width: 22, height: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <X size={12} />
                      </button>
                    </div>
                  )}
                  <label className="upload-zone" style={{ flex: 1, minHeight: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: uploading ? 'wait' : 'pointer', flexDirection: 'column', gap: 6 }}>
                    <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" style={{ display: 'none' }} onChange={handleLogoPick} disabled={uploading} />
                    {uploading ? (
                      <>
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>{t.store.uploading}</span>
                        <div className="upload-progress" style={{ width: '80%' }}><div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} /></div>
                      </>
                    ) : (
                      <span className="upload-zone-hint" style={{ textAlign: 'center' }}>{form.logo_url ? '↺ ' : ''}{t.modal.uploadChannelLogo}</span>
                    )}
                  </label>
                </div>
              </div>
              {canGrantSubch && (
                <div className="form-field" style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{ch.subchannelMgmt}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{ch.subchannelMgmtHint}</div>
                  </div>
                  <button
                    type="button"
                    onClick={toggleCms}
                    disabled={cmsToggling}
                    style={{
                      width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0,
                      background: cmsValue ? '#6366f1' : '#334155',
                      transition: 'background 0.2s', position: 'relative', opacity: cmsToggling ? 0.6 : 1,
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 3, width: 18, height: 18, borderRadius: '50%', background: '#fff',
                      transition: 'left 0.2s', left: cmsValue ? 23 : 3,
                    }} />
                  </button>
                </div>
              )}
              {isSuperadmin && (
                <div style={{
                  gridColumn: '1 / -1',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', borderRadius: 10, marginTop: 4,
                  background: channel.autonomous ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${channel.autonomous ? 'rgba(99,102,241,0.4)' : 'var(--border)'}`,
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      {channel.autonomous && (
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, background: '#6366f1', color: '#fff', borderRadius: 4, padding: '1px 6px', textTransform: 'uppercase' }}>
                          {ch.autonomousLabel}
                        </span>
                      )}
                      <span style={{ fontWeight: 700, fontSize: 13, color: channel.autonomous ? '#818cf8' : '#94a3b8' }}>
                        {channel.autonomous ? ch.autonomousEnabled : ch.autonomousDisabled}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      {channel.autonomous ? ch.autonomousHint : ch.autonomousDisabledHint}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={toggleAutonomous}
                    style={{
                      width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0,
                      background: channel.autonomous ? '#6366f1' : '#334155',
                      transition: 'background 0.2s', position: 'relative', marginLeft: 16,
                    }}
                    title={channel.autonomous ? ch.autonomousRevoke : ch.autonomousGrant}
                  >
                    <span style={{
                      position: 'absolute', top: 3, width: 18, height: 18, borderRadius: '50%', background: '#fff',
                      transition: 'left 0.2s', left: channel.autonomous ? 23 : 3,
                    }} />
                  </button>
                </div>
              )}
              {generalError && <div className="form-error" style={{ gridColumn: '1 / -1' }}>{generalError}</div>}
              <div className="modal-footer" style={{ gridColumn: '1 / -1' }}>
                <button className="btn-secondary" onClick={onClose} disabled={uploading}>{t.modal.cancel}</button>
                <button className="btn-primary" onClick={saveGeneral} disabled={generalBusy || uploading}>
                  <Check size={14} />{generalBusy ? t.modal.saving : t.modal.save}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'admin-tabs' && (
            <>
              <p style={{ marginBottom: 12, color: '#94a3b8', fontSize: 13 }}>{ch.adminTabsHint}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {CONFIGURABLE_TABS.map(tab => (
                  <label key={tab.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#EEF2FF', fontSize: 14 }}>
                    <input type="checkbox" checked={selectedTabs.has(tab.id)} onChange={() => toggleTab(tab.id)} />
                    {tab.label}
                  </label>
                ))}
              </div>
              {tabsError && <p className="form-error" style={{ marginTop: 8 }}>{tabsError}</p>}
              <div className="modal-footer">
                <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
                <button className="btn-primary" onClick={saveTabs} disabled={tabsBusy}>
                  <Check size={14} />{tabsBusy ? t.modal.saving : t.modal.save}
                </button>
              </div>
            </>
          )}

          {activeTab === 'admins' && (
            <>
              {adminsLoading ? <p style={{ color: '#94a3b8' }}>{ch.loading}</p> : (
                <>
                  <table className="data-table" style={{ marginBottom: 16 }}>
                    <thead><tr><th>{ch.colUsername}</th><th>{ch.colCreated}</th><th></th></tr></thead>
                    <tbody>
                      {admins.length === 0 && <tr><td colSpan={3} className="empty-row">{ch.noAdmins}</td></tr>}
                      {admins.map(a => (
                        <tr key={a.id}>
                          <td><strong>{a.username}</strong></td>
                          <td className="muted">{fmtDate(a.created_at)}</td>
                          <td><button className="icon-btn danger" onClick={() => delAdmin(a.id)}><Trash2 size={14} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>{ch.addAdminHint}</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input className="form-input" placeholder={ch.usernamePlaceholder} value={adminForm.username} onChange={e => setAdminForm(f => ({ ...f, username: e.target.value }))} style={{ flex: 1, minWidth: 120 }} />
                    <input className="form-input" type="password" placeholder={ch.passwordPlaceholder} value={adminForm.password} onChange={e => setAdminForm(f => ({ ...f, password: e.target.value }))} style={{ flex: 1, minWidth: 120 }} />
                    <button className="btn-primary" onClick={addAdmin} disabled={adminSaving || !adminForm.username || !adminForm.password}>
                      {adminSaving ? ch.adding : <><Plus size={14} />{ch.add}</>}
                    </button>
                  </div>
                  {adminErr && <p className="form-error" style={{ marginTop: 8 }}>{adminErr}</p>}
                </>
              )}
            </>
          )}

          {activeTab === 'invites' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <button className="btn-primary" onClick={createInvite} disabled={inviteCreating}>
                  <Plus size={14} />{inviteCreating ? ch.creating : ch.newInvite}
                </button>
              </div>
              {invitesLoading ? <p style={{ color: '#94a3b8' }}>{ch.loading}</p> : (
                <table className="data-table">
                  <thead><tr><th>{ch.colCode}</th><th>{ch.colUses}</th><th>{ch.colActive}</th><th>{t.table.joined}</th><th></th></tr></thead>
                  <tbody>
                    {invites.length === 0 && <tr><td colSpan={5} className="empty-row">{ch.noInvites}</td></tr>}
                    {invites.map(inv => (
                      <tr key={inv.id}>
                        <td><code className="code-tag">{inv.code}</code></td>
                        <td>{inv.use_count}{inv.max_uses ? ` / ${inv.max_uses}` : ''}</td>
                        <td><Badge color={inv.is_active ? '#10b981' : '#64748b'}>{inv.is_active ? ch.active : ch.inactive}</Badge></td>
                        <td className="muted">{fmtDate(inv.created_at)}</td>
                        <td>
                          <div className="row-actions">
                            <button className="icon-btn" title={ch.copyLink} onClick={() => navigator.clipboard?.writeText(`pages/login/login?invite=${inv.code}`)}><Copy size={14} /></button>
                            {inv.is_active && <button className="icon-btn danger" title={ch.deactivate} onClick={() => deactivateInvite(inv.id)}><Trash2 size={14} /></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {activeTab === 'sub-age' && isSuperadmin && (
            <>
              <p style={{ marginBottom: 12, color: '#94a3b8', fontSize: 13 }}>{ch.subAgeHint}</p>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: '#94a3b8', fontSize: 12 }}>{ch.colDimension}</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: '#94a3b8', fontSize: 12 }}>{ch.colZh}</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: '#94a3b8', fontSize: 12 }}>{ch.colEn}</th>
                  </tr>
                </thead>
                <tbody>
                  {SUB_AGE_KEYS_CONFIG.map(({ key, defaultZh, defaultEn }) => (
                    <tr key={key}>
                      <td style={{ padding: '6px 8px', fontSize: 13, color: '#1e293b', fontWeight: 500, whiteSpace: 'nowrap' }}>{key}</td>
                      <td style={{ padding: '4px 8px' }}>
                        <input className="form-input" placeholder={defaultZh} value={labels[key].zh} onChange={e => setLabel(key, 'zh', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <input className="form-input" placeholder={defaultEn} value={labels[key].en} onChange={e => setLabel(key, 'en', e.target.value)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {labelsError && <p className="form-error" style={{ marginTop: 8 }}>{labelsError}</p>}
              <div className="modal-footer">
                <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
                <button className="btn-primary" onClick={saveLabels} disabled={labelsBusy}>
                  <Check size={14} />{labelsBusy ? t.modal.saving : t.modal.save}
                </button>
              </div>
            </>
          )}

          {activeTab === 'rewards' && (
            <div>
              {rewardsLoading ? <p style={{ color: '#94a3b8' }}>{ch.loading}</p> : (
                <>
                  {/* Source badge */}
                  {rewardsData && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                        background: rewardsData.source === 'own' ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.15)',
                        color: rewardsData.source === 'own' ? '#10b981' : '#94a3b8' }}>
                        {rewardsData.source === 'own' ? ch.rewardsSrcOwn
                          : rewardsData.source === 'inherited' ? ch.rewardsSrcInherited(rewardsData.source_channel_name)
                          : ch.rewardsSrcGlobal}
                      </span>
                      {!canEditRates && (
                        <span style={{ fontSize: 12, color: '#64748b' }}>{ch.rewardsNoPermission}</span>
                      )}
                    </div>
                  )}

                  {/* Commission rates table */}
                  <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>{ch.rewardsRatesHint}</p>
                  <div style={{ overflowX: 'auto', marginBottom: 16 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '6px 8px', color: '#94a3b8', fontWeight: 500, fontSize: 12 }}>{ch.rewardsProduct}</th>
                          <th style={{ textAlign: 'center', padding: '6px 8px', color: '#94a3b8', fontWeight: 500, fontSize: 12 }} colSpan={2}>{ch.rewardsCoachComm}</th>
                          <th style={{ textAlign: 'center', padding: '6px 8px', color: '#94a3b8', fontWeight: 500, fontSize: 12 }} colSpan={2}>{ch.rewardsChannelComm}</th>
                        </tr>
                        <tr>
                          <th />
                          <th style={{ textAlign: 'center', padding: '2px 8px', color: '#64748b', fontWeight: 400, fontSize: 11 }}>{ch.rewardsFlat}</th>
                          <th style={{ textAlign: 'center', padding: '2px 8px', color: '#64748b', fontWeight: 400, fontSize: 11 }}>{ch.rewardsPct}</th>
                          <th style={{ textAlign: 'center', padding: '2px 8px', color: '#64748b', fontWeight: 400, fontSize: 11 }}>{ch.rewardsFlat}</th>
                          <th style={{ textAlign: 'center', padding: '2px 8px', color: '#64748b', fontWeight: 400, fontSize: 11 }}>{ch.rewardsPct}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {PRODUCT_TYPES.map(pt => (
                          <tr key={pt} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ padding: '6px 8px', fontWeight: 600, color: '#e2e8f0', textTransform: 'capitalize' }}>{pt}</td>
                            {RATE_ROLES.map(role => (
                              <>
                                <td key={`${role}_${pt}_flat`} style={{ padding: '4px 6px' }}>
                                  <input
                                    type="number" min="0" step="0.01"
                                    className="form-input"
                                    style={{ width: 80, textAlign: 'center' }}
                                    placeholder="—"
                                    value={ratesForm[`${role}_${pt}_flat`]}
                                    onChange={e => setRatesForm(f => ({ ...f, [`${role}_${pt}_flat`]: e.target.value }))}
                                    disabled={!canEditRates}
                                  />
                                </td>
                                <td key={`${role}_${pt}_pct`} style={{ padding: '4px 6px' }}>
                                  <input
                                    type="number" min="0" max="100" step="0.1"
                                    className="form-input"
                                    style={{ width: 80, textAlign: 'center' }}
                                    placeholder="—"
                                    value={ratesForm[`${role}_${pt}_pct`]}
                                    onChange={e => setRatesForm(f => ({ ...f, [`${role}_${pt}_pct`]: e.target.value }))}
                                    disabled={!canEditRates}
                                  />
                                </td>
                              </>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Referral rate */}
                  <label className="form-field" style={{ maxWidth: 220 }}>
                    <span style={{ fontSize: 12 }}>{ch.rewardsReferral}</span>
                    <input
                      type="number" min="0" max="100" step="0.1"
                      className="form-input"
                      placeholder="5"
                      value={referralRate}
                      onChange={e => setReferralRate(e.target.value)}
                      disabled={!canEditRates}
                    />
                  </label>

                  {rewardsError && <p className="form-error" style={{ marginTop: 8 }}>{rewardsError}</p>}

                  {canEditRates && (
                    <div className="modal-footer" style={{ marginTop: 16 }}>
                      {!isRoot && (
                        <button className="btn-secondary" onClick={resetRates} disabled={rewardsSaving} style={{ color: '#f87171' }}>
                          {ch.rewardsReset}
                        </button>
                      )}
                      <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
                      <button className="btn-primary" onClick={saveRates} disabled={rewardsSaving}>
                        <Check size={14} />{rewardsSaving ? t.modal.saving : ch.rewardsSave}
                      </button>
                    </div>
                  )}

                  {/* Sub-channel rewards permissions */}
                  {(isSuperadmin || canGrantSubch) && subchannels?.length > 0 && (
                    <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{ch.rewardsSubchTitle}</div>
                      <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>{ch.rewardsSubchHint}</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {subchannels.map(subch => (
                          <div key={subch.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--border)' }}>
                            <span style={{ fontSize: 13, color: '#e2e8f0' }}>{subch.name}</span>
                            <button
                              type="button"
                              onClick={() => toggleSubchRewardsPermission(subch)}
                              style={{
                                width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0,
                                background: subch.can_customize_rewards ? '#6366f1' : '#334155',
                                transition: 'background 0.2s', position: 'relative',
                              }}
                              title={subch.can_customize_rewards ? ch.rewardsRevoke : ch.rewardsAllow}
                            >
                              <span style={{
                                position: 'absolute', top: 3, width: 18, height: 18, borderRadius: '50%', background: '#fff',
                                transition: 'left 0.2s', left: subch.can_customize_rewards ? 23 : 3,
                              }} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'partner-tiers' && (
            <div>
              {tierCfgLoading ? <p style={{ color: '#94a3b8' }}>{ch.loading}</p> : (
                <>
                  {tierCfgData && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                      <span style={{
                        fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                        background: tierCfgData.source === 'own' ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.15)',
                        color: tierCfgData.source === 'own' ? '#10b981' : '#94a3b8',
                      }}>
                        {tierCfgData.source === 'own' ? ch.tierSrcOwn
                          : tierCfgData.source === 'inherited' ? ch.tierSrcInherited(tierCfgData.source_channel_name)
                          : ch.tierSrcGlobal}
                      </span>
                      {!canEditTierCfg && (
                        <span style={{ fontSize: 12, color: '#64748b' }}>{ch.tierNoPermission}</span>
                      )}
                    </div>
                  )}

                  {tierCfgForm && chPartnerTypes.map(pt => { const tk = pt.key;
                    const row = tierCfgForm[tk] || {};
                    const setField = (field, val) =>
                      setTierCfgForm(f => ({ ...f, [tk]: { ...f[tk], [field]: val } }));
                    return (
                      <div key={tk} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', marginBottom: 12, background: 'rgba(255,255,255,0.02)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <span style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0, background: row.color || '#64748b', border: '1px solid rgba(255,255,255,0.2)', display: 'inline-block' }} />
                          <span style={{ fontWeight: 600, fontSize: 13, color: '#e2e8f0' }}>{row.label || tk}</span>
                          <code style={{ fontSize: 10, color: '#64748b', marginLeft: 'auto' }}>{tk}</code>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <label className="form-field">
                            <span style={{ fontSize: 12 }}>{ch.tierLabelEn}</span>
                            <input className="form-input" value={row.label || ''} onChange={e => setField('label', e.target.value)} disabled={!canEditTierCfg} />
                          </label>
                          <label className="form-field">
                            <span style={{ fontSize: 12 }}>{ch.tierLabelZh}</span>
                            <input className="form-input" value={row.label_zh || ''} onChange={e => setField('label_zh', e.target.value)} disabled={!canEditTierCfg} />
                          </label>
                          <label className="form-field">
                            <span style={{ fontSize: 12 }}>{ch.tierEntryFee}</span>
                            <input className="form-input" type="number" min="0" step="100"
                              value={row.entry_fee ?? ''}
                              onChange={e => setField('entry_fee', e.target.value === '' ? '' : Number(e.target.value))}
                              disabled={!canEditTierCfg} />
                          </label>
                          <label className="form-field">
                            <span style={{ fontSize: 12 }}>{ch.tierColor}</span>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <input type="color" value={row.color || '#64748b'}
                                onChange={e => setField('color', e.target.value)}
                                disabled={!canEditTierCfg}
                                style={{ width: 36, height: 32, padding: 2, borderRadius: 4, border: '1px solid var(--border)', cursor: canEditTierCfg ? 'pointer' : 'default' }} />
                              <input className="form-input" value={row.color || ''} onChange={e => setField('color', e.target.value)} disabled={!canEditTierCfg} placeholder="#0ea5e9" style={{ flex: 1 }} />
                            </div>
                          </label>
                          <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                            <span style={{ fontSize: 12 }}>{ch.tierDescription}</span>
                            <input className="form-input" value={row.description || ''} onChange={e => setField('description', e.target.value)} disabled={!canEditTierCfg} placeholder="Optional" />
                          </label>
                        </div>
                      </div>
                    );
                  })}

                  {tierCfgError && <p className="form-error" style={{ marginTop: 8 }}>{tierCfgError}</p>}

                  {canEditTierCfg && (
                    <div className="modal-footer" style={{ marginTop: 16 }}>
                      {tierCfgMsg && <span style={{ fontSize: 13, color: '#16a34a', marginRight: 'auto' }}>{tierCfgMsg}</span>}
                      {!isRoot && (
                        <button className="btn-secondary" onClick={resetTierCfg} disabled={tierCfgSaving} style={{ color: '#f87171' }}>
                          {ch.tierReset}
                        </button>
                      )}
                      <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
                      <button className="btn-primary" onClick={saveTierCfg} disabled={tierCfgSaving}>
                        <Check size={14} />{tierCfgSaving ? t.modal.saving : ch.tierSave}
                      </button>
                    </div>
                  )}

                  {(isSuperadmin || canGrantSubch) && subchannels?.length > 0 && (
                    <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{ch.tierSubchTitle}</div>
                      <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>{ch.tierSubchHint}</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {subchannels.map(subch => (
                          <div key={subch.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--border)' }}>
                            <span style={{ fontSize: 13, color: '#e2e8f0' }}>{subch.name}</span>
                            <button
                              type="button"
                              onClick={() => toggleSubchTierPermission(subch)}
                              style={{
                                width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0,
                                background: subch.can_customize_partner_tiers ? '#6366f1' : '#334155',
                                transition: 'background 0.2s', position: 'relative',
                              }}
                              title={subch.can_customize_partner_tiers ? ch.tierRevoke : ch.tierAllow}
                            >
                              <span style={{
                                position: 'absolute', top: 3, width: 18, height: 18, borderRadius: '50%', background: '#fff',
                                transition: 'left 0.2s', left: subch.can_customize_partner_tiers ? 23 : 3,
                              }} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'partner-system' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Permission status */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: channel.can_customize_partner_system ? '#10b981' : '#94a3b8', marginBottom: 4 }}>
                    {channel.can_customize_partner_system ? ch.psPermEnabled : ch.psPermDisabled}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {channel.can_customize_partner_system ? ch.psPermHint : ch.psPermDisabledHint}
                  </div>
                </div>
                {isSuperadmin && (
                  <button type="button" onClick={toggleOwnPartnerSystemPermission} style={{
                    width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0,
                    background: channel.can_customize_partner_system ? '#6366f1' : '#334155', transition: 'background 0.2s', position: 'relative',
                  }} title={channel.can_customize_partner_system ? ch.psRevoke : ch.psAllow}>
                    <span style={{ position: 'absolute', top: 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', left: channel.can_customize_partner_system ? 23 : 3 }} />
                  </button>
                )}
              </div>

              {channel.can_customize_partner_system ? (
                psLoading ? (
                  <p style={{ fontSize: 13, color: '#94a3b8' }}>Loading…</p>
                ) : (
                  <>
                    {psError && <p className="form-error">{psError}</p>}
                    {psMsg && <p style={{ fontSize: 13, color: '#16a34a' }}>{psMsg}</p>}

                    {/* ── Partner Types ──────────────────────────────────────── */}
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{ch.psTypesTitle}</span>
                        <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => { setPsTypeForm(psTypeEmpty); setEditingPsType(null); setShowPsTypeForm(true); }}>
                          + {ch.psAddType}
                        </button>
                      </div>
                      {psTypes.length === 0 ? (
                        <p style={{ fontSize: 12, color: '#64748b' }}>{ch.psNoTypes}</p>
                      ) : (
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ color: '#64748b', borderBottom: '1px solid var(--border)' }}>
                              <th style={{ textAlign: 'left', padding: '4px 6px' }}>Key</th>
                              <th style={{ textAlign: 'left', padding: '4px 6px' }}>Label</th>
                              <th style={{ textAlign: 'left', padding: '4px 6px' }}>Color</th>
                              <th style={{ textAlign: 'right', padding: '4px 6px' }}>Fee</th>
                              <th style={{ padding: '4px 6px' }}>Status</th>
                              <th style={{ padding: '4px 6px' }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {psTypes.map(t => (
                              <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                <td style={{ padding: '5px 6px', fontFamily: 'monospace', color: '#94a3b8' }}>{t.key}</td>
                                <td style={{ padding: '5px 6px' }}>{t.label_zh || t.label}</td>
                                <td style={{ padding: '5px 6px' }}>
                                  <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: t.color, verticalAlign: 'middle', marginRight: 4 }} />
                                  <span style={{ color: '#64748b', fontFamily: 'monospace' }}>{t.color}</span>
                                </td>
                                <td style={{ padding: '5px 6px', textAlign: 'right' }}>¥{Number(t.entry_fee).toLocaleString()}</td>
                                <td style={{ padding: '5px 6px', textAlign: 'center' }}>
                                  <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: t.is_active ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', color: t.is_active ? '#10b981' : '#ef4444' }}>
                                    {t.is_active ? 'Active' : 'Inactive'}
                                  </span>
                                </td>
                                <td style={{ padding: '5px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                  <button className="btn-secondary" style={{ fontSize: 11, padding: '2px 8px', marginRight: 4 }} onClick={() => { setPsTypeForm({ key: t.key, label: t.label, label_zh: t.label_zh || '', color: t.color, entry_fee: t.entry_fee, sort_order: t.sort_order, description: t.description || '', is_active: t.is_active }); setEditingPsType(t); setShowPsTypeForm(true); }}>
                                    {ch.psEditType}
                                  </button>
                                  {t.is_active && (
                                    <button className="btn-secondary" style={{ fontSize: 11, padding: '2px 8px', color: '#f87171' }} onClick={() => deactivatePsType(t)}>
                                      {ch.psDeactivateType}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}

                      {/* Type form */}
                      {showPsTypeForm && (
                        <div style={{ marginTop: 12, padding: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--border)' }}>
                          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10 }}>{editingPsType ? `Edit: ${editingPsType.key}` : 'New Partner Type'}</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            {!editingPsType && (
                              <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                                <span style={{ fontSize: 11 }}>{ch.psTypeKey} *</span>
                                <input className="form-input" value={psTypeForm.key} onChange={e => setPsTypeForm(f => ({ ...f, key: e.target.value }))} placeholder="e.g. gold_partner" />
                              </label>
                            )}
                            <label className="form-field">
                              <span style={{ fontSize: 11 }}>{ch.psTypeLabelEn} *</span>
                              <input className="form-input" value={psTypeForm.label} onChange={e => setPsTypeForm(f => ({ ...f, label: e.target.value }))} />
                            </label>
                            <label className="form-field">
                              <span style={{ fontSize: 11 }}>{ch.psTypeLabelZh}</span>
                              <input className="form-input" value={psTypeForm.label_zh} onChange={e => setPsTypeForm(f => ({ ...f, label_zh: e.target.value }))} />
                            </label>
                            <label className="form-field">
                              <span style={{ fontSize: 11 }}>{ch.psTypeColor}</span>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <input type="color" value={psTypeForm.color} onChange={e => setPsTypeForm(f => ({ ...f, color: e.target.value }))} style={{ width: 32, height: 28, padding: 2, borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer' }} />
                                <input className="form-input" value={psTypeForm.color} onChange={e => setPsTypeForm(f => ({ ...f, color: e.target.value }))} style={{ flex: 1 }} />
                              </div>
                            </label>
                            <label className="form-field">
                              <span style={{ fontSize: 11 }}>{ch.psTypeEntryFee}</span>
                              <input type="number" className="form-input" value={psTypeForm.entry_fee} onChange={e => setPsTypeForm(f => ({ ...f, entry_fee: Number(e.target.value) }))} />
                            </label>
                            <label className="form-field">
                              <span style={{ fontSize: 11 }}>{ch.psTypeSortOrder}</span>
                              <input type="number" className="form-input" value={psTypeForm.sort_order} onChange={e => setPsTypeForm(f => ({ ...f, sort_order: Number(e.target.value) }))} />
                            </label>
                            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                              <span style={{ fontSize: 11 }}>{ch.psTypeDesc}</span>
                              <input className="form-input" value={psTypeForm.description} onChange={e => setPsTypeForm(f => ({ ...f, description: e.target.value }))} />
                            </label>
                            {editingPsType && (
                              <label className="form-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <input type="checkbox" checked={psTypeForm.is_active} onChange={e => setPsTypeForm(f => ({ ...f, is_active: e.target.checked }))} />
                                <span style={{ fontSize: 11 }}>{ch.psTypeActive}</span>
                              </label>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                            <button className="btn-secondary" onClick={() => { setShowPsTypeForm(false); setEditingPsType(null); }}>{t.modal.cancel}</button>
                            <button className="btn-primary" onClick={savePsType} disabled={psTypeBusy}>{psTypeBusy ? ch.psSaving : t.modal.save}</button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ── Commission Rules ──────────────────────────────────── */}
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{ch.psRulesTitle}</span>
                        <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => { setPsRuleForm(psRuleEmpty); setEditingPsRule(null); setShowPsRuleForm(true); }}>
                          + {ch.psAddRule}
                        </button>
                      </div>
                      <p style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>{ch.psGlobalTypesHint}</p>
                      {psRules.length === 0 ? (
                        <p style={{ fontSize: 12, color: '#64748b' }}>{ch.psNoRules}</p>
                      ) : (
                        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ color: '#64748b', borderBottom: '1px solid var(--border)' }}>
                              <th style={{ textAlign: 'left', padding: '4px 6px' }}>Event</th>
                              <th style={{ textAlign: 'left', padding: '4px 6px' }}>Lvl</th>
                              <th style={{ textAlign: 'left', padding: '4px 6px' }}>Earner</th>
                              <th style={{ textAlign: 'left', padding: '4px 6px' }}>Subject</th>
                              <th style={{ textAlign: 'right', padding: '4px 6px' }}>Rate</th>
                              <th style={{ padding: '4px 6px' }}>On</th>
                              <th style={{ padding: '4px 6px' }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {psRules.map(r => (
                              <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: r.is_active ? 1 : 0.5 }}>
                                <td style={{ padding: '4px 6px', fontFamily: 'monospace', fontSize: 10 }}>{r.event_type}</td>
                                <td style={{ padding: '4px 6px', color: '#94a3b8' }}>{r.upline_level ?? '—'}</td>
                                <td style={{ padding: '4px 6px', color: '#94a3b8' }}>{r.earner_type || '*'}</td>
                                <td style={{ padding: '4px 6px', color: '#94a3b8' }}>{r.subject_type || '*'}</td>
                                <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600 }}>{(Number(r.rate) * 100).toFixed(1)}%</td>
                                <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: r.is_active ? '#10b981' : '#475569' }} />
                                </td>
                                <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                                  <button className="btn-secondary" style={{ fontSize: 10, padding: '1px 6px', marginRight: 3 }} onClick={() => { setPsRuleForm({ event_type: r.event_type, upline_level: r.upline_level ?? '', earner_type: r.earner_type || '', subject_type: r.subject_type || '', rate: r.rate, description: r.description || '', sort_order: r.sort_order }); setEditingPsRule(r); setShowPsRuleForm(true); }}>
                                    {ch.psEditRule}
                                  </button>
                                  <button className="btn-secondary" style={{ fontSize: 10, padding: '1px 6px', color: '#f87171' }} onClick={() => deletePsRule(r)}>
                                    {ch.psDeleteRule}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}

                      {/* Rule form */}
                      {showPsRuleForm && (
                        <div style={{ marginTop: 12, padding: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--border)' }}>
                          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10 }}>{editingPsRule ? 'Edit Rule' : 'New Commission Rule'}</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <label className="form-field">
                              <span style={{ fontSize: 11 }}>{ch.psRuleEventType} *</span>
                              <select className="form-input" value={psRuleForm.event_type} onChange={e => setPsRuleForm(f => ({ ...f, event_type: e.target.value }))} disabled={!!editingPsRule}>
                                <option value="referral">referral</option>
                                <option value="team_income">team_income</option>
                                <option value="product_discount">product_discount</option>
                                <option value="training_discount">training_discount</option>
                              </select>
                            </label>
                            <label className="form-field">
                              <span style={{ fontSize: 11 }}>{ch.psRuleUplineLevel} (blank=none)</span>
                              <input type="number" className="form-input" value={psRuleForm.upline_level} onChange={e => setPsRuleForm(f => ({ ...f, upline_level: e.target.value }))} placeholder="e.g. 1" disabled={!!editingPsRule} />
                            </label>
                            <label className="form-field">
                              <span style={{ fontSize: 11 }}>{ch.psRuleEarnerType} (blank=any)</span>
                              <select className="form-input" value={psRuleForm.earner_type} onChange={e => setPsRuleForm(f => ({ ...f, earner_type: e.target.value }))} disabled={!!editingPsRule}>
                                <option value="">* (any)</option>
                                {(psTypes.length > 0 ? psTypes : globalTypes).map(pt => <option key={pt.key} value={pt.key}>{pt.key}</option>)}
                              </select>
                            </label>
                            <label className="form-field">
                              <span style={{ fontSize: 11 }}>{ch.psRuleSubjectType} (blank=any)</span>
                              <select className="form-input" value={psRuleForm.subject_type} onChange={e => setPsRuleForm(f => ({ ...f, subject_type: e.target.value }))} disabled={!!editingPsRule}>
                                <option value="">* (any)</option>
                                {(psTypes.length > 0 ? psTypes : globalTypes).map(pt => <option key={pt.key} value={pt.key}>{pt.key}</option>)}
                              </select>
                            </label>
                            <label className="form-field">
                              <span style={{ fontSize: 11 }}>{ch.psRuleRate} *</span>
                              <input type="number" step="0.001" min="0" max="1" className="form-input" value={psRuleForm.rate} onChange={e => setPsRuleForm(f => ({ ...f, rate: e.target.value }))} placeholder="0.25" />
                            </label>
                            <label className="form-field">
                              <span style={{ fontSize: 11 }}>{ch.psRuleSortOrder}</span>
                              <input type="number" className="form-input" value={psRuleForm.sort_order} onChange={e => setPsRuleForm(f => ({ ...f, sort_order: e.target.value }))} />
                            </label>
                            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                              <span style={{ fontSize: 11 }}>{ch.psRuleDesc}</span>
                              <input className="form-input" value={psRuleForm.description} onChange={e => setPsRuleForm(f => ({ ...f, description: e.target.value }))} />
                            </label>
                          </div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                            <button className="btn-secondary" onClick={() => { setShowPsRuleForm(false); setEditingPsRule(null); }}>{t.modal.cancel}</button>
                            <button className="btn-primary" onClick={savePsRule} disabled={psRuleBusy}>{psRuleBusy ? ch.psSaving : t.modal.save}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )
              ) : (
                !isSuperadmin && <p style={{ fontSize: 13, color: '#64748b' }}>{ch.psNoPermission}</p>
              )}

              {/* Subchannel permissions */}
              {(isSuperadmin || canGrantSubch) && subchannels?.length > 0 && (
                <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{ch.psSubchTitle}</div>
                  <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>{ch.psSubchHint}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {subchannels.map(subch => (
                      <div key={subch.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 13, color: '#e2e8f0' }}>{subch.name}</span>
                        <button type="button" onClick={() => toggleSubchPartnerSystemPermission(subch)} style={{
                          width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0,
                          background: subch.can_customize_partner_system ? '#6366f1' : '#334155',
                          transition: 'background 0.2s', position: 'relative',
                        }} title={subch.can_customize_partner_system ? ch.psRevoke : ch.psAllow}>
                          <span style={{ position: 'absolute', top: 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', left: subch.can_customize_partner_system ? 23 : 3 }} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'store' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Own channel store permission status */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: channel.can_customize_store ? '#10b981' : '#94a3b8', marginBottom: 4 }}>
                    {channel.can_customize_store ? ch.storePermEnabled : ch.storePermDisabled}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {channel.can_customize_store ? ch.storePermHint : ch.storePermDisabledHint}
                  </div>
                </div>
                {isSuperadmin && (
                  <button
                    type="button"
                    onClick={toggleOwnStorePermission}
                    style={{
                      width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0,
                      background: channel.can_customize_store ? '#6366f1' : '#334155',
                      transition: 'background 0.2s', position: 'relative',
                    }}
                    title={channel.can_customize_store ? ch.storeRevoke : ch.storeAllow}
                  >
                    <span style={{
                      position: 'absolute', top: 3, width: 18, height: 18, borderRadius: '50%', background: '#fff',
                      transition: 'left 0.2s', left: channel.can_customize_store ? 23 : 3,
                    }} />
                  </button>
                )}
              </div>

              {/* Warehouse management permission */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: channel.can_manage_warehouses ? '#10b981' : '#94a3b8', marginBottom: 4 }}>
                    {channel.can_manage_warehouses ? ch.warehousePermEnabled : ch.warehousePermDisabled}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {channel.can_manage_warehouses ? ch.warehousePermHint : ch.warehousePermDisabledHint}
                  </div>
                </div>
                {isSuperadmin && (
                  <button
                    type="button"
                    onClick={toggleOwnWarehousePermission}
                    style={{
                      width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0,
                      background: channel.can_manage_warehouses ? '#6366f1' : '#334155',
                      transition: 'background 0.2s', position: 'relative',
                    }}
                    title={channel.can_manage_warehouses ? ch.warehouseRevoke : ch.warehouseAllow}
                  >
                    <span style={{
                      position: 'absolute', top: 3, width: 18, height: 18, borderRadius: '50%', background: '#fff',
                      transition: 'left 0.2s', left: channel.can_manage_warehouses ? 23 : 3,
                    }} />
                  </button>
                )}
              </div>

              {/* Sub-channel warehouse permissions */}
              {(isSuperadmin || (canGrantSubch && channel.can_manage_warehouses)) && subchannels?.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{ch.warehouseSubchTitle}</div>
                  <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>{ch.warehouseSubchHint}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {subchannels.map(subch => (
                      <div key={subch.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 13, color: '#e2e8f0' }}>{subch.name}</span>
                        <button
                          type="button"
                          onClick={() => toggleSubchWarehousePermission(subch)}
                          style={{
                            width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0,
                            background: subch.can_manage_warehouses ? '#6366f1' : '#334155',
                            transition: 'background 0.2s', position: 'relative',
                          }}
                          title={subch.can_manage_warehouses ? ch.warehouseRevoke : ch.warehouseAllow}
                        >
                          <span style={{
                            position: 'absolute', top: 3, width: 18, height: 18, borderRadius: '50%', background: '#fff',
                            transition: 'left 0.2s', left: subch.can_manage_warehouses ? 23 : 3,
                          }} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sub-channel store permissions */}
              {(isSuperadmin || (canGrantSubch && channel.can_customize_store)) && subchannels?.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{ch.storeSubchTitle}</div>
                  <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>{ch.storeSubchHint}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {subchannels.map(subch => (
                      <div key={subch.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 13, color: '#e2e8f0' }}>{subch.name}</span>
                        <button
                          type="button"
                          onClick={() => toggleSubchStorePermission(subch)}
                          style={{
                            width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0,
                            background: subch.can_customize_store ? '#6366f1' : '#334155',
                            transition: 'background 0.2s', position: 'relative',
                          }}
                          title={subch.can_customize_store ? ch.storeRevoke : ch.storeAllow}
                        >
                          <span style={{
                            position: 'absolute', top: 3, width: 18, height: 18, borderRadius: '50%', background: '#fff',
                            transition: 'left 0.2s', left: subch.can_customize_store ? 23 : 3,
                          }} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'danger' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {hasSubchannels ? (
                <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '14px 16px' }}>
                  <div style={{ fontWeight: 600, color: '#f87171', marginBottom: 6 }}>{ch.dangerBlockedTitle}</div>
                  <div style={{ fontSize: 13, color: '#94a3b8' }}>{ch.dangerBlockedHint}</div>
                </div>
              ) : (
                <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '14px 16px' }}>
                  <div style={{ fontWeight: 600, color: '#f87171', marginBottom: 6 }}>{ch.dangerDeleteTitle}</div>
                  <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 14 }}>
                    {ch.dangerDeleteHintPre}<strong style={{ color: '#e2e8f0' }}>{channel.name}</strong>{ch.dangerDeleteHintPost}
                  </div>
                  <input
                    className="form-input"
                    placeholder={ch.dangerDeletePlaceholder(channel.name)}
                    value={deleteConfirm}
                    onChange={e => setDeleteConfirm(e.target.value)}
                    style={{ marginBottom: 12 }}
                  />
                  {deleteError && <p className="form-error" style={{ marginBottom: 8 }}>{deleteError}</p>}
                  <button
                    className="btn-primary"
                    style={{ background: '#ef4444', borderColor: '#ef4444' }}
                    onClick={doDelete}
                    disabled={deleteConfirm !== channel.name || deleting}
                  >
                    <Trash2 size={14} />{deleting ? t.modal.deleting : ch.dangerDeleteBtn}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChannelTab({ channels, onRefresh, isSuperadmin, session }) {
  const { t } = useLang();
  const ch = t.channels;
  const [modal, setModal] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set(channels.map(c => c.id)));
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  const toggleExpand = (id) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const channelById = Object.fromEntries(channels.map(c => [c.id, c]));

  const getDepth = (c) => {
    if (c.depth != null) return c.depth;
    if (!c.parent_channel_id) return 0;
    return 1 + getDepth(channelById[c.parent_channel_id] || {});
  };

  const childrenOf = {};
  channels.forEach(c => {
    const pid = c.parent_channel_id ?? 'root';
    if (!childrenOf[pid]) childrenOf[pid] = [];
    childrenOf[pid].push(c);
  });

  // For CMS admin, anchor the tree at their own channel regardless of its real parent
  let rootKey;
  if (isSuperadmin) {
    rootKey = 'root';
  } else {
    rootKey = 'cms_root';
    const ownChannel = channels.find(c => c.id === parseInt(session?.channelId));
    if (ownChannel) childrenOf['cms_root'] = [ownChannel];
  }
  const totalUsers = channels.reduce((s, c) => s + (parseInt(c.user_count) || 0), 0);
  const totalScans = channels.reduce((s, c) => s + (parseInt(c.scan_count) || 0), 0);
  const totalDevices = channels.reduce((s, c) => s + (parseInt(c.kino_device_count) || 0), 0);

  function renderRows(parentKey, indent) {
    return (childrenOf[parentKey] || []).flatMap(c => {
      const persona = c.config?.persona_type || 'nano';
      const personaColor = persona === 'viva' ? '#8b5cf6' : '#6366f1';
      const hasChildren = !!(childrenOf[c.id]?.length);
      const isOpen = expanded.has(c.id);
      const userCount = parseInt(c.user_count) || 0;
      const coachCount = parseInt(c.coach_count) || 0;
      const deviceCount = parseInt(c.kino_device_count) || 0;
      const activeDeviceCount = parseInt(c.kino_active_count) || 0;
      const scanCount = parseInt(c.scan_count) || 0;
      return [
        <tr key={c.id}>
          <td className="muted" style={{ width: 40 }}>{c.id}</td>
          <td>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: indent * 22 }}>
              {hasChildren ? (
                <button className="icon-btn" style={{ padding: 0, width: 18, height: 18, flexShrink: 0, fontSize: 11 }} onClick={() => toggleExpand(c.id)}>
                  {isOpen ? '▾' : '▸'}
                </button>
              ) : (
                <span style={{ display: 'inline-block', width: 18, flexShrink: 0 }} />
              )}
              {c.logo_url
                ? <img src={c.logo_url} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
                : <div style={{ width: 24, height: 24, borderRadius: 4, background: personaColor + '1a', color: personaColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 11, flexShrink: 0 }}>
                    {(c.name || c.key_name || '?')[0].toUpperCase()}
                  </div>
              }
              <span style={{ fontWeight: 600, fontSize: 13 }}>{fmt(c.name)}</span>
            </span>
          </td>
          <td><code className="code-tag">{c.key_name}</code></td>
          <td><span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10, background: personaColor + '15', color: personaColor }}>{persona}</span></td>
          <td><Badge color="#3b82f6">{userCount}</Badge></td>
          <td><Badge color="#10b981">{coachCount}</Badge></td>
          <td><Badge color="#f59e0b">{deviceCount}<span style={{ fontWeight: 400, fontSize: 10, color: '#94a3b8' }}> ({activeDeviceCount})</span></Badge></td>
          <td><Badge color="#8b5cf6">{scanCount}</Badge></td>
          <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.created_at)}</td>
          <td>
            <div className="row-actions">
              <button className="icon-btn" title={ch.titleAddSubchannel} onClick={() => setModal({ type: 'add', parentChannel: c })}><Plus size={13} /></button>
              <button className="icon-btn" title={ch.titleSettings} onClick={() => setModal({
                type: 'config', channel: c, channelId: c.id,
                canGrantSubch: isSuperadmin || (session?.canManageSubchannels && c.id !== parseInt(session?.channelId)),
              })}><Settings2 size={13} /></button>
            </div>
          </td>
        </tr>,
        ...(isOpen ? renderRows(c.id, indent + 1) : [])
      ];
    });
  }

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Building2} label={t.stats.totalChannels} value={channels.length} color="#6366f1" />
        <StatCard icon={Users} label={t.stats.totalUsers} value={totalUsers} color="#3b82f6" />
        <StatCard icon={Cpu} label={ch.statKinoDevices} value={totalDevices} color="#f59e0b" />
        <StatCard icon={Activity} label={ch.statTotalScans} value={totalScans} color="#8b5cf6" />
      </div>

      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{t.countChannel(channels.length)}</span>
          {isSuperadmin && (
            <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
              <Plus size={14} />{t.addChannel}
            </button>
          )}
        </div>

        {channels.length === 0 ? (
          <div className="empty-row" style={{ padding: 40 }}>{t.empty.channels}</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>{t.table.id}</th>
                <th>{t.table.name}</th>
                <th>{t.table.key}</th>
                <th>{ch.colPersona}</th>
                <th>{ch.colUsers}</th>
                <th>{ch.colCoaches}</th>
                <th>{ch.colDevices}</th>
                <th>{ch.colScans}</th>
                <th>{t.table.joined}</th>
                <th>{ch.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {renderRows(rootKey, 0)}
            </tbody>
          </table>
        )}
      </div>

      {modal?.type === 'add'    && <ChannelModal channel={null} channels={channels} isSuperadmin={isSuperadmin} parentChannel={modal.parentChannel} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'config' && (() => {
        const liveChannel = channels.find(c => c.id === modal.channelId) || modal.channel;
        const liveChildren = channels.filter(c => c.parent_channel_id === modal.channelId);
        return <ChannelConfigModal
          channel={liveChannel}
          isSuperadmin={isSuperadmin}
          canGrantSubch={modal.canGrantSubch}
          hasSubchannels={liveChildren.length > 0}
          subchannels={liveChildren}
          onClose={() => setModal(null)}
          onSave={closeAndRefresh}
          onRefreshData={onRefresh}
        />;
      })()}
    </>
  );
}

// ── Kino tab ──────────────────────────────────────────────────────────────────

const DEVICE_STATUSES = ['active', 'inactive', 'maintenance'];
const EMPTY_DEVICE = { model: 'KNA1', quantity: 1, serial_number: '', name: '', coach_id: '', channel_id: '', status: 'active', notes: '' };


export { ChannelTab };
