import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { TrendingUp, Coins, Check, ChevronRight, X, Package, Landmark } from 'lucide-react';
import { useLang, fmtDate, StatCard, Badge } from '../shared.jsx';

function FinanceTab() {
  const { t } = useLang();
  const f = t.finance;
  const r = t.rewards;
  const p = t.partners;

  const [subTab, setSubTab] = useState('overview');
  const [withdrawals, setWithdrawals] = useState([]);
  const [channelPayouts, setChannelPayouts] = useState([]);
  const [coachCommissions, setCoachCommissions] = useState([]);
  const [partnerPayouts, setPartnerPayouts] = useState([]);
  const [partnerTypes, setPartnerTypes] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [wdFilter, setWdFilter] = useState('pending');
  const [channelPeriod, setChannelPeriod] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [partnerPeriod, setPartnerPeriod] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [generatingChannel, setGeneratingChannel] = useState(false);
  const [generatingPartner, setGeneratingPartner] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [wdRes, cpRes, ccRes, ppRes, ptRes, oRes] = await Promise.all([
        axios.get('/api/admin/credit-withdrawals'),
        axios.get('/api/channel-payouts'),
        axios.get('/api/coach-commissions'),
        axios.get('/api/partner-payouts'),
        axios.get('/api/partner-types'),
        axios.get('/api/orders'),
      ]);
      setWithdrawals(wdRes.data.withdrawals || []);
      setChannelPayouts(cpRes.data.payouts || []);
      setCoachCommissions(ccRes.data.commissions || []);
      setPartnerPayouts(ppRes.data.payouts || []);
      setPartnerTypes(ptRes.data.types || []);
      setOrders(oRes.data.orders || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generateChannelPayouts() {
    if (!channelPeriod) return;
    setGeneratingChannel(true);
    try {
      await axios.post('/api/generate-channel-payouts', { period: channelPeriod });
      await load();
    } finally { setGeneratingChannel(false); }
  }

  async function updateChannelPayout(id, status) {
    try {
      await axios.put(`/api/channel-payouts/${id}`, { status });
      setChannelPayouts(prev => prev.map(cp => cp.id === id ? { ...cp, status } : cp));
    } catch { alert(r.saveFailed); }
  }

  async function updateWithdrawal(id, status) {
    try {
      await axios.put(`/api/admin/credit-withdrawals/${id}`, { status });
      setWithdrawals(prev => prev.map(w => w.id === id ? { ...w, status } : w));
    } catch { alert(r.saveFailed); }
  }

  async function generatePartnerPayouts() {
    if (!partnerPeriod) return;
    setGeneratingPartner(true);
    try {
      await axios.post('/api/generate-partner-payouts', { period: partnerPeriod });
      await load();
    } finally { setGeneratingPartner(false); }
  }

  async function updatePartnerPayout(id, status) {
    try {
      await axios.put(`/api/partner-payouts/${id}`, { status });
      setPartnerPayouts(prev => prev.map(py => py.id === id ? { ...py, status } : py));
    } catch { alert(p.saveFailed); }
  }

  async function markOrderPaid(id) {
    try {
      await axios.put(`/api/orders/${id}`, { payment_status: 'paid' });
      setOrders(prev => prev.map(o => o.id === id ? { ...o, payment_status: 'paid' } : o));
    } catch { alert(f.markPaidFailed); }
  }

  const tierLabel = (tier) => partnerTypes.find(pt => pt.key === tier)?.label_zh || partnerTypes.find(pt => pt.key === tier)?.label || tier;
  const tierColor = (tier) => partnerTypes.find(pt => pt.key === tier)?.color || '#64748b';
  const payoutStatusColor = (s) => ({ draft: '#64748b', approved: '#2563eb', transferred: '#16a34a' }[s] || '#64748b');
  const payoutStatusLabel = (s) => ({ draft: r.draft, approved: r.approved, transferred: r.transferred }[s] || s);
  const productLabel = (pt) => ({ chip: r.chip, dot: r.dot, subscription: r.subscription }[pt] || pt);
  const commStatusColor = (s) => ({ draft: '#64748b', approved: '#2563eb', transferred: '#16a34a', pending: '#f59e0b' }[s] || '#64748b');

  const pendingWithdrawals = withdrawals.filter(w => w.status === 'pending').length;
  const pendingChannelPayouts = channelPayouts.filter(cp => cp.status === 'draft').length;
  const pendingPartnerPayouts = partnerPayouts.filter(pp => pp.status === 'draft').length;
  const unpaidOrders = orders.filter(o => o.payment_status && o.payment_status !== 'paid').length;
  const filteredWithdrawals = wdFilter === 'all' ? withdrawals : withdrawals.filter(w => w.status === wdFilter);

  const overviewItems = [
    { label: f.pendingWithdrawals, count: pendingWithdrawals, target: 'withdrawals', color: '#ef4444', bg: 'rgba(239,68,68,0.07)', desc: f.withdrawalsDesc },
    { label: f.pendingChannelPayouts, count: pendingChannelPayouts, target: 'channel-payouts', color: '#f59e0b', bg: 'rgba(245,158,11,0.07)', desc: f.channelPayoutsDesc },
    { label: f.totalCoachCommissions, count: coachCommissions.length, target: 'coach-commissions', color: '#3b82f6', bg: 'rgba(59,130,246,0.07)', desc: f.coachCommissionsDesc },
    { label: f.pendingPartnerPayouts, count: pendingPartnerPayouts, target: 'partner-payouts', color: '#8b5cf6', bg: 'rgba(139,92,246,0.07)', desc: f.partnerPayoutsDesc },
    { label: f.unpaidOrders, count: unpaidOrders, target: 'order-payments', color: '#6366f1', bg: 'rgba(99,102,241,0.07)', desc: f.orderPaymentsDesc },
  ];

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Coins}      label={f.pendingWithdrawals}    value={pendingWithdrawals}      color="#ef4444" />
        <StatCard icon={TrendingUp} label={f.pendingChannelPayouts} value={pendingChannelPayouts}   color="#f59e0b" />
        <StatCard icon={Coins}      label={f.totalCoachCommissions} value={coachCommissions.length} color="#3b82f6" />
        <StatCard icon={TrendingUp} label={f.pendingPartnerPayouts} value={pendingPartnerPayouts}   color="#8b5cf6" />
        <StatCard icon={Package}    label={f.unpaidOrders}          value={unpaidOrders}            color="#6366f1" />
      </div>

      <div className="subtab-row">
        <button className={`subtab-btn${subTab === 'overview'          ? ' active' : ''}`} onClick={() => setSubTab('overview')}>
          <Landmark size={13} /> {f.overviewTab}
        </button>
        <button className={`subtab-btn${subTab === 'withdrawals'       ? ' active' : ''}`} onClick={() => setSubTab('withdrawals')}>
          <Coins size={13} /> {r.withdrawalsTab}
        </button>
        <button className={`subtab-btn${subTab === 'channel-payouts'   ? ' active' : ''}`} onClick={() => setSubTab('channel-payouts')}>
          <TrendingUp size={13} /> {r.channelPayoutsTab}
        </button>
        <button className={`subtab-btn${subTab === 'coach-commissions' ? ' active' : ''}`} onClick={() => setSubTab('coach-commissions')}>
          <Coins size={13} /> {r.coachCommissionsTab}
        </button>
        <button className={`subtab-btn${subTab === 'partner-payouts'   ? ' active' : ''}`} onClick={() => setSubTab('partner-payouts')}>
          <TrendingUp size={13} /> {p.payoutsTab}
        </button>
        <button className={`subtab-btn${subTab === 'order-payments'    ? ' active' : ''}`} onClick={() => setSubTab('order-payments')}>
          <Package size={13} /> {f.orderPaymentsTab}
        </button>
      </div>

      {loading && <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Loading…</div>}

      {!loading && subTab === 'overview' && (
        <div className="card" style={{ padding: '24px 28px' }}>
          <h3 style={{ margin: '0 0 20px', fontSize: 15, fontWeight: 600 }}>{f.pendingTitle}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 14 }}>
            {overviewItems.map(({ label, count, target, color, bg, desc }) => (
              <div key={target} onClick={() => setSubTab(target)}
                style={{ padding: '18px 20px', borderRadius: 12, border: `1px solid ${color}30`, background: bg, cursor: 'pointer', transition: 'transform 0.15s ease' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
              >
                <div style={{ fontSize: 34, fontWeight: 700, color, marginBottom: 4, lineHeight: 1 }}>{count}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && subTab === 'withdrawals' && (
        <div className="card">
          <div className="table-toolbar">
            <div style={{ display: 'flex', gap: 6 }}>
              {['all', 'pending', 'approved', 'rejected', 'completed'].map(filter => (
                <button key={filter} className={`subtab-btn${wdFilter === filter ? ' active' : ''}`}
                  style={{ fontSize: 11, padding: '3px 10px' }}
                  onClick={() => setWdFilter(filter)}>
                  {r[`filter${filter.charAt(0).toUpperCase() + filter.slice(1)}`]}
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
                const wdColor = { pending: '#f59e0b', approved: '#2563eb', rejected: '#ef4444', completed: '#16a34a' }[w.status] || '#64748b';
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
                    <td><Badge color={wdColor}>{r[w.status] || w.status}</Badge></td>
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

      {!loading && subTab === 'channel-payouts' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{channelPayouts.length} payout{channelPayouts.length !== 1 ? 's' : ''}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={channelPeriod} onChange={e => setChannelPeriod(e.target.value)}
                placeholder="YYYY-MM" style={{ width: 110 }} />
              <button className="btn-primary" onClick={generateChannelPayouts} disabled={generatingChannel}>
                <TrendingUp size={13} />{generatingChannel ? r.generating : r.generatePayouts}
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
              {channelPayouts.map(cp => (
                <tr key={cp.id}>
                  <td className="bold">{cp.channel_name || <span className="muted">—</span>}</td>
                  <td><code className="code-tag">{cp.period}</code></td>
                  <td className="bold">¥{Number(cp.total_cny).toFixed(2)}</td>
                  <td><Badge color={payoutStatusColor(cp.status)}>{payoutStatusLabel(cp.status)}</Badge></td>
                  <td className="muted">{fmtDate(cp.approved_at)}</td>
                  <td className="muted">{fmtDate(cp.transferred_at)}</td>
                  <td>
                    <div className="row-actions">
                      {cp.status === 'draft' &&
                        <button className="icon-btn" title={r.approve} onClick={() => updateChannelPayout(cp.id, 'approved')}>
                          <Check size={14} />
                        </button>}
                      {cp.status === 'approved' &&
                        <button className="icon-btn" title={r.markTransferred} onClick={() => updateChannelPayout(cp.id, 'transferred')}>
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
                  <td><Badge color={commStatusColor(c.status)}>{payoutStatusLabel(c.status)}</Badge></td>
                  <td className="muted">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && subTab === 'partner-payouts' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{partnerPayouts.length} payout{partnerPayouts.length !== 1 ? 's' : ''}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={partnerPeriod} onChange={e => setPartnerPeriod(e.target.value)}
                placeholder="YYYY-MM" style={{ width: 110 }} />
              <button className="btn-primary" onClick={generatePartnerPayouts} disabled={generatingPartner}>
                <TrendingUp size={13} />{generatingPartner ? p.generating : p.generatePayouts}
              </button>
            </div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{p.partnerName}</th><th>{p.tier}</th><th>{p.payoutPeriod}</th>
                <th>{p.payoutTotal}</th><th>{p.payoutStatus}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {partnerPayouts.length === 0 && <tr><td colSpan={6} className="empty-row">{p.noPayouts}</td></tr>}
              {partnerPayouts.map(py => (
                <tr key={py.id}>
                  <td className="bold">{py.partner_name || py.partner_id}</td>
                  <td><Badge color={tierColor(py.partner_tier)}>{tierLabel(py.partner_tier)}</Badge></td>
                  <td><code className="code-tag">{py.period}</code></td>
                  <td className="bold">¥{Number(py.total_cny).toFixed(2)}</td>
                  <td><Badge color={payoutStatusColor(py.status)}>{payoutStatusLabel(py.status)}</Badge></td>
                  <td>
                    <div className="row-actions">
                      {py.status === 'draft' &&
                        <button className="icon-btn" title={p.approve} onClick={() => updatePartnerPayout(py.id, 'approved')}><Check size={14} /></button>}
                      {py.status === 'approved' &&
                        <button className="icon-btn" title={p.markTransferred} onClick={() => updatePartnerPayout(py.id, 'transferred')}><ChevronRight size={14} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && subTab === 'order-payments' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{unpaidOrders} {f.unpaidOrders.toLowerCase()}</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{f.orderId}</th>
                <th>{f.user}</th>
                <th>{f.item}</th>
                <th>{f.amount}</th>
                <th>{f.paymentMethod}</th>
                <th>{f.paymentStatus}</th>
                <th>{f.orderedAt}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {unpaidOrders === 0 && <tr><td colSpan={8} className="empty-row">{f.noUnpaidOrders}</td></tr>}
              {orders.filter(o => o.payment_status && o.payment_status !== 'paid').map(o => (
                <tr key={o.id}>
                  <td><span className="mono muted">{o.id.slice(0, 8)}…</span></td>
                  <td>{o.nickname || o.user_id}</td>
                  <td className="bold">{o.name_zh || o.name_en}</td>
                  <td className="bold">¥{o.price_cny}</td>
                  <td className="muted">{o.payment_method || 'WeChat Pay'}</td>
                  <td><Badge color="#f59e0b">{o.payment_status}</Badge></td>
                  <td className="muted">{fmtDate(o.created_at)}</td>
                  <td>
                    <button className="icon-btn" title={f.markPaid} onClick={() => markOrderPaid(o.id)}>
                      <Check size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export { FinanceTab };
