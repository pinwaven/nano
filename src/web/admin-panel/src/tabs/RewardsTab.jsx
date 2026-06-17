import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { TrendingUp, Coins, Settings2, Check, ChevronRight, X } from 'lucide-react';
import { useLang, fmtDate, StatCard, Badge } from '../shared.jsx';

function RewardsTab() {
  const { t } = useLang();
  const r = t.rewards;
  const [subTab, setSubTab] = useState('settings');
  const [settings, setSettings] = useState([]);
  const [channelPayouts, setChannelPayouts] = useState([]);
  const [coachCommissions, setCoachCommissions] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [wdFilter, setWdFilter] = useState('pending');
  const [loading, setLoading] = useState(false);
  const [generatePeriod, setGeneratePeriod] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, cpRes, ccRes, wdRes] = await Promise.all([
        axios.get('/api/commission-settings'),
        axios.get('/api/channel-payouts'),
        axios.get('/api/coach-commissions'),
        axios.get('/api/admin/credit-withdrawals'),
      ]);
      setSettings(sRes.data.settings || []);
      setChannelPayouts(cpRes.data.payouts || []);
      setCoachCommissions(ccRes.data.commissions || []);
      setWithdrawals(wdRes.data.withdrawals || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveSetting(id, field, value) {
    const row = settings.find(s => s.id === id);
    if (!row) return;
    const patch = { flat_rate_cny: row.flat_rate_cny, percentage: row.percentage, [field]: value === '' ? null : Number(value) };
    try {
      await axios.put(`/api/commission-settings/${id}`, patch);
      setSettings(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    } catch {
      alert(r.saveFailed);
    }
  }

  async function generateChannelPayouts() {
    if (!generatePeriod) return;
    setGenerating(true);
    try {
      await axios.post('/api/generate-channel-payouts', { period: generatePeriod });
      await load();
    } finally {
      setGenerating(false);
    }
  }

  async function updateChannelPayout(id, status) {
    try {
      await axios.put(`/api/channel-payouts/${id}`, { status });
      setChannelPayouts(prev => prev.map(p => p.id === id ? { ...p, status } : p));
    } catch {
      alert(r.saveFailed);
    }
  }

  async function updateWithdrawal(id, status) {
    try {
      await axios.put(`/api/admin/credit-withdrawals/${id}`, { status });
      setWithdrawals(prev => prev.map(w => w.id === id ? { ...w, status } : w));
    } catch {
      alert(r.saveFailed);
    }
  }

  const productLabel = (pt) => ({ chip: r.chip, dot: r.dot, subscription: r.subscription }[pt] || pt);
  const statusLabel  = (s)  => ({ draft: r.draft, approved: r.approved, transferred: r.transferred }[s] || s);
  const statusBadgeColor = (s) => ({ draft: '#64748b', approved: '#2563eb', transferred: '#16a34a' }[s] || '#64748b');

  const pendingPayouts = channelPayouts.filter(p => p.status === 'draft').length;
  const totalCommissionsAmount = coachCommissions.reduce((sum, c) => sum + Number(c.amount_cny || 0), 0);
  const pendingWithdrawals = withdrawals.filter(w => w.status === 'pending').length;
  const filteredWithdrawals = wdFilter === 'all' ? withdrawals : withdrawals.filter(w => w.status === wdFilter);

  return (
    <>
      <div className="stat-row">
        <StatCard icon={TrendingUp} label={r.totalPayouts}       value={channelPayouts.length}           color="#6366f1" />
        <StatCard icon={TrendingUp} label={r.pendingPayouts}     value={pendingPayouts}                  color="#f59e0b" />
        <StatCard icon={Coins}      label={r.totalCommissions}   value={coachCommissions.length}         color="#3b82f6" />
        <StatCard icon={Coins}      label={r.totalWithdrawals}   value={withdrawals.length}              color="#8b5cf6" />
        <StatCard icon={Coins}      label={r.pendingWithdrawals} value={pendingWithdrawals}              color="#ef4444" />
      </div>

      <div className="subtab-row">
        <button className={`subtab-btn${subTab === 'settings' ? ' active' : ''}`} onClick={() => setSubTab('settings')}>
          <Settings2 size={13} /> {r.settingsTab}
        </button>
        <button className={`subtab-btn${subTab === 'channel-payouts' ? ' active' : ''}`} onClick={() => setSubTab('channel-payouts')}>
          <TrendingUp size={13} /> {r.channelPayoutsTab}
        </button>
        <button className={`subtab-btn${subTab === 'coach-commissions' ? ' active' : ''}`} onClick={() => setSubTab('coach-commissions')}>
          <Coins size={13} /> {r.coachCommissionsTab}
        </button>
        <button className={`subtab-btn${subTab === 'withdrawals' ? ' active' : ''}`} onClick={() => setSubTab('withdrawals')}>
          <Coins size={13} /> {r.withdrawalsTab}
        </button>
      </div>

      {loading && <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Loading…</div>}

      {!loading && subTab === 'settings' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{settings.length} rule{settings.length !== 1 ? 's' : ''}</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{r.role}</th><th>{r.productType}</th>
                <th>{r.flatRate}</th><th>{r.pct}</th>
              </tr>
            </thead>
            <tbody>
              {settings.length === 0 && <tr><td colSpan={4} className="empty-row">{r.noSettings}</td></tr>}
              {settings.map(row => (
                <tr key={row.id}>
                  <td><Badge color={row.role === 'coach' ? '#8b5cf6' : '#6366f1'}>{row.role === 'coach' ? r.coach : r.channel}</Badge></td>
                  <td><Badge color="#64748b">{productLabel(row.product_type)}</Badge></td>
                  <td>
                    {row.flat_rate_cny != null
                      ? <input type="number" step="0.01" defaultValue={row.flat_rate_cny}
                          onBlur={e => saveSetting(row.id, 'flat_rate_cny', e.target.value)}
                          style={{ width: 90 }} />
                      : <span className="muted">—</span>}
                  </td>
                  <td>
                    {row.percentage != null
                      ? <input type="number" step="0.1" defaultValue={row.percentage}
                          onBlur={e => saveSetting(row.id, 'percentage', e.target.value)}
                          style={{ width: 90 }} />
                      : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && subTab === 'channel-payouts' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{channelPayouts.length} payout{channelPayouts.length !== 1 ? 's' : ''}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={generatePeriod} onChange={e => setGeneratePeriod(e.target.value)}
                placeholder="YYYY-MM" style={{ width: 110 }} />
              <button className="btn-primary" onClick={generateChannelPayouts} disabled={generating}>
                <TrendingUp size={13} />{generating ? r.generating : r.generatePayouts}
              </button>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{r.channelName}</th><th>{r.period}</th><th>{r.totalCny}</th>
                <th>{r.status}</th><th>{r.approvedAt}</th><th>{r.transferredAt}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {channelPayouts.length === 0 && <tr><td colSpan={7} className="empty-row">{r.noPayouts}</td></tr>}
              {channelPayouts.map(p => (
                <tr key={p.id}>
                  <td className="bold">{p.channel_name || <span className="muted">—</span>}</td>
                  <td><code className="code-tag">{p.period}</code></td>
                  <td className="bold">¥{Number(p.total_cny).toFixed(2)}</td>
                  <td><Badge color={statusBadgeColor(p.status)}>{statusLabel(p.status)}</Badge></td>
                  <td className="muted">{fmtDate(p.approved_at)}</td>
                  <td className="muted">{fmtDate(p.transferred_at)}</td>
                  <td>
                    <div className="row-actions">
                      {p.status === 'draft' &&
                        <button className="icon-btn" title={r.approve} onClick={() => updateChannelPayout(p.id, 'approved')}>
                          <Check size={14} />
                        </button>}
                      {p.status === 'approved' &&
                        <button className="icon-btn" title={r.markTransferred} onClick={() => updateChannelPayout(p.id, 'transferred')}>
                          <ChevronRight size={14} />
                        </button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && subTab === 'coach-commissions' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{coachCommissions.length} commission{coachCommissions.length !== 1 ? 's' : ''}</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{r.coachName}</th><th>{r.channelCol}</th><th>{r.productTypeCol}</th>
                <th>{r.amountCny}</th><th>{r.status}</th><th>{r.createdAt}</th>
              </tr>
            </thead>
            <tbody>
              {coachCommissions.length === 0 && <tr><td colSpan={6} className="empty-row">{r.noCommissions}</td></tr>}
              {coachCommissions.map(c => (
                <tr key={c.id}>
                  <td className="bold">{c.coach_name || c.coach_id}</td>
                  <td>{c.channel_name || <span className="muted">—</span>}</td>
                  <td><Badge color="#64748b">{productLabel(c.product_type)}</Badge></td>
                  <td className="bold">¥{Number(c.amount_cny).toFixed(2)}</td>
                  <td><Badge color={statusBadgeColor(c.status)}>{statusLabel(c.status)}</Badge></td>
                  <td className="muted">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && subTab === 'withdrawals' && (
        <div className="card">
          <div className="table-toolbar">
            <div style={{ display: 'flex', gap: 6 }}>
              {['all', 'pending', 'approved', 'rejected', 'completed'].map(f => (
                <button key={f} className={`subtab-btn${wdFilter === f ? ' active' : ''}`}
                  style={{ fontSize: 11, padding: '3px 10px' }}
                  onClick={() => setWdFilter(f)}>
                  {r[`filter${f.charAt(0).toUpperCase() + f.slice(1)}`]}
                </button>
              ))}
            </div>
            <span className="table-count">{filteredWithdrawals.length}</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{r.withdrawalUser}</th>
                <th>{r.withdrawalCredits}</th>
                <th>{r.withdrawalCash}</th>
                <th>{r.withdrawalMethod}</th>
                <th>{r.withdrawalAccount}</th>
                <th>{r.withdrawalStatus}</th>
                <th>{r.withdrawalDate}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredWithdrawals.length === 0 && (
                <tr><td colSpan={8} className="empty-row">{r.noWithdrawals}</td></tr>
              )}
              {filteredWithdrawals.map(w => {
                const wdStatusColor = { pending: '#f59e0b', approved: '#2563eb', rejected: '#ef4444', completed: '#16a34a' }[w.status] || '#64748b';
                return (
                  <tr key={w.id}>
                    <td>
                      <div className="bold" style={{ fontSize: 12 }}>{w.nickname || w.user_id}</div>
                      <div className="muted" style={{ fontSize: 10, fontFamily: 'monospace' }}>{w.user_id}</div>
                    </td>
                    <td className="bold">{Number(w.credits_amount).toFixed(2)} pts</td>
                    <td className="bold">{Number(w.currency_amount).toFixed(2)} {w.currency}</td>
                    <td className="muted">{w.payment_method}</td>
                    <td className="muted" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {w.payment_account || '—'}
                    </td>
                    <td><Badge color={wdStatusColor}>{r[w.status] || w.status}</Badge></td>
                    <td className="muted">{fmtDate(w.requested_at)}</td>
                    <td>
                      {w.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="icon-btn" title={r.approve} onClick={() => updateWithdrawal(w.id, 'approved')}>
                            <Check size={13} />
                          </button>
                          <button className="icon-btn danger" title={r.reject} onClick={() => updateWithdrawal(w.id, 'rejected')}>
                            <X size={13} />
                          </button>
                        </div>
                      )}
                      {w.status === 'approved' && (
                        <button className="icon-btn" title={r.markCompleted} onClick={() => updateWithdrawal(w.id, 'completed')}>
                          <ChevronRight size={13} />
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
    </>
  );
}

export { RewardsTab };
