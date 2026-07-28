import { fmtDate } from '../utils.js';

export default function LineChart({ series, lang, width = 300, height = 120 }) {
  const allValues = series.flatMap(s => s.points.map(p => p.value)).filter(v => v != null);
  if (allValues.length === 0) return null;

  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const padY = 10;
  const chartH = height - padY * 2;

  const xy = (points, i) => {
    const n = points.length;
    const x = n > 1 ? (i / (n - 1)) * width : width / 2;
    const y = padY + chartH - ((points[i].value - min) / range) * chartH;
    return [x, y];
  };

  const toPolyline = points => points.map((_, i) => xy(points, i).join(',')).join(' ');
  const longest = series.reduce((a, b) => (a.points.length > b.points.length ? a : b));
  const first = longest.points[0];
  const last = longest.points[longest.points.length - 1];

  return (
    <div className="line-chart-wrap">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="line-chart">
        {[0, 0.5, 1].map(f => (
          <line key={f} x1="0" x2={width} y1={padY + chartH * f} y2={padY + chartH * f} className="line-chart-grid" />
        ))}
        {series.map((s, si) => (
          <polyline key={si} points={toPolyline(s.points)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {series.map((s, si) => s.points.map((p, i) => {
          const [x, y] = xy(s.points, i);
          return <circle key={`${si}-${i}`} cx={x} cy={y} r="2.5" fill={s.color} />;
        }))}
      </svg>
      {first && last && (
        <div className="line-chart-axis">
          <span>{fmtDate(first.date, lang)}</span>
          <span>{fmtDate(last.date, lang)}</span>
        </div>
      )}
    </div>
  );
}
