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

// ── Digital Twin scoring (ported from miniapp components/user-health/user-health.js) ──

export function scoreSleep(h) {
  if (h >= 7 && h <= 9) return Math.min(100, Math.round(80 + (h - 7) / 2 * 20));
  if (h > 9) return Math.max(50, Math.round(100 - (h - 9) * 25));
  if (h >= 6) return Math.round(50 + (h - 6) * 30);
  return Math.max(10, Math.round(h / 6 * 50));
}
export function scoreHrv(ms) {
  if (ms >= 80) return 100;
  if (ms >= 50) return Math.round(75 + (ms - 50) / 30 * 25);
  if (ms >= 30) return Math.round(45 + (ms - 30) / 20 * 30);
  return Math.max(10, Math.round(ms / 30 * 45));
}
export function scoreRestHr(bpm) {
  if (bpm <= 52) return 100;
  if (bpm <= 65) return Math.round(100 - (bpm - 52) / 13 * 20);
  if (bpm <= 75) return Math.round(80 - (bpm - 65) / 10 * 20);
  if (bpm <= 90) return Math.round(60 - (bpm - 75) / 15 * 30);
  return Math.max(5, Math.round(30 - (bpm - 90) / 30 * 25));
}
export function scoreSpo2(pct) {
  if (pct >= 98) return 100;
  if (pct >= 95) return Math.round(70 + (pct - 95) / 3 * 30);
  return Math.max(10, Math.round(30 + (pct - 90) / 5 * 40));
}
export function scoreSteps(steps) {
  if (steps >= 10000) return 100;
  if (steps >= 7500) return Math.round(75 + (steps - 7500) / 2500 * 25);
  if (steps >= 5000) return Math.round(50 + (steps - 5000) / 2500 * 25);
  return Math.max(5, Math.round(steps / 5000 * 50));
}
export function scoreBmi(bmi) {
  if (bmi >= 18.5 && bmi <= 24.9) return 100;
  if (bmi >= 25 && bmi <= 27.5) return Math.round(100 - (bmi - 24.9) / 2.6 * 30);
  if (bmi >= 17 && bmi < 18.5) return Math.round(70 + (bmi - 17) / 1.5 * 30);
  if (bmi > 27.5) return Math.max(10, Math.round(70 - (bmi - 27.5) / 10 * 60));
  return Math.max(10, Math.round(bmi / 17 * 70));
}
export function scoreBp(sys, dia) {
  if (sys == null || dia == null) return null;
  if (sys >= 140 || dia >= 90) return 20;
  if (sys >= 130 || dia >= 85) return 50;
  if (sys >= 120 || dia >= 80) return 75;
  if (sys < 85 || dia < 55) return 60;
  return 100;
}

