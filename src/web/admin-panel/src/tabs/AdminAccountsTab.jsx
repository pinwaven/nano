import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Plus, Pencil, Trash2, X, Check, Shield } from 'lucide-react';
import { useLang, fmtDate, hasPermission, PERMS } from '../shared.jsx';

// ── Constants ─────────────────────────────────────────────────────────────────

const PERMISSION_GROUPS = [
  { resource: 'users',         actions: ['read','write','delete'], label: 'Users' },
  { resource: 'coaches',       actions: ['read','write','delete'], label: 'Coaches' },
  { resource: 'store',         actions: ['read','write','delete'], label: 'Store' },
  { resource: 'orders',        actions: ['read','write'],          label: 'Orders' },
  { resource: 'invites',       actions: ['read','write','delete'], label: 'Invites' },
  { resource: 'inventory',     actions: ['read','write'],          label: 'Inventory' },
  { resource: 'rewards',       actions: ['read','write','delete'], label: 'Rewards' },
  { resource: 'partners',      actions: ['read','write','delete'], label: 'Partners' },
  { resource: 'academy',       actions: ['read','write'],          label: 'Academy' },
  { resource: 'questionnaires',actions: ['read'],                  label: 'Questionnaires' },
  { resource: 'health-plans',  actions: ['read'],                  label: 'Health Plans' },
  { resource: 'reports',       actions: ['read'],                  label: 'Reports' },
  { resource: 'tickets',       actions: ['read'],                  label: 'Tickets' },
  { resource: 'lab',           actions: ['read','write'],          label: 'Lab' },
  { resource: 'kino',          actions: ['read'],                  label: 'Kino' },
  { resource: 'chips',         actions: ['read'],                  label: 'Chips' },
  { resource: 'admin-accounts',  actions: ['read','write'],          label: 'Admin Accounts' },
  { resource: 'digital-assets', actions: ['read','write','delete'], label: 'Media' },
];

// ── Helper Components ─────────────────────────────────────────────────────────

