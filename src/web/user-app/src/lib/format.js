// Date/number helpers, byte-for-byte the miniapp's (pages/main/main.js §Helpers) so both clients
// print the same strings.
export const MONTH_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function chronoAge(birthDate) {
  if (!birthDate) return null;
  return Math.floor((Date.now() - new Date(birthDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

export function fmtDate(d, lang) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d);
  const y = date.getFullYear(), m = date.getMonth() + 1, day = date.getDate();
  if (lang === 'zh') return `${y}年${m}月${day}日`;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[date.getMonth()]} ${day}, ${y}`;
}

export function localISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getWeekRange(offsetWeeks = 0) {
  const now = new Date();
  const dow = now.getDay();
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday + offsetWeeks * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { monday: localISODate(monday), sunday: localISODate(sunday) };
}

export function fmtWeekLabel(monday, sunday, lang) {
  const m = new Date(monday + 'T12:00:00Z');
  const s = new Date(sunday + 'T12:00:00Z');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (lang === 'zh') return `${m.getUTCMonth()+1}月${m.getUTCDate()}日 – ${s.getUTCMonth()+1}月${s.getUTCDate()}日`;
  return `${months[m.getUTCMonth()]} ${m.getUTCDate()} – ${months[s.getUTCMonth()]} ${s.getUTCDate()}`;
}

export function bioAgeColor(bio, chrono) {
  if (!bio || !chrono) return '#EEF2FF';
  const diff = Number(bio) - Number(chrono);
  if (diff > 2) return '#ef4444';
  if (diff < -2) return '#10b981';
  return '#f59e0b';
}

// main.js:_msgSeparator — a time label between two chat messages > 30 min apart.
export function msgSeparator(prevTs, ts, lang, gapMs = 30 * 60 * 1000) {
  if (!prevTs || !ts || ts - prevTs < gapMs) return '';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `${hh}:${mm}`;
  const md = lang === 'zh' ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getMonth() + 1}/${d.getDate()}`;
  return `${md} ${hh}:${mm}`;
}
