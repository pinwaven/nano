import React, { useState, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { useLang } from '../i18n.js';
import Sparkline from '../components/Sparkline.jsx';
import { BM_META, chronoAge, fmtDate, bioAgeColor } from '../utils.js';

const API = '/api';

const SUB_AGE_KEYS = ['ResilienceAge', 'CellularAge', 'MetabolicAge', 'MicroVascularAge'];
const SUB_AGE_COLORS = {
  ResilienceAge: '#ef4444', CellularAge: '#10b981',
  MetabolicAge: '#6375EC', MicroVascularAge: '#0ea5e9',
};

function KinoScanModal({ user, onClose, onDone }) {
  const { t } = useLang();
  const [chipCode, setChipCode] = useState('');
  const [status, setStatus] = useState('idle');
  const [msg, setMsg] = useState('');

  const handleScan = async () => {
    const code = chipCode.trim().toUpperCase();
    if (!code) return;
    setStatus('loading');
    setMsg('');
    try {
      const res = await axios.post(`${API}/kino-scan`, { chip_id: code, openid: user.user_id });
      const outcome = {
        registered:      { ok: true,  msg: t.scanSuccess },
        already_linked:  { ok: true,  msg: t.scanAlreadyLinked },
        used:            { ok: false, msg: t.scanUsed },
        invalid_chip:    { ok: false, msg: t.scanInvalidChip },
        claimed_by_other:{ ok: false, msg: t.scanClaimedByOther },
      }[res.data?.status] || { ok: false, msg: t.scanError };
      setStatus(outcome.ok ? 'success' : 'error');
      setMsg(outcome.msg);
      if (outcome.ok) onDone && setTimeout(onDone, 1800);
    } catch (err) {
      setStatus('error');
      setMsg(t.scanError);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{t.scanTitle}</div>
        <div className="modal-desc">{t.scanDesc}</div>
        <input
          className="modal-input"
          type="text"
          placeholder={t.scanPlaceholder}
          value={chipCode}
          onChange={e => { setChipCode(e.target.value); setStatus('idle'); setMsg(''); }}
          onKeyDown={e => { if (e.key === 'Enter') handleScan(); }}
          autoFocus
        />
        {msg && (
          <div className={`modal-msg${status === 'success' ? ' modal-msg--ok' : ' modal-msg--err'}`}>{msg}</div>
        )}
        <div className="modal-actions">
          <button className="modal-btn modal-btn--ghost" onClick={onClose}>{t.cancel}</button>
          <button className="modal-btn modal-btn--primary" onClick={handleScan} disabled={!chipCode.trim() || status === 'loading'}>
            {status === 'loading' ? '…' : t.scanSubmit}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportSection({ user, lang }) {
  const { t } = useLang();
  const [reports, setReports] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [activeReport, setActiveReport] = useState(null);

  useEffect(() => {
    if (!user?.user_id) return;
    axios.get(`${API}/health-reports?openid=${encodeURIComponent(user.user_id)}`)
      .then(r => setReports(r.data.reports || []))
      .catch(() => setReports([]))
      .finally(() => setLoadingList(false));
  }, [user?.user_id]);

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await axios.post(`${API}/health-reports`, { openid: user.user_id });
      if (r.data.report) {
        setReports(prev => [r.data.report, ...prev]);
      }
    } catch { /* silent */ }
    setGenerating(false);
  };

  if (activeReport) {
    return (
      <div className="health-section">
        <div className="health-section-title" style={{ cursor: 'pointer' }} onClick={() => setActiveReport(null)}>
          ← {t.back}
        </div>
        <div className="report-body">
          <ReactMarkdown>{activeReport.content || activeReport.report_text || ''}</ReactMarkdown>
        </div>
      </div>
    );
  }

  return (
    <div className="health-section">
      <div className="health-section-title">
        {t.genReport}
        <button className="report-gen-btn" onClick={generate} disabled={generating}>
          {generating ? t.reportGenerating : '+ ' + t.genReport}
        </button>
      </div>
      <div className="health-info-grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="modal-desc" style={{ margin: 0 }}>{t.genReportDesc}</div>
      </div>
      {loadingList ? null : reports.length === 0 ? (
        <div className="health-empty" style={{ marginTop: 8 }}>{t.noReports}</div>
      ) : (
        <div className="report-list">
          {reports.slice(0, 5).map(r => (
            <button key={r.id} className="report-row" onClick={() => setActiveReport(r)}>
              <span className="report-row-date">{fmtDate(r.created_at, lang)}</span>
              <span className="report-row-view">{t.viewReport} →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HealthTab({ user }) {
  const { t, lang } = useLang();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showScan, setShowScan] = useState(false);

  const loadRecords = () => {
    if (!user?.user_id) return;
    setLoading(true);
    axios.get(`${API}/biomarkers?openid=${encodeURIComponent(user.user_id)}`)
      .then(r => setRecords(r.data.records || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  };

  useEffect(loadRecords, [user?.user_id]);

  const latestRecord = records.length > 0 ? records[records.length - 1] : null;
  const latestBm     = latestRecord?.data?.validated || null;
  const subAges      = latestRecord?.data?.bioage_profile?.SubAges || null;
  const trendFor     = key => records.map(r => r.data?.validated?.[key]).filter(v => v != null);
  const age          = chronoAge(user.birth_date);

  return (
    <div className="health-tab">
      {showScan && (
        <KinoScanModal
          user={user}
          onClose={() => setShowScan(false)}
          onDone={() => { setShowScan(false); loadRecords(); }}
        />
      )}

      <div className="health-hero">
        <div className="health-hero-bg" />
        <div className="health-avatar-row">
          <div className="health-avatar">{(user.nickname || 'U')[0].toUpperCase()}</div>
          <button className="scan-chip-btn" onClick={() => setShowScan(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="8" height="8" rx="1"/><rect x="14" y="2" width="8" height="8" rx="1"/>
              <rect x="2" y="14" width="8" height="8" rx="1"/><path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/>
            </svg>
            {t.scanChip}
          </button>
        </div>
        <div className="health-name">{user.nickname || 'User'}</div>
        {(user.bio_age || age) && (
          <div className="health-bio-row">
            <div className="health-bio-chip">
              <span className="health-bio-num" style={{ color: user.bio_age ? bioAgeColor(user.bio_age, age) : 'var(--text-muted)' }}>
                {user.bio_age ? Number(user.bio_age).toFixed(1) : '—'}
              </span>
              <span className="health-bio-unit">{t.bioAge}</span>
            </div>
            <div className="health-bio-chip health-bio-chip--dim">
              <span className="health-bio-num" style={{ color: 'var(--text-sub)' }}>{age ?? '—'}</span>
              <span className="health-bio-unit">{t.chronoAge}</span>
            </div>
          </div>
        )}
        {subAges && (
          <div className="sub-age-grid">
            {SUB_AGE_KEYS.map(key => (
              <div key={key} className="sub-age-card">
                <span className="sub-age-val" style={{ color: SUB_AGE_COLORS[key] }}>
                  {subAges[key] != null ? subAges[key].toFixed(1) : '—'}
                </span>
                <span className="sub-age-label">{t.subAgeLabels[key]}</span>
                <span className="sub-age-desc">{t.subAgeDesc[key]}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="health-section">
        <div className="health-section-title">{t.profile}</div>
        <div className="health-info-grid">
          {[
            [t.gender,   t.genderMap[user.gender] || user.gender],
            [t.born,     fmtDate(user.birth_date, lang)],
            [t.language, t.langMap[user.language] || user.language],
            [t.coach,    user.coach_name],
            [t.joined,   fmtDate(user.created_at, lang)],
            [t.phone,    user.phone],
            [t.email,    user.email],
          ].map(([k, v]) => (
            <React.Fragment key={k}>
              <span className="health-info-key">{k}</span>
              <span className="health-info-val">{v || '—'}</span>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="health-section">
        <div className="health-section-title">{t.latestBm}</div>
        {loading ? (
          <div className="health-loading"><span /><span /><span /></div>
        ) : latestBm ? (
          <div className="bm-list">
            {BM_META.map(({ key, unit, color }) => (
              <div key={key} className="bm-row">
                <span className="bm-dot" style={{ background: color }} />
                <span className="bm-label">{t.bmLabels[key]}</span>
                <span className="bm-val" style={{ color }}>{latestBm[key] ?? '—'}</span>
                <span className="bm-unit">{unit}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="health-empty">{t.noBmData}</div>
        )}
      </div>

      <div className="health-section">
        <div className="health-section-title">
          {t.trends}
          {records.length > 0 && <span className="health-section-badge">{t.tests(records.length)}</span>}
        </div>
        {loading ? (
          <div className="health-loading"><span /><span /><span /></div>
        ) : records.length > 0 ? (
          <div className="trend-grid">
            {BM_META.map(({ key, unit, color }) => {
              const vals = trendFor(key);
              const last = vals[vals.length - 1];
              return (
                <div key={key} className="trend-card">
                  <div className="trend-label">{t.bmLabels[key]}</div>
                  <div className="trend-val" style={{ color }}>
                    {last != null ? last : '—'}
                    <span className="trend-unit">{unit}</span>
                  </div>
                  <Sparkline values={vals} color={color} width={130} height={38} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="health-empty">{t.noHistory}</div>
        )}
      </div>

      <ReportSection user={user} lang={lang} />
    </div>
  );
}
