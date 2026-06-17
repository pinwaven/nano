import React, { useState } from 'react';
import axios from 'axios';
import { ChevronDown, X, Check, Trash2, Copy, Plus, Tag } from 'lucide-react';
import { useLang, fmt, fmtDate, Badge, StatCard } from '../shared.jsx';
import { PERMS, hasPermission } from '../shared.jsx';

function InviteModal({ channels, coaches, onClose, onSave }) {
  const { t } = useLang();
  const [form, setForm] = useState({ channel_id: '', type: 'coach', max_uses: '', created_by: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const channelCoaches = coaches.filter(c => String(c.channel_id) === String(form.channel_id));
  const showCoachPicker = form.type === 'coach' && form.channel_id !== '';

  const handleChannelChange = (val) => {
    setForm(f => ({ ...f, channel_id: val, created_by: '' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.channel_id) { setError(t.modal.inviteChannel.replace(' *', '') + ' required'); return; }
    if (showCoachPicker && !form.created_by) { setError('Assigned coach required for coach invites'); return; }
    setBusy(true); setError('');
    try {
      const payload = {
        channel_id: parseInt(form.channel_id),
        type: form.type,
        max_uses: form.max_uses !== '' ? parseInt(form.max_uses) : null,
      };
      if (form.created_by) payload.created_by = form.created_by;
      await axios.post('/api/invitations', payload);
      onSave();
    } catch (err) { setError(err.response?.data?.error || t.modal.saveFailed); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.modal.addInvite}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field">
              <span>{t.modal.inviteChannel}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.channel_id} onChange={e => handleChannelChange(e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="">{t.modal.channelUnassigned}</option>
                  {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{t.modal.inviteType}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.type} onChange={e => set('type', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="coach">{t.modal.inviteTypeCoach}</option>
                  <option value="channel">{t.modal.inviteTypeChannel}</option>
                  <option value="admin">{t.modal.inviteTypeAdmin}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            {showCoachPicker && (
              <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span>Assigned Coach *</span>
                <div className="select-wrap" style={{ width: '100%' }}>
                  <select value={form.created_by} onChange={e => set('created_by', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                    <option value="">— select coach —</option>
                    {channelCoaches.map(c => <option key={c.user_id} value={c.user_id}>{c.name}</option>)}
                  </select>
                  <ChevronDown size={11} className="select-chevron" />
                </div>
              </label>
            )}
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{t.modal.inviteMaxUses}</span>
              <input type="number" min="1" value={form.max_uses} onChange={e => set('max_uses', e.target.value)} placeholder={t.modal.inviteMaxUsesPlaceholder} />
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

function DeactivateInviteConfirm({ invite, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleDeactivate = async () => {
    setBusy(true);
    try { await axios.delete(`/api/invitations/${invite.id}`); onConfirm(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.modal.deactivateInvite}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 20, color: '#475569' }}>
            {t.modal.deleteInviteWarning(invite.code)}
          </p>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-danger" onClick={handleDeactivate} disabled={busy}>
              <Trash2 size={14} />{busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InvitesTab({ invitations, channels, coaches, session, onRefresh }) {
  const { t } = useLang();
  const [modal, setModal] = useState(null);
  const [copied, setCopied] = useState(null);
  const closeAndRefresh = () => { setModal(null); onRefresh(); };

  const activeCount = invitations.filter(i => i.is_active).length;
  const usedTotal   = invitations.reduce((s, i) => s + (i.use_count || 0), 0);

  const copyCode = (code) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Tag} label={t.stats.totalInvites}  value={invitations.length} color="#6366f1" />
        <StatCard icon={Tag} label={t.stats.activeInvites} value={activeCount}         color="#10b981" />
        <StatCard icon={Tag} label={t.stats.usedInvites}   value={usedTotal}           color="#f59e0b" />
      </div>
      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{t.countInvite(invitations.length)}</span>
          {hasPermission(session, PERMS.INVITES_WRITE) && (
            <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
              <Plus size={14} />{t.addInvite}
            </button>
          )}
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t.table.code}</th>
              <th>{t.table.type}</th>
              <th>{t.table.channel}</th>
              <th>{t.table.creator}</th>
              <th>{t.table.maxUses}</th>
              <th>{t.table.useCount}</th>
              <th>Status</th>
              <th>{t.table.joined}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invitations.length === 0 && <tr><td colSpan={9} className="empty-row">{t.empty.invites}</td></tr>}
            {invitations.map(inv => (
              <tr key={inv.id}>
                <td>
                  <div className="avatar-cell" style={{ gap: 6 }}>
                    <code className="code-tag" style={{ letterSpacing: '0.1em', fontSize: 13 }}>{inv.code}</code>
                    <button className="icon-btn" title="Copy" onClick={() => copyCode(inv.code)} style={{ padding: 3 }}>
                      {copied === inv.code
                        ? <Check size={12} style={{ color: '#10b981' }} />
                        : <Copy size={12} />}
                    </button>
                  </div>
                </td>
                <td><Badge color="#8b5cf6">{inv.type}</Badge></td>
                <td>{inv.channel_name ? <Badge color="#6366f1">{inv.channel_name}</Badge> : '—'}</td>
                <td className="muted">{fmt(inv.creator_name)}</td>
                <td className="muted">{inv.max_uses != null ? inv.max_uses : t.invites.unlimited}</td>
                <td><Badge color={inv.use_count > 0 ? '#3b82f6' : '#94a3b8'}>{inv.use_count || 0}</Badge></td>
                <td>
                  <Badge color={inv.is_active ? '#10b981' : '#94a3b8'}>
                    {inv.is_active ? t.invites.active : t.invites.deactivated}
                  </Badge>
                </td>
                <td className="muted">{fmtDate(inv.created_at)}</td>
                <td>
                  {inv.is_active && hasPermission(session, PERMS.INVITES_DELETE) && (
                    <button className="icon-btn danger" title={t.modal.deactivateInvite} onClick={() => setModal({ type: 'deactivate', invite: inv })}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal?.type === 'add'        && <InviteModal channels={channels} coaches={coaches} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'deactivate' && <DeactivateInviteConfirm invite={modal.invite} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
    </>
  );
}

export { InvitesTab };
