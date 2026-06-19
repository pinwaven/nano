import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Settings2 } from 'lucide-react';
import { useLang, Badge } from '../shared.jsx';

function RewardsTab() {
  const { t } = useLang();
  const r = t.rewards;
  const [settings, setSettings] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/commission-settings');
      setSettings(res.data.settings || []);
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

  const productLabel = (pt) => ({ chip: r.chip, dot: r.dot, subscription: r.subscription }[pt] || pt);

  return (
    <>
      <div className="subtab-row">
        <button className="subtab-btn active">
          <Settings2 size={13} /> {r.settingsTab}
        </button>
      </div>

      {loading && <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Loading…</div>}

      {!loading && (
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
    </>
  );
}

export { RewardsTab };
