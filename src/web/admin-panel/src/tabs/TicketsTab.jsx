import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { X, Plus, Pencil, Trash2, Bug, Activity, Check, ChevronRight, ChevronDown, CornerDownRight } from 'lucide-react';
import { LangCtx, StatCard } from '../shared.jsx';

const TICKET_STATUS_COLORS = {
  open:        '#ef4444',
  in_progress: '#f59e0b',
  resolved:    '#10b981',
  closed:      '#64748b',
};
const TICKET_PRIORITY_COLORS = {
  low:    '#64748b',
  normal: '#6375EC',
  high:   '#f87171',
};

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

function TicketStatusLabel({ status }) {
  const { t } = useContext(LangCtx);
  const tk = t.tickets;
  const map = { open: tk.sOpen, in_progress: tk.sInProgress, resolved: tk.sResolved, closed: tk.sClosed };
  const color = TICKET_STATUS_COLORS[status] || '#94a3b8';
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 10, background: `${color}22`, color, fontSize: 11, fontWeight: 600 }}>
      {map[status] || status}
    </span>
  );
}

function TicketPriorityLabel({ priority }) {
  const { t } = useContext(LangCtx);
  const tk = t.tickets;
  const map = { low: tk.pLow, normal: tk.pNormal, high: tk.pHigh };
  const color = TICKET_PRIORITY_COLORS[priority] || '#94a3b8';
  return (
    <span style={{ fontSize: 11, color, fontWeight: 600 }}>{map[priority] || priority}</span>
  );
}

function TicketImageThumb({ ossKey, onClick }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    axios.get('/api/oss/presign', { params: { action: 'get', key: ossKey } })
      .then(res => { if (alive && res.data?.success) setUrl(res.data.url); else if (alive) setErr(true); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [ossKey]);
  if (err) return <div style={{ width: 64, height: 64, borderRadius: 6, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 10 }}>!</div>;
  if (!url) return <div style={{ width: 64, height: 64, borderRadius: 6, background: '#1e293b' }} />;
  return (
    <img src={url} alt=""
         onClick={onClick}
         style={{ width: 64, height: 64, borderRadius: 6, objectFit: 'cover', cursor: onClick ? 'zoom-in' : 'default', border: '1px solid rgba(99,117,236,0.25)' }} />
  );
}

function TicketImageLightbox({ ossKey, onClose }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    axios.get('/api/oss/presign', { params: { action: 'get', key: ossKey } })
      .then(res => { if (alive && res.data?.success) setUrl(res.data.url); });
    return () => { alive = false; };
  }, [ossKey]);
  return (
    <div className="modal-overlay" onClick={onClose}
         style={{ background: 'rgba(0,0,0,0.85)' }}>
      {url && <img src={url} alt="" style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8 }} />}
    </div>
  );
}

