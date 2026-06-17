import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Upload, Trash2, Music2 } from 'lucide-react';

function DigitalAssetUploadModal({ onClose, onSave, fixedChannelId, channels, isSuperadmin }) {
  const [form, setForm] = useState({
    type: 'sleep_music', title: '', title_zh: '', duration_seconds: '', sort_order: '0',
    channel_id: fixedChannelId ?? '',
  });
  const [file, setFile] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');

  const handleFile = (e) => setFile(e.target.files[0] || null);

  const handleSubmit = async () => {
    if (!file || !form.title || !form.type) { setError('Type, title, and file are required'); return; }
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

  const inputStyle = { width: '100%', padding: '8px 10px', borderRadius: 8, background: '#0e1f3a', border: '1px solid rgba(166,196,229,0.2)', color: '#E8F0F8', fontSize: 14, boxSizing: 'border-box' };
  const labelStyle = { fontSize: 12, color: '#8ca9c5', display: 'block', marginBottom: 4 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#1a2744', borderRadius: 14, padding: 28, width: 420, maxWidth: '95vw' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <span style={{ fontWeight: 700, fontSize: 17, color: '#E8F0F8' }}>Upload Media Asset</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8ca9c5', cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>
        {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, color: '#ef4444', fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Type</label>
            <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))} style={inputStyle}>
              <option value="sleep_music">Sleep Music</option>
              <option value="guide_video">Guide Video</option>
              <option value="document">Document</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Title (EN)</label>
            <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Track title" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Title (ZH)</label>
            <input value={form.title_zh} onChange={e => setForm(p => ({ ...p, title_zh: e.target.value }))} placeholder="中文标题" style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Duration (seconds)</label>
              <input type="number" value={form.duration_seconds} onChange={e => setForm(p => ({ ...p, duration_seconds: e.target.value }))} placeholder="e.g. 1800" style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Sort Order</label>
              <input type="number" value={form.sort_order} onChange={e => setForm(p => ({ ...p, sort_order: e.target.value }))} style={inputStyle} />
            </div>
          </div>
          {isSuperadmin && (
            <div>
              <label style={labelStyle}>Channel (leave blank for global)</label>
              <select value={form.channel_id} onChange={e => setForm(p => ({ ...p, channel_id: e.target.value }))} style={inputStyle}>
                <option value="">Global (all channels)</option>
                {(channels || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label style={labelStyle}>File</label>
            <input type="file" accept="audio/*,video/*,application/*" onChange={handleFile}
              style={{ ...inputStyle, fontSize: 13 }} />
          </div>
        </div>
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 8, background: 'transparent', border: '1px solid rgba(166,196,229,0.2)', color: '#8ca9c5', cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={phase !== 'idle'}
            style={{ padding: '9px 20px', borderRadius: 8, background: '#6375EC', border: 'none', color: '#fff', fontWeight: 600, cursor: phase !== 'idle' ? 'not-allowed' : 'pointer', opacity: phase !== 'idle' ? 0.7 : 1 }}>
            {phase === 'uploading' ? 'Uploading…' : phase === 'saving' ? 'Saving…' : phase === 'done' ? 'Done ✓' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DigitalAssetsTab({ session, channels, isSuperadmin, onRefresh }) {
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
    if (!window.confirm('Delete this asset?')) return;
    await axios.delete(`/api/digital-assets/${id}`);
    load();
  };

  const TYPE_LABELS = { sleep_music: 'Sleep Music', guide_video: 'Guide Video', document: 'Document' };
  const channelName = (id) => (channels || []).find(c => c.id === id)?.name || `ch.${id}`;

  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Media / Digital Assets</span>
          {!isSuperadmin && session?.channelName && (
            <span style={{ marginLeft: 10, fontSize: 13, color: '#8ca9c5' }}>{session.channelName}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {isSuperadmin && (
            <select value={filterChannelId} onChange={e => setFilterChannelId(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 8, background: '#0e1f3a', border: '1px solid rgba(166,196,229,0.2)', color: '#E8F0F8', fontSize: 13 }}>
              <option value="">Global</option>
              {(channels || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <button onClick={() => setModal('upload')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, background: '#6375EC', border: 'none', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
            <Upload size={15} /> Upload
          </button>
        </div>
      </div>
      {loading ? (
        <div style={{ color: '#8ca9c5', padding: 40, textAlign: 'center' }}>Loading…</div>
      ) : assets.length === 0 ? (
        <div style={{ color: '#8ca9c5', padding: 40, textAlign: 'center' }}>No assets yet. Upload one to get started.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {assets.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 14, background: '#1a2744', borderRadius: 10, padding: '14px 18px', border: '1px solid rgba(166,196,229,0.1)' }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(99,117,236,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Music2 size={18} color="#6375EC" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: '#E8F0F8', fontSize: 14 }}>{a.title_zh ? `${a.title_zh} / ${a.title}` : a.title}</div>
                <div style={{ fontSize: 12, color: '#8ca9c5', marginTop: 2 }}>
                  {TYPE_LABELS[a.type] || a.type}
                  {a.duration_seconds ? ` · ${Math.floor(a.duration_seconds / 60)}m ${a.duration_seconds % 60}s` : ''}
                  {isSuperadmin && a.channel_id ? ` · ${channelName(a.channel_id)}` : ''}
                  {isSuperadmin && !a.channel_id ? ' · Global' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <button onClick={() => toggleActive(a)}
                  style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: a.is_active ? 'rgba(16,185,129,0.15)' : 'rgba(166,196,229,0.1)', color: a.is_active ? '#10b981' : '#8ca9c5', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  {a.is_active ? 'Active' : 'Inactive'}
                </button>
                <button onClick={() => deleteAsset(a.id)}
                  style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: 'rgba(239,68,68,0.1)', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {modal === 'upload' && (
        <DigitalAssetUploadModal
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load(); }}
          fixedChannelId={channelAdminId}
          channels={channels}
          isSuperadmin={isSuperadmin}
        />
      )}
    </div>
  );
}

export { DigitalAssetsTab };