function PermissionGroupsEditor({ available, value, onChange }) {
  const toggle = (perm) => onChange(value.includes(perm) ? value.filter(p => p !== perm) : [...value, perm]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
      {PERMISSION_GROUPS.filter(g => available.some(p => p.startsWith(g.resource + ':'))).map(g => (
        <div key={g.resource}>
          <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{g.label}</div>
          <div style={{ display: 'flex', gap: 12 }}>
            {g.actions.map(action => {
              const perm = `${g.resource}:${action}`;
              if (!available.includes(perm)) return null;
              return (
                <label key={perm} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={value.includes(perm)} onChange={() => toggle(perm)} />
                  {action}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

function AdminAccountsTab({ accounts, channels, session, onRefresh }) {
  const { t } = useLang();
  const ta = t.adminAccounts;
  const [channelRoles, setChannelRoles] = useState([]);
  const [modal, setModal] = useState(null);
  const [form, setForm]   = useState({ username: '', password: '', channel_id: '', role_id: '', permissions_override: [] });
  const [roleForm, setRoleForm] = useState({ name: '', label: '', permissions: [] });
  const [err, setErr]     = useState('');
  const [saving, setSaving] = useState(false);
  const [subTab, setSubTab] = useState('accounts'); // 'accounts' | 'roles'

  const isChannelAdmin = session?.role === 'channel';
  const canManageRoles = hasPermission(session, PERMS.ADMIN_ACCTS_WRITE);
  const myChannelId = session?.channelId ? String(session.channelId) : '';

  const loadRoles = useCallback(() => {
    axios.get('/api/admin-channel-roles').then(r => setChannelRoles(r.data.roles || []));
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  // Actor's available perms (ceiling for what they can assign)
  const actorPerms = isChannelAdmin
    ? (session?.allowedPerms || [])
    : PERMISSION_GROUPS.flatMap(g => g.actions.map(a => `${g.resource}:${a}`));

  const rolesForChannel = (cid) => {
    if (!cid) return [];
    return channelRoles.filter(r => r.channel_id === null || String(r.channel_id) === String(cid));
  };

  const openAdd = () => {
    const defaultCid = isChannelAdmin ? myChannelId : '';
    setForm({ username: '', password: '', channel_id: defaultCid, role_id: '', permissions_override: [], is_channel_admin: false });
    setErr(''); setModal({ type: 'add' });
  };
  const openPassword = (account) => { setForm({ password: '' }); setErr(''); setModal({ type: 'password', account }); };
  const openRole = (account) => {
    setForm({ role_id: account.role_id ? String(account.role_id) : '', permissions_override: Array.isArray(account.permissions_override) ? [...account.permissions_override] : [] });
    setErr(''); setModal({ type: 'role', account });
  };
  const openAddRole = () => {
    setRoleForm({ name: '', label: '', permissions: [] });
    setErr(''); setModal({ type: 'add-role' });
  };
  const openEditRole = (role) => {
    setRoleForm({ name: role.name, label: role.label, permissions: [...role.permissions] });
    setErr(''); setModal({ type: 'edit-role', role });
  };
  const close = () => setModal(null);

  const save = async () => {
    setSaving(true); setErr('');
    try {
      if (modal.type === 'add') {
        await axios.post('/api/admin-accounts', {
          username: form.username,
          password: form.password,
          channel_id: form.channel_id || null,
          is_channel_admin: form.is_channel_admin || false,
          role_id: form.is_channel_admin ? null : (form.role_id ? parseInt(form.role_id) : null),
          permissions_override: form.is_channel_admin ? [] : form.permissions_override,
        });
      } else if (modal.type === 'password') {
        await axios.put(`/api/admin-accounts/${modal.account.id}`, { password: form.password });
      } else if (modal.type === 'role') {
        await axios.put(`/api/admin-accounts/${modal.account.id}`, {
          role_id: form.role_id ? parseInt(form.role_id) : null,
          permissions_override: form.permissions_override,
        });
      } else if (modal.type === 'add-role') {
        await axios.post('/api/admin-channel-roles', roleForm);
        loadRoles();
      } else if (modal.type === 'edit-role') {
        await axios.put(`/api/admin-channel-roles/${modal.role.id}`, { label: roleForm.label, permissions: roleForm.permissions });
        loadRoles();
      }
      close(); onRefresh();
    } catch (e) {
      setErr(e.response?.data?.error || 'Error');
    } finally { setSaving(false); }
  };

  const del = async (account) => {
    if (!window.confirm(ta.confirmDelete)) return;
    try { await axios.delete(`/api/admin-accounts/${account.id}`); onRefresh(); }
    catch (e) { alert(e.response?.data?.error || 'Error'); }
  };

  const delRole = async (role) => {
    if (!window.confirm(`Delete role "${role.label}"?`)) return;
    try { await axios.delete(`/api/admin-channel-roles/${role.id}`); loadRoles(); onRefresh(); }
    catch (e) { alert(e.response?.data?.error || 'Error'); }
  };

  const selectedRole = modal?.type === 'role' || modal?.type === 'add'
    ? channelRoles.find(r => String(r.id) === String(form.role_id))
    : modal?.type === 'add-role' || modal?.type === 'edit-role'
      ? null
      : null;

  const overrideAvailable = actorPerms.filter(p => !selectedRole?.permissions.includes(p));

  const myChannelRoles = channelRoles.filter(r => r.channel_id !== null &&
    (!isChannelAdmin || String(r.channel_id) === myChannelId));

  return (
    <>
      {/* Sub-tab nav */}
      <div style={{ display: 'flex', gap: 2, padding: '0 16px 0', borderBottom: '1px solid var(--border)', marginBottom: 0 }}>
        {['accounts', ...(canManageRoles && isChannelAdmin ? ['roles'] : [])].map(st => (
          <button key={st} onClick={() => setSubTab(st)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: subTab === st ? 600 : 400,
            background: 'transparent', border: 'none', borderBottom: subTab === st ? '2px solid #6366f1' : '2px solid transparent',
            color: subTab === st ? '#6366f1' : 'var(--muted)', cursor: 'pointer', textTransform: 'capitalize',
          }}>{st}</button>
        ))}
      </div>

      {subTab === 'accounts' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{ta.count(accounts.length)}</span>
            {hasPermission(session, PERMS.ADMIN_ACCTS_WRITE) && (
              <button className="btn-primary" onClick={openAdd}><Plus size={14} />{ta.add}</button>
            )}
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{ta.usernameLabel}</th>
                <th>Channel</th>
                <th>Role</th>
                <th>{t.table.joined}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 && <tr><td colSpan={5} className="empty-row">No admin accounts</td></tr>}
              {accounts.map(a => {
                const roleLabel = a.role_label || a.role_name || null;
                const isChAdmin = a.is_channel_admin;
                return (
                  <tr key={a.id}>
                    <td><strong>{a.username}</strong>{isChAdmin && <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#312e81', color: '#a5b4fc' }}>Channel Admin</span>}</td>
                    <td className="muted">{a.channel_name || <span style={{ color: '#475569' }}>Superadmin</span>}</td>
                    <td>
                      {a.channel_id ? (
                        isChAdmin
                          ? <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: '#1e293b', color: '#94a3b8' }}>Full Access (hardcoded)</span>
                          : roleLabel
                            ? <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: '#1e3a5f', color: '#93c5fd' }}>{roleLabel}</span>
                            : <span className="muted" style={{ fontSize: 11 }}>no role</span>
                      ) : <span className="muted" style={{ fontSize: 11 }}>all</span>}
                    </td>
                    <td className="muted">{fmtDate(a.created_at)}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      {a.channel_id && !isChAdmin && hasPermission(session, PERMS.ADMIN_ACCTS_WRITE) && (
                        <button className="icon-btn" title="Edit role & permissions" onClick={() => openRole(a)}>
                          <Shield size={14} />
                        </button>
                      )}
                      {hasPermission(session, PERMS.ADMIN_ACCTS_WRITE) && (
                        <button className="icon-btn" title={ta.changePassword} onClick={() => openPassword(a)}>
                          <Pencil size={14} />
                        </button>
                      )}
                      {a.username !== session?.username && hasPermission(session, PERMS.ADMIN_ACCTS_WRITE) && (
                        <button className="icon-btn danger" title="Delete" onClick={() => del(a)}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'roles' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{myChannelRoles.length} custom role{myChannelRoles.length !== 1 ? 's' : ''}</span>
            <button className="btn-primary" onClick={openAddRole}><Plus size={14} />New Role</button>
          </div>
          {/* Global suggestion roles (read-only) */}
          <div style={{ padding: '8px 16px 4px', fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Global Suggestions (read-only)</div>
          <table className="data-table">
            <thead><tr><th>Name</th><th>Permissions</th><th></th></tr></thead>
            <tbody>
              {channelRoles.filter(r => r.channel_id === null).map(r => (
                <tr key={r.id}>
                  <td><strong>{r.label}</strong><span style={{ marginLeft: 6, fontSize: 11, color: '#475569' }}>{r.name}</span></td>
                  <td><div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>{r.permissions.map(p => <span key={p} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#1e293b', color: '#64748b' }}>{p}</span>)}</div></td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Channel's own roles */}
          <div style={{ padding: '8px 16px 4px', fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 8 }}>Your Channel Roles</div>
          <table className="data-table">
            <thead><tr><th>Name</th><th>Permissions</th><th></th></tr></thead>
            <tbody>
              {myChannelRoles.length === 0 && <tr><td colSpan={3} className="empty-row">No custom roles yet</td></tr>}
              {myChannelRoles.map(r => (
                <tr key={r.id}>
                  <td><strong>{r.label}</strong><span style={{ marginLeft: 6, fontSize: 11, color: '#475569' }}>{r.name}</span></td>
                  <td><div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>{r.permissions.map(p => <span key={p} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#1e3a5f', color: '#93c5fd' }}>{p}</span>)}</div></td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="icon-btn" title="Edit" onClick={() => openEditRole(r)}><Pencil size={14} /></button>
                    <button className="icon-btn danger" title="Delete" onClick={() => delRole(r)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={close}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{
                modal.type === 'add' ? ta.add :
                modal.type === 'role' ? `Role — ${modal.account.username}` :
                modal.type === 'password' ? ta.changePassword :
                modal.type === 'add-role' ? 'New Role' :
                `Edit Role — ${modal.role?.label}`
              }</span>
              <button className="icon-btn" onClick={close}><X size={16} /></button>
            </div>
            <div className="modal-body">
              {/* Add account */}
              {modal.type === 'add' && (
                <>
                  <label className="form-field">
                    <span>{ta.usernameLabel}</span>
                    <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} autoFocus />
                  </label>
                  {isChannelAdmin ? (
                    <label className="form-field">
                      <span>Channel</span>
                      <input value={(channels || []).find(c => String(c.id) === myChannelId)?.name || `Channel ${myChannelId}`} disabled />
                    </label>
                  ) : (
                    <label className="form-field">
                      <span>Channel</span>
                      <select value={form.channel_id} onChange={e => setForm(f => ({ ...f, channel_id: e.target.value, role_id: '', permissions_override: [], is_channel_admin: false }))}>
                        <option value="">Superadmin (all channels)</option>
                        {(channels || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                  )}
                  {/* Channel Admin toggle — superadmin only, only when a channel is selected */}
                  {!isChannelAdmin && form.channel_id && (
                    <label className="form-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!form.is_channel_admin}
                        onChange={e => setForm(f => ({ ...f, is_channel_admin: e.target.checked, role_id: '', permissions_override: [] }))} />
                      <span style={{ margin: 0 }}>Channel Admin <span style={{ fontSize: 11, color: '#94a3b8' }}>(full access to this channel)</span></span>
                    </label>
                  )}
                  {/* Role picker — hidden when creating a channel admin (role is auto-assigned) */}
                  {form.channel_id && !form.is_channel_admin && (
                    <label className="form-field">
                      <span>Role</span>
                      <select value={form.role_id} onChange={e => setForm(f => ({ ...f, role_id: e.target.value, permissions_override: [] }))}>
                        <option value="">— no role —</option>
                        {rolesForChannel(form.channel_id).filter(r => r.name !== 'channel_admin').map(r => <option key={r.id} value={r.id}>{r.label}{r.channel_id === null ? ' (global)' : ''}</option>)}
                      </select>
                    </label>
                  )}
                  {form.channel_id && !form.is_channel_admin && selectedRole && overrideAvailable.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>Additional permissions beyond role</summary>
                      <PermissionGroupsEditor available={overrideAvailable} value={form.permissions_override} onChange={v => setForm(f => ({ ...f, permissions_override: v }))} />
                    </details>
                  )}
                </>
              )}
              {/* Edit role assignment */}
              {modal.type === 'role' && (
                <>
                  <label className="form-field">
                    <span>Role</span>
                    <select value={form.role_id} onChange={e => setForm(f => ({ ...f, role_id: e.target.value, permissions_override: [] }))}>
                      <option value="">— no role —</option>
                      {rolesForChannel(modal.account.channel_id).filter(r => r.name !== 'channel_admin').map(r => <option key={r.id} value={r.id}>{r.label}{r.channel_id === null ? ' (global)' : ''}</option>)}
                    </select>
                  </label>
                  {selectedRole && overrideAvailable.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>Additional permissions beyond role</summary>
                      <PermissionGroupsEditor available={overrideAvailable} value={form.permissions_override} onChange={v => setForm(f => ({ ...f, permissions_override: v }))} />
                    </details>
                  )}
                </>
              )}
              {/* Change password */}
              {modal.type === 'password' && (
                <label className="form-field">
                  <span>{ta.usernameLabel}</span>
                  <input value={modal.account.username} disabled />
                </label>
              )}
              {/* Add / edit channel role */}
              {(modal.type === 'add-role' || modal.type === 'edit-role') && (
                <>
                  <label className="form-field">
                    <span>Internal name (slug)</span>
                    <input value={roleForm.name} disabled={modal.type === 'edit-role'} onChange={e => setRoleForm(f => ({ ...f, name: e.target.value.toLowerCase().replace(/\s+/g, '_') }))} placeholder="e.g. clinic_staff" autoFocus={modal.type === 'add-role'} />
                  </label>
                  <label className="form-field">
                    <span>Display label</span>
                    <input value={roleForm.label} onChange={e => setRoleForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Clinic Staff" />
                  </label>
                  <div className="form-field">
                    <span>Permissions</span>
                    <PermissionGroupsEditor available={actorPerms} value={roleForm.permissions} onChange={v => setRoleForm(f => ({ ...f, permissions: v }))} />
                  </div>
                </>
              )}
              {(modal.type === 'add' || modal.type === 'password') && (
                <label className="form-field">
                  <span>{modal.type === 'add' ? ta.passwordLabel : ta.newPassword}</span>
                  <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} autoFocus={modal.type === 'password'} />
                </label>
              )}
              {err && <p className="form-error">{err}</p>}
              <div className="modal-footer">
                <button className="btn-secondary" onClick={close}>Cancel</button>
                <button className="btn-primary" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : <><Check size={14} />Save</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { AdminAccountsTab };
