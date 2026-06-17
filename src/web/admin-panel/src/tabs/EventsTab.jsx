import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { X, ChevronDown, Plus, Trash2, Calendar, Activity, Users } from 'lucide-react';
import { useLang, fmt, StatCard, Badge } from '../shared.jsx';

function EventCreateModal({ channels, isSuperadmin, channelId, headers, onClose, onSave }) {
  const { t } = useLang();
  const [form, setForm] = useState({ title: '', description: '', location: '', scheduled_at: '', end_at: '', capacity: '', channel_id: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payload = { ...form, capacity: form.capacity ? parseInt(form.capacity, 10) : null };
      if (!isSuperadmin) payload.channel_id = channelId;
      await axios.post('/api/events', payload, { headers });
      onSave();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.modal?.addEvent || 'Create Event'}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal?.title || 'Title'} *</span>
              <input required value={form.title} onChange={e => set('title', e.target.value)} />
            </label>
            <label className="form-field">
              <span>{t.modal?.location || 'Location'}</span>
              <input value={form.location} onChange={e => set('location', e.target.value)} />
            </label>
            <label className="form-field">
              <span>{t.modal?.capacity || 'Capacity'}</span>
              <input type="number" min="1" value={form.capacity} onChange={e => set('capacity', e.target.value)} placeholder="—" />
            </label>
            <label className="form-field">
              <span>{t.modal?.startTime || 'Start Time'} *</span>
              <input type="datetime-local" required value={form.scheduled_at} onChange={e => set('scheduled_at', e.target.value)} />
            </label>
            <label className="form-field">
              <span>{t.modal?.endTime || 'End Time'}</span>
              <input type="datetime-local" value={form.end_at} onChange={e => set('end_at', e.target.value)} />
            </label>
            {isSuperadmin && (
              <label className="form-field">
                <span>{t.modal?.channel || 'Channel'}</span>
                <div className="select-wrap" style={{ width: '100%' }}>
                  <select value={form.channel_id} onChange={e => set('channel_id', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                    <option value="">—</option>
                    {(channels || []).map(ch => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
                  </select>
                  <ChevronDown size={11} className="select-chevron" />
                </div>
              </label>
            )}
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal?.description || 'Description'}</span>
              <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)} style={{ resize: 'vertical' }} />
            </label>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>{t.modal?.cancel || 'Cancel'}</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? (t.modal?.saving || '…') : (t.modal?.addEvent || 'Create')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EventSignupsModal({ event, headers, onClose }) {
  const { t } = useLang();
  const [signups, setSignups] = useState(null);

  useEffect(() => {
    axios.get(`/api/events/${event.id}/signups`, { headers })
      .then(r => setSignups(r.data?.signups || []))
      .catch(() => setSignups([]));
  }, [event.id]);

  const fmtDt = (dt) => dt ? new Date(dt).toLocaleString() : '—';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{event.title}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {signups === null ? (
            <p className="muted">{t.topbar.loading}</p>
          ) : signups.length === 0 ? (
            <p className="muted">{t.modal?.noSignups || 'No signups yet'}</p>
          ) : (
            <table className="data-table">
              <thead><tr>
                <th>{t.table?.nickname || 'Name'}</th>
                <th>{t.table?.phone || 'Phone'}</th>
                <th>{t.table?.joined || 'Signed Up'}</th>
              </tr></thead>
              <tbody>
                {signups.map(s => (
                  <tr key={s.user_id}>
                    <td>{fmt(s.nickname)}</td>
                    <td className="muted">{fmt(s.phone)}</td>
                    <td className="muted">{fmtDt(s.signed_up_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal?.close || 'Close'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EventsTab({ channels, session, isSuperadmin, onRefresh }) {
  const { t } = useLang();
  const headers = session?.token ? { Authorization: `Bearer ${session.token}` } : {};
  const channelId = isSuperadmin ? null : session?.channelId;

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      if (channelId) {
        const res = await axios.get(`/api/events?channel_id=${channelId}`, { headers });
        setEvents(res.data?.events || []);
      } else {
        const results = await Promise.all(
          (channels || []).map(ch =>
            axios.get(`/api/events?channel_id=${ch.id}`, { headers })
              .catch(() => ({ data: { events: [] } }))
          )
        );
        setEvents(results.flatMap((r, i) =>
          (r.data?.events || []).map(ev => ({ ...ev, channel_name: channels[i]?.name }))
        ));
      }
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, [channelId, channels, JSON.stringify(headers)]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const handleCancel = async (id) => {
    if (!window.confirm(t.modal?.confirmCancel || 'Cancel this event?')) return;
    try {
      await axios.delete(`/api/events/${id}`, { headers });
      fetchEvents();
    } catch (e) { alert(e.message); }
  };

  const activeCount     = events.filter(e => e.status === 'active').length;
  const totalSignups    = events.reduce((s, e) => s + (parseInt(e.signup_count, 10) || 0), 0);
  const upcomingCount   = events.filter(e => new Date(e.scheduled_at) > new Date()).length;

  const fmtDt = (dt) => dt ? new Date(dt).toLocaleString() : '—';

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Calendar}  label={t.nav.events}                              value={events.length}  color="#6366f1" />
        <StatCard icon={Activity}  label={t.stats?.activeEvents  || 'Active'}        value={activeCount}    color="#10b981" />
        <StatCard icon={Calendar}  label={t.stats?.upcomingEvents || 'Upcoming'}     value={upcomingCount}  color="#f59e0b" />
        <StatCard icon={Users}     label={t.stats?.totalSignups  || 'Total Signups'} value={totalSignups}   color="#3b82f6" />
      </div>

      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{events.length} {t.nav.events}</span>
          <button className="btn-primary" onClick={() => setModal({ type: 'create' })}>
            <Plus size={14} />{t.modal?.addEvent || 'Create Event'}
          </button>
        </div>
        <table className="data-table">
          <thead><tr>
            <th>{t.table?.title || 'Title'}</th>
            {isSuperadmin && <th>{t.table?.channel || 'Channel'}</th>}
            <th>{t.table?.startTime || 'Start'}</th>
            <th>{t.table?.location || 'Location'}</th>
            <th>{t.table?.capacity || 'Capacity'}</th>
            <th>{t.table?.signups || 'Signups'}</th>
            <th>{t.table?.status || 'Status'}</th>
            <th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={isSuperadmin ? 8 : 7} className="empty-row">{t.topbar.loading}</td></tr>}
            {!loading && events.length === 0 && (
              <tr><td colSpan={isSuperadmin ? 8 : 7} className="empty-row">{t.modal?.noEvents || 'No events yet'}</td></tr>
            )}
            {events.map(ev => (
              <tr key={ev.id} style={{ cursor: 'pointer' }} onClick={() => setModal({ type: 'signups', event: ev })}>
                <td>
                  <div style={{ fontWeight: 600 }}>{ev.title}</div>
                  {ev.description && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{ev.description.slice(0, 60)}{ev.description.length > 60 ? '…' : ''}</div>}
                </td>
                {isSuperadmin && <td className="muted">{fmt(ev.channel_name)}</td>}
                <td className="muted">{fmtDt(ev.scheduled_at)}</td>
                <td className="muted">{fmt(ev.location)}</td>
                <td className="muted">{ev.capacity ?? '∞'}</td>
                <td><Badge color="#3b82f6">{ev.signup_count || 0}</Badge></td>
                <td>
                  <Badge color={ev.status === 'cancelled' ? '#ef4444' : ev.status === 'completed' ? '#94a3b8' : '#10b981'}>
                    {{ active: t.modal?.eventStatusActive, cancelled: t.modal?.eventStatusCancelled, completed: t.modal?.eventStatusCompleted }[ev.status] || ev.status}
                  </Badge>
                </td>
                <td onClick={e => e.stopPropagation()}>
                  {ev.status === 'active' && (
                    <button className="icon-btn danger" title={t.modal?.cancelEvent || 'Cancel event'} onClick={() => handleCancel(ev.id)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal?.type === 'create' && (
        <EventCreateModal
          channels={channels}
          isSuperadmin={isSuperadmin}
          channelId={channelId}
          headers={headers}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); fetchEvents(); }}
        />
      )}
      {modal?.type === 'signups' && (
        <EventSignupsModal
          event={modal.event}
          headers={headers}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

export { EventsTab };
