import React, { useState, useEffect, useContext, useMemo } from 'react';
import axios from 'axios';
import { X, Plus, QrCode, Printer, Download, Layers, Package } from 'lucide-react';
import { LangCtx, StatCard } from '../shared.jsx';

// The QR payload must be the FULL public URL, not the bare box_code — unlike Kino chips (where
// the miniapp's own scanner parses the raw code client-side), a box QR must open directly from
// any camera app with no miniapp/login involved. Same origin the admin panel itself is served
// from (worker serves both), so this naturally resolves to the right dev/prod domain.
// The printed QR is a GCN aeviva sector link, not a nano one: that page draws the QR, lists every
// dot with its ingredients, shows the order, and is the same page the user already saw in the app
// when the formula was generated. The Mini Program's claim scan reads the WVB code straight out of
// this URL, so one QR both explains the box and activates it.
//
// Host derived from nano's own, mirroring pages/main/main.js's `BASE.includes('-dev.')` — the
// admin panel has no config endpoint and adding one for a single constant is not worth it.
const AEVIVA_SITE = window.location.origin.includes('-dev.')
  ? 'https://aeviva-dev.gcn.net'
  : 'https://aeviva.gcn.net';
const boxUrl = (code) => `${AEVIVA_SITE}/formulation-label.html?c=${encodeURIComponent(code)}`;