export function buildTwinVisuals(twin, t, isZh) {
  const td = twin.trend_data || {};
  const trendIcon = v => v === 'improving' ? '↑' : v === 'declining' ? '↓' : v === 'stable' ? '→' : '';
  const trendColor = v => v === 'improving' ? '#10b981' : v === 'declining' ? '#ef4444' : 'rgba(166,196,229,0.35)';

  const domainScores = {};
  const vitalGauges = [];

  if (twin.avg_sleep_hours != null) {
    const h = twin.avg_sleep_hours;
    domainScores.sleep = scoreSleep(h);
    vitalGauges.push({
      key: 'sleep', label: isZh ? '睡眠时长' : 'Sleep',
      val: h.toFixed(1), unit: 'h',
      score: domainScores.sleep, color: '#6375EC',
      trend: trendIcon(td.sleep_trend), trendColor: trendColor(td.sleep_trend),
      markerPct: Math.min(97, Math.max(2, Math.round(h / 12 * 100))),
      zones: [{ width: 50, color: '#ef4444' }, { width: 8, color: '#f97316' }, { width: 17, color: '#10b981' }, { width: 8, color: '#f97316' }, { width: 17, color: '#ef4444' }],
      sublabel: isZh ? '最优: 7–9h' : 'Optimal: 7–9h',
    });
  }
  if (twin.avg_hrv_ms != null) {
    const ms = twin.avg_hrv_ms;
    domainScores.hrv = scoreHrv(ms);
    vitalGauges.push({
      key: 'hrv', label: 'HRV', val: Math.round(ms).toString(), unit: 'ms',
      score: domainScores.hrv, color: '#10b981',
      trend: trendIcon(td.hrv_trend), trendColor: trendColor(td.hrv_trend),
      markerPct: Math.min(97, Math.max(2, Math.round(ms))),
      zones: [{ width: 20, color: '#ef4444' }, { width: 20, color: '#f97316' }, { width: 30, color: '#10b981' }, { width: 30, color: '#0ea5e9' }],
      sublabel: isZh ? '越高越好' : 'Higher is better',
    });
  }
  if (twin.avg_resting_hr != null) {
    const bpm = twin.avg_resting_hr;
    domainScores.hr = scoreRestHr(bpm);
    vitalGauges.push({
      key: 'hr', label: isZh ? '静息心率' : 'Resting HR', val: Math.round(bpm).toString(), unit: 'bpm',
      score: domainScores.hr, color: '#f97316', trend: '', trendColor: '',
      markerPct: Math.min(97, Math.max(2, Math.round((bpm - 40) / 80 * 100))),
      zones: [{ width: 15, color: '#0ea5e9' }, { width: 16, color: '#10b981' }, { width: 13, color: '#10b981' }, { width: 19, color: '#f97316' }, { width: 37, color: '#ef4444' }],
      sublabel: isZh ? '最优: 50–65 bpm' : 'Optimal: 50–65 bpm',
    });
  }
  if (twin.avg_systolic_bp != null && twin.avg_diastolic_bp != null) {
    const sys = Math.round(twin.avg_systolic_bp);
    const dia = Math.round(twin.avg_diastolic_bp);
    domainScores.bp = scoreBp(sys, dia);
    vitalGauges.push({
      key: 'bp', label: isZh ? '血压' : 'Blood Pressure', val: `${sys}/${dia}`, unit: 'mmHg',
      score: domainScores.bp, color: '#ef4444', trend: '', trendColor: '',
      markerPct: Math.min(97, Math.max(2, Math.round((sys - 80) / 80 * 100))),
      zones: [{ width: 12, color: '#0ea5e9' }, { width: 38, color: '#10b981' }, { width: 12, color: '#f97316' }, { width: 13, color: '#ef4444' }, { width: 25, color: '#7f1d1d' }],
      sublabel: isZh ? '最优: <120/80' : 'Optimal: <120/80',
    });
  }
  if (twin.avg_spo2 != null) {
    const pct = twin.avg_spo2;
    domainScores.spo2 = scoreSpo2(pct);
    vitalGauges.push({
      key: 'spo2', label: 'SpO₂', val: pct.toFixed(1), unit: '%',
      score: domainScores.spo2, color: '#a855f7', trend: '', trendColor: '',
      markerPct: Math.min(97, Math.max(2, Math.round((pct - 90) / 10 * 100))),
      zones: [{ width: 50, color: '#ef4444' }, { width: 20, color: '#f97316' }, { width: 10, color: '#10b981' }, { width: 20, color: '#0ea5e9' }],
      sublabel: isZh ? '最优: ≥98%' : 'Optimal: ≥98%',
    });
  }
  if (twin.avg_daily_steps != null) {
    const steps = twin.avg_daily_steps;
    domainScores.steps = scoreSteps(steps);
    vitalGauges.push({
      key: 'steps', label: isZh ? '日均步数' : 'Daily Steps',
      val: steps >= 10000 ? `${(steps / 1000).toFixed(1)}k` : steps.toLocaleString(), unit: '',
      score: domainScores.steps, color: '#0ea5e9', trend: '', trendColor: '',
      markerPct: Math.min(97, Math.max(2, Math.round(steps / 12000 * 100))),
      zones: [{ width: 42, color: '#ef4444' }, { width: 21, color: '#f97316' }, { width: 21, color: '#10b981' }, { width: 16, color: '#0ea5e9' }],
      sublabel: isZh ? '目标: 7,500+ 步' : 'Goal: 7,500+ steps',
    });
  }
  if (twin.latest_bmi != null) domainScores.bmi = scoreBmi(twin.latest_bmi);

  const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  const healthDomains = [];
  const recoveryS = avg([domainScores.sleep, domainScores.hrv].filter(v => v != null));
  const cardioS   = avg([domainScores.hr, domainScores.spo2, domainScores.bp].filter(v => v != null));
  const activityS = avg([domainScores.steps].filter(v => v != null));
  const bodyS     = avg([domainScores.bmi].filter(v => v != null));

  if (recoveryS != null) healthDomains.push({ key: 'recovery', label: t.dtRecovery, score: recoveryS, color: '#6375EC' });
  if (cardioS   != null) healthDomains.push({ key: 'cardio',   label: t.dtCardio,   score: cardioS,   color: '#f97316' });
  if (activityS != null) healthDomains.push({ key: 'activity', label: t.dtActivity, score: activityS, color: '#0ea5e9' });
  if (bodyS     != null) healthDomains.push({ key: 'body',     label: t.dtBodyDomain, score: bodyS,  color: '#a855f7' });

  const allScores = [recoveryS, cardioS, activityS, bodyS].filter(v => v != null);
  const healthScore = allScores.length ? avg(allScores) : null;
  const healthScoreColor = healthScore == null ? '#A6C4E5'
    : healthScore >= 80 ? '#10b981'
    : healthScore >= 65 ? '#6375EC'
    : healthScore >= 50 ? '#f97316'
    : '#ef4444';
  const grades = t.healthScoreGrades;
  const healthScoreGrade = healthScore == null ? ''
    : healthScore >= 80 ? grades.optimal
    : healthScore >= 65 ? grades.good
    : healthScore >= 50 ? grades.fair
    : grades.low;

  let twinBodyBar = null;
  if (twin.latest_body_fat_pct != null) {
    const fat = Math.min(60, Math.max(5, Math.round(twin.latest_body_fat_pct)));
    twinBodyBar = { fatPct: fat, leanPct: 100 - fat };
  }

  return { healthScore, healthScoreColor, healthScoreGrade, healthDomains, vitalGauges, twinBodyBar };
}

