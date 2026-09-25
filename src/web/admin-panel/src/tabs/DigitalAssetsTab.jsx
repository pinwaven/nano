import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Upload, Trash2, Music2, X } from 'lucide-react';
import { useLang } from '../shared.jsx';

const labelStyle = { fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 };

function DigitalAssetUploadModal({ onClose, onSave, fixedChannelId, channels, isSuperadmin }) {
  const { t } = useLang();
  const tm = t.media;
  const [form, setForm] = useState({
    type: 'sleep_music', title: '', title_zh: '', duration_seconds: '', sort_order: '0',
    channel_id: fixedChannelId ?? '',
  });
  const [file, setFile] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');

  const handleFile = (e) => setFile(e.target.files[0] || null);

  const handleSubmit = async () => {
    if (!file || !form.title || !form.type) { setError(tm.required); return; }
    setError('');
    try {
      setPhase('uploading');
      const presignRes = await axios.get(`/api/digital-assets/presign?filename=${encodeURIComponent(file.name)}&content_type=${encodeURIComponent(file.type || 'audio/mpeg')}`);
      const { put_url, key } = presignRes.data;
      await axios.put(put_url, file, { headers: { 'Content-Type': 'application/octet-stream' } });
      setPhase('saving');
      await axios.post('/api/digital-assets', {
        type: form.type,
        title: form.title,
        title_zh: form.title_zh || null,
        oss_key: key,
        content_type: file.type || 'audio/mpeg',
        duration_seconds: form.duration_seconds ? parseInt(form.duration_seconds) : null,
        sort_order: parseInt(form.sort_order) || 0,
        channel_id: form.channel_id ? parseInt(form.channel_id) : null,
      });
      setPhase('done');
      setTimeout(onSave, 800);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
      setPhase('idle');
    }
  };

  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{tm.uploadTitle}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#dc2626', fontSize: 13 }}>{error}</div>}
          <div>
            <label style={labelStyle}>{tm.type}</label>
            <select value={form.type} onChange={set('type')} className="form-input" style={{ marginBottom: 0 }}>
              {Object.entries(tm.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>{tm.titleEn}</label>
            <input value={form.title} onChange={set('title')} placeholder={tm.titleEnPh} className="form-input" style={{ marginBottom: 0 }} />
          </div>
          <div>
            <label style={labelStyle}>{tm.titleZh}</label>
            <input value={form.title_zh} onChange={set('title_zh')} placeholder={tm.titleZhPh} className="form-input" style={{ marginBottom: 0 }} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{tm.duration}</label>
              <input type="number" value={form.duration_seconds} onChange={set('duration_seconds')} placeholder={tm.durationPh} className="form-input" style={{ marginBottom: 0 }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>{tm.sortOrder}</label>
              <input type="number" value={form.sort_order} onChange={set('sort_order')} className="form-input" style={{ marginBottom: 0 }} />
            </div>
          </div>
          {isSuperadmin && (
            <div>
              <label style={labelStyle}>{tm.channelHint}</label>
              <select value={form.channel_id} onChange={set('channel_id')} className="form-input" style={{ marginBottom: 0 }}>
                <option value="">{tm.globalAll}</option>
                {(channels || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label style={labelStyle}>{tm.file}</label>
            <input type="file" accept="audio/*,video/*,application/*" onChange={handleFile} className="form-input" style={{ marginBottom: 0 }} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>{tm.cancel}</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={phase !== 'idle'}>
            {phase === 'uploading' ? tm.uploading : phase === 'saving' ? tm.saving : phase === 'done' ? tm.done : tm.upload}
          </button>
        </div>
      </div>
    </div>
  );
}

function DigitalAssetsTab({ session, channels, isSuperadmin, onRefresh }) {
  const { t } = useLang();
  const tm = t.media;
  const channelAdminId = !isSuperadmin ? session?.channelId : null;
  const [filterChannelId, setFilterChannelId] = useState(channelAdminId ?? '');
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = channelAdminId
        ? ''
        : (filterChannelId ? `?channel_id=${filterChannelId}` : '');
      const res = await axios.get(`/api/digital-assets${params}`);
      setAssets(res.data.assets || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [channelAdminId, filterChannelId]);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async (asset) => {
    await axios.put(`/api/digital-assets/${asset.id}`, { is_active: !asset.is_active });
    load();
  };

  const deleteAsset = async (id) => {
    if (!window.confirm(tm.confirmDelete)) return;
    await axios.delete(`/api/digital-assets/${id}`);
    load();
  };

  const channelName = (id) => (channels || []).find(c => c.id === id)?.name || `ch.${id}`;

  return (
    <>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count" style={{ flex: 1 }}>
            {tm.title}
            {!isSuperadmin && session?.channelName && <span style={{ marginLeft: 8 }}>· {session.channelName}</span>}
          </span>
          {isSuperadmin && (
            <select value={filterChannelId} onChange={e => setFilterChannelId(e.target.value)}
              className="form-input" style={{ width: 180, marginBottom: 0, marginRight: 8, padding: '6px 10px' }}>
              <option value="">{tm.global}</option>
              {(channels || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <button className="btn-primary" onClick={() => setModal('upload')}>
            <Upload size={14} />{tm.upload}
          </button>
        </div>
        {loading ? (
          <div className="empty-row" style={{ padding: 40, textAlign: 'center' }}>{t.topbar.loading}</div>
        ) : assets.length === 0 ? (
          <div className="empty-row" style={{ padding: 40, textAlign: 'center' }}>{tm.noAssets}</div>
        ) : assets.map(a => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(99,117,236,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Music2 size={18} color="#6375EC" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{a.title_zh ? `${a.title_zh} / ${a.title}` : a.title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                {tm.types[a.type] || a.type}
                {a.duration_seconds ? ` · ${tm.duration_fmt(Math.floor(a.duration_seconds / 60), a.duration_seconds % 60)}` : ''}
                {isSuperadmin && a.channel_id ? ` · ${channelName(a.channel_id)}` : ''}
                {isSuperadmin && !a.channel_id ? ` · ${tm.global}` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <button onClick={() => toggleActive(a)} className={`subtab-btn${a.is_active ? ' active' : ''}`} style={{ fontSize: 11, padding: '2px 10px' }}>
                {a.is_active ? tm.active : tm.inactive}
              </button>
              <button className="icon-btn danger" onClick={() => deleteAsset(a.id)}><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </div>
      {modal === 'upload' && (
        <DigitalAssetUploadModal
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load(); }}
          fixedChannelId={channelAdminId}
          channels={channels}
          isSuperadmin={isSuperadmin}
        />
      )}
    </>
  );
}

export { DigitalAssetsTab };
