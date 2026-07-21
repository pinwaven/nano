import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { X, Plus, Pencil, Trash2, QrCode, Printer, Download, Layers, Package, Check, Activity, Cpu, ClipboardList, Search, RotateCcw } from 'lucide-react';
import { LangCtx, StatCard, fmt, bioAgeColor } from '../shared.jsx';

const TESTED_BM_META = [
  { key: 'hsCRP',     label: 'hsCRP',            unit: 'mg/L' },
  { key: 'GDF15',     label: 'GDF-15',           unit: 'pg/mL' },
  { key: 'IL6',       label: 'IL-6',             unit: 'pg/mL' },
  { key: 'GA',        label: 'Glycated Albumin',  unit: '%' },
  { key: 'CystatinC', label: 'Cystatin C',        unit: 'mg/L' },
  { key: 'CD38',      label: 'CD38',             unit: 'xBaseline' },
];

const TESTED_SUB_AGE_META = [
  { key: 'ResilienceAge',    label: 'Resilience Age',     color: '#c084d4' },
  { key: 'CellularAge',      label: 'Cellular Age',       color: '#10b981' },
  { key: 'MetabolicAge',     label: 'Metabolic Age',      color: '#6375EC' },
  { key: 'MicroVascularAge', label: 'Micro-Vascular Age', color: '#0ea5e9' },
];

