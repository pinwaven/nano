import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Users, UserCog, Activity, TrendingUp, Coins,
  ShoppingBag, Bug, Cpu, Layers, FlaskConical,
  ChevronRight, Check,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useLang, fmtDate, Badge } from '../shared.jsx';

// ── Helper ────────────────────────────────────────────────────────────────────

function fillDailySeries(rows, days = 30, valueKey = 'count') {
  const map = {};
  (rows || []).forEach(r => { map[r.day] = parseFloat(r[valueKey]) || 0; });
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ key, label: `${d.getMonth() + 1}/${d.getDate()}`, value: map[key] || 0 });
  }
  return out;
}

function CrmAvatar({ name, url, size = 28 }) {
  if (url) return <img src={url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.42), fontWeight: 700, color: '#fff', background: `hsl(${h},55%,55%)`,
    }}>
      {(name || '?').trim().charAt(0).toUpperCase()}
    </div>
  );
}

function DashSparkline({ data, color }) {
  const gid = `dash-spark-${String(color).replace('#', '')}`;
  return (
    <div style={{ width: '100%', height: 34 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.6}
            fill={`url(#${gid})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, subHighlight, color, spark }) {
  return (
    <div className="kpi-card">
      <div className="kpi-card-top">
        <div className="stat-icon" style={{ background: color + '1a', color }}><Icon size={18} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="kpi-value">{value}</div>
          <div className="kpi-label">{label}</div>
        </div>
        {sub != null && (
          <span className="kpi-sub" style={subHighlight ? { background: color + '15', color, borderColor: color + '30', fontWeight: 600 } : undefined}>
            {sub}
          </span>
        )}
      </div>
      {spark ? <DashSparkline data={spark} color={color} /> : <div style={{ height: 34 }} />}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

function DashboardTab({ users, coaches, devices, batches, orders, tickets, session, isSuperadmin, onNavigate }) {
  const { t, lang } = useLang();
  const td = t.dash;
  const [stats, setStats] = useState(null);
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const isChannel = session?.role === 'channel';
    const cid = session?.channelId;
    const statsUrl = isChannel
      ? `/api/channel-users/${cid}?include_subchannels=true`
      : '/api/users?limit=1&offset=0';
    Promise.allSettled([
      axios.get(statsUrl),
      axios.get('/api/admin/dashboard-stats'),
    ]).then(([sRes, dRes]) => {
      if (sRes.status === 'fulfilled' && sRes.value.data.success) setStats(sRes.value.data);
      if (dRes.status === 'fulfilled' && dRes.value.data.success) setDash(dRes.value.data);
    }).finally(() => setLoading(false));
  }, [session]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '80px 0' }}>
      <span style={{ width: 16, height: 16, border: '2px solid var(--border)', borderTopColor: 'var(--primary)', borderRadius: '50%', display: 'inline-block', animation: 'spin 1s linear infinite' }} />
      <span style={{ color: 'var(--muted)' }}>{t.topbar.loading}</span>
    </div>
  );

  const total        = stats?.total       || 0;
  const tested       = stats?.tested      || 0;
  const avgBioAge    = stats?.avgBioAge   || null;
  const bioAgeDelta  = stats?.bioAgeDelta ?? null;
  const maleCount    = stats?.maleCount   || 0;
  const femaleCount  = stats?.femaleCount || 0;
  const coachTotal   = stats?.coachTotal  || (coaches?.length || 0);
  const newCoaches7d = stats?.newCoaches7d || 0;
  const scansTotal   = stats?.scansTotal  || 0;
  const scans7d      = stats?.scans7d     || 0;
  const newUsers7d   = stats?.newUsers7d  || 0;

  const activeDevices  = (devices || []).filter(d => d.status === 'active').length;
  const totalDevices   = (devices || []).length;
  const availableChips = (batches || []).reduce((s, b) => s + parseInt(b.available || 0), 0);
  const totalChips     = (batches || []).reduce((s, b) => s + parseInt(b.quantity  || 0), 0);
  const usedChips      = Math.max(0, totalChips - availableChips);
  const chipsLow       = totalChips > 0 && availableChips / totalChips < 0.15;

  // Daily series (dense, last 30 days)
  const signupSeries = fillDailySeries(dash?.daily?.signups, 30);
  const scanSeries   = fillDailySeries(dash?.daily?.scans, 30);
  const revSeries    = fillDailySeries(dash?.daily?.orders, 30, 'revenue_cny');
  const trendData    = signupSeries.map((p, i) => ({ label: p.label, signups: p.value, scans: scanSeries[i]?.value || 0 }));
  const hasTrend     = trendData.some(p => p.signups > 0 || p.scans > 0);

  // Revenue
  const rev30d    = parseFloat(dash?.revenue?.revenue_30d) || 0;
  const revTotal  = parseFloat(dash?.revenue?.revenue_total) || 0;
  const fmtCny    = (v) => `¥${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  // Orders
  const ORDER_STATUS_COLORS = {
    pending: '#f59e0b', paid: '#3b82f6', fulfilled: '#10b981', shipped: '#0ea5e9',
    delivered: '#10b981', cancelled: '#94a3b8', refunded: '#ef4444',
  };
  const statusCounts = {};
  (orders || []).forEach(o => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });
  const orderStatusData = Object.entries(statusCounts).map(([name, value]) => ({
    name, value, fill: ORDER_STATUS_COLORS[name] || '#64748b',
  }));
  const pendingOrders = statusCounts.pending ?? (parseInt(dash?.revenue?.orders_pending) || 0);

  // Needs attention
  const openTickets = tickets
    ? tickets.filter(tk => tk.status === 'open' || tk.status === 'in_progress').length
    : (dash?.attention?.open_tickets || 0);
  const canGo = (tabId) => isSuperadmin || (session?.allowedTabs || []).includes(tabId);
  const attentionItems = [
    { id: 'orders',   icon: ShoppingBag,  label: td.pendingOrders,   count: pendingOrders,                color: '#f59e0b', tab: 'store' },
    { id: 'tickets',  icon: Bug,          label: td.openTickets,     count: openTickets,                  color: '#ef4444', tab: 'tickets' },
    ...(isSuperadmin ? [
      { id: 'devices', icon: Cpu,         label: td.inactiveDevices, count: totalDevices - activeDevices, color: '#8b5cf6', tab: 'kino' },
      ...(chipsLow ? [{ id: 'chips', icon: Layers, label: td.lowChips, count: availableChips, color: '#0ea5e9', tab: 'chips' }] : []),
    ] : []),
    { id: 'untested', icon: FlaskConical, label: td.untestedUsers,   count: Math.max(0, total - tested),  color: '#64748b', tab: 'users' },
  ].filter(a => a.count > 0);

  // Bio-age delta histogram
  const DELTA_BUCKETS = [
    { key: 'lt_m5', label: '≤-5',  fill: '#059669' },
    { key: 'm5_m2', label: '-5~-2', fill: '#10b981' },
    { key: 'm2_0',  label: '-2~0',  fill: '#6ee7b7' },
    { key: '0_2',   label: '0~2',   fill: '#fbbf24' },
    { key: '2_5',   label: '2~5',   fill: '#f97316' },
    { key: 'gt_5',  label: '>5',    fill: '#ef4444' },
  ];
  const histData = DELTA_BUCKETS.map(b => ({
    ...b,
    count: parseInt((dash?.delta_histogram || []).find(r => r.bucket === b.key)?.count) || 0,
  }));
  const hasHist = histData.some(b => b.count > 0);

  // Four-dimension averages
  const sa = dash?.sub_age_avgs || {};
  const avgChrono = sa.chrono != null ? parseFloat(sa.chrono) : null;
  const dims = [
    { key: 'cellular',      label: td.dimCellular,      color: '#8b5cf6' },
    { key: 'metabolic',     label: td.dimMetabolic,     color: '#f59e0b' },
    { key: 'microvascular', label: td.dimMicroVascular, color: '#0ea5e9' },
    { key: 'resilience',    label: td.dimResilience,    color: '#10b981' },
  ].map(d => ({ ...d, value: sa[d.key] != null ? parseFloat(sa[d.key]) : null }))
   .filter(d => d.value != null && !isNaN(d.value));
  const maxDim = Math.max(...dims.map(d => d.value), avgChrono || 0, 1);

  // Channel ranking (superadmin)
  const channelTop = dash?.channel_top || [];
  const maxChannelUsers = Math.max(...channelTop.map(c => c.user_count), 1);

  // Recent rows
  const recentUsers = (dash?.recent_users && dash.recent_users.length)
    ? dash.recent_users
    : (stats?.users || users || []).slice(0, 6);
  const recentOrders = [...(orders || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);
  const orderStatusColor = (s) => ORDER_STATUS_COLORS[s] || '#64748b';

  const deltaStr = bioAgeDelta != null
    ? `${bioAgeDelta > 0 ? '+' : ''}${Number(bioAgeDelta).toFixed(1)}y`
    : null;

  return (
    <>
      {/* Row 1: KPI cards with sparklines */}
      <div className="dashboard-kpi-grid-5">
        <KpiCard icon={Users} label={t.stats.totalUsers} value={total} color="#3b82f6"
          sub={`${t.stats.new7d} +${newUsers7d}`} subHighlight={newUsers7d > 0} spark={signupSeries} />
        <KpiCard icon={TrendingUp} label={t.stats.totalTests} value={scansTotal} color="#10b981"
          sub={`${t.stats.days7} +${scans7d}`} subHighlight={scans7d > 0} spark={scanSeries} />
        <KpiCard icon={Coins} label={td.revenue30d} value={fmtCny(rev30d)} color="#f59e0b"
          sub={`${td.revenueTotal} ${fmtCny(revTotal)}`} subHighlight={rev30d > 0} spark={revSeries} />
        <KpiCard icon={UserCog} label={t.stats.totalCoaches} value={coachTotal} color="#8b5cf6"
          sub={`${t.stats.new7d} +${newCoaches7d}`} subHighlight={newCoaches7d > 0} />
        <KpiCard icon={Activity} label={t.stats.avgBioAge}
          value={avgBioAge != null ? Number(avgBioAge).toFixed(1) : '—'} color="#ec4899"
          sub={deltaStr ? `${bioAgeDelta > 0 ? t.stats.aboveChrono : t.stats.belowChrono} ${deltaStr}` : null}
          subHighlight={!!deltaStr} />
      </div>

      {/* Row 2: 30-day trend + needs attention */}
      <div className="dashboard-main-row">
        <div className="card dashboard-chart-card">
          <div className="dashboard-card-title">{td.trendTitle}</div>
          {hasTrend ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trendData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <defs>
                  <linearGradient id="dashGradSignups" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="dashGradScans" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} interval={4} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} width={30} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="signups" name={td.signups} stroke="#3b82f6" strokeWidth={2}
                  fill="url(#dashGradSignups)" dot={false} />
                <Area type="monotone" dataKey="scans" name={td.scans} stroke="#10b981" strokeWidth={2}
                  fill="url(#dashGradScans)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <div className="dashboard-empty-chart" style={{ height: 240 }}>{td.noData}</div>}
        </div>

        <div className="card dashboard-chart-card">
          <div className="dashboard-card-title">{td.needsAttention}</div>
          {attentionItems.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '24px 4px', color: '#10b981' }}>
              <div className="attention-icon" style={{ background: '#10b9811c', color: '#10b981' }}><Check size={15} /></div>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{td.allClear}</span>
            </div>
          ) : attentionItems.map(a => {
            const Icon = a.icon;
            const clickable = onNavigate && canGo(a.tab);
            return (
              <div key={a.id} className="attention-row" style={clickable ? undefined : { cursor: 'default' }}
                onClick={() => clickable && onNavigate(a.tab)}>
                <div className="attention-icon" style={{ background: a.color + '1c', color: a.color }}>
                  <Icon size={15} />
                </div>
                <span style={{ fontSize: 13 }}>{a.label}</span>
                <span className="attention-count" style={{ color: a.color }}>{a.count.toLocaleString()}</span>
                {clickable && <ChevronRight size={14} style={{ color: '#cbd5e1', flexShrink: 0 }} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Row 3: bio-age distribution + four dimensions + orders/revenue */}
      <div className="dashboard-triple-row">
        <div className="card dashboard-chart-card">
          <div className="dashboard-card-title">
            {td.deltaDist} <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· {td.deltaDistHint}</span>
          </div>
          {hasHist ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={histData} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} width={26} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {histData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="dashboard-empty-chart">{td.noData}</div>}
          <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 11, color: '#64748b', flexWrap: 'wrap' }}>
            <span>{t.stats.male} <b>{maleCount}</b></span>
            <span>{t.stats.female} <b>{femaleCount}</b></span>
            <span>{t.stats.tested} <b>{total ? Math.round((tested / total) * 100) : 0}%</b></span>
          </div>
        </div>

        <div className="card dashboard-chart-card">
          <div className="dashboard-card-title">{td.subAgeTitle}</div>
          {dims.length === 0 ? (
            <div className="dashboard-empty-chart">{td.noData}</div>
          ) : (
            <div style={{ paddingTop: 6 }}>
              {dims.map(d => {
                const dDelta = avgChrono != null ? d.value - avgChrono : null;
                return (
                  <div key={d.key} className="dim-row">
                    <span className="dim-label">{d.label}</span>
                    <div className="dim-bar-track">
                      <div className="dim-bar-fill" style={{ width: `${Math.round((d.value / maxDim) * 100)}%`, background: d.color }} />
                    </div>
                    <span className="dim-value" style={{ color: d.color }}>
                      {d.value.toFixed(1)}
                      {dDelta != null && (
                        <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 4, color: dDelta <= 0 ? '#10b981' : '#ef4444' }}>
                          {dDelta > 0 ? '+' : ''}{dDelta.toFixed(1)}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
              {avgChrono != null && (
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                  {td.avgChrono}: <b>{avgChrono.toFixed(1)}</b>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card dashboard-chart-card">
          <div className="dashboard-card-title">{td.ordersTitle}</div>
          {orderStatusData.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <ResponsiveContainer width="55%" height={150}>
                <PieChart>
                  <Pie data={orderStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={56} innerRadius={32}>
                    {orderStatusData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {orderStatusData.map(s => (
                  <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.fill, flexShrink: 0 }} />
                    <span style={{ color: '#64748b', flex: 1 }}>{s.name}</span>
                    <b>{s.value}</b>
                  </div>
                ))}
              </div>
            </div>
          ) : <div className="dashboard-empty-chart" style={{ height: 150 }}>{td.noData}</div>}
          <div style={{ display: 'flex', gap: 16, marginTop: 10, paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{fmtCny(rev30d)}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{td.revenue30d}</div>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{fmtCny(revTotal)}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{td.revenueTotal}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 4: channel ranking + hardware (superadmin only) */}
      {isSuperadmin && (channelTop.length > 0 || totalDevices > 0 || totalChips > 0) && (
        <div className="dashboard-main-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="card dashboard-chart-card">
            <div className="dashboard-card-title">{td.channelTop}</div>
            {channelTop.length === 0 ? (
              <div className="dashboard-empty-chart" style={{ height: 120 }}>{td.noData}</div>
            ) : channelTop.map(c => (
              <div key={c.name} className="channel-rank-row">
                <span style={{ fontSize: 12, fontWeight: 600, width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{c.name}</span>
                <div className="dim-bar-track">
                  <div className="dim-bar-fill" style={{ width: `${Math.round((c.user_count / maxChannelUsers) * 100)}%`, background: '#3b82f6' }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, width: 56, textAlign: 'right', flexShrink: 0 }}>
                  {c.user_count.toLocaleString()}{td.usersUnit}
                </span>
              </div>
            ))}
          </div>

          <div className="card dashboard-chart-card">
            <div className="dashboard-card-title">{td.hardware}</div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
              <div className="dashboard-hw-card" style={{ border: '1px solid var(--border)' }}>
                <Cpu size={20} style={{ color: '#6366f1', flexShrink: 0 }} />
                <div>
                  <div className="dashboard-hw-value">{activeDevices} / {totalDevices}</div>
                  <div className="dashboard-hw-label">{td.devicesActive}</div>
                </div>
              </div>
              <div className="dashboard-hw-card" style={{ border: '1px solid var(--border)' }}>
                <Layers size={20} style={{ color: chipsLow ? '#ef4444' : '#10b981', flexShrink: 0 }} />
                <div>
                  <div className="dashboard-hw-value" style={chipsLow ? { color: '#ef4444' } : undefined}>
                    {availableChips.toLocaleString()} / {totalChips.toLocaleString()}
                  </div>
                  <div className="dashboard-hw-label">{td.chipsAvailable}</div>
                </div>
              </div>
            </div>
            {totalChips > 0 && (
              <div>
                <div className="progress-track" style={{ height: 8 }}>
                  <div className="progress-fill" style={{
                    width: `${Math.round((usedChips / totalChips) * 100)}%`,
                    background: chipsLow ? '#ef4444' : '#10b981',
                  }} />
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                  {td.chipUtilization}: {usedChips.toLocaleString()} ({Math.round((usedChips / totalChips) * 100)}%)
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Row 5: recent users / recent orders */}
      <div className="dashboard-tables-row">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-toolbar" style={{ padding: '10px 16px' }}>
            <span className="table-count">{td.recentUsers}</span>
          </div>
          <table className="data-table">
            <thead><tr>
              <th>{td.colUser}</th>
              {isSuperadmin && <th>{td.colChannel}</th>}
              <th>{t.table.bioAge}</th>
              <th>{t.table.joined}</th>
            </tr></thead>
            <tbody>
              {recentUsers.length === 0
                ? <tr><td colSpan={isSuperadmin ? 4 : 3} className="empty-row">—</td></tr>
                : recentUsers.map(u => (
                  <tr key={u.user_id}>
                    <td>
                      <div className="avatar-cell">
                        <CrmAvatar name={u.nickname || u.user_id} url={u.avatar_url} size={26} />
                        <span style={{ fontWeight: 500 }}>{u.nickname || u.user_id}</span>
                      </div>
                    </td>
                    {isSuperadmin && <td style={{ fontSize: 12, color: '#64748b' }}>{u.channel_name || '—'}</td>}
                    <td>{u.bio_age ? Number(u.bio_age).toFixed(1) : '—'}</td>
                    <td style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(u.created_at)}</td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-toolbar" style={{ padding: '10px 16px' }}>
            <span className="table-count">{td.recentOrders}</span>
          </div>
          <table className="data-table">
            <thead><tr>
              <th>{td.colUser}</th>
              <th>{td.colItem}</th>
              <th>{td.colAmount}</th>
              <th>{t.table.status}</th>
              <th>{t.table.joined}</th>
            </tr></thead>
            <tbody>
              {recentOrders.length === 0
                ? <tr><td colSpan={5} className="empty-row">—</td></tr>
                : recentOrders.map(o => (
                  <tr key={o.id}>
                    <td style={{ fontWeight: 500 }}>{o.nickname || o.user_id}</td>
                    <td style={{ fontSize: 12, color: '#475569', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(lang === 'en' ? o.name_en : o.name_zh) || o.item_key || '—'}
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {o.price_cny != null ? fmtCny(parseFloat(o.price_cny) * (parseInt(o.quantity) || 1)) : '—'}
                    </td>
                    <td>
                      <Badge color={orderStatusColor(o.status)}>{o.status}</Badge>
                    </td>
                    <td style={{ fontSize: 12, color: '#64748b' }}>{fmtDate(o.created_at)}</td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export { DashboardTab };
