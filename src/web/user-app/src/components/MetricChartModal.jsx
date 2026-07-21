import { useLang } from '../i18n.js';
import LineChart from './LineChart.jsx';

export default function MetricChartModal({ title, series, lang, onClose, legend }) {
  const { t } = useLang();
  const hasData = series.some(s => s.points.length > 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="referral-modal-header">
          <span className="modal-title">{title}</span>
          <button className="referral-close-btn" onClick={onClose} aria-label={t.cancel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        {legend && (
          <div className="chart-legend">
            {series.map((s, i) => (
              <span key={i} className="chart-legend-item">
                <span className="chart-legend-dot" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
        )}
        {hasData ? (
          <LineChart series={series} lang={lang} />
        ) : (
          <div className="ac-empty">{t.noHistory}</div>
        )}
      </div>
    </div>
  );
}
