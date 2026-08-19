import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Sparkles, CheckCircle2, Clock } from 'lucide-react';
import { useLang, fmtDate, StatCard, Badge } from '../shared.jsx';
import { VivaSubscriptionsTab } from './VivaSubscriptionsTab.jsx';
import { PersonaSubscriptionModal } from './UsersTab.jsx';

const PERSONA_LABELS = { nano: 'Nano', viva: 'Viva' };

// Superadmin-only, cross-channel view of every user with an active-or-past persona
// override (see migration_users_persona_override.sql). Complements VivaSubscriptionsTab
// (the GCN code-redemption audit trail, unchanged) with the newer direct-grant mechanism —
// editing a row opens the same PersonaSubscriptionModal channel admins use in the Users tab.
function PersonaSubscriptionsTab() {
  const { t, lang } = useLang();
  const isZh = lang === 'zh';
  const ps = t.personaSubscription;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');
  const [personaFilter, setPersonaFilter] = useState('all');
  const [modalUser, setModalUser] = useState(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      if (personaFilter !== 'all') params.persona_type = personaFilter;
      const res = await axios.get('/api/admin/persona-subscriptions', { params });
      setRows(res.data?.subscriptions || []);
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, [statusFilter, personaFilter]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const activeCount = rows.filter(r => r.persona_override_expires_at && new Date(r.persona_override_expires_at) > new Date()).length;
  const vivaCount = rows.filter(r => r.persona_override_type === 'viva').length;
  const nanoCount = rows.filter(r => r.persona_override_type === 'nano').length;

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Sparkles}     label={isZh ? '订阅总数' : 'Total Overrides'} value={rows.length}   color="#8b5cf6" />
        <StatCard icon={CheckCircle2} label={isZh ? '生效中' : 'Active'}            value={activeCount}   color="#10b981" />
        <StatCard icon={Clock}        label="Viva"                                  value={vivaCount}     color="#8b5cf6" />
        <StatCard icon={Clock}        label="Nano"                                  value={nanoCount}     color="#6366f1" />
      </div>

      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{rows.length} {isZh ? '条记录' : 'rows'}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="select-wrap">
              <select value={personaFilter} onChange={e => setPersonaFilter(e.target.value)} className="inline-select">
                <option value="all">{isZh ? '全部角色' : 'All personas'}</option>
                <option value="nano">Nano</option>
                <option value="viva">Viva</option>
              </select>
            </div>
            <div className="select-wrap">
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="inline-select">
                <option value="all">{isZh ? '全部状态' : 'All statuses'}</option>
                <option value="active">{isZh ? '生效中' : 'Active'}</option>
                <option value="expired">{isZh ? '已过期' : 'Expired'}</option>
              </select>
            </div>
          </div>
        </div>
        <table className="data-table">
          <thead><tr>
            <th>{isZh ? '用户' : 'User'}</th>
            <th>{isZh ? '渠道' : 'Channel'}</th>
            <th>{ps.channelDefault}</th>
            <th>{isZh ? '订阅角色' : 'Override'}</th>
            <th>{ps.expires}</th>
            <th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="empty-row">{t.topbar.loading}</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="empty-row">{isZh ? '暂无订阅记录' : 'No overrides yet'}</td></tr>
            )}
            {rows.map(r => {
              const active = r.persona_override_expires_at && new Date(r.persona_override_expires_at) > new Date();
              return (
                <tr key={r.user_id} style={{ cursor: 'pointer' }} onClick={() => setModalUser(r)}>
                  <td>{r.nickname || r.user_id}</td>
                  <td className="muted">{r.channel_name || r.channel_id || '—'}</td>
                  <td><Badge color="#64748b">{PERSONA_LABELS[r.channel_persona_type] || r.channel_persona_type}</Badge></td>
                  <td><Badge color={active ? '#10b981' : '#94a3b8'}>{PERSONA_LABELS[r.persona_override_type] || r.persona_override_type}</Badge></td>
                  <td className="muted" style={{ fontSize: 11 }}>{fmtDate(r.persona_override_expires_at)}</td>
                  <td className="muted" style={{ fontSize: 11 }}>{active ? (isZh ? '生效中' : 'active') : (isZh ? '已过期' : 'expired')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>
          {isZh ? 'Viva 激活码' : 'Viva Codes'}
        </div>
        <VivaSubscriptionsTab />
      </div>

      {modalUser && (
        <PersonaSubscriptionModal
          user={{ user_id: modalUser.user_id, nickname: modalUser.nickname }}
          onClose={() => { setModalUser(null); fetchRows(); }}
        />
      )}
    </>
  );
}

export { PersonaSubscriptionsTab };
