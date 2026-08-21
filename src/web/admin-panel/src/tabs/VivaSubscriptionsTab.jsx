import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Ban, KeyRound, CheckCircle2, Clock } from 'lucide-react';
import { useLang, fmtDate, StatCard, Badge } from '../shared.jsx';

const STATUS_COLOR = { unredeemed: '#3b82f6', redeemed: '#10b981', revoked: '#94a3b8' };

function maskCode(code) {
  if (!code || code.length <= 8) return code;
  return `${code.slice(0, 4)}…${code.slice(-4)}`;
}

// Lists viva_subscription_codes (generated via POST /viva-subscription-checkout-confirmed,
// called by GCN's aeviva store after payment) and allows revoking an unredeemed code — a soft
// action (status -> 'revoked'), mirroring invitations.is_active rather than a hard delete.
// Known limitation: revoking only blocks future redemption; it does not claw back an
// already-granted users.viva_subscription_expires_at (see CLAUDE.md plan doc).
function VivaSubscriptionsTab() {
  const { t } = useLang();
  const tv = t.vivaSubscriptions || {};

  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchCodes = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter !== 'all' ? { status: statusFilter } : {};
      const res = await axios.get('/api/viva-subscription-codes', { params });
      setCodes(res.data?.codes || []);
    } catch { /* silently fail */ }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { fetchCodes(); }, [fetchCodes]);

  const handleRevoke = async (id, code) => {
    if (!window.confirm(tv.confirmRevoke || `Revoke code "${maskCode(code)}"? It can no longer be redeemed.`)) return;
    try {
      const res = await axios.put(`/api/viva-subscription-codes/${id}`, { status: 'revoked' });
      if (res.data?.success === false) { alert(res.data.error || (tv.revokeFailed || 'Revoke failed')); return; }
      fetchCodes();
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };

  const unredeemedCount = codes.filter(c => c.status === 'unredeemed').length;
  const redeemedCount   = codes.filter(c => c.status === 'redeemed').length;
  const revokedCount    = codes.filter(c => c.status === 'revoked').length;

  return (
    <>
      <div className="stat-row">
        <StatCard icon={KeyRound}     label={tv.totalCodes      || 'Total Codes'}     value={codes.length}     color="#3b82f6" />
        <StatCard icon={Clock}        label={tv.unredeemedCount || 'Unredeemed'}      value={unredeemedCount} color="#3b82f6" />
        <StatCard icon={CheckCircle2} label={tv.redeemedCount   || 'Redeemed'}        value={redeemedCount}   color="#10b981" />
        <StatCard icon={Ban}          label={tv.revokedCount    || 'Revoked'}         value={revokedCount}    color="#94a3b8" />
      </div>

      <div className="card">
        <div className="table-toolbar">
          <span className="table-count">{codes.length} {tv.codes || 'codes'}</span>
          <div className="select-wrap">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="inline-select">
              <option value="all">{tv.allStatuses || 'All statuses'}</option>
              <option value="unredeemed">{tv.statusUnredeemed || 'Unredeemed'}</option>
              <option value="redeemed">{tv.statusRedeemed || 'Redeemed'}</option>
              <option value="revoked">{tv.statusRevoked || 'Revoked'}</option>
            </select>
          </div>
        </div>
        <table className="data-table">
          <thead><tr>
            <th>{tv.code || 'Code'}</th>
            <th>{tv.plan || 'Plan'}</th>
            <th>{tv.status || 'Status'}</th>
            <th>{tv.orderRef || 'Order Ref'}</th>
            <th>{tv.redeemedBy || 'Redeemed By'}</th>
            <th>{tv.redeemedAt || 'Redeemed At'}</th>
            <th>{tv.createdAt || 'Created At'}</th>
            <th></th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="empty-row">{t.topbar.loading}</td></tr>}
            {!loading && codes.length === 0 && (
              <tr><td colSpan={8} className="empty-row">{tv.noCodes || 'No subscription codes yet'}</td></tr>
            )}
            {codes.map(c => (
              <tr key={c.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{maskCode(c.code)}</td>
                <td className="muted">{c.plan_key} · {c.duration_days}d</td>
                <td><Badge color={STATUS_COLOR[c.status] || '#64748b'}>{c.status}</Badge></td>
                <td className="muted" style={{ fontFamily: 'monospace', fontSize: 11 }}>{c.order_ref}</td>
                <td className="muted">{c.redeemed_by_nickname || c.redeemed_by_user_id || '—'}</td>
                <td className="muted" style={{ fontSize: 11 }}>{fmtDate(c.redeemed_at)}</td>
                <td className="muted" style={{ fontSize: 11 }}>{fmtDate(c.created_at)}</td>
                <td>
                  {c.status === 'unredeemed' && (
                    <button className="icon-btn danger" title={tv.revoke || 'Revoke'} onClick={() => handleRevoke(c.id, c.code)}>
                      <Ban size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export { VivaSubscriptionsTab };
