import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Plus, Pencil, Trash2, X, Check, RefreshCcw, Send, Eye, Download, BarChart2 } from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { useLang } from '../shared.jsx';

// ── Constants ─────────────────────────────────────────────────────────────────

const REPORT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

// ── Helper Components ─────────────────────────────────────────────────────────

function ReportChart({ chart, data }) {
  if (!chart || !data || data.length === 0) return null;
  const { type, xKey, yKeys = [] } = chart;
  if (!xKey || yKeys.length === 0) return null;

  const tickFmt = (v) => {
    const s = String(v);
    return s.length > 14 ? s.slice(0, 12) + '…' : s;
  };

  if (type === 'pie') {
    const yk = yKeys[0];
    if (!yk) return null;
    return (
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie data={data} dataKey={yk.key} nameKey={xKey} cx="50%" cy="50%" outerRadius={110}
            label={({ name, percent }) => `${String(name).slice(0, 10)} ${(percent * 100).toFixed(0)}%`}>
            {data.map((_, i) => <Cell key={i} fill={REPORT_COLORS[i % REPORT_COLORS.length]} />)}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  const ChartComp   = type === 'area' ? AreaChart  : type === 'line' ? LineChart  : BarChart;
  const SeriesComp  = type === 'area' ? Area       : type === 'line' ? Line       : Bar;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ChartComp data={data} margin={{ top: 4, right: 20, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={tickFmt} />
        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} width={50} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        {yKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {yKeys.map((yk, i) => (
          <SeriesComp
            key={yk.key}
            type="monotone"
            dataKey={yk.key}
            name={yk.label || yk.key}
            fill={yk.color || REPORT_COLORS[i % REPORT_COLORS.length]}
            stroke={yk.color || REPORT_COLORS[i % REPORT_COLORS.length]}
            fillOpacity={type === 'area' ? 0.2 : 1}
            radius={type === 'bar' ? [3, 3, 0, 0] : undefined}
          />
        ))}
      </ChartComp>
    </ResponsiveContainer>
  );
}

function ReportDataTable({ columns, data }) {
  const { t } = useLang();
  if (!data || data.length === 0) return <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>{t.reports.rowCount(0)}</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table">
        <thead>
          <tr>{columns.map(col => <th key={col}>{col}</th>)}</tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              {columns.map(col => (
                <td key={col}>
                  {row[col] == null ? '—' : typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

function ReportsTab() {
  const { t } = useLang();
  const tr = t.reports;
  const adminUser = sessionStorage.getItem('nano_admin_user') || '';

  // Run state
  const [query, setQuery]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [report, setReport]       = useState(null);
  const [llmHistory, setLlmHistory] = useState([]);
  const [showSql, setShowSql]     = useState(false);
  const [activeTab, setActiveTab] = useState('chart');

  // Session history (localStorage)
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('nano_report_history') || '[]'); } catch { return []; }
  });

  // Saved reports (DB, shared across admins)
  const [savedReports, setSavedReports]   = useState([]);
  const [savedLoading, setSavedLoading]   = useState(false);
  const [activeSavedId, setActiveSavedId] = useState(null);

  // Edit / save modal: null | { mode: 'save' | 'edit', title, query, savedId }
  const [modal, setModal] = useState(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  const textareaRef = React.useRef(null);

  const fetchSaved = useCallback(async () => {
    setSavedLoading(true);
    try {
      const res = await axios.get('/api/admin/saved-reports');
      setSavedReports(res.data.reports || []);
    } catch {} finally { setSavedLoading(false); }
  }, []);

  useEffect(() => { fetchSaved(); }, [fetchSaved]);

  const runReport = async (queryText) => {
    const q = (queryText || query).trim();
    if (!q || loading) return;
    setLoading(true);
    setError('');
    setShowSql(false);
    setActiveSavedId(null);
    try {
      const res = await axios.post('/api/admin/report', { query: q, history: llmHistory });
      if (res.data.success === false) throw new Error(res.data.error || 'Report failed');
      const newReport = { ...res.data, query: q };
      setReport(newReport);
      setActiveTab(newReport.chart && newReport.data?.length > 0 ? 'chart' : 'table');
      const summary = `Title: ${newReport.title}. SQL: ${(newReport.sql || '').slice(0, 200)}. Rows: ${newReport.data?.length}.`;
      setLlmHistory(prev => [...prev, { role: 'user', content: q }, { role: 'assistant', content: summary }].slice(-24));
      setHistory(prev => {
        const next = [{ id: Date.now(), query: q, report: newReport }, ...prev].slice(0, 20);
        try { localStorage.setItem('nano_report_history', JSON.stringify(next)); } catch {}
        return next;
      });
      setQuery('');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Unknown error');
    } finally { setLoading(false); }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runReport(); }
  };

  const loadFromHistory = (entry) => {
    setReport(entry.report);
    setShowSql(false);
    setError('');
    setActiveSavedId(null);
    setActiveTab(entry.report.chart && entry.report.data?.length > 0 ? 'chart' : 'table');
  };

  const loadSaved = (saved) => {
    const r = {
      title: saved.title,
      query: saved.query,
      sql: saved.sql,
      chart: saved.chart,
      insights: saved.insights,
      columns: saved.columns || [],
      data: saved.data || [],
    };
    setReport(r);
    setShowSql(false);
    setError('');
    setActiveSavedId(saved.id);
    setActiveTab(r.chart && r.data?.length > 0 ? 'chart' : 'table');
  };

  const startNew = () => {
    setReport(null); setQuery(''); setError(''); setShowSql(false);
    setLlmHistory([]); setActiveSavedId(null);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const exportCsv = () => {
    if (!report?.data?.length) return;
    const cols = report.columns;
    const rows = report.data.map(row =>
      cols.map(c => {
        const v = row[c] == null ? '' : String(row[c]);
        return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(',')
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([[cols.join(','), ...rows].join('\n')], { type: 'text/csv' }));
    a.download = `${(report.title || 'report').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.csv`;
    a.click();
  };

  // ── Save / Edit modal actions ───────────────────────────────────────────────
  const openSaveModal = () => {
    setModal({ mode: 'save', title: report?.title || '', query: report?.query || '' });
    setModalError('');
  };

  const openEditModal = (saved) => {
    setModal({ mode: 'edit', title: saved.title, query: saved.query, savedId: saved.id });
    setModalError('');
  };

  const closeModal = () => { setModal(null); setModalBusy(false); setModalError(''); };

  const handleModalSave = async (rerun = false) => {
    if (!modal?.title?.trim()) { setModalError('Title is required'); return; }
    setModalBusy(true);
    setModalError('');
    try {
      if (modal.mode === 'save') {
        // New save
        await axios.post('/api/admin/saved-reports', {
          title: modal.title.trim(),
          query: report.query || modal.query,
          sql: report.sql,
          chart: report.chart,
          insights: report.insights,
          columns: report.columns,
          data: report.data,
          created_by: adminUser,
        });
        await fetchSaved();
        closeModal();
      } else {
        // Edit existing
        if (rerun && modal.query?.trim()) {
          // Re-run query first, then update saved
          closeModal();
          setLoading(true);
          setError('');
          const res = await axios.post('/api/admin/report', { query: modal.query.trim(), history: [] });
          if (res.data.success === false) throw new Error(res.data.error || 'Report failed');
          const newReport = res.data;
          await axios.put(`/api/admin/saved-reports/${modal.savedId}`, {
            title: modal.title.trim(),
            query: modal.query.trim(),
            sql: newReport.sql,
            chart: newReport.chart,
            insights: newReport.insights,
            columns: newReport.columns,
            data: newReport.data,
            updated_by: adminUser,
          });
          setReport(newReport);
          setActiveSavedId(modal.savedId);
          setActiveTab(newReport.chart && newReport.data?.length > 0 ? 'chart' : 'table');
          await fetchSaved();
          setLoading(false);
        } else {
          // Title-only update
          await axios.put(`/api/admin/saved-reports/${modal.savedId}`, {
            title: modal.title.trim(),
            query: modal.query,
            sql: report?.sql || '',
            chart: report?.chart,
            insights: report?.insights,
            columns: report?.columns,
            data: report?.data,
            updated_by: adminUser,
          });
          setReport(prev => prev ? { ...prev, title: modal.title.trim() } : prev);
          await fetchSaved();
          closeModal();
        }
      }
    } catch (err) {
      if (modal) setModalError(err.response?.data?.error || err.message);
      setLoading(false);
    } finally {
      if (modal) setModalBusy(false);
    }
  };

  const handleDeleteSaved = async (saved) => {
    if (!window.confirm(`Delete saved report "${saved.title}"?`)) return;
    try {
      await axios.delete(`/api/admin/saved-reports/${saved.id}`);
      if (activeSavedId === saved.id) startNew();
      await fetchSaved();
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const isSavedLoaded = activeSavedId !== null;

  return (
    <div className="reports-layout">

      {/* ── Left sidebar ─────────────────────────────────────────── */}
      <div className="reports-sidebar">
        <div className="reports-sidebar-header">
          <span className="reports-sidebar-title">{tr.title}</span>
          <button className="btn-primary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={startNew}>
            <Plus size={12} />{tr.newReport}
          </button>
        </div>

        <div className="reports-history-list">
          {/* Saved reports section */}
          <div className="reports-section-label">{tr.saved}</div>
          {savedLoading && <div className="reports-history-empty">…</div>}
          {!savedLoading && savedReports.length === 0 && (
            <div className="reports-history-empty">{tr.emptySaved}</div>
          )}
          {savedReports.map(s => (
            <div key={s.id} className={`reports-saved-item${activeSavedId === s.id ? ' active' : ''}`}>
              <button className="reports-saved-main" onClick={() => loadSaved(s)}>
                <span className="reports-history-query">{s.title}</span>
                <span className="reports-history-title">{s.created_by ? `by ${s.created_by}` : ''}</span>
              </button>
              <div className="reports-saved-actions">
                <button title="Edit" onClick={() => openEditModal(s)}><Pencil size={11} /></button>
                <button title="Delete" onClick={() => handleDeleteSaved(s)}><Trash2 size={11} /></button>
              </div>
            </div>
          ))}

          <div className="reports-sidebar-divider" />

          {/* Session history section */}
          <div className="reports-section-label">{tr.history}</div>
          {history.length === 0 && <div className="reports-history-empty">{tr.emptyHistory}</div>}
          {history.map(entry => (
            <button key={entry.id}
              className={`reports-history-item${!isSavedLoaded && report === entry.report ? ' active' : ''}`}
              onClick={() => loadFromHistory(entry)}>
              <span className="reports-history-query">{entry.query}</span>
              <span className="reports-history-title">{entry.report.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Main area ────────────────────────────────────────────── */}
      <div className="reports-main">

        {/* Empty state */}
        {!report && !loading && !error && (
          <div className="reports-empty-state">
            <BarChart2 size={48} color="#cbd5e1" />
            <h3 className="reports-empty-title">{tr.title}</h3>
            <p className="reports-empty-sub">Ask anything about your platform data.</p>
            <div className="reports-samples">
              {tr.samples.map((s, i) => (
                <button key={i} className="reports-sample-btn"
                  onClick={() => { setQuery(s); setTimeout(() => textareaRef.current?.focus(), 50); }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Result area */}
        {(report || loading || error) && (
          <div className="reports-result">
            {error && <div className="form-error" style={{ marginBottom: 16 }}>{tr.errorPrefix}{error}</div>}
            {loading && (
              <div className="reports-loading">
                <RefreshCcw size={18} style={{ animation: 'spin 1s linear infinite' }} />
                <span>{tr.running}</span>
              </div>
            )}
            {report && !loading && (
              <>
                <div className="reports-result-header">
                  <h2 className="reports-result-title">{report.title}</h2>
                  <div className="reports-result-actions">
                    {!isSavedLoaded && report.sql && (
                      <button className="btn-secondary" style={{ fontSize: 12 }} onClick={openSaveModal}>
                        <Check size={13} />{tr.saveReport}
                      </button>
                    )}
                    {isSavedLoaded && (
                      <button className="btn-secondary" style={{ fontSize: 12 }}
                        onClick={() => openEditModal(savedReports.find(s => s.id === activeSavedId) || { id: activeSavedId, title: report.title, query: report.query || '' })}>
                        <Pencil size={13} />{tr.editReport}
                      </button>
                    )}
                    {report.data?.length > 0 && (
                      <button className="btn-secondary" style={{ fontSize: 12 }} onClick={exportCsv}>
                        <Download size={13} />{tr.exportCsv}
                      </button>
                    )}
                    {report.sql && (
                      <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setShowSql(v => !v)}>
                        <Eye size={13} />{showSql ? tr.hideSql : tr.showSql}
                      </button>
                    )}
                  </div>
                </div>
                {report.data && (
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>{tr.rowCount(report.data.length)}</div>
                )}
                {showSql && report.sql && (
                  <div className="reports-sql-block">
                    <div className="reports-sql-label">{tr.sqlLabel}</div>
                    <pre className="reports-sql-pre">{report.sql}</pre>
                  </div>
                )}
                {report.insights && (
                  <div className="reports-insights">
                    <div className="reports-insights-label">{tr.insights}</div>
                    <p className="reports-insights-text">{report.insights}</p>
                  </div>
                )}
                {report.data && report.data.length > 0 && (
                  <>
                    <div className="subtab-row" style={{ marginBottom: 12 }}>
                      {report.chart && (
                        <button className={`subtab-btn${activeTab === 'chart' ? ' active' : ''}`} onClick={() => setActiveTab('chart')}>
                          {tr.chart}
                        </button>
                      )}
                      <button className={`subtab-btn${activeTab === 'table' ? ' active' : ''}`} onClick={() => setActiveTab('table')}>
                        {tr.dataTable}
                      </button>
                    </div>
                    <div className="card" style={{ overflow: 'hidden' }}>
                      {activeTab === 'chart' && report.chart && (
                        <div style={{ padding: '20px 16px' }}>
                          <ReportChart chart={report.chart} data={report.data} />
                        </div>
                      )}
                      {activeTab === 'table' && <ReportDataTable columns={report.columns} data={report.data} />}
                    </div>
                  </>
                )}
                {report.data && report.data.length === 0 && (
                  <div className="card"><div style={{ padding: 24, color: 'var(--muted)', fontSize: 13 }}>{tr.rowCount(0)}</div></div>
                )}
              </>
            )}
          </div>
        )}

        {/* Query input */}
        <div className="reports-input-area">
          <div className="reports-input-box">
            <textarea
              ref={textareaRef}
              className="reports-textarea"
              placeholder={tr.placeholder}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              disabled={loading}
            />
            <button className="reports-send-btn" onClick={() => runReport()} disabled={!query.trim() || loading}>
              {loading
                ? <RefreshCcw size={16} style={{ animation: 'spin 1s linear infinite' }} />
                : <Send size={16} />}
            </button>
          </div>
          <div className="reports-input-hint">
            {navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to run
          </div>
        </div>
      </div>

      {/* ── Save / Edit modal ─────────────────────────────────────── */}
      {modal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{modal.mode === 'save' ? tr.saveReport : tr.editReport}</span>
              <button onClick={closeModal}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                <div className="form-field">
                  <span className="form-field-label">{tr.reportTitle}</span>
                  <input
                    autoFocus
                    value={modal.title}
                    onChange={e => setModal(m => ({ ...m, title: e.target.value }))}
                    placeholder="e.g. Monthly User Signups"
                  />
                </div>
                {modal.mode === 'edit' && (
                  <div className="form-field">
                    <span className="form-field-label">{tr.reportQuery}</span>
                    <textarea
                      className="form-field-textarea"
                      rows={3}
                      value={modal.query}
                      onChange={e => setModal(m => ({ ...m, query: e.target.value }))}
                      placeholder="Natural language query…"
                    />
                  </div>
                )}
              </div>
              {modalError && <div className="form-error">{modalError}</div>}
              <div className="modal-footer">
                <button className="btn-secondary" onClick={closeModal}>{t.modal.cancel}</button>
                {modal.mode === 'edit' && (
                  <button className="btn-secondary" disabled={modalBusy || loading} onClick={() => handleModalSave(true)}>
                    {tr.rerunSave}
                  </button>
                )}
                <button className="btn-primary" disabled={modalBusy} onClick={() => handleModalSave(false)}>
                  {modalBusy ? t.modal.saving : t.modal.save}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { ReportsTab };
