import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  X, Check, Trash2, Plus, Pencil, ChevronDown, ChevronLeft, ChevronRight,
  Cpu, Activity, Upload,
} from 'lucide-react';
import {
  useLang, fmt, fmtDate, Badge, StatCard,
  normalizeKinoMachine, normalizeKinoMachinesPayload, buildKinoMachinesUrl,
  KINO_MACHINE_PAGE_LIMIT,
} from '../shared.jsx';

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

const DEVICE_STATUSES = ['active', 'inactive', 'maintenance'];
const EMPTY_DEVICE = { model: 'KNA1', quantity: 1, serial_number: '', name: '', coach_id: '', channel_id: '', status: 'active', notes: '' };

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
    const quantity = parseInt(form.quantity, 10);
    if (isEdit && !form.serial_number.trim()) { setError(t.modal.serialNumber.replace(' *', '') + ' is required'); return; }
    if (!isEdit && (!Number.isInteger(quantity) || quantity < 1)) { setError(t.modal.quantityRequired); return; }
    setBusy(true); setError('');
    try {
      let res;
      if (isEdit) {
        const machineNo = form.serial_number.trim().toUpperCase();
        const payload = {
          ...form,
          serial_number: machineNo,
          coach_id:   form.coach_id   !== '' ? parseInt(form.coach_id)   : null,
          channel_id: form.channel_id !== '' ? parseInt(form.channel_id) : null,
        };
        res = await axios.put(`/kino/kino-machines/${machineNo}`, payload);
      } else {
        res = await axios.post('/kino/kino-machines/batch', { model: form.model, quantity: parseInt(form.quantity, 10) });
      }
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
            {!isEdit ? (
              <>
                <label className="form-field">
                  <span>{t.modal.machineModel}</span>
                  <div className="select-wrap" style={{ width: '100%' }}>
                    <select value={form.model} onChange={e => set('model', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                      <option value="KNA1">KNA1</option>
                      <option value="KNA2">KNA2</option>
                    </select>
                    <ChevronDown size={11} className="select-chevron" />
                  </div>
                </label>
                <label className="form-field">
                  <span>{t.modal.quantity}</span>
                  <input type="number" min="1" step="1" value={form.quantity} onChange={e => set('quantity', e.target.value)} />
                </label>
              </>
            ) : (
              <>
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
              </>
            )}
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

function KoneApkUploadModal({ onClose, onSave }) {
  const { t } = useLang();
  const [form, setForm] = useState({ version: '', notes: '', setActive: true });
  const [file, setFile] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | uploading | saving | done
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.version.trim()) { setError(t.modal.apkVersion.replace(' *', '') + ' required'); return; }
    if (!file) { setError('APK file required'); return; }
    setError(''); setPhase('uploading');
    try {
      const presignRes = await axios.get('/api/oss/kone-apk/presign');
      if (!presignRes.data.success) throw new Error(presignRes.data.error || 'Presign failed');
      const { put_url, get_url, key } = presignRes.data;
      await uploadToOSS(put_url, file, () => {});
      setPhase('saving');
      const createRes = await axios.post('/api/kone-apk-releases', {
        version: form.version.trim(),
        oss_key: key,
        download_url: get_url,
        notes: form.notes.trim() || null,
      });
      if (form.setActive && createRes.data.id) {
        await axios.put(`/api/kone-apk-releases/${createRes.data.id}`, { is_active: true });
      }
      setPhase('done');
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Upload failed');
      setPhase('idle');
    }
  };

  const busy = phase === 'uploading' || phase === 'saving';
  const phaseLabel = phase === 'uploading' ? t.modal.apkUploading : phase === 'saving' ? t.modal.apkSaving : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.modal.uploadApk}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form className="modal-body" onSubmit={handleSubmit}>
          <label className="field-label">{t.modal.apkVersion}
            <input className="field-input" value={form.version} onChange={e => set('version', e.target.value)}
              placeholder={t.modal.apkVersionPlaceholder} disabled={busy} />
          </label>
          <label className="field-label">{t.modal.apkFile}
            <input type="file" accept=".apk" disabled={busy}
              onChange={e => setFile(e.target.files[0] || null)}
              style={{ marginTop: 4, fontSize: 13 }} />
          </label>
          <label className="field-label">{t.modal.apkNotes}
            <textarea className="field-input" value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder={t.modal.apkNotesPlaceholder} rows={3} disabled={busy} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.setActive} onChange={e => set('setActive', e.target.checked)} disabled={busy} />
            {t.modal.apkSetActive}
          </label>
          {error && <p style={{ color: '#ef4444', fontSize: 13, margin: '4px 0 0' }}>{error}</p>}
          {phaseLabel && <p style={{ color: '#6366f1', fontSize: 13, margin: '4px 0 0' }}>{phaseLabel}</p>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? phaseLabel : t.modal.uploadApk}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function KinoTab({ devices, machinePagination, coaches, channels, releases = [], onRefresh }) {
  const { t } = useLang();
  const [modal, setModal] = useState(null);
  const [listDevices, setListDevices] = useState((devices || []).map(normalizeKinoMachine));
  const [pagination, setPagination] = useState(machinePagination || { page: 1, limit: KINO_MACHINE_PAGE_LIMIT, total: (devices || []).length, total_pages: 1 });
  const [page, setPage] = useState(machinePagination?.page || 1);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  const loadMachines = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      const res = await axios.get(buildKinoMachinesUrl({ page, q: searchQuery }));
      const normalized = normalizeKinoMachinesPayload(res.data || {});
      setListDevices(normalized.devices);
      setPagination(normalized.pagination);
    } catch (err) {
      setListError(err.response?.data?.error || t.modal.saveFailed);
    } finally {
      setListLoading(false);
    }
  }, [page, searchQuery, t.modal.saveFailed]);

  useEffect(() => {
    setListDevices((devices || []).map(normalizeKinoMachine));
    if (machinePagination) {
      setPagination(machinePagination);
      setPage(Number(machinePagination.page ?? 1));
    }
  }, [devices, machinePagination]);

  useEffect(() => {
    loadMachines();
  }, [loadMachines]);

  const closeAndRefresh = () => { setModal(null); loadMachines(); onRefresh(); };

  const totalPages = Math.max(1, Number(pagination.total_pages || 1));
  const totalDevices = Number(pagination.total ?? listDevices.length);
  const activeCount = listDevices.filter(d => d.status === 'active').length;
  const totalTests  = listDevices.reduce((s, d) => s + (d.test_count || 0), 0);
  const activeRelease = releases.find(r => r.is_active);

  const statusColor = { active: '#10b981', inactive: '#94a3b8', maintenance: '#f59e0b' };
  const statusLabel = { active: t.modal.statusActive, inactive: t.modal.statusInactive, maintenance: t.modal.statusMaintenance };

  const handleSetActive = async (id) => {
    try { await axios.put(`/api/kone-apk-releases/${id}`, { is_active: true }); onRefresh(); }
    catch { /* silent */ }
  };

  const handleDeleteRelease = async (id, version) => {
    if (!window.confirm(t.modal.apkDeleteWarning(version))) return;
    try { await axios.delete(`/api/kone-apk-releases/${id}`); onRefresh(); }
    catch (err) { alert(err.response?.data?.error || 'Delete failed'); }
  };

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Cpu} label={t.stats.totalDevices}  value={totalDevices} color="#6366f1" />
        <StatCard icon={Cpu} label={t.stats.activeDevices} value={activeCount}     color="#10b981" />
        <StatCard icon={Activity} label={t.stats.totalTests}   value={totalTests}     color="#3b82f6" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{t.countDevice(totalDevices)}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <form onSubmit={(e) => { e.preventDefault(); setPage(1); setSearchQuery(searchInput); }} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                className="toolbar-search"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder={t.searchKino}
              />
              {searchInput && (
                <button type="button" className="icon-btn" onClick={() => { setSearchInput(''); setSearchQuery(''); setPage(1); }}>
                  <X size={14} />
                </button>
              )}
            </form>
            <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
              <Plus size={14} />{t.addDevice}
            </button>
          </div>
        </div>
        {listError && <div className="form-error" style={{ margin: '10px 16px 0' }}>{listError}</div>}
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
            {listDevices.length === 0 && <tr><td colSpan={9} className="empty-row">{listLoading ? t.topbar.loading : t.empty.kino}</td></tr>}
            {listDevices.map(d => (
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
        <div className="table-toolbar" style={{ borderTop: '1px solid var(--border)', borderBottom: 0 }}>
          <span className="table-count">
            {t.pagination.page} {pagination.page || page} {t.pagination.of} {totalPages} · {totalDevices} {t.pagination.total}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="icon-btn" disabled={listLoading || page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
              <ChevronLeft size={14} />
            </button>
            <button className="icon-btn" disabled={listLoading || page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="table-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{t.apk.title}</span>
            <Badge color={activeRelease ? '#10b981' : '#94a3b8'}>
              {t.apk.activeVersion}: {activeRelease ? activeRelease.version : t.apk.noActive}
            </Badge>
          </div>
          <button className="btn-primary" onClick={() => setModal({ type: 'uploadApk' })}>
            <Plus size={14} />{t.modal.uploadApk}
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.apk.version}</th>
              <th>{t.apk.status}</th>
              <th>{t.apk.notes}</th>
              <th>{t.apk.uploadedAt}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {releases.length === 0 && <tr><td colSpan={5} className="empty-row">{t.apk.empty}</td></tr>}
            {releases.map(r => (
              <tr key={r.id}>
                <td><code style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>{r.version}</code></td>
                <td>
                  <Badge color={r.is_active ? '#10b981' : '#94a3b8'}>
                    {r.is_active ? t.apk.active : t.apk.inactive}
                  </Badge>
                </td>
                <td className="muted desc-cell">{fmt(r.notes)}</td>
                <td className="muted">{fmtDate(r.created_at)}</td>
                <td>
                  <div className="row-actions">
                    {!r.is_active && (
                      <button className="icon-btn" title={t.modal.apkSetActiveBtn} onClick={() => handleSetActive(r.id)}>
                        <Check size={14} />
                      </button>
                    )}
                    {!r.is_active && (
                      <button className="icon-btn danger" title="Delete" onClick={() => handleDeleteRelease(r.id, r.version)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal?.type === 'add'       && <KinoModal device={null}          coaches={coaches} channels={channels} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit'      && <KinoModal device={modal.device}  coaches={coaches} channels={channels} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete'    && <DeleteDeviceConfirm device={modal.device} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
      {modal?.type === 'uploadApk' && <KoneApkUploadModal onClose={() => setModal(null)} onSave={closeAndRefresh} />}
    </>
  );
}