// ── Lab panel (ported from miniapp components/user-health/user-health.js) ──

// ref ranges: [low, high, higherIsBetter]
export const BIO_REF = {
  hsCRP: [null, 1.0, false], IL6: [null, 3.0, false], GDF15: [null, 750, false],
  GA: [11.0, 15.0, false], CystatinC: [0.51, 0.95, false], HbA1c: [null, 5.7, false],
  FPG: [3.9, 6.1, false], Triglycerides: [null, 1.7, false],
  ALT: [null, 40, false], AST: [null, 40, false], GGT: [null, 50, false],
  TSH: [0.35, 4.5, false], TotalCholesterol: [null, 5.2, false],
  LDL: [null, 3.4, false], HDL: [1.0, null, true],
  Creatinine: [53, 115, false], eGFR: [90, null, true], BUN: [1.7, 8.3, false],
  UricAcid: [null, 416, false], CRP: [null, 10, false], VitaminD: [50, 150, false],
  WBC: [4.0, 10.0, false], Ferritin: [13, 150, false], Hemoglobin: [115, 175, false],
};

export const LEGACY_KEY_MAP = {
  ldl: 'LDL', hdl: 'HDL', alt: 'ALT', ast: 'AST', tsh: 'TSH',
  hba1c: 'HbA1c', ferritin: 'Ferritin', uric_acid: 'UricAcid',
  vitamin_d: 'VitaminD', creatinine: 'Creatinine',
  triglycerides: 'Triglycerides', glucose_fasting: 'FPG',
  total_cholesterol: 'TotalCholesterol', hsCRP: 'hsCRP', il6: 'IL6',
};

export const LAB_DISPLAY_NAME = {
  TotalCholesterol: 'Chol', MicroVascularAge: 'µVasc',
  total_cholesterol: 'Chol', uric_acid: 'UA', glucose_fasting: 'Gluc',
  vitamin_d: 'VitD', vitamin_b12: 'B12',
};

function bioStatus(keyName, value) {
  if (value == null || !keyName) return 'normal';
  const ref = BIO_REF[keyName];
  if (!ref) return 'normal';
  const [lo, hi, higherBetter] = ref;
  const v = parseFloat(value);
  if (higherBetter) return (lo != null && v < lo) ? 'low' : 'normal';
  if (hi != null && v > hi) return 'high';
  if (lo != null && v < lo) return 'low';
  return 'normal';
}

export function buildLabPanel(twin, lang) {
  const labData = twin.latest_lab_data;
  const labDate = twin.latest_lab_date;
  if (!labData || !labDate) return { labPanel: [], labPanelDate: '', labPanelAbnormal: 0 };

  const labPanelDate = fmtDate(labDate, lang || 'zh');
  const items = [];

  if (labData.markers) {
    for (const [key, info] of Object.entries(labData.markers)) {
      const v = parseFloat(info.value);
      const status = bioStatus(key, v);
      const statusColor = status === 'high' ? '#ef4444' : status === 'low' ? '#60a5fa' : '#10b981';
      items.push({ key, displayName: LAB_DISPLAY_NAME[key] || key, value: String(v), unit: info.unit || '', status, statusColor });
    }
  } else if (labData.results) {
    for (const [legacyKey, info] of Object.entries(labData.results)) {
      const catalogKey = LEGACY_KEY_MAP[legacyKey] || legacyKey;
      const v = parseFloat(info.value);
      let status = 'normal';
      if (info.ref_high != null && v > info.ref_high) status = 'high';
      else if (info.ref_low != null && v < info.ref_low) status = 'low';
      const statusColor = status === 'high' ? '#ef4444' : status === 'low' ? '#60a5fa' : '#10b981';
      const displayName = LAB_DISPLAY_NAME[legacyKey] || legacyKey.replace(/_/g, ' ');
      items.push({ key: legacyKey, displayName, value: String(v), unit: info.unit || '', status, statusColor });
    }
  }

  items.sort((a, b) => {
    const aAbn = a.status !== 'normal' ? 0 : 1;
    const bAbn = b.status !== 'normal' ? 0 : 1;
    return aAbn !== bAbn ? aAbn - bAbn : a.key.localeCompare(b.key);
  });

  const labPanelAbnormal = items.filter(i => i.status !== 'normal').length;
  return { labPanel: items, labPanelDate, labPanelAbnormal };
}

export const USER_UPLOADED_BP_SOURCES = new Set(['manual_photo']);
