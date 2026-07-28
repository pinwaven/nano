export default function GaugeBar({ gauge }) {
  const { label, val, unit, score, color, trend, trendColor, markerPct, zones, sublabel } = gauge;
  return (
    <div className="gauge-bar">
      <div className="gauge-bar-top">
        <span className="gauge-bar-label">{label}</span>
        {trend && <span className="gauge-bar-trend" style={{ color: trendColor }}>{trend}</span>}
      </div>
      <div className="gauge-bar-val-row">
        <span className="gauge-bar-val" style={{ color }}>{val}</span>
        <span className="gauge-bar-unit">{unit}</span>
        {score != null && <span className="gauge-bar-score">{score}</span>}
      </div>
      <div className="gauge-bar-track">
        {zones.map((z, i) => (
          <span key={i} className="gauge-bar-zone" style={{ width: `${z.width}%`, background: z.color }} />
        ))}
        <span className="gauge-bar-marker" style={{ left: `${markerPct}%` }} />
      </div>
      {sublabel && <div className="gauge-bar-sublabel">{sublabel}</div>}
    </div>
  );
}
