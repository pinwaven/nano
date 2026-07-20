import React, { useState, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { useLang } from '../i18n.js';
import Sparkline from '../components/Sparkline.jsx';
import GaugeBar from '../components/GaugeBar.jsx';
import MetricChartModal from '../components/MetricChartModal.jsx';
import { BM_META, chronoAge, fmtDate, bioAgeColor, buildTwinVisuals, buildLabPanel, USER_UPLOADED_BP_SOURCES } from '../utils.js';

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

function DigitalTwinSection({ user, lang }) {
  const { t } = useLang();
  const [twin, setTwin] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openModal, setOpenModal] = useState(null);
  const isZh = lang === 'zh';

  useEffect(() => {
    if (!user?.user_id) return;
    Promise.all([
      axios.get(`${API}/health-twin?openid=${encodeURIComponent(user.user_id)}`),
      axios.get(`${API}/health-events?openid=${encodeURIComponent(user.user_id)}&limit=60`),
    ]).then(([twinRes, eventsRes]) => {
      setTwin(twinRes.data.twin || null);
      setEvents(eventsRes.data.events || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [user?.user_id]);

  if (loading) return <div className="health-loading"><span /><span /><span /></div>;
  if (!twin) return null;

  const visuals = buildTwinVisuals(twin, t, isZh);
  const { labPanel, labPanelDate, labPanelAbnormal } = buildLabPanel(twin, lang);

  const eventDate = ev => (ev.data_date || '').toString().slice(0, 10);
  const seriesFor = (field, category) => events
    .filter(ev => category ? ev.category === category : true)
    .filter(ev => ev.data?.[field] != null)
    .map(ev => ({ date: eventDate(ev), value: Number(ev.data[field]) }))
    .filter(p => p.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const bpSeries = () => {
    const sys = [], dia = [];
    events
      .filter(ev => USER_UPLOADED_BP_SOURCES.has(ev.source) && ev.data?.bp_systolic != null && ev.data?.bp_diastolic != null)
      .sort((a, b) => eventDate(a).localeCompare(eventDate(b)))
      .forEach(ev => {
        sys.push({ date: eventDate(ev), value: Number(ev.data.bp_systolic) });
        dia.push({ date: eventDate(ev), value: Number(ev.data.bp_diastolic) });
      });
    return [sys, dia];
  };

  const glucoseSeries = () => events
    .filter(ev => USER_UPLOADED_BP_SOURCES.has(ev.source) && ev.data?.glucose_mmol != null)
    .map(ev => ({ date: eventDate(ev), value: Number(ev.data.glucose_mmol) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const [bpSys, bpDia] = bpSeries();

  const trendCards = [
    { key: 'steps',  label: t.metricSteps,  unit: '',     color: '#0ea5e9', points: seriesFor('steps', 'activity') },
    { key: 'hrv',    label: t.metricHrv,    unit: 'ms',   color: '#10b981', points: seriesFor('hrv_sdnn_ms', 'vitals') },
    { key: 'hr',     label: t.metricRestHr, unit: 'bpm',  color: '#f97316', points: seriesFor('resting_hr', 'vitals') },
    { key: 'glucose',label: t.metricGlucose,unit: 'mmol/L',color: '#a855f7', points: glucoseSeries() },
  ].filter(c => c.points.length > 0);

  return (
    <div className="health-section dt-section">
      <div className="health-section-title">{t.digitalTwin}</div>

      {visuals.healthScore != null && (
        <div className="dt-score-row">
          <div className="dt-score-ring" style={{ borderColor: visuals.healthScoreColor }}>
            <span className="dt-score-val" style={{ color: visuals.healthScoreColor }}>{visuals.healthScore}</span>
          </div>
          <div className="dt-score-info">
            <span className="dt-score-label">{t.healthScore}</span>
            <span className="dt-score-grade" style={{ color: visuals.healthScoreColor }}>{visuals.healthScoreGrade}</span>
          </div>
        </div>
      )}

      {visuals.healthDomains.length > 0 && (
        <div className="dt-domains-row">
          {visuals.healthDomains.map(d => (
            <div key={d.key} className="dt-domain-chip">
              <span className="dt-domain-score" style={{ color: d.color }}>{d.score}</span>
              <span className="dt-domain-label">{d.label}</span>
            </div>
          ))}
        </div>
      )}

      {visuals.vitalGauges.length > 0 && (
        <div className="dt-gauges">
          <div className="dt-subtitle">{t.dtSevenDay}</div>
          {visuals.vitalGauges.map(g => <GaugeBar key={g.key} gauge={g} />)}
        </div>
      )}

      {visuals.twinBodyBar && (
        <div className="dt-body-section">
          <div className="dt-subtitle">{t.dtBody}</div>
          <div className="dt-body-bar">
            <div className="dt-body-bar-fat" style={{ width: `${visuals.twinBodyBar.fatPct}%` }} />
          </div>
          <div className="dt-body-legend">
            <span><span className="dt-body-dot dt-body-dot--fat" />{t.dtFat} {visuals.twinBodyBar.fatPct}%</span>
            <span><span className="dt-body-dot dt-body-dot--lean" />{t.dtLean} {visuals.twinBodyBar.leanPct}%</span>
          </div>
        </div>
      )}

      {labPanel.length > 0 && (
        <div className="dt-lab-section">
          <div className="dt-subtitle">{t.dtLabPanel} · {labPanelDate}</div>
          <div className="dt-lab-abnormal">
            {labPanelAbnormal > 0
              ? `${labPanelAbnormal} ${t.dtLabAbnormal}`
              : t.dtLabAllNormal}
          </div>
          <div className="dt-lab-grid">
            {labPanel.map(item => (
              <div key={item.key} className="dt-lab-item">
                <span className="dt-lab-name">{item.displayName}</span>
                <span className="dt-lab-val" style={{ color: item.statusColor }}>{item.value}</span>
                <span className="dt-lab-unit">{item.unit}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(bpSys.length > 0 || trendCards.length > 0) && (
        <div className="dt-trend-cards">
          {bpSys.length > 0 && (
            <button className="dt-trend-card" onClick={() => setOpenModal('bp')}>
              <span className="dt-trend-card-label">{t.metricBp}</span>
              <span className="dt-trend-card-val" style={{ color: '#ef4444' }}>
                {bpSys[bpSys.length - 1].value}/{bpDia[bpDia.length - 1].value}
              </span>
            </button>
          )}
          {trendCards.map(c => (
            <button key={c.key} className="dt-trend-card" onClick={() => setOpenModal(c.key)}>
              <span className="dt-trend-card-label">{c.label}</span>
              <span className="dt-trend-card-val" style={{ color: c.color }}>{c.points[c.points.length - 1].value}</span>
            </button>
          ))}
        </div>
      )}

      {openModal === 'bp' && (
        <MetricChartModal
          title={t.metricBp}
          lang={lang}
          legend
          series={[{ label: 'SYS', color: '#ef4444', points: bpSys }, { label: 'DIA', color: '#f97316', points: bpDia }]}
          onClose={() => setOpenModal(null)}
        />
      )}
      {trendCards.filter(c => c.key === openModal).map(c => (
        <MetricChartModal
          key={c.key}
          title={c.label}
          lang={lang}
          series={[{ label: c.label, color: c.color, points: c.points }]}
          onClose={() => setOpenModal(null)}
        />
      ))}
    </div>
  );
}

export default function HealthTab({ user }) {
  const { t, lang } = useLang();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showScan, setShowScan] = useState(false);
  const [openModal, setOpenModal] = useState(null);

  const loadRecords = () => {
    if (!user?.user_id) return;
    setLoading(true);
    axios.get(`${API}/biomarkers?openid=${encodeURIComponent(user.user_id)}`)
      .then(r => setRecords(r.data.records || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  };

  useEffect(loadRecords, [user?.user_id]);

  const kinoRecordsAll = records.filter(r => r.test_type === 'kino_chip');
  const latestRecord = kinoRecordsAll.length > 0 ? kinoRecordsAll[kinoRecordsAll.length - 1] : null;
  const latestBm     = latestRecord?.data?.validated || null;
  const subAges      = latestRecord?.data?.bioage_profile?.SubAges || null;
  const trendFor     = key => kinoRecordsAll.map(r => r.data?.validated?.[key]).filter(v => v != null);
  const age          = chronoAge(user.birth_date);

  const kinoRecords = kinoRecordsAll.filter(r => r.bio_age != null);
  const bioAgeSeries = kinoRecords
    .map(r => ({ date: (r.tested_at || '').slice(0, 10), value: Number(r.bio_age) }))
    .filter(p => p.date);

  const bodyRecords = records.filter(r => r.test_type === 'body_composition');
  const weightSeries = bodyRecords
    .filter(r => r.data?.actual?.weight != null)
    .map(r => ({ date: (r.tested_at || '').slice(0, 10), value: Number(r.data.actual.weight) }))
    .filter(p => p.date);
  const heightVal = bodyRecords.find(r => r.data?.actual?.height != null)?.data?.actual?.height
    ?? user.bio_data?.height ?? null;
  const bmiSeries = heightVal
    ? weightSeries.map(p => ({ date: p.date, value: Number((p.value / Math.pow(heightVal / 100, 2)).toFixed(1)) }))
    : [];

  const conditions = user.bio_data?.health_conditions || [];

  const bioAgeTrendCards = [
    { key: 'bioage', label: t.metricBioAge, color: '#6375EC', points: bioAgeSeries },
    { key: 'weight', label: t.metricWeight, color: '#10b981', points: weightSeries },
    { key: 'bmi',    label: t.metricBmi,    color: '#f97316', points: bmiSeries },
  ].filter(c => c.points.length > 0);

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

      <DigitalTwinSection user={user} lang={lang} />

      {bioAgeTrendCards.length > 0 && (
        <div className="health-section">
          <div className="health-section-title">{t.trends}</div>
          <div className="dt-trend-cards">
            {bioAgeTrendCards.map(c => (
              <button key={c.key} className="dt-trend-card" onClick={() => setOpenModal(c.key)}>
                <span className="dt-trend-card-label">{c.label}</span>
                <span className="dt-trend-card-val" style={{ color: c.color }}>{c.points[c.points.length - 1].value}</span>
              </button>
            ))}
          </div>
          {bioAgeTrendCards.filter(c => c.key === openModal).map(c => (
            <MetricChartModal
              key={c.key}
              title={c.label}
              lang={lang}
              series={[{ label: c.label, color: c.color, points: c.points }]}
              onClose={() => setOpenModal(null)}
            />
          ))}
        </div>
      )}

      {conditions.length > 0 && (
        <div className="health-section">
          <div className="health-section-title">{t.healthConditions}</div>
          <div className="plan-chips-row">
            {conditions.map((c, i) => (
              <span key={i} className="plan-chip">{t.conditionLabels[c] || c}</span>
            ))}
          </div>
        </div>
      )}

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
