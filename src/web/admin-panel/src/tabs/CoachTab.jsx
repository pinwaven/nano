import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Users, UserCog, Plus, Pencil, Trash2, X, Check, ChevronDown, GraduationCap,
} from 'lucide-react';
import { useLang, fmt, fmtDate, Badge, StatCard, PERMS, hasPermission } from '../shared.jsx';

// ── EMPTY_COACH ───────────────────────────────────────────────────────────────

const EMPTY_COACH = { user_id: '', group_id: '' };

// ── CoachModal ────────────────────────────────────────────────────────────────

function CoachModal({ coach, users, channels, groups, onClose, onSave }) {
  const { t } = useLang();
  const isEdit = !!coach?.id;
  const [form, setForm] = useState(isEdit
    ? { user_id: coach.user_id || '', group_id: coach.group_id ?? '' }
    : { ...EMPTY_COACH });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const selectedUser = users.find(u => u.user_id === form.user_id) || null;
  const filteredUsers = search.trim().length > 0
    ? users.filter(u => {
        const q = search.toLowerCase();
        return (u.nickname || '').toLowerCase().includes(q) || (u.user_id || '').toLowerCase().includes(q);
      }).slice(0, 8)
    : [];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.user_id.trim()) { setError(t.modal.userRequired); return; }
    setBusy(true); setError('');
    try {
      const payload = { user_id: form.user_id, group_id: form.group_id === '' ? null : parseInt(form.group_id) };
      if (isEdit) await axios.put(`/api/coaches/${coach.id}`, payload);
      else await axios.post('/api/coaches', payload);
      onSave();
    } catch (err) { setError(err.response?.data?.error || t.modal.saveFailed); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEdit ? t.modal.editCoach : t.modal.addCoach}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <div className="form-field" style={{ gridColumn: '1 / -1', position: 'relative' }}>
              <span>{t.modal.selectUser}</span>
              {selectedUser ? (
                <div className="coach-user-selected">
                  <div className="avatar" style={{ background: '#10b98120', color: '#10b981', width: 28, height: 28, fontSize: 13, flexShrink: 0 }}>{(selectedUser.nickname || 'U')[0].toUpperCase()}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{selectedUser.nickname || '—'}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{selectedUser.user_id} · {selectedUser.email || selectedUser.phone || '—'}</div>
                  </div>
                  {!isEdit && <button type="button" className="icon-btn" onClick={() => { set('user_id', ''); setSearch(''); }}><X size={14} /></button>}
                </div>
              ) : (
                <>
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={t.modal.selectUserPlaceholder}
                    autoComplete="off"
                  />
                  {filteredUsers.length > 0 && (
                    <div className="coach-user-dropdown">
                      {filteredUsers.map(u => (
                        <div key={u.user_id} className="coach-user-option" onClick={() => { set('user_id', u.user_id); setSearch(''); }}>
                          <div className="avatar" style={{ background: '#10b98120', color: '#10b981', width: 24, height: 24, fontSize: 11, flexShrink: 0 }}>{(u.nickname || 'U')[0].toUpperCase()}</div>
                          <div>
                            <div style={{ fontWeight: 500 }}>{u.nickname || '—'}</div>
                            <div style={{ fontSize: 11, color: '#64748b' }}>{u.user_id}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            {groups && groups.length > 0 && (
              <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span>{t.modal.coachGroup}</span>
                <div className="select-wrap" style={{ width: '100%' }}>
                  <select value={form.group_id} onChange={e => set('group_id', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                    <option value="">{t.modal.coachGroupUnassigned}</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  <ChevronDown size={11} className="select-chevron" />
                </div>
              </label>
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

// ── DeleteCoachConfirm ────────────────────────────────────────────────────────

function DeleteCoachConfirm({ coach, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleDelete = async () => {
    setBusy(true);
    try { await axios.delete(`/api/coaches/${coach.id}`); onConfirm(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.modal.deleteCoach}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 20, color: '#475569' }}>
            {t.modal.deleteCoachWarning(<strong>{coach.name}</strong>)}
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

// ── CoachUsersModal ───────────────────────────────────────────────────────────

function CoachUsersModal({ coach, onClose }) {
  const { t } = useLang();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    axios.get(`/api/coach-users/${coach.id}`)
      .then(r => { if (!cancelled) setList(r.data.users || []); })
      .catch(err => { if (!cancelled) { setError(err.response?.data?.error || err.message); setList([]); } });
    return () => { cancelled = true; };
  }, [coach.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.modal.coachUsersTitle(coach.name || '—')}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto', padding: 0 }}>
          {list === null && <div className="empty-row" style={{ padding: 24, textAlign: 'center' }}>{t.topbar.loading}</div>}
          {error && <div className="form-error" style={{ margin: 16 }}>{error}</div>}
          {list !== null && !error && list.length === 0 && (
            <div className="empty-row" style={{ padding: 24, textAlign: 'center' }}>{t.modal.coachUsersEmpty}</div>
          )}
          {list !== null && list.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.table.name}</th>
                  <th>{t.table.bioAge}</th>
                  <th>{t.table.phone}</th>
                  <th>{t.table.email}</th>
                  <th>{t.table.joined}</th>
                </tr>
              </thead>
              <tbody>
                {list.map(u => (
                  <tr key={u.user_id}>
                    <td>
                      <div className="avatar-cell">
                        <div className="avatar" style={{ background: '#3b82f620', color: '#3b82f6' }}>{(u.nickname || 'U')[0].toUpperCase()}</div>
                        <div>
                          <div className="bold">{fmt(u.nickname)}</div>
                          <div className="muted mono" style={{ fontSize: 10 }}>{u.user_id}</div>
                        </div>
                      </div>
                    </td>
                    <td>{u.bio_age != null ? <Badge color="#10b981">{Number(u.bio_age).toFixed(1)}</Badge> : <span className="muted">—</span>}</td>
                    <td className="muted">{fmt(u.phone)}</td>
                    <td className="muted">{fmt(u.email)}</td>
                    <td className="muted">{fmtDate(u.created_at)}</td>
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

// ── CoachGroupModal ───────────────────────────────────────────────────────────

function CoachGroupModal({ group, channelId, onClose, onSave }) {
  const { t } = useLang();
  const isEdit = !!group?.id;
  const [form, setForm] = useState({
    name: group?.name || '',
    description: group?.description || '',
    type: group?.type || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError(t.modal.coachGroupName.replace(' *', '') + ' is required'); return; }
    setBusy(true); setError('');
    try {
      const payload = { name: form.name.trim(), description: form.description.trim() || null, type: form.type.trim() || null, channel_id: channelId };
      if (isEdit) await axios.put(`/api/coach-groups/${group.id}`, payload);
      else await axios.post('/api/coach-groups', payload);
      onSave();
    } catch (err) { setError(err.response?.data?.error || t.modal.saveFailed); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEdit ? t.modal.editCoachGroup : t.modal.addCoachGroup}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal.coachGroupName}</span>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder={t.modal.coachGroupName.replace(' *', '')} autoFocus />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal.coachGroupType}</span>
              <input value={form.type} onChange={e => set('type', e.target.value)} placeholder={t.modal.coachGroupTypePlaceholder} />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal.coachGroupDescription}</span>
              <input value={form.description} onChange={e => set('description', e.target.value)} placeholder={t.modal.coachGroupDescription} />
            </label>
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

// ── DeleteCoachGroupConfirm ───────────────────────────────────────────────────

function DeleteCoachGroupConfirm({ group, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleDelete = async () => {
    setBusy(true);
    try { await axios.delete(`/api/coach-groups/${group.id}`); onConfirm(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.modal.deleteCoachGroup}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 20, color: '#475569' }}>
            {t.modal.deleteCoachGroupWarning(<strong>{group.name}</strong>)}
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

// ── CoachTab ──────────────────────────────────────────────────────────────────

function CoachTab({ coaches, users, channels, session, isCmsAdmin, onRefresh }) {
  const { t } = useLang();
  const [modal, setModal] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [sortField, setSortField] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [includeSubchannels, setIncludeSubchannels] = useState(true);
  const [subCoaches, setSubCoaches] = useState(null);
  const [groups, setGroups] = useState([]);
  const [groupModal, setGroupModal] = useState(null);
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  const displayCoaches = includeSubchannels && subCoaches !== null ? subCoaches : coaches;

  const fetchGroups = () => {
    const cid = session?.channelId;
    if (!cid) return;
    axios.get(`/api/coach-groups?channel_id=${cid}`)
      .then(r => setGroups(r.data.groups || []))
      .catch(() => {});
  };

  useEffect(() => { fetchGroups(); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!includeSubchannels) { setSubCoaches(null); return; }
    const cid = session?.channelId;
    if (!cid) return;
    axios.get(`/api/channel-coaches/${cid}?include_subchannels=true`)
      .then(r => setSubCoaches(r.data.coaches || []))
      .catch(() => setSubCoaches(null));
  }, [includeSubchannels, session]);

  const q = searchQuery.trim().toLowerCase();
  const channelFilterSet = (() => {
    if (!channelFilter) return null;
    if (!includeSubchannels) return new Set([channelFilter]);
    const root = channels.find(c => c.name === channelFilter);
    if (!root) return new Set([channelFilter]);
    const ids = new Set([root.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of channels) {
        if (!ids.has(c.id) && ids.has(c.parent_channel_id)) { ids.add(c.id); changed = true; }
      }
    }
    return new Set(channels.filter(c => ids.has(c.id)).map(c => c.name));
  })();
  const byChannel = channelFilterSet
    ? displayCoaches.filter(p => channelFilterSet.has(p.channel_name || ''))
    : displayCoaches;
  const byGroup = groupFilter
    ? byChannel.filter(p => String(p.group_id) === String(groupFilter))
    : byChannel;
  const filtered = q
    ? byGroup.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.id || '').toString().includes(q) ||
        (p.email || '').toLowerCase().includes(q) ||
        (p.phone || '').toLowerCase().includes(q) ||
        (p.channel_name || '').toLowerCase().includes(q)
      )
    : byGroup;

  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortField] ?? '', bv = b[sortField] ?? '';
    const numA = Number(av), numB = Number(bv);
    if (!isNaN(numA) && !isNaN(numB) && av !== '' && bv !== '') {
      return sortDir === 'asc' ? numA - numB : numB - numA;
    }
    return sortDir === 'asc'
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const SortIcon = ({ field }) => (
    <span style={{ marginLeft: 4, opacity: sortField === field ? 1 : 0.3, color: sortField === field ? 'var(--primary)' : 'inherit' }}>
      {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );

  return (
    <>
      <div className="stat-row">
        <StatCard icon={UserCog} label={t.stats.totalCoaches}    value={displayCoaches.length}                  color="#10b981" />
        <StatCard icon={Users}   label={t.stats.assignedUsers}   value={users.filter(u => u.coach_id).length}  color="#3b82f6" />
        <StatCard icon={Users}   label={t.stats.unassignedUsers} value={users.filter(u => !u.coach_id).length} color="#f59e0b" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="table-count">{(q || channelFilter) ? `${sorted.length} / ${displayCoaches.length}` : t.countCoach(displayCoaches.length)}</span>
            <input
              className="toolbar-search"
              type="text"
              placeholder={t.searchCoaches}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {isCmsAdmin && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={includeSubchannels} onChange={e => setIncludeSubchannels(e.target.checked)} />
                Include sub-channels
              </label>
            )}
          </div>
          {hasPermission(session, PERMS.COACHES_WRITE) && (
            <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
              <Plus size={14} />{t.addCoach}
            </button>
          )}
        </div>
        {channels.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
            {channels.map(c => {
              const active = channelFilter === c.name;
              return (
                <button
                  key={c.id}
                  onClick={() => setChannelFilter(active ? '' : c.name)}
                  style={{
                    padding: '3px 10px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
                    border: `1px solid ${active ? '#6366f1' : 'var(--border)'}`,
                    background: active ? '#6366f1' : 'transparent',
                    color: active ? '#fff' : 'var(--muted)',
                    fontWeight: active ? 600 : 400,
                    transition: 'all 0.15s',
                  }}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        )}
        {groups.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 16px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
            <button onClick={() => setGroupFilter('')} style={{ padding: '2px 9px', borderRadius: 99, fontSize: 11, cursor: 'pointer', border: `1px solid ${groupFilter === '' ? '#8b5cf6' : 'var(--border)'}`, background: groupFilter === '' ? '#8b5cf6' : 'transparent', color: groupFilter === '' ? '#fff' : 'var(--muted)', fontWeight: groupFilter === '' ? 600 : 400 }}>All Groups</button>
            {groups.map(g => {
              const active = String(groupFilter) === String(g.id);
              return (
                <button key={g.id} onClick={() => setGroupFilter(active ? '' : g.id)} style={{ padding: '2px 9px', borderRadius: 99, fontSize: 11, cursor: 'pointer', border: `1px solid ${active ? '#8b5cf6' : 'var(--border)'}`, background: active ? '#8b5cf6' : 'transparent', color: active ? '#fff' : 'var(--muted)', fontWeight: active ? 600 : 400, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {g.name}
                  <span style={{ background: active ? 'rgba(255,255,255,0.25)' : '#e9d5ff', color: active ? '#fff' : '#7c3aed', borderRadius: 99, padding: '0 5px', fontSize: 10 }}>{g.coach_count || 0}</span>
                </button>
              );
            })}
            <button onClick={() => setGroupModal({ type: 'add-group' })} style={{ marginLeft: 4, padding: '2px 9px', borderRadius: 99, fontSize: 11, cursor: 'pointer', border: '1px dashed #c4b5fd', background: 'transparent', color: '#8b5cf6' }}>+ {t.modal.addCoachGroup}</button>
          </div>
        )}
        {groups.length === 0 && session?.channelId && (
          <div style={{ padding: '6px 16px', borderBottom: '1px solid var(--border)' }}>
            <button onClick={() => setGroupModal({ type: 'add-group' })} style={{ padding: '2px 9px', borderRadius: 99, fontSize: 11, cursor: 'pointer', border: '1px dashed #c4b5fd', background: 'transparent', color: '#8b5cf6' }}>+ {t.modal.addCoachGroup}</button>
          </div>
        )}
        <table className="data-table">
          <thead>
            <tr>
              <th className="sortable-th" onClick={() => toggleSort('id')}>{t.table.id}<SortIcon field="id" /></th>
              <th className="sortable-th" onClick={() => toggleSort('name')}>{t.table.name}<SortIcon field="name" /></th>
              <th className="sortable-th" onClick={() => toggleSort('channel_name')}>{t.table.channel}<SortIcon field="channel_name" /></th>
              <th className="sortable-th" onClick={() => toggleSort('group_name')}>{t.modal.coachGroup}<SortIcon field="group_name" /></th>
              <th>{t.table.linkedUser}</th>
              <th>{t.table.email}</th>
              <th>{t.table.phone}</th>
              <th>{t.table.language}</th>
              <th className="sortable-th" onClick={() => toggleSort('user_count')}>{t.table.customers}<SortIcon field="user_count" /></th>
              <th className="sortable-th" onClick={() => toggleSort('created_at')}>{t.table.joined}<SortIcon field="created_at" /></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && <tr><td colSpan={11} className="empty-row">{t.empty.coaches}</td></tr>}
            {sorted.map(p => (
              <tr key={p.id} className="clickable-row" onClick={() => setModal({ type: 'users', coach: p })}>
                <td className="muted">{p.id}</td>
                <td>
                  <div className="avatar-cell">
                    <div className="avatar" style={{ background: '#10b98120', color: '#10b981' }}>{(p.name || 'C')[0].toUpperCase()}</div>
                    <span className="bold">{fmt(p.name)}</span>
                  </div>
                </td>
                <td>{p.channel_name ? <Badge color="#6366f1">{p.channel_name}</Badge> : '—'}</td>
                <td>{p.group_name ? <Badge color="#8b5cf6">{p.group_name}</Badge> : <span className="muted">—</span>}</td>
                <td className="muted mono" style={{ fontSize: 11 }}>{p.user_id ? p.user_id : '—'}</td>
                <td className="muted">{fmt(p.email)}</td>
                <td className="muted">{fmt(p.phone)}</td>
                <td><Badge color={p.language === 'zh' ? '#16a34a' : '#2563eb'}>{(p.language || 'zh').toUpperCase()}</Badge></td>
                <td><Badge color="#3b82f6">{p.user_count || 0}</Badge></td>
                <td className="muted">{fmtDate(p.created_at)}</td>
                <td onClick={e => e.stopPropagation()}>
                  <div className="row-actions">
                    {p.user_id && <button className="icon-btn" title="Enroll in Academy" onClick={async (e) => {
                      const btn = e.currentTarget;
                      try {
                        await axios.post('/api/academy/enrollments', { user_id: p.user_id });
                        btn.style.color = '#10b981';
                        setTimeout(() => { btn.style.color = ''; }, 2000);
                      } catch (err) {
                        btn.style.color = '#ef4444';
                        btn.title = err.response?.data?.error || err.message;
                        setTimeout(() => { btn.style.color = ''; }, 3000);
                      }
                    }}><GraduationCap size={14} /></button>}
                    {hasPermission(session, PERMS.COACHES_WRITE) && <button className="icon-btn" title={t.modal.editCoach} onClick={() => setModal({ type: 'edit', coach: p })}><Pencil size={14} /></button>}
                    {hasPermission(session, PERMS.COACHES_DELETE) && <button className="icon-btn danger" title={t.modal.deleteCoach} onClick={() => setModal({ type: 'delete', coach: p })}><Trash2 size={14} /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Group management panel */}
      {groups.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="table-toolbar">
            <span className="table-count">{groups.length} {groups.length === 1 ? 'group' : 'groups'}</span>
            <button className="btn-primary" onClick={() => setGroupModal({ type: 'add-group' })}><Plus size={14} />{t.modal.addCoachGroup}</button>
          </div>
          <table className="data-table">
            <thead><tr>
              <th>{t.modal.coachGroupName.replace(' *', '')}</th>
              <th>{t.modal.coachGroupType}</th>
              <th>{t.modal.coachGroupDescription}</th>
              <th>{t.coachCrm?.colCoachCount || 'Coaches'}</th>
              <th></th>
            </tr></thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.id}>
                  <td style={{ fontWeight: 600 }}><Badge color="#8b5cf6">{g.name}</Badge></td>
                  <td className="muted" style={{ fontSize: 12 }}>{g.type || '—'}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{g.description || '—'}</td>
                  <td><Badge color="#6366f1">{g.coach_count || 0}</Badge></td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" title={t.modal.editCoachGroup} onClick={() => setGroupModal({ type: 'edit-group', group: g })}><Pencil size={14} /></button>
                      <button className="icon-btn danger" title={t.modal.deleteCoachGroup} onClick={() => setGroupModal({ type: 'delete-group', group: g })}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.type === 'add'    && <CoachModal coach={null}        users={users} channels={channels} groups={groups} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit'   && <CoachModal coach={modal.coach} users={users} channels={channels} groups={groups} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete' && <DeleteCoachConfirm coach={modal.coach} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
      {modal?.type === 'users'  && <CoachUsersModal coach={modal.coach} onClose={() => setModal(null)} />}
      {groupModal?.type === 'add-group'    && <CoachGroupModal group={null} channelId={session?.channelId} onClose={() => setGroupModal(null)} onSave={() => { setGroupModal(null); fetchGroups(); }} />}
      {groupModal?.type === 'edit-group'   && <CoachGroupModal group={groupModal.group} channelId={session?.channelId} onClose={() => setGroupModal(null)} onSave={() => { setGroupModal(null); fetchGroups(); }} />}
      {groupModal?.type === 'delete-group' && <DeleteCoachGroupConfirm group={groupModal.group} onClose={() => setGroupModal(null)} onConfirm={() => { setGroupModal(null); setGroupFilter(''); fetchGroups(); }} />}
    </>
  );
}

export { CoachTab };