function GenerateBoxBatchModal({ users, onClose, onSave }) {
  const { t } = useContext(LangCtx);
  const tb = t.boxes;
  const [userQuery, setUserQuery] = useState('');
  const [userId, setUserId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [planId, setPlanId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const matches = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!q) return [];
    return (users || [])
      .filter(u => (u.nickname || '').toLowerCase().includes(q) || (u.phone || '').includes(q) || (u.user_id || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [userQuery, users]);

  const selectedUser = (users || []).find(u => u.user_id === userId);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      // plan_id is optional and omitted when blank, so the default stays exactly what it was:
      // snapshot the user's latest ACTIVE plan. It is needed for a Formulate-Dots proposal,
      // which by design has no schedules and is not the user's active plan until the box
      // they are about to be shipped is scanned.
      const res = await axios.post('/api/box-batches',
        { user_id: userId, quantity, notes, ...(planId.trim() ? { plan_id: planId.trim() } : {}) });
      if (res.data?.success === false) { setError(res.data.error || tb.saveFailed); return; }
      onSave();
    } catch (err) { setError(err.response?.data?.error || tb.saveFailed); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{tb.generateBatch}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tb.user}</span>
              {selectedUser ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{selectedUser.nickname || selectedUser.user_id} {selectedUser.phone ? `(${selectedUser.phone})` : ''}</span>
                  <button type="button" style={{ fontSize: 11, color: '#38bdf8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    onClick={() => { setUserId(''); setUserQuery(''); }}>Change</button>
                </div>
              ) : (
                <>
                  <input value={userQuery} onChange={e => setUserQuery(e.target.value)} placeholder={tb.userPlaceholder} required />
                  {matches.length > 0 && (
                    <div style={{ marginTop: 4, border: '1px solid #1e293b', borderRadius: 6, overflow: 'hidden' }}>
                      {matches.map(u => (
                        <div key={u.user_id}
                          style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', borderTop: '1px solid #1e293b' }}
                          onClick={() => { setUserId(u.user_id); setUserQuery(''); }}>
                          {u.nickname || u.user_id} {u.phone ? `· ${u.phone}` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </label>
            <label className="form-field">
              <span>{tb.quantity}</span>
              <input type="number" min="1" max="5000" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="1 – 5000" required />
              <small style={{ color: '#64748b', fontSize: 10 }}>{tb.quantityHint}</small>

              <span>{tb.planId}</span>
              <input type="number" min="1" value={planId} onChange={e => setPlanId(e.target.value)} placeholder={tb.planIdPlaceholder} />
              <small style={{ color: '#64748b', fontSize: 10 }}>{tb.planIdHint}</small>
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tb.notes}</span>
              <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy || !userId}>
              {busy ? t.modal.saving : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BoxCard({ box }) {
  return (
    <div style={{
      background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10,
      padding: '14px 10px 10px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: 8, minWidth: 0,
    }}>
      <img
        src={`https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${encodeURIComponent(boxUrl(box.box_code))}&bgcolor=0f172a&color=e2e8f0&margin=4`}
        width={96} height={96} alt="QR"
        style={{ borderRadius: 6, display: 'block' }}
      />
      <code style={{ fontSize: 10, color: '#cbd5e1', letterSpacing: '0.3px', textAlign: 'center', wordBreak: 'break-all' }}>
        {box.box_code}
      </code>
    </div>
  );
}

function BoxListPanel({ batch, onClose }) {
  const { t } = useContext(LangCtx);
  const tb = t.boxes;
  const [firstBoxes, setFirstBoxes] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await axios.get(`/api/box-batches/${batch.id}/boxes?page=1&limit=25`);
        setFirstBoxes(res.data.boxes || []);
        setTotal(res.data.total || 0);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    load();
  }, [batch.id]);

  const fetchAll = async () => {
    const pages = Math.ceil(batch.quantity / 100);
    let all = [];
    for (let p = 1; p <= pages; p++) {
      const res = await axios.get(`/api/box-batches/${batch.id}/boxes?page=${p}&limit=100`);
      all = all.concat(res.data.boxes || []);
    }
    return all;
  };

  const printQR = async () => {
    setPrinting(true);
    try {
      const all = await fetchAll();
      const html = `<!DOCTYPE html><html><head><title>Box batch ${batch.id}</title>
        <style>body{font-family:sans-serif;margin:16px}h2{margin-bottom:12px}
        .grid{display:flex;flex-wrap:wrap;gap:8px}
        .box{text-align:center;border:1px solid #ccc;border-radius:6px;padding:10px;width:120px}
        .box img{display:block;margin:0 auto 6px}
        .box p{font-size:9px;margin:0;word-break:break-all;font-family:monospace}
        @media print{@page{size:A4;margin:12mm}.box{page-break-inside:avoid}}</style>
        </head><body>
        <h2>Box batch #${batch.id} | User: ${batch.nickname || batch.user_id} | Total: ${batch.quantity}</h2>
        <div class="grid">${all.map(b =>
          `<div class="box"><img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(boxUrl(b.box_code))}" width="100" height="100"/><p>${b.box_code}</p></div>`
        ).join('')}</div></body></html>`;
      const win = window.open('', '_blank');
      win.document.write(html);
      win.document.close();
      setTimeout(() => win.print(), 800);
    } catch (e) { console.error(e); }
    finally { setPrinting(false); }
  };

  const downloadCSV = async () => {
    setDownloading(true);
    try {
      const all = await fetchAll();
      const csv = all.map(b => `${b.box_code},${boxUrl(b.box_code)}`).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `box_batch_${batch.id}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error(e); }
    finally { setDownloading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720, width: '90vw' }}>
        <div className="modal-header">
          <div>
            <span style={{ fontWeight: 600 }}>{batch.nickname || batch.user_id}</span>
            <span style={{ color: '#64748b', fontSize: 13, marginLeft: 8 }}>{total} {tb.total.toLowerCase()}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={downloadCSV} disabled={downloading}>
              <Download size={13} />{downloading ? 'Downloading…' : 'CSV'}
            </button>
            <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={printQR} disabled={printing}>
              <Printer size={13} />{printing ? 'Preparing…' : tb.printQR}
            </button>
            <button className="icon-btn" onClick={onClose}><X size={16} /></button>
          </div>
        </div>
        <div className="modal-body" style={{ padding: '20px 20px 24px' }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: '#64748b', padding: '32px 0' }}>{t.topbar.loading}</p>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                {firstBoxes.map(b => <BoxCard key={b.id} box={b} />)}
              </div>
              {firstBoxes.length === 0 && (
                <p style={{ textAlign: 'center', color: '#475569', padding: '32px 0' }}>{tb.noBoxes}</p>
              )}
              {total > firstBoxes.length && (
                <p style={{ textAlign: 'center', color: '#475569', fontSize: 12, marginTop: 16 }}>
                  · · · {(total - firstBoxes.length).toLocaleString()} more · · ·
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BoxesTab({ batches, users, onRefresh }) {
  const { t } = useContext(LangCtx);
  const tb = t.boxes;
  const [modal, setModal] = useState(null);
  const [viewBatch, setViewBatch] = useState(null);
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  const list = batches || [];
  const totalBoxes = list.reduce((s, b) => s + (parseInt(b.quantity) || 0), 0);

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Layers} label={tb.countBatch(list.length)} value={list.length} color="#3b82f6" />
        <StatCard icon={Package} label={tb.total} value={totalBoxes} color="#8b5cf6" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{tb.countBatch(list.length)}</span>
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
            <Plus size={14} />{tb.generateBatch}
          </button>
        </div>
        <table className="data-table">
          <thead><tr>
            <th>ID</th>
            <th>{tb.user.replace(' *', '')}</th>
            <th>{tb.total}</th>
            <th>{tb.status}</th>
            <th>{tb.createdBy}</th>
            <th>{tb.createdAt}</th>
            <th></th>
          </tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={7} className="empty-row">{tb.noBoxes}</td></tr>}
            {list.map(b => (
              <tr key={b.id}>
                <td style={{ color: '#94a3b8', fontSize: 11 }}>{b.id}</td>
                <td>{b.nickname || b.user_id}</td>
                <td>{b.quantity}</td>
                <td>
                  <span style={{ fontSize: 11, color: b.status === 'active' ? '#10b981' : '#ef4444' }}>
                    {b.status === 'recalled' ? tb.statusRecalled : tb.statusActive}
                  </span>
                </td>
                <td style={{ fontSize: 11, color: '#94a3b8' }}>{b.created_by || '—'}</td>
                <td style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(b.created_at).toLocaleDateString()}</td>
                <td>
                  <button className="icon-btn" title={tb.viewBoxes} onClick={() => setViewBatch(b)}><QrCode size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal?.type === 'add' && <GenerateBoxBatchModal users={users} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {viewBatch && <BoxListPanel batch={viewBatch} onClose={() => setViewBatch(null)} />}
    </>
  );
}

export { BoxesTab };
