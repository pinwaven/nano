import React, { useMemo } from 'react';

const ZONE_DEFS = [
  { key: 'ResilienceAge',    short: 'Resilience',  shortZh: '抗压',  color: '#c084d4' },
  { key: 'CellularAge',      short: 'Cellular',    shortZh: '细胞',  color: '#10b981' },
  { key: 'MetabolicAge',     short: 'Metabolic',   shortZh: '代谢',  color: '#6375EC' },
  { key: 'MicroVascularAge', short: 'Micro-Vasc',  shortZh: '微血管', color: '#0ea5e9' },
];

function resolvedColor(base, score) {
  if (score >= 75) return base;
  if (score >= 50) return '#f97316';
  return '#ef4444';
}

function fillAlpha(score) {
  if (score >= 75) return 0.15;
  if (score >= 50) return 0.27;
  return 0.42;
}

export default function DigitalBodyFigure({ subAges = [], bioAge, chronoAge, isZh }) {
  const zoneMap = useMemo(
    () => Object.fromEntries(subAges.map(s => [s.key, s])),
    [subAges],
  );

  const getZ = key => {
    const meta = ZONE_DEFS.find(d => d.key === key);
    const sa = zoneMap[key];
    const score = sa?.score ?? 50;
    const color = sa ? resolvedColor(meta.color, score) : '#2a3550';
    return { color, alpha: sa ? fillAlpha(score) : 0.2, score, value: sa?.value ?? '—', pulse: !!sa && score < 65 };
  };

  const res = getZ('ResilienceAge');
  const cel = getZ('CellularAge');
  const met = getZ('MetabolicAge');
  const vas = getZ('MicroVascularAge');

  const bioNum = bioAge ? parseFloat(bioAge) : null;
  const bioColor = !bioNum ? '#64748b'
    : !chronoAge ? '#6375EC'
    : bioNum <= chronoAge ? '#10b981'
    : bioNum <= chronoAge + 5 ? '#f97316'
    : '#ef4444';

  const zp = z => ({
    fill: z.color,
    fillOpacity: z.alpha,
    stroke: z.color,
    strokeWidth: 1.2,
    strokeOpacity: 0.75,
    style: { filter: `drop-shadow(0 0 ${z.pulse ? 7 : 4}px ${z.color})` },
    className: z.pulse ? 'dt-zone-pulse' : undefined,
  });

  const chips = ZONE_DEFS.map(d => ({ ...d, z: getZ(d.key) }));

  return (
    <div className="dt-wrap">
      <div className="dt-halo" />
      <div className="dt-body">
        <svg viewBox="0 0 200 460" className="dt-svg" xmlns="http://www.w3.org/2000/svg">

          {/* ── Limbs (MicroVascular) — drawn first so torso overlaps ── */}
          <path d="M44,128 L22,140 C14,148 8,162 6,182 L2,268 C1,278 8,282 18,280 L38,274 C44,272 48,266 48,258 L52,208 L56,162 Z" {...zp(vas)} />
          <path d="M156,128 L178,140 C186,148 192,162 194,182 L198,268 C199,278 192,282 182,280 L162,274 C156,272 152,266 152,258 L148,208 L144,162 Z" {...zp(vas)} />
          <path d="M46,316 L100,316 L97,452 L50,452 Z" {...zp(vas)} />
          <path d="M100,316 L154,316 L150,452 L103,452 Z" {...zp(vas)} />

          {/* ── Abdomen (Metabolic) ── */}
          <path d="M42,208 L158,208 L154,290 L46,290 Z" {...zp(met)} />
          <path
            d="M46,290 L154,290 C156,300 156,312 154,316 L46,316 C44,312 44,300 46,290 Z"
            fill={met.color} fillOpacity={met.alpha * 0.6}
            stroke={met.color} strokeWidth={0.8} strokeOpacity={0.5}
          />

          {/* ── Chest (Cellular) ── */}
          <path d="M92,108 C80,110 66,116 54,124 L44,128 C38,132 36,144 38,164 L42,208 L158,208 L162,164 C164,144 162,132 156,128 L146,124 C134,116 120,110 108,108 Z" {...zp(cel)} />
          <circle
            cx="100" cy="162" r="4.5"
            fill={cel.color} fillOpacity={0.7}
            stroke={cel.color} strokeWidth={1} strokeOpacity={0.9}
            style={{ filter: `drop-shadow(0 0 5px ${cel.color})` }}
          />

          {/* ── Head (Resilience) ── */}
          <path
            d="M90,88 L110,88 L108,108 L92,108 Z"
            fill={res.color} fillOpacity={res.alpha * 0.65}
            stroke={res.color} strokeWidth={0.8} strokeOpacity={0.5}
          />
          <ellipse cx="100" cy="50" rx="32" ry="40" {...zp(res)} />
          <ellipse
            cx="100" cy="50" rx="20" ry="26"
            fill="none" stroke={res.color} strokeWidth={0.5} strokeOpacity={0.3}
          />

          {/* Spine hint */}
          <line
            x1="100" y1="88" x2="100" y2="290"
            stroke="#fff" strokeWidth={0.4} strokeOpacity={0.1} strokeDasharray="4,5"
          />
        </svg>

        {/* Zone chips */}
        <div className="dt-chips">
          {chips.map(({ key, short, shortZh, z }) => (
            <div key={key} className="dt-chip" style={{ borderColor: z.color + '55', color: z.color }}>
              <span className="dt-chip-val">{z.value}</span>
              <span className="dt-chip-lbl">{isZh ? shortZh : short}</span>
            </div>
          ))}
        </div>
      </div>

      {bioNum && (
        <div className="dt-footer">
          <span className="dt-bio-num" style={{ color: bioColor }}>{bioNum.toFixed(1)}</span>
          <span className="dt-bio-label">{isZh ? '生理年龄' : 'Bio Age'}</span>
          {chronoAge && <span className="dt-chrono">{isZh ? `实际年龄 ${chronoAge}` : `vs ${chronoAge} chrono`}</span>}
        </div>
      )}
    </div>
  );
}
