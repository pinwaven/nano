import { useState, useEffect } from 'react';
import axios from 'axios';
import { useLang } from '../i18n.js';
import { MONTH_EN } from '../utils.js';

const API = '/api';

function parsePlan(text) {
  if (!text) return [];
  return text.trim().split('\n').filter(Boolean).map(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return null;
    const dateText = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();
    const morningMatch = rest.match(/(?:早上|Morning)\s+((?:D\d{2}x\d+\s*)+)/i);
    const eveningMatch = rest.match(/(?:晚上|Evening)\s+((?:D\d{2}x\d+\s*)+)/i);
    const parseDots = str => str
      ? [...str.matchAll(/D(\d{2})x(\d+)/g)].map(m => ({ key: `D${m[1]}`, dotKey: `DOT${m[1]}`, count: parseInt(m[2]) }))
      : [];
    const zhDate = dateText.match(/(\d+)月(\d+)日/);
    const enDate = dateText.match(/(\w+)\s+(\d+)/);
    let month = null, day = null;
    if (zhDate) { month = parseInt(zhDate[1]); day = parseInt(zhDate[2]); }
    else if (enDate) {
      const mi = MONTH_EN.findIndex(m => enDate[1].toLowerCase().startsWith(m.toLowerCase().slice(0, 3)));
      if (mi !== -1) { month = mi + 1; day = parseInt(enDate[2]); }
    }
    return { dateText, month, day, morning: parseDots(morningMatch?.[1]), evening: parseDots(eveningMatch?.[1]) };
  }).filter(Boolean);
}

function DotChip({ dotKey, count, dotsMap }) {
  const dot = dotsMap[dotKey];
  const color = dot?.color || '#6375EC';
  const label = dot?.name_zh || dot?.name || dotKey;
  return (
    <div className="dot-chip" title={label}>
      <span className="dot-chip-swatch" style={{ background: color }} />
      <span className="dot-chip-key">{dotKey.replace('DOT', 'D')}</span>
      <span className="dot-chip-count">×{count}</span>
    </div>
  );
}

export default function DotsTab({ user }) {
  const { t } = useLang();
  const [plan, setPlan] = useState(null);
  const [days, setDays] = useState([]);
  const [dotsMap, setDotsMap] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.user_id) return;
    (async () => {
      try {
        const r = await axios.get(`${API}/nutrition-plan?openid=${encodeURIComponent(user.user_id)}`);
        const dotMap = {};
        (r.data.dots || []).forEach(d => { dotMap[d.key_name] = d; });
        setDotsMap(dotMap);
        setPlan(r.data.plan);
        setDays(parsePlan(r.data.plan));
      } catch { /* silent */ } finally { setLoading(false); }
    })();
  }, [user?.user_id]);

  const now = new Date();
  const todayM = now.getMonth() + 1;
  const todayD = now.getDate();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowM = tomorrow.getMonth() + 1;
  const tomorrowD = tomorrow.getDate();

  const dayLabel = d => {
    if (d.month === todayM && d.day === todayD) return t.today;
    if (d.month === tomorrowM && d.day === tomorrowD) return t.tomorrow;
    return d.dateText;
  };

  return (
    <div className="dots-tab">
      <div className="dots-header">
        <span className="dots-title">{t.dotsTitle}</span>
      </div>
      {loading ? (
        <div className="dots-empty">
          <span className="dots-loading-dot" /><span className="dots-loading-dot" /><span className="dots-loading-dot" />
        </div>
      ) : !plan ? (
        <div className="dots-empty">{t.noPlan}</div>
      ) : (
        <div className="dots-days">
          {days.map((d, i) => {
            const isToday = d.month === todayM && d.day === todayD;
            return (
              <div key={i} className={`dots-day-card${isToday ? ' is-today' : ''}`}>
                <div className="dots-day-label">{dayLabel(d)}</div>
                {d.morning.length > 0 && (
                  <div className="dots-slot">
                    <span className="dots-slot-name">{t.morning}</span>
                    <div className="dots-chips">
                      {d.morning.map(dc => <DotChip key={dc.key} dotKey={dc.dotKey} count={dc.count} dotsMap={dotsMap} />)}
                    </div>
                  </div>
                )}
                {d.evening.length > 0 && (
                  <div className="dots-slot">
                    <span className="dots-slot-name">{t.evening}</span>
                    <div className="dots-chips">
                      {d.evening.map(dc => <DotChip key={dc.key} dotKey={dc.dotKey} count={dc.count} dotsMap={dotsMap} />)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
