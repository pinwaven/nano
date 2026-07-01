export const BM_META = [
  { key: 'hsCRP',     unit: 'mg/L',      color: '#ef4444' },
  { key: 'GDF15',     unit: 'pg/mL',     color: '#f97316' },
  { key: 'IL6',       unit: 'pg/mL',     color: '#a855f7' },
  { key: 'GA',        unit: '%',         color: '#6375EC' },
  { key: 'CystatinC', unit: 'mg/L',      color: '#0ea5e9' },
  { key: 'CD38',      unit: 'xBaseline', color: '#10b981' },
];

export function chronoAge(birthDate) {
  if (!birthDate) return null;
  return Math.floor((Date.now() - new Date(birthDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

export function fmtDate(d, lang) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export function fmtDateTime(d, lang) {
  if (!d) return '—';
  return new Date(d).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function bioAgeColor(bio, chrono) {
  if (!bio || !chrono) return 'var(--text)';
  const diff = Number(bio) - Number(chrono);
  if (diff > 2) return '#ef4444';
  if (diff < -2) return '#10b981';
  return '#f59e0b';
}

export const MONTH_ZH = ['一','二','三','四','五','六','七','八','九','十','十一','十二'];
export const MONTH_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