function ChipBatchModal({ batch, models, onClose, onSave }) {
  const { t } = useContext(LangCtx);
  const tc = t.chips;
  const isEdit = !!batch;

  const activeModels = (models || []).filter(m => m.status === 'active');
  const modelOptions = activeModels.length > 0 ? activeModels : (models || []);
  const fallbackModel = modelOptions[0]?.code || 'K2';

  const [batchNum] = useState(() =>
    String(Math.floor(Math.random() * 100000000)).padStart(8, '0')
  );

  const [form, setForm] = useState({
    prefix:   isEdit ? batch.prefix : `KNC${batchNum}`,
    model:    batch?.model    || fallbackModel,
    quantity: batch?.quantity || '',
    notes:    batch?.notes    || '',
    status:   batch?.status   || 'active',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const [prefixOverride, setPrefixOverride] = useState(false);

  const displayPrefix = form.prefix.trim().toUpperCase();
  const qty = parseInt(form.quantity) || 0;
  const previewEnd = qty > 0 ? String(Math.min(qty, 9999)).padStart(4, '0') : '????';
  const preview = `${displayPrefix || '???'}-0001  →  ${displayPrefix || '???'}-${previewEnd}`;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      let res;
      if (isEdit) {
        res = await axios.put(`/api/kino-chip-batches/${batch.id}`, { model: form.model, notes: form.notes, status: form.status });
      } else {
        res = await axios.post('/api/kino-chip-batches', { prefix: form.prefix, model: form.model, quantity: form.quantity, notes: form.notes });
      }
      if (res.data?.success === false) { setError(res.data.error || t.modal.saveFailed); return; }
      onSave();
    } catch (err) { setError(err.response?.data?.error || t.modal.saveFailed); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEdit ? tc.editBatch : tc.addBatch}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            {!isEdit && (
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{tc.prefix.replace(' *', '')}</span>
                  <code style={{ fontSize: 13, color: '#e2e8f0' }}>{displayPrefix}</code>
                  {!prefixOverride && (
                    <button type="button" style={{ fontSize: 11, color: '#38bdf8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      onClick={() => setPrefixOverride(true)}>Override</button>
                  )}
                </div>
                {prefixOverride && (
                  <input value={form.prefix} onChange={e => set('prefix', e.target.value.toUpperCase())}
                         placeholder={tc.prefixHint} required style={{ fontFamily: 'monospace', marginTop: 6 }} />
                )}
              </div>
            )}
            <label className="form-field">
              <span>{tc.model}</span>
              <select value={form.model} onChange={e => set('model', e.target.value)}>
                {modelOptions.length === 0 && <option value={form.model}>{form.model}</option>}
                {modelOptions.map(m => (
                  <option key={m.code} value={m.code}>
                    {m.name ? `${m.code} — ${m.name}` : m.code}
                  </option>
                ))}
              </select>
            </label>
            {!isEdit && (
              <label className="form-field">
                <span>{tc.quantity}</span>
                <input type="number" min="1" max="9999"
                       value={form.quantity} onChange={e => set('quantity', e.target.value)}
                       placeholder="1 – 9999" required />
              </label>
            )}
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tc.notes}</span>
              <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
            </label>
            {isEdit && (
              <label className="form-field">
                <span>{tc.batchStatus}</span>
                <select value={form.status} onChange={e => set('status', e.target.value)}>
                  <option value="active">{tc.statusActive}</option>
                  <option value="inactive">{tc.statusInactive}</option>
                  <option value="recalled">{tc.statusRecalled}</option>
                </select>
              </label>
            )}
          </div>
          {!isEdit && (
            <div style={{ margin: '12px 0 4px', padding: '10px 14px', background: '#0f172a', borderRadius: 6, border: '1px solid #1e293b' }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Chip code range preview</div>
              <code style={{ fontSize: 13, color: '#38bdf8', letterSpacing: '0.5px' }}>{preview}</code>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? t.modal.saving : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteBatchConfirm({ batch, onClose, onConfirm }) {
  const { t } = useContext(LangCtx);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const handleDelete = async () => {
    setBusy(true);
    try {
      const res = await axios.delete(`/api/kino-chip-batches/${batch.id}`);
      if (res.data?.success === false) { setError(res.data.error); return; }
      onConfirm();
    } catch (err) { setError(err.response?.data?.error || 'Delete failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><span>{t.chips.deleteBatch}</span><button className="icon-btn" onClick={onClose}><X size={16} /></button></div>
        <div className="modal-body">
          <p>{t.chips.deleteBatchWarning(batch.prefix)}</p>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-danger" onClick={handleDelete} disabled={busy}>
              {busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChipCard({ chip, index }) {
  const statusColor = { available: '#10b981', used: '#f59e0b', damaged: '#ef4444' };
  const color = statusColor[chip.status] || '#94a3b8';
  return (
    <div style={{
      background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10,
      padding: '14px 10px 10px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: 8, minWidth: 0,
    }}>
      <img
        src={`https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${encodeURIComponent(chip.chip_code)}&bgcolor=0f172a&color=e2e8f0&margin=4`}
        width={96} height={96} alt="QR"
        style={{ borderRadius: 6, display: 'block' }}
      />
      <code style={{ fontSize: 10, color: '#cbd5e1', letterSpacing: '0.3px', textAlign: 'center', wordBreak: 'break-all' }}>
        {chip.chip_code}
      </code>
      <span style={{
        fontSize: 10, fontWeight: 600, color, background: color + '1a',
        borderRadius: 99, padding: '2px 8px',
      }}>
        {chip.status}
      </span>
      {chip.nickname && (
        <span style={{ fontSize: 10, color: '#64748b' }}>{chip.nickname}</span>
      )}
    </div>
  );
}

function ChipListPanel({ batch, onClose }) {
  const { t } = useContext(LangCtx);
  const tc = t.chips;
  const [firstChips, setFirstChips] = useState([]);
  const [lastChip,   setLastChip]   = useState(null);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [printing,   setPrinting]   = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await axios.get(`/api/kino-chip-batches/${batch.id}/chips?page=1&limit=10`);
        const chips = res.data.chips || [];
        const tot   = res.data.total || 0;
        setFirstChips(chips);
        setTotal(tot);
        if (tot > 10) {
          const lastRes = await axios.get(`/api/kino-chip-batches/${batch.id}/chips?page=${tot}&limit=1`);
          setLastChip(lastRes.data.chips?.[0] || null);
        }
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    load();
  }, [batch.id]);

  const printQR = async () => {
    setPrinting(true);
    try {
      const pages = Math.ceil(batch.quantity / 100);
      let all = [];
      for (let p = 1; p <= pages; p++) {
        const res = await axios.get(`/api/kino-chip-batches/${batch.id}/chips?page=${p}&limit=100`);
        all = all.concat(res.data.chips || []);
      }
      const html = `<!DOCTYPE html><html><head><title>Batch ${batch.prefix}</title>
        <style>body{font-family:sans-serif;margin:16px}h2{margin-bottom:12px}
        .grid{display:flex;flex-wrap:wrap;gap:8px}
        .chip{text-align:center;border:1px solid #ccc;border-radius:6px;padding:10px;width:120px}
        .chip img{display:block;margin:0 auto 6px}
        .chip p{font-size:9px;margin:0;word-break:break-all;font-family:monospace}
        @media print{@page{size:A4;margin:12mm}.chip{page-break-inside:avoid}}</style>
        </head><body>
        <h2>Batch: ${batch.prefix} | Model: ${batch.model} | Total: ${batch.quantity}</h2>
        <div class="grid">${all.map(c =>
          `<div class="chip"><img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(c.chip_code)}" width="100" height="100"/><p>${c.chip_code}</p></div>`
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
      const pages = Math.ceil(batch.quantity / 100);
      let all = [];
      for (let p = 1; p <= pages; p++) {
        const res = await axios.get(`/api/kino-chip-batches/${batch.id}/chips?page=${p}&limit=100`);
        all = all.concat(res.data.chips || []);
      }
      const csv = all.map(c => c.chip_code).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `${batch.prefix}_chips.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error(e); }
    finally { setDownloading(false); }
  };

  const hiddenCount = total > 10 ? total - 11 : 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720, width: '90vw' }}>
        <div className="modal-header">
          <div>
            <span style={{ fontWeight: 600 }}>{batch.prefix}</span>
            <span style={{ color: '#64748b', fontSize: 13, marginLeft: 8 }}>{batch.model} · {total} chips</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={downloadCSV} disabled={downloading}>
              <Download size={13} />{downloading ? 'Downloading…' : 'CSV'}
            </button>
            <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={printQR} disabled={printing}>
              <Printer size={13} />{printing ? 'Preparing…' : tc.printQR}
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
                {firstChips.map((c, i) => <ChipCard key={c.id} chip={c} index={i + 1} />)}
              </div>

              {hiddenCount > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
                  <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
                  <span style={{ fontSize: 12, color: '#475569', whiteSpace: 'nowrap' }}>
                    · · · {hiddenCount.toLocaleString()} more chips · · ·
                  </span>
                  <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
                </div>
              )}

              {lastChip && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                  <ChipCard chip={lastChip} index={total} />
                </div>
              )}

              {firstChips.length === 0 && (
                <p style={{ textAlign: 'center', color: '#475569', padding: '32px 0' }}>{tc.noChips}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ChipsTab({ batches, models, onRefresh }) {
  const { t } = useContext(LangCtx);
  const tc = t.chips;
  const [subTab, setSubTab] = useState('batches');

  return (
    <>
      <div className="subtab-row" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`subtab-btn${subTab === 'batches' ? ' active' : ''}`} onClick={() => setSubTab('batches')}>
          <Layers size={13} />{tc.batchesTab}
        </button>
        <button className={`subtab-btn${subTab === 'models' ? ' active' : ''}`} onClick={() => setSubTab('models')}>
          <Cpu size={13} />{tc.modelsTab}
        </button>
        <button className={`subtab-btn${subTab === 'tested' ? ' active' : ''}`} onClick={() => setSubTab('tested')}>
          <ClipboardList size={13} />{tc.testedTab}
        </button>
      </div>

      {subTab === 'batches' && <ChipBatchesPanel batches={batches} models={models} onRefresh={onRefresh} />}
      {subTab === 'models'  && <ChipModelsPanel  models={models} onRefresh={onRefresh} />}
      {subTab === 'tested'  && <TestedChipsPanel />}
    </>
  );
}

function ChipBatchesPanel({ batches, models, onRefresh }) {
  const { t } = useContext(LangCtx);
  const tc = t.chips;
  const [modal, setModal]         = useState(null);
  const [viewBatch, setViewBatch] = useState(null);
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  const totalChips     = batches.reduce((s, b) => s + parseInt(b.quantity  || 0), 0);
  const availableChips = batches.reduce((s, b) => s + parseInt(b.available || 0), 0);
  const usedChips      = batches.reduce((s, b) => s + parseInt(b.used      || 0), 0);
  const damagedChips   = batches.reduce((s, b) => s + parseInt(b.damaged   || 0), 0);

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Layers}      label={t.countBatch(batches.length)} value={batches.length}  color="#3b82f6" />
        <StatCard icon={Package}     label={tc.total}                     value={totalChips}       color="#8b5cf6" />
        <StatCard icon={Check}       label={tc.available}                 value={availableChips}   color="#10b981" />
        <StatCard icon={Activity}    label={tc.used}                      value={usedChips}        color="#f59e0b" />
        <StatCard icon={Trash2}      label={tc.damaged}                   value={damagedChips}     color="#ef4444" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{t.countBatch(batches.length)}</span>
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
            <Plus size={14} />{t.addBatch}
          </button>
        </div>
      <table className="data-table">
        <thead><tr>
          <th>ID</th>
          <th>{tc.prefix || 'Prefix'}</th>
          <th>Model</th>
          <th>{tc.batchStatus}</th>
          <th>{tc.total}</th>
          <th style={{ color: '#10b981' }}>{tc.available}</th>
          <th style={{ color: '#94a3b8' }}>{tc.used}</th>
          <th style={{ color: '#ef4444' }}>{tc.damaged}</th>
          <th>Created</th>
          <th></th>
        </tr></thead>
        <tbody>
          {batches.length === 0 && <tr><td colSpan={10} className="empty-row">{t.empty.chipBatches}</td></tr>}
          {batches.map(b => (
            <tr key={b.id}>
              <td style={{ color: '#94a3b8', fontSize: 11 }}>{b.id}</td>
              <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{b.prefix}</td>
              <td>{b.model}</td>
              <td>
                <span style={{ fontSize: 11, color: b.status === 'active' ? '#10b981' : b.status === 'recalled' ? '#ef4444' : '#94a3b8' }}>
                  {b.status === 'active' ? tc.statusActive : b.status === 'recalled' ? tc.statusRecalled : tc.statusInactive}
                </span>
              </td>
              <td>{b.quantity}</td>
              <td style={{ color: '#10b981' }}>{b.available}</td>
              <td style={{ color: '#94a3b8' }}>{b.used}</td>
              <td style={{ color: b.damaged > 0 ? '#ef4444' : '#94a3b8' }}>{b.damaged}</td>
              <td style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(b.created_at).toLocaleDateString()}</td>
              <td>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="icon-btn" title={tc.viewChips} onClick={() => setViewBatch(b)}><QrCode size={14} /></button>
                  <button className="icon-btn" title={tc.editBatch} onClick={() => setModal({ type: 'edit', batch: b })}><Pencil size={14} /></button>
                  <button className="icon-btn" title={tc.deleteBatch} onClick={() => setModal({ type: 'delete', batch: b })}><Trash2 size={14} /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {modal?.type === 'add'    && <ChipBatchModal batch={null}        models={models} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit'   && <ChipBatchModal batch={modal.batch} models={models} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete' && <DeleteBatchConfirm batch={modal.batch} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
      {viewBatch && <ChipListPanel batch={viewBatch} onClose={() => setViewBatch(null)} />}
    </>
  );
}

function ChipModelsPanel({ models, onRefresh }) {
  const { t } = useContext(LangCtx);
  const tc = t.chips;
  const [modal, setModal] = useState(null);
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  const totalBatches = models.reduce((s, m) => s + (parseInt(m.batch_count) || 0), 0);
  const totalChips   = models.reduce((s, m) => s + (parseInt(m.chip_count)  || 0), 0);
  const activeCount  = models.filter(m => m.status === 'active').length;

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Cpu}     label={tc.countModel(models.length)} value={models.length} color="#3b82f6" />
        <StatCard icon={Check}   label={tc.statusActive}              value={activeCount}   color="#10b981" />
        <StatCard icon={Layers}  label={tc.batchCount}                value={totalBatches}  color="#8b5cf6" />
        <StatCard icon={Package} label={tc.chipCount}                 value={totalChips}    color="#f59e0b" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{tc.countModel(models.length)}</span>
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
            <Plus size={14} />{tc.addModel}
          </button>
        </div>
        <table className="data-table">
          <thead><tr>
            <th>{tc.modelCode.replace(' *', '')}</th>
            <th>{tc.modelName}</th>
            <th>{tc.biomarkerKeys.replace(' *', '')}</th>
            <th>{tc.modelStatus}</th>
            <th>{tc.batchCount}</th>
            <th>{tc.chipCount}</th>
            <th></th>
          </tr></thead>
          <tbody>
            {models.length === 0 && <tr><td colSpan={7} className="empty-row">{t.empty.chipModels}</td></tr>}
            {models.map(m => (
              <tr key={m.code}>
                <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{m.code}</td>
                <td>{m.name || <span style={{ color: '#64748b' }}>—</span>}</td>
                <td style={{ fontSize: 12 }}>
                  {(m.biomarker_keys || []).map(k => (
                    <span key={k} style={{ display: 'inline-block', padding: '2px 8px', marginRight: 4, marginBottom: 2, borderRadius: 10, background: '#162E4A', color: '#A6C4E5', fontSize: 11 }}>{k}</span>
                  ))}
                </td>
                <td>
                  <span style={{ fontSize: 11, color: m.status === 'active' ? '#10b981' : '#94a3b8' }}>
                    {m.status === 'active' ? tc.statusActive : tc.statusInactive}
                  </span>
                </td>
                <td>{m.batch_count}</td>
                <td>{m.chip_count}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="icon-btn" title={tc.editModel} onClick={() => setModal({ type: 'edit', model: m })}><Pencil size={14} /></button>
                    <button className="icon-btn" title={tc.deleteModel}
                            onClick={() => setModal({ type: 'delete', model: m })}
                            disabled={parseInt(m.batch_count) > 0}
                            style={parseInt(m.batch_count) > 0 ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(modal?.type === 'add' || modal?.type === 'edit') && (
        <ChipModelModal model={modal.type === 'edit' ? modal.model : null}
                        onClose={() => setModal(null)} onSave={closeAndRefresh} />
      )}
      {modal?.type === 'delete' && (
        <DeleteChipModelConfirm model={modal.model}
                                onClose={() => setModal(null)} onConfirm={closeAndRefresh} />
      )}
    </>
  );
}

function ChipModelModal({ model, onClose, onSave }) {
  const { t } = useContext(LangCtx);
  const tc = t.chips;
  const isEdit = !!model;

  const [form, setForm] = useState({
    code:           model?.code           || '',
    name:           model?.name           || '',
    biomarkers:     (model?.biomarker_keys || []).join(', '),
    config:         model?.config ? JSON.stringify(model.config, null, 2) : '{\n  \n}',
    guide_video:    model?.guide_video    || '',
    guide_text:     model?.guide_text     || '',
    status:         model?.status         || 'active',
    notes:          model?.notes          || '',
  });
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const code = form.code.trim().toUpperCase();
    if (!isEdit && !/^[A-Z0-9]{1,16}$/.test(code)) {
      setError('Code must be 1–16 uppercase letters/digits'); return;
    }
    const biomarker_keys = form.biomarkers.split(',').map(s => s.trim()).filter(Boolean);
    if (biomarker_keys.length === 0) { setError(tc.biomarkersRequired); return; }

    let config;
    try {
      config = JSON.parse(form.config);
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        setError(tc.invalidJson); return;
      }
    } catch (err) {
      setError(`${tc.invalidJson}: ${err.message}`); return;
    }

    const payload = {
      name:        form.name.trim() || null,
      biomarker_keys,
      config,
      guide_video: form.guide_video.trim() || null,
      guide_text:  form.guide_text.trim()  || null,
      status:      form.status,
      notes:       form.notes.trim() || null,
    };

    setBusy(true);
    try {
      let res;
      if (isEdit) {
        res = await axios.put(`/api/kino-chip-models/${encodeURIComponent(model.code)}`, payload);
      } else {
        res = await axios.post('/api/kino-chip-models', { code, ...payload });
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
          <span>{isEdit ? tc.editModel : tc.addModel}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field">
              <span>{tc.modelCode}</span>
              <input value={form.code}
                     onChange={e => set('code', e.target.value.toUpperCase())}
                     placeholder="K2" disabled={isEdit} required={!isEdit} maxLength={16} />
              <small style={{ color: '#64748b', fontSize: 10 }}>{tc.modelCodeHint}</small>
            </label>
            <label className="form-field">
              <span>{tc.modelName}</span>
              <input value={form.name} onChange={e => set('name', e.target.value)}
                     placeholder={tc.modelNamePlaceholder} />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tc.biomarkerKeys}</span>
              <input value={form.biomarkers} onChange={e => set('biomarkers', e.target.value)}
                     placeholder="hsCRP, IL-6" required />
              <small style={{ color: '#64748b', fontSize: 10 }}>{tc.biomarkerKeysHint}</small>
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tc.configJson}</span>
              <textarea rows={12} value={form.config}
                        onChange={e => set('config', e.target.value)}
                        style={{ fontFamily: 'monospace', fontSize: 12 }} required />
              <small style={{ color: '#64748b', fontSize: 10 }}>{tc.configJsonHint}</small>
            </label>
            <label className="form-field">
              <span>{tc.modelStatus}</span>
              <select value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="active">{tc.statusActive}</option>
                <option value="inactive">{tc.statusInactive}</option>
              </select>
            </label>
            <label className="form-field">
              <span>{tc.guideVideo}</span>
              <input value={form.guide_video} onChange={e => set('guide_video', e.target.value)}
                     placeholder="https://…" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tc.guideText}</span>
              <textarea rows={2} value={form.guide_text} onChange={e => set('guide_text', e.target.value)} />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tc.notes}</span>
              <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? t.modal.saving : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteChipModelConfirm({ model, onClose, onConfirm }) {
  const { t } = useContext(LangCtx);
  const tc = t.chips;
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const inUse = parseInt(model.batch_count) > 0;

  const handleDelete = async () => {
    if (inUse) return;
    setBusy(true); setError('');
    try {
      const res = await axios.delete(`/api/kino-chip-models/${encodeURIComponent(model.code)}`);
      if (res.data?.success === false) { setError(res.data.error || 'Failed to delete'); return; }
      onConfirm();
    } catch (err) { setError(err.response?.data?.error || 'Failed to delete'); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{tc.deleteModel}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p>{tc.deleteModelWarning(model.code)}</p>
          {inUse && <p className="form-error">{tc.modelInUse(model.batch_count)}</p>}
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-primary danger" onClick={handleDelete} disabled={busy || inUse}>
              {busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TestedChipsPanel() {
  const { t } = useContext(LangCtx);
  const tc = t.chips;
  const [chips, setChips]       = useState([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
  const [loading, setLoading]   = useState(false);
  const [detailScanId, setDetailScanId] = useState(null);
  const limit = 20;

  const load = async (p = page, q = search) => {
    setLoading(true);
    try {
      const res = await axios.get('/api/kino-tested-chips', { params: { page: p, limit, search: q || undefined } });
      setChips(res.data.chips || []);
      setTotal(res.data.total || 0);
    } catch (e) { console.error(e); setChips([]); setTotal(0); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(1, search); setPage(1); /* eslint-disable-next-line */ }, []);

  const handleSearchSubmit = (e) => { e.preventDefault(); load(1, search); setPage(1); };
  const goToPage = (p) => { setPage(p); load(p, search); };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <div className="stat-row">
        <StatCard icon={ClipboardList} label={tc.countTested(total)} value={total} color="#3b82f6" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{tc.countTested(total)}</span>
          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 6 }}>
            <input value={search} onChange={e => setSearch(e.target.value)}
                   placeholder={tc.searchChipOrUser} style={{ fontSize: 13, padding: '6px 10px' }} />
            <button type="submit" className="btn-secondary" style={{ padding: '6px 10px' }}><Search size={14} /></button>
          </form>
        </div>
        <table className="data-table">
          <thead><tr>
            <th>{tc.chipCode}</th>
            <th>{tc.batch}</th>
            <th>Nickname</th>
            <th>Bio Age</th>
            <th>{tc.device}</th>
            <th>{tc.testedAt}</th>
            <th></th>
          </tr></thead>
          <tbody>
            {!loading && chips.length === 0 && <tr><td colSpan={7} className="empty-row">{tc.noTestedChips}</td></tr>}
            {chips.map(c => (
              <tr key={c.scan_id} style={{ cursor: 'pointer' }} onClick={() => setDetailScanId(c.scan_id)}>
                <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{c.chip_code}</td>
                <td>{c.batch_prefix} <span style={{ color: '#94a3b8', fontSize: 11 }}>({c.model})</span></td>
                <td>{fmt(c.nickname)}</td>
                <td style={{ fontWeight: 700, color: bioAgeColor(c.bio_age, null) }}>{c.bio_age != null ? Number(c.bio_age).toFixed(1) : '—'}</td>
                <td>{fmt(c.device_name || c.device_serial)}</td>
                <td style={{ fontSize: 11, color: '#94a3b8' }}>{c.tested_at ? new Date(c.tested_at).toLocaleString() : (c.updated_at ? new Date(c.updated_at).toLocaleString() : '—')}</td>
                <td>
                  <button className="icon-btn" title={tc.viewDetail} onClick={(e) => { e.stopPropagation(); setDetailScanId(c.scan_id); }}>
                    <ClipboardList size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '12px 0' }}>
            <button className="btn-secondary" disabled={page <= 1} onClick={() => goToPage(page - 1)}>‹</button>
            <span style={{ fontSize: 12, color: '#94a3b8', alignSelf: 'center' }}>{tc.page} {page} {tc.of} {totalPages}</span>
            <button className="btn-secondary" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>›</button>
          </div>
        )}
      </div>

      {detailScanId && (
        <TestedChipDetailModal
          scanId={detailScanId}
          onClose={() => setDetailScanId(null)}
          onReset={() => { setDetailScanId(null); load(page, search); }}
        />
      )}
    </>
  );
}

function ResetChipConfirm({ scanId, chipCode, onClose, onConfirm }) {
  const { t } = useContext(LangCtx);
  const tc = t.chips;
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const handleReset = async () => {
    setBusy(true); setError('');
    try {
      const res = await axios.post(`/api/kino-tested-chips/${scanId}/reset`);
      if (res.data?.success === false) { setError(res.data.error || t.modal.saveFailed); return; }
      onConfirm();
    } catch (err) { setError(err.response?.data?.error || t.modal.saveFailed); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><span>{tc.resetChip}</span><button className="icon-btn" onClick={onClose}><X size={16} /></button></div>
        <div className="modal-body">
          <p>{tc.resetChipWarning(chipCode)}</p>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-primary danger" onClick={handleReset} disabled={busy}>
              {busy ? tc.resetting : tc.resetChip}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TestedChipDetailModal({ scanId, onClose, onReset }) {
  const { t } = useContext(LangCtx);
  const tc = t.chips;
  const [chip, setChip]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axios.get(`/api/kino-tested-chips/${scanId}`)
      .then(res => { if (!cancelled) setChip(res.data.chip || null); })
      .catch(() => { if (!cancelled) setChip(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scanId]);

  const bmData      = chip?.biomarker_data || null;
  const actualBm     = bmData?.actual || null;
  const validatedBm  = bmData?.validated || null;
  const subAgesRaw   = bmData?.bioage_profile?.SubAges || null;
  const cAge         = chip?.chrono_age;
  const bAge         = chip?.bio_age;

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-user-detail" onClick={e => e.stopPropagation()}>
        <div className="udm-header">
          <div className="udm-identity">
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>{tc.chipDetail}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', marginTop: 2 }}>{chip?.chip_code || '…'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {chip && (
              <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                onClick={() => setConfirmReset(true)}>
                <RotateCcw size={13} />{tc.resetChip}
              </button>
            )}
            <button className="icon-btn" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        <div className="modal-body">
          {loading && <p style={{ textAlign: 'center', color: '#64748b', padding: '32px 0' }}>{t.topbar.loading}</p>}
          {!loading && !chip && <p style={{ textAlign: 'center', color: '#475569', padding: '32px 0' }}>Not found</p>}
          {!loading && chip && (
            <div className="udm-health">
              <div className="udm-col-left">
                <div className="udm-section">
                  <div className="udm-section-title">{tc.sectionChip}</div>
                  <div className="drawer-info-grid">
                    <span className="drawer-info-key">{tc.chipCode}</span>
                    <span className="drawer-info-val mono">{fmt(chip.chip_code)}</span>
                    <span className="drawer-info-key">{tc.batch}</span>
                    <span className="drawer-info-val">{fmt(chip.batch_prefix)}</span>
                    <span className="drawer-info-key">{tc.batchModel}</span>
                    <span className="drawer-info-val">{fmt(chip.model)}</span>
                    <span className="drawer-info-key">{tc.chipModelName}</span>
                    <span className="drawer-info-val">{fmt(chip.model_name)}</span>
                    <span className="drawer-info-key">{tc.batchStatusLabel}</span>
                    <span className="drawer-info-val">{fmt(chip.batch_status)}</span>
                  </div>
                </div>

                <div className="udm-section">
                  <div className="udm-section-title">{tc.sectionScan}</div>
                  <div className="drawer-info-grid">
                    <span className="drawer-info-key">Nickname</span>
                    <span className="drawer-info-val">{fmt(chip.nickname)}</span>
                    <span className="drawer-info-key">User ID</span>
                    <span className="drawer-info-val mono">{fmt(chip.user_id)}</span>
                    <span className="drawer-info-key">{tc.scanStatus}</span>
                    <span className="drawer-info-val">{fmt(chip.scan_status)}</span>
                    <span className="drawer-info-key">{tc.scannedAt}</span>
                    <span className="drawer-info-val">{chip.scan_created_at ? new Date(chip.scan_created_at).toLocaleString() : '—'}</span>
                    <span className="drawer-info-key">{tc.updatedAt}</span>
                    <span className="drawer-info-val">{chip.scan_updated_at ? new Date(chip.scan_updated_at).toLocaleString() : '—'}</span>
                  </div>
                </div>

                <div className="udm-section">
                  <div className="udm-section-title">{tc.sectionDevice}</div>
                  {chip.kino_device_id ? (
                    <div className="drawer-info-grid">
                      <span className="drawer-info-key">{tc.device}</span>
                      <span className="drawer-info-val">{fmt(chip.device_name)}</span>
                      <span className="drawer-info-key">{tc.deviceSerial}</span>
                      <span className="drawer-info-val mono">{fmt(chip.device_serial)}</span>
                    </div>
                  ) : (
                    <p style={{ fontSize: 12, color: '#64748b' }}>{tc.noDeviceLinked}</p>
                  )}
                </div>
              </div>

              <div className="udm-col-right">
                {!chip.biomarker_id && (
                  <div className="udm-section">
                    <p style={{ fontSize: 12, color: '#64748b' }}>{tc.noBiomarkerLinked}</p>
                  </div>
                )}

                {chip.biomarker_id && (
                  <>
                    <div className="udm-section">
                      <div className="udm-bioage-row">
                        <div className="udm-age-chip">
                          <div className="udm-age-val">{cAge ?? '—'}</div>
                          <div className="udm-age-label">{t.userDetail.chronoAge}</div>
                        </div>
                        <div className="udm-age-chip udm-age-chip-primary">
                          <div className="udm-age-val udm-bio-val" style={{ color: bioAgeColor(bAge, cAge) }}>
                            {bAge != null ? Number(bAge).toFixed(1) : '—'}
                          </div>
                          <div className="udm-age-label">{t.userDetail.bioAge}</div>
                        </div>
                      </div>
                    </div>

                    {subAgesRaw && (
                      <div className="udm-section">
                        <div className="udm-section-title">{t.userDetail.subAges}</div>
                        <div className="udm-subages">
                          {TESTED_SUB_AGE_META.map(({ key, label, color }) => {
                            const v = subAgesRaw[key];
                            const score = v != null && cAge != null
                              ? Math.max(5, Math.min(95, Math.round((cAge + 15 - v) / 30 * 100)))
                              : 50;
                            return (
                              <div key={key} className="udm-subage-row">
                                <span className="udm-subage-label">{label}</span>
                                <div className="udm-bar-wrap">
                                  <div className="udm-bar-fill" style={{ width: `${score}%`, background: color }} />
                                </div>
                                <span className="udm-subage-val" style={{ color }}>{v != null ? Number(v).toFixed(1) : '—'}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="udm-section">
                      <div className="udm-section-title">{tc.sectionValidatedBiomarkers}</div>
                      {validatedBm ? (
                        <div className="bm-table">
                          {TESTED_BM_META.map(({ key, label, unit }) => (
                            <div key={key} className="bm-table-row">
                              <span className="bm-table-label">{label}</span>
                              <span className="bm-table-val">{validatedBm[key] ?? '—'}</span>
                              <span className="bm-table-unit">{unit}</span>
                            </div>
                          ))}
                        </div>
                      ) : <p style={{ fontSize: 12, color: '#64748b' }}>—</p>}
                    </div>

                    <div className="udm-section">
                      <div className="udm-section-title">{tc.sectionRawBiomarkers}</div>
                      {actualBm && Object.keys(actualBm).length > 0 ? (
                        <div className="bm-table">
                          {TESTED_BM_META.map(({ key, label, unit }) => (
                            actualBm[key] != null && (
                              <div key={key} className="bm-table-row">
                                <span className="bm-table-label">{label}</span>
                                <span className="bm-table-val">{actualBm[key]}</span>
                                <span className="bm-table-unit">{unit}</span>
                              </div>
                            )
                          ))}
                        </div>
                      ) : <p style={{ fontSize: 12, color: '#64748b' }}>—</p>}
                    </div>

                    {bmData?.context && (
                      <div className="udm-section">
                        <div className="udm-section-title">{tc.sectionContext}</div>
                        <p style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap' }}>{bmData.context}</p>
                      </div>
                    )}
                  </>
                )}

                <div className="udm-section">
                  <div className="udm-section-title">{tc.sectionRawResults}</div>
                  <pre style={{
                    fontSize: 11, background: '#0f172a', color: '#cbd5e1', borderRadius: 6,
                    padding: 10, overflowX: 'auto', maxHeight: 220, margin: 0,
                  }}>
                    {JSON.stringify(chip.scan_results || {}, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    {confirmReset && chip && (
      <ResetChipConfirm
        scanId={scanId}
        chipCode={chip.chip_code}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => { setConfirmReset(false); onReset(); }}
      />
    )}
    </>
  );
}

export { ChipsTab };