function TicketsTab({ tickets, onRefresh }) {
  const { t } = useContext(LangCtx);
  const tk = t.tickets;
  const [modal, setModal]     = useState(null);
  const [filter, setFilter]   = useState('all');
  const [lightbox, setLightbox] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const closeAndRefresh = () => { setModal(null); onRefresh(); };
  const selectTicket = (ticket) => setModal({ type: 'view', ticket });
  const toggleExpanded = (id) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const topLevel = tickets.filter(t => !t.parent_id);
  const childrenByParent = tickets.reduce((acc, t) => {
    if (t.parent_id) (acc[t.parent_id] ||= []).push(t);
    return acc;
  }, {});

  const counts = {
    all:         tickets.length,
    open:        tickets.filter(t => t.status === 'open').length,
    in_progress: tickets.filter(t => t.status === 'in_progress').length,
    resolved:    tickets.filter(t => t.status === 'resolved').length,
    closed:      tickets.filter(t => t.status === 'closed').length,
  };
  const filtered = filter === 'all' ? topLevel : topLevel.filter(t => t.status === filter);

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Bug}         label={tk.statOpen}       value={counts.open}        color={TICKET_STATUS_COLORS.open}        />
        <StatCard icon={Activity}    label={tk.statInProgress} value={counts.in_progress} color={TICKET_STATUS_COLORS.in_progress} />
        <StatCard icon={Check}       label={tk.statResolved}   value={counts.resolved}    color={TICKET_STATUS_COLORS.resolved}    />
        <StatCard icon={X}           label={tk.statClosed}     value={counts.closed}      color={TICKET_STATUS_COLORS.closed}      />
      </div>

      <div className="card">
        <div className="table-toolbar">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['all', 'open', 'in_progress', 'resolved', 'closed'].map(s => (
              <button key={s}
                      className={`subtab-btn${filter === s ? ' active' : ''}`}
                      onClick={() => setFilter(s)}>
                {s === 'all' ? tk.filterAll : (s === 'open' ? tk.sOpen : s === 'in_progress' ? tk.sInProgress : s === 'resolved' ? tk.sResolved : tk.sClosed)}
                {' '}<span style={{ opacity: 0.6 }}>({counts[s]})</span>
              </button>
            ))}
          </div>
          <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
            <Plus size={14} />{tk.addTicket}
          </button>
        </div>
        <table className="data-table">
          <thead><tr>
            <th>ID</th>
            <th>{tk.title.replace(' *', '')}</th>
            <th>{tk.status}</th>
            <th>{tk.priority}</th>
            <th>{tk.images}</th>
            <th>{tk.reporter}</th>
            <th>Created</th>
            <th></th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={8} className="empty-row">{t.empty.tickets}</td></tr>}
            {filtered.map(ticket => {
              const kids = childrenByParent[ticket.id] || [];
              const isExpanded = expanded.has(ticket.id);
              return (
                <React.Fragment key={ticket.id}>
                  <TicketRow ticket={ticket} tk={tk}
                             childCount={kids.length}
                             expanded={isExpanded}
                             onToggleExpand={kids.length > 0 ? () => toggleExpanded(ticket.id) : null}
                             onSelect={() => selectTicket(ticket)}
                             onEdit={() => setModal({ type: 'edit', ticket })}
                             onDelete={() => setModal({ type: 'delete', ticket })}
                             onImageClick={setLightbox} />
                  {isExpanded && kids.map(child => (
                    <TicketRow key={child.id} ticket={child} tk={tk} sub
                               onSelect={() => selectTicket(child)}
                               onEdit={() => setModal({ type: 'edit', ticket: child })}
                               onDelete={() => setModal({ type: 'delete', ticket: child })}
                               onImageClick={setLightbox} />
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal?.type === 'view' && (
        <TicketDetailModal ticket={modal.ticket}
                           parent={modal.ticket.parent_id ? tickets.find(x => x.id === modal.ticket.parent_id) : null}
                           subtickets={childrenByParent[modal.ticket.id] || []}
                           onClose={() => setModal(null)}
                           onEdit={() => setModal({ type: 'edit', ticket: modal.ticket })}
                           onSelectTicket={selectTicket}
                           onAddSubticket={() => setModal({ type: 'add', parentId: modal.ticket.id })} />
      )}
      {(modal?.type === 'add' || modal?.type === 'edit') && (
        <TicketModal ticket={modal.type === 'edit' ? modal.ticket : null}
                     parentId={modal.type === 'add' ? modal.parentId : null}
                     parentTitle={modal.type === 'add' && modal.parentId ? tickets.find(x => x.id === modal.parentId)?.title : null}
                     onClose={() => setModal(null)} onSave={closeAndRefresh} />
      )}
      {modal?.type === 'delete' && (
        <DeleteTicketConfirm ticket={modal.ticket}
                             subticketCount={(childrenByParent[modal.ticket.id] || []).length}
                             onClose={() => setModal(null)} onConfirm={closeAndRefresh} />
      )}
      {lightbox && <TicketImageLightbox ossKey={lightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}

function TicketRow({ ticket, tk, sub = false, childCount = 0, expanded = false, onToggleExpand, onSelect, onEdit, onDelete, onImageClick }) {
  return (
    <tr style={{ cursor: 'pointer', background: sub ? 'rgba(99,117,236,0.04)' : undefined }} onClick={onSelect}>
      <td style={{ color: '#94a3b8', fontSize: 11 }}>#{ticket.id}</td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: sub ? 22 : 0 }}>
          {sub && <CornerDownRight size={13} style={{ color: '#64748b', flexShrink: 0 }} />}
          {!sub && onToggleExpand && (
            <button className="icon-btn" style={{ width: 20, height: 20, flexShrink: 0 }}
                    onClick={e => { e.stopPropagation(); onToggleExpand(); }}>
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}
          {!sub && !onToggleExpand && <span style={{ width: 20, flexShrink: 0 }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: sub ? 500 : 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              {ticket.title}
              {!sub && childCount > 0 && (
                <span style={{ fontSize: 10, fontWeight: 600, color: '#6375EC', background: 'rgba(99,117,236,0.12)', borderRadius: 8, padding: '1px 7px' }}>
                  {tk.subticketCount(childCount)}
                </span>
              )}
            </div>
            {ticket.description && (
              <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2, maxWidth: 440, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ticket.description}
              </div>
            )}
          </div>
        </div>
      </td>
      <td><TicketStatusLabel status={ticket.status} /></td>
      <td><TicketPriorityLabel priority={ticket.priority} /></td>
      <td onClick={e => e.stopPropagation()}>
        {(ticket.images && ticket.images.length > 0) ? (
          <div style={{ display: 'flex', gap: 4 }}>
            {ticket.images.slice(0, 3).map(k => (
              <TicketImageThumb key={k} ossKey={k} onClick={() => onImageClick(k)} />
            ))}
            {ticket.images.length > 3 && (
              <div style={{ width: 64, height: 64, borderRadius: 6, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>
                +{ticket.images.length - 3}
              </div>
            )}
          </div>
        ) : <span style={{ color: '#475569', fontSize: 11 }}>—</span>}
      </td>
      <td style={{ fontSize: 12 }}>{ticket.reporter || <span style={{ color: '#475569' }}>—</span>}</td>
      <td style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(ticket.created_at).toLocaleString()}</td>
      <td onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="icon-btn" title={tk.editTicket}   onClick={onEdit}><Pencil size={14} /></button>
          <button className="icon-btn" title={tk.deleteTicket} onClick={onDelete}><Trash2 size={14} /></button>
        </div>
      </td>
    </tr>
  );
}

function TicketDetailModal({ ticket, parent, subtickets = [], onClose, onEdit, onSelectTicket, onAddSubticket }) {
  const { t } = useContext(LangCtx);
  const tk = t.tickets;
  const [lightbox, setLightbox] = useState(null);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{tk.viewTicket}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {parent && (
              <button type="button" onClick={() => onSelectTicket(parent)}
                      style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(99,117,236,0.08)', border: '1px solid rgba(99,117,236,0.25)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', color: '#6375EC', fontSize: 12, fontWeight: 600 }}>
                <CornerDownRight size={13} style={{ transform: 'rotate(180deg)' }} />
                {tk.parentTicket}: {parent.title}
              </button>
            )}

            <div>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{tk.title.replace(' *', '')}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{ticket.title}</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{tk.status}</div>
                <TicketStatusLabel status={ticket.status} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{tk.priority}</div>
                <TicketPriorityLabel priority={ticket.priority} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{tk.reporter}</div>
                <div style={{ fontSize: 13, color: ticket.reporter ? '#1e293b' : '#94a3b8' }}>{ticket.reporter || '—'}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>ID</div>
                <div style={{ fontSize: 13, color: '#475569' }}>#{ticket.id}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Created</div>
                <div style={{ fontSize: 13, color: '#475569' }}>{new Date(ticket.created_at).toLocaleString()}</div>
              </div>
            </div>

            {ticket.description && (
              <div>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{tk.description}</div>
                <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.65, whiteSpace: 'pre-wrap', background: '#f8fafc', borderRadius: 8, padding: '12px 14px', border: '1px solid #e2e8f0' }}>
                  {ticket.description}
                </div>
              </div>
            )}

            {ticket.images && ticket.images.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{tk.images} ({ticket.images.length})</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {ticket.images.map(k => (
                    <TicketImageThumb key={k} ossKey={k} onClick={() => setLightbox(k)} />
                  ))}
                </div>
              </div>
            )}

            {!parent && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{tk.subtickets} ({subtickets.length})</div>
                  <button type="button" className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onAddSubticket}>
                    <Plus size={12} style={{ marginRight: 4 }} />{tk.addSubticket}
                  </button>
                </div>
                {subtickets.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{tk.noSubtickets}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {subtickets.map(sub => (
                      <button type="button" key={sub.id} onClick={() => onSelectTicket(sub)}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', textAlign: 'left' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub.title}</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                          <TicketPriorityLabel priority={sub.priority} />
                          <TicketStatusLabel status={sub.status} />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-primary" onClick={onEdit}><Pencil size={13} style={{ marginRight: 4 }} />{tk.editTicket}</button>
          </div>
        </div>
      </div>
      {lightbox && <TicketImageLightbox ossKey={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function TicketModal({ ticket, parentId, parentTitle, onClose, onSave }) {
  const { t } = useContext(LangCtx);
  const tk = t.tickets;
  const isEdit = !!ticket;

  const [form, setForm] = useState({
    title:       ticket?.title       || '',
    description: ticket?.description || '',
    status:      ticket?.status      || 'open',
    priority:    ticket?.priority    || 'normal',
    reporter:    ticket?.reporter    || '',
  });
  const [images, setImages]     = useState(ticket?.images || []);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handlePickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true); setProgress(0); setError('');
    try {
      const presignRes = await axios.get('/api/oss/presign', {
        params: { type: 'image', filename: file.name, category: 'tickets' },
      });
      if (!presignRes.data.success) throw new Error(presignRes.data.error || tk.uploadFailed);
      const { url, key } = presignRes.data;
      await uploadToOSS(url, file, setProgress);
      setImages(arr => [...arr, key]);
    } catch (err) {
      setError(err.response?.data?.error || err.message || tk.uploadFailed);
    } finally { setUploading(false); }
  };

  const removeImage = (key) => setImages(arr => arr.filter(k => k !== key));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setError(tk.titleRequired); return; }
    setBusy(true); setError('');
    try {
      const payload = { ...form, images };
      if (!isEdit && parentId) payload.parent_id = parentId;
      let res;
      if (isEdit) {
        res = await axios.put(`/api/tickets/${ticket.id}`, payload);
      } else {
        res = await axios.post('/api/tickets', payload);
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
          <span>{isEdit ? tk.editTicket : (parentId ? tk.addSubticket : tk.addTicket)}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            {!isEdit && parentId && (
              <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#6375EC', background: 'rgba(99,117,236,0.08)', border: '1px solid rgba(99,117,236,0.25)', borderRadius: 8, padding: '6px 10px' }}>
                {tk.parentTicket}: {parentTitle}
              </div>
            )}
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tk.title}</span>
              <input value={form.title}
                     onChange={e => set('title', e.target.value)}
                     placeholder={tk.titlePlaceholder} required autoFocus />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tk.description}</span>
              <textarea rows={5} value={form.description}
                        onChange={e => set('description', e.target.value)}
                        placeholder={tk.descriptionPlaceholder}
                        style={{ resize: 'vertical' }} />
            </label>
            <label className="form-field">
              <span>{tk.status}</span>
              <select value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="open">{tk.sOpen}</option>
                <option value="in_progress">{tk.sInProgress}</option>
                <option value="resolved">{tk.sResolved}</option>
                <option value="closed">{tk.sClosed}</option>
              </select>
            </label>
            <label className="form-field">
              <span>{tk.priority}</span>
              <select value={form.priority} onChange={e => set('priority', e.target.value)}>
                <option value="low">{tk.pLow}</option>
                <option value="normal">{tk.pNormal}</option>
                <option value="high">{tk.pHigh}</option>
              </select>
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{tk.reporter}</span>
              <input value={form.reporter}
                     onChange={e => set('reporter', e.target.value)}
                     placeholder={tk.reporterPlaceholder} />
            </label>

            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label-text">{tk.images}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                {images.map(k => (
                  <div key={k} style={{ position: 'relative' }}>
                    <TicketImageThumb ossKey={k} />
                    <button type="button" className="icon-btn" title={tk.removeImage}
                            onClick={() => removeImage(k)}
                            style={{ position: 'absolute', top: -6, right: -6, background: '#0F2540', border: '1px solid rgba(99,117,236,0.4)', borderRadius: '50%', width: 22, height: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <label className="upload-zone" style={{ width: 64, height: 64, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: uploading ? 'wait' : 'pointer' }}>
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePickFile} disabled={uploading} />
                  {uploading ? <span style={{ fontSize: 10, color: '#94a3b8' }}>{progress}%</span> : <Plus size={18} style={{ color: 'var(--muted)' }} />}
                </label>
              </div>
              {!uploading && images.length === 0 && (
                <small style={{ color: '#64748b', fontSize: 11 }}>{tk.imageDropHint}</small>
              )}
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy || uploading}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy || uploading}>
              {busy ? t.modal.saving : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteTicketConfirm({ ticket, subticketCount = 0, onClose, onConfirm }) {
  const { t } = useContext(LangCtx);
  const tk = t.tickets;
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    setBusy(true); setError('');
    try {
      const res = await axios.delete(`/api/tickets/${ticket.id}`);
      if (res.data?.success === false) { setError(res.data.error || 'Failed to delete'); return; }
      onConfirm();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{tk.deleteTicket}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p>{tk.deleteWarning(ticket.title)}</p>
          {subticketCount > 0 && (
            <p style={{ color: '#f59e0b', fontSize: 13 }}>{tk.deleteSubticketsWarning(subticketCount)}</p>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-primary danger" onClick={handleDelete} disabled={busy}>
              {busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { TicketsTab };
