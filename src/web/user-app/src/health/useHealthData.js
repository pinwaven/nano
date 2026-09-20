// The Digital Twin data layer — a port of components/user-health/user-health.js's loaders:
// _loadHealth (biomarkers → BioAge/sub-ages/trends/profile), _loadHealthTwin (+ lab series),
// _loadHealthReports, _loadUserFacts, _loadFoodSensitivity, _loadTwinReports, _loadMetricHistory,
// _loadRingDataFromServer and _loadWearableHintFromServer. Same endpoints, same derived shapes,
// so the JSX below can mirror user-health.wxml field for field.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, q } from '../api.js';
import {
  BM_META, SUB_AGE_META, SUB_AGE_KEYS, USER_UPLOADED_BP_SOURCES, TWIN_LAYER_KEYS, TWIN_LAYER_LABELS,
  chronoAge, fmtDate, bioAgeColor, _buildLabPanel, _reportTypeColor, _foodClassColor, _factCategoryColor,
  _sizeLabel, _sessionsFromEventData, _selectLastNight, _slotsToReadings, _fmtRealtimeReadings,
  _buildReadingLineCharts, _buildRingDisplayData, computeMood, resolveAvatarUrl,
} from './helpers.js';

const initial = () => ({
  bioLoading: true, twinLoading: true, reportsLoading: false,
  subAgeList: [], subAgeZ: {}, bmList: [], trendList: [], cAge: null, bAge: null, bAgeColor: '#A6C4E5',
  recordCount: 0, hasBm: false, bioAgeHistory: [], subAgeHistory: {},
  weightHistory: [], bmiHistory: [], healthConditionsList: [], hasConditionsData: false,
  rawHeight: null, rawWeight: null, rawBmi: null,
  hasTwinData: false, twinMetrics: [], twinBody: null, twinBodyBar: null, twinRaw: null, labSeries: {},
  labPanel: [], labPanelDate: '', labPanelAbnormal: 0, labPanelMeta: '', healthTags: [],
  healthReports: [], userFacts: [], userFactsLoaded: false,
  foodPanel: null, foodPositives: [], foodSummary: '',
  twinReports: [], twinReportLatest: null,
  stepsHistory: [], hrvHistory: [], stressHistory: [], bpHistory: [], glucoseHistory: [], latestBp: null, latestGlucose: null,
  ringData: null, wearableConnected: false, wearableServerHint: null, mood: null,
  ecgList: [], ecgLatest: null,
  docCount: 0, latestDocDate: null,
  twinLayers: [], twinLayersDone: 0,
});

export function useHealthData({ userId, user, lang, t, coachId = null, mode = 'self' }) {
  const [d, setD] = useState(initial);
  const patch = useCallback(p => setD(prev => ({ ...prev, ...(typeof p === 'function' ? p(prev) : p) })), []);
  const loadedAt = useRef(0);
  const isZh = (lang || 'zh') !== 'en';
  const dRef = useRef(d); dRef.current = d;

  // _recomputeTwinLayers — derived from whatever has loaded so far (§34).
  const recomputeTwinLayers = useCallback(() => setD(prev => {
    const labels = TWIN_LAYER_LABELS[isZh ? 'zh' : 'en'];
    const twin = prev.twinRaw || {};
    const cov = twin.data_coverage || {};
    const short = x => (x ? String(x).substring(0, 10).substring(5) : null);
    const newest = (...ds) => { const v = ds.filter(Boolean).map(x => String(x).substring(0, 10)).sort(); return v.length ? v[v.length - 1] : null; };
    const reports = prev.healthReports || [];
    const state = {
      precision: { has: prev.bAge != null, date: newest(twin.latest_kino_scan_at, (prev.bioAgeHistory || []).slice(-1)[0]?.date) },
      daily: { has: !!(cov.sleep || cov.activity || cov.vitals || cov.body_composition || prev.ringData), date: newest(cov.sleep, cov.activity, cov.vitals, cov.body_composition) },
      medical: {
        has: reports.length > 0 || !!cov.lab_result || !!cov.epigenetic_result || !!twin.latest_lab_date || (prev.docCount || 0) > 0,
        date: newest(twin.latest_lab_date, cov.lab_result, cov.epigenetic_result, reports[0] && reports[0].report_date_raw, prev.latestDocDate),
      },
      profile: { has: prev.rawHeight != null && prev.rawWeight != null, date: null },
    };
    const twinLayers = TWIN_LAYER_KEYS.map(key => ({ key, label: labels[key], hasData: state[key].has, lastDate: state[key].has ? short(state[key].date) : null, emptyLabel: t.twinLayerEmpty }));
    return { ...prev, twinLayers, twinLayersDone: twinLayers.filter(l => l.hasData).length };
  }), [isZh, t]);

  const loadHealthTwin = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.get(`/health-twin?openid=${q(userId)}`);
      const twin = res?.twin;
      if (!twin) { patch({ hasTwinData: false, twinLoading: false }); recomputeTwinLayers(); return; }
      const trendIcon = v => v === 'improving' ? '↑' : v === 'declining' ? '↓' : v === 'stable' ? '→' : '';
      const trendColor = v => v === 'improving' ? '#10b981' : v === 'declining' ? '#ef4444' : 'rgba(166,196,229,0.35)';
      const metrics = [];
      const td = twin.trend_data || {};
      if (twin.avg_sleep_hours != null) metrics.push({ key: 'sleep', label: isZh ? '睡眠' : 'Sleep', val: twin.avg_sleep_hours.toFixed(1), unit: 'h', sub: twin.avg_sleep_score != null ? `${t.dtSleepScore} ${Math.round(twin.avg_sleep_score)}` : t.dtSevenDay, trend: trendIcon(td.sleep_trend), trendColor: trendColor(td.sleep_trend), color: '#6375EC' });
      if (twin.avg_hrv_ms != null) metrics.push({ key: 'hrv', label: 'HRV', val: Math.round(twin.avg_hrv_ms).toString(), unit: 'ms', sub: t.dtSevenDay, trend: trendIcon(td.hrv_trend), trendColor: trendColor(td.hrv_trend), color: '#10b981' });
      if (twin.avg_daily_steps != null) metrics.push({ key: 'steps', label: isZh ? '步数' : 'Steps', val: twin.avg_daily_steps.toLocaleString(), unit: '', sub: t.dtSevenDay, trend: '', trendColor: '', color: '#0ea5e9' });
      if (twin.avg_resting_hr != null) metrics.push({ key: 'hr', label: isZh ? '心率' : 'Resting HR', val: Math.round(twin.avg_resting_hr).toString(), unit: 'bpm', sub: t.dtResting, trend: '', trendColor: '', color: '#f97316' });
      if (twin.avg_spo2 != null && metrics.length < 4) metrics.push({ key: 'spo2', label: 'SpO₂', val: twin.avg_spo2.toFixed(1), unit: '%', sub: t.dtSevenDay, trend: '', trendColor: '', color: '#a855f7' });
      const bodyParts = [];
      if (twin.latest_weight_kg != null) bodyParts.push(`${twin.latest_weight_kg} kg`);
      if (twin.latest_bmi != null) bodyParts.push(`BMI ${Number(twin.latest_bmi).toFixed(1)}`);
      if (twin.latest_body_fat_pct != null) bodyParts.push(`${t.dtFat} ${Number(twin.latest_body_fat_pct).toFixed(1)}%`);
      const twinBody = bodyParts.length ? bodyParts.join('  ·  ') : null;
      let labSeries = {};
      try {
        const sres = await api.get(`/lab-history?openid=${q(userId)}&series=1${coachId ? `&coach_id=${q(coachId)}` : ''}`);
        labSeries = sres?.series || {};
      } catch { labSeries = {}; }
      const { labPanel, labPanelDate, labPanelAbnormal, labPanelMeta } = _buildLabPanel(twin, lang, labSeries);
      const healthTags = (twin.tags || []).map(tag => ({ ...tag, label: isZh ? tag.labelZh : tag.labelEn }));
      let twinBodyBar = null;
      if (twin.latest_body_fat_pct != null) { const fat = Math.min(60, Math.max(5, Math.round(twin.latest_body_fat_pct))); twinBodyBar = { fatPct: fat, leanPct: 100 - fat }; }
      patch(prev => ({
        twinLoading: false,
        hasTwinData: !prev.ringData ? (metrics.length > 0 || twinBody != null || labPanel.length > 0) : prev.hasTwinData,
        twinMetrics: metrics, twinBody, twinRaw: twin, labSeries, labPanelMeta, labPanel, labPanelDate, labPanelAbnormal, healthTags,
        ...(prev.ringData ? {} : { twinBodyBar }),
      }));
      recomputeTwinLayers();
    } catch {
      patch({ hasTwinData: false, twinLoading: false });
      recomputeTwinLayers();
    }
  }, [userId, coachId, lang, isZh, t, patch, recomputeTwinLayers]);

  const loadHealthReports = useCallback(async () => {
    if (!userId) return;
    patch({ reportsLoading: true });
    try {
      const res = await api.get(`/health-reports?openid=${q(userId)}`);
      const reports = (res?.reports || []).map(r => ({
        id: r.id, institution: r.institution || '—', report_date: fmtDate(r.report_date, lang), report_date_raw: r.report_date,
        report_type: t.reportTypeLabels[r.report_type] || r.report_type, source_label: t.reportSourceLabels[r.source] || r.source,
        type_color: _reportTypeColor(r.report_type), image_url: r.image_url || '',
        item_count: r.item_count || 0, items_label: r.item_count ? t.rptItemsCount.replace('{n}', String(r.item_count)) : '',
      }));
      patch({ healthReports: reports, reportsLoading: false });
      recomputeTwinLayers();
    } catch { patch({ reportsLoading: false }); }
  }, [userId, lang, t, patch, recomputeTwinLayers]);

  const loadUserFacts = useCallback(async () => {
    if (!userId || mode !== 'self') return;
    try {
      const res = await api.get(`/user-facts?openid=${q(userId)}`);
      const facts = (res?.facts || []).filter(f => f.status === 'active').map(f => ({
        id: f.id, fact: f.fact_zh, category: f.category, categoryLabel: t.factCategories[f.category] || t.factCategories.other, color: _factCategoryColor(f.category),
      }));
      patch({ userFacts: facts, userFactsLoaded: true });
    } catch { patch({ userFactsLoaded: true }); }
  }, [userId, mode, t, patch]);

  const loadFoodSensitivity = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.get(`/food-sensitivity?openid=${q(userId)}${mode === 'coach' && coachId ? `&coach_id=${q(coachId)}` : ''}`);
      const panel = res?.panel || null;
      if (!panel) { patch({ foodPanel: null, foodPositives: [], foodSummary: '' }); return; }
      const today = new Date().toISOString().slice(0, 10);
      const positives = (res?.foods || []).filter(f => f.class >= 1).map(f => {
        const passed = f.avoid_until && f.avoid_until < today;
        return {
          food_key: f.food_key, name: isZh ? f.name_zh : (f.name_en || f.name_zh), classLabel: t.foodClass[f.class] || '', color: _foodClassColor(f.class),
          valueText: f.below_detection ? t.foodBelowDetection : (f.value == null ? '' : `${f.value} ${panel.unit}`),
          windowText: !f.avoid_until ? '' : (passed ? t.foodWindowPassed.replace('{d}', f.avoid_until) : t.foodAvoidUntil.replace('{d}', f.avoid_until)),
          substitutes: (f.substitutes_zh || []).join('、'),
        };
      });
      const summary = positives.length === 0 ? t.foodSummaryNone.replace('{n}', panel.foods_tested) : t.foodSummarySome.replace('{n}', panel.foods_tested).replace('{k}', positives.length);
      patch({ foodPanel: panel, foodPositives: positives, foodSummary: summary });
    } catch { patch({ foodPanel: null, foodPositives: [], foodSummary: '' }); }
  }, [userId, mode, coachId, isZh, t, patch]);

  const loadTwinReports = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.get(`/twin-reports?openid=${q(userId)}${coachId ? `&coach_id=${q(coachId)}` : ''}`);
      if (!res?.success) return;
      const reports = (res.reports || []).map(r => {
        const pdf = (r.files || []).find(f => f.ext === 'pdf');
        const parts = [r.completed_date, pdf && pdf.size_bytes ? _sizeLabel(pdf.size_bytes) : '', pdf ? 'PDF' : (r.files?.[0]?.ext || '').toUpperCase()].filter(Boolean);
        return { ...r, metaLine: parts.join(' · ') };
      });
      patch({ twinReports: reports, twinReportLatest: reports[0] || null });
    } catch { /* card stays hidden */ }
  }, [userId, coachId, patch]);

  const loadMetricHistory = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.get(`/health-events?openid=${q(userId)}&limit=60`);
      const events = res?.events || [];
      const seen = { steps: new Set(), hrv: new Set(), stress: new Set(), bp: new Set(), glucose: new Set() };
      const stepsHistory = [], hrvHistory = [], stressHistory = [], bpHistory = [], glucoseHistory = [];
      for (const ev of events) {
        const date = (ev.data_date || '').substring(0, 10);
        if (!date) continue;
        const x = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
        if (ev.category === 'activity' && !seen.steps.has(date) && x?.steps != null) { stepsHistory.push({ date, steps: x.steps }); seen.steps.add(date); }
        else if (ev.category === 'vitals') {
          if (!seen.hrv.has(date) && x?.hrv_ms != null) { hrvHistory.push({ date, hrv: x.hrv_ms }); seen.hrv.add(date); }
          if (!seen.stress.has(date) && x?.stress != null) { stressHistory.push({ date, stress: x.stress }); seen.stress.add(date); }
          if (!seen.bp.has(date) && USER_UPLOADED_BP_SOURCES.has(ev.source) && x?.bp_systolic != null && x?.bp_diastolic != null) { bpHistory.push({ date, systolic: x.bp_systolic, diastolic: x.bp_diastolic, pulse: x.bp_pulse || null }); seen.bp.add(date); }
          if (!seen.glucose.has(date) && x?.glucose_mmol != null) { glucoseHistory.push({ date, glucose: x.glucose_mmol }); seen.glucose.add(date); }
        }
      }
      const bpRev = bpHistory.reverse(), glRev = glucoseHistory.reverse();
      patch({ stepsHistory: stepsHistory.reverse(), hrvHistory: hrvHistory.reverse(), stressHistory: stressHistory.reverse(), bpHistory: bpRev, latestBp: bpRev.length ? bpRev[bpRev.length - 1] : null, glucoseHistory: glRev, latestGlucose: glRev.length ? glRev[glRev.length - 1] : null });
    } catch { /* non-critical */ }
  }, [userId, patch]);

  const loadWearableHint = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.get(`/users/${q(userId)}`);
      const u = res?.user;
      if (u?.wearable_brand) patch({ wearableServerHint: { brand: u.wearable_brand, mac: u.wearable_mac || null, name: u.wearable_name || null, boundAt: u.wearable_bound_at || null } });
      else patch({ wearableServerHint: null });
    } catch { /* ignore */ }
  }, [userId, patch]);

  // 心电节律 summaries (V8 band; twin layer 2). Read-only on the web — recording needs BLE.
  const loadEcg = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.get(`/ecg?openid=${q(userId)}&limit=10${mode === 'coach' && coachId ? `&coach_id=${q(coachId)}` : ''}`);
      const items = res?.success && Array.isArray(res.items) ? res.items : [];
      patch({ ecgList: items, ecgLatest: items[0] || null });
    } catch { /* the card shows its empty state */ }
  }, [userId, mode, coachId, patch]);

  // _loadRingDataFromServer — the server is the single source of truth for ring charts.
  const loadRingData = useCallback(async () => {
    if (!userId) return;
    try {
      const [vitalsRes, activityRes, sleepRes] = await Promise.all([
        api.get(`/health-events?openid=${q(userId)}&category=vitals&limit=1000`),
        api.get(`/health-events?openid=${q(userId)}&category=activity&limit=14`),
        api.get(`/health-events?openid=${q(userId)}&category=sleep&limit=14`),
      ]);
      const vitalsEvents = vitalsRes?.events || [], activityEvents = activityRes?.events || [], sleepEvents = sleepRes?.events || [];
      if (!vitalsEvents.length && !activityEvents.length && !sleepEvents.length) { patch({ twinLoading: false }); return; }
      const _pd = data => (typeof data === 'string' ? JSON.parse(data) : (data || {}));
      const _tsFromExtId = extId => { const ts = (extId || '').split('_').pop(); if (!ts || !/^\d{14}$/.test(ts)) return null; return `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)} ${ts.slice(8,10)}:${ts.slice(10,12)}:${ts.slice(12,14)}`; };
      let latestIngestedMs = 0;
      for (const ev of [...vitalsEvents, ...activityEvents, ...sleepEvents]) { const tm = ev.ingested_at ? new Date(ev.ingested_at).getTime() : 0; if (tm > latestIngestedMs) latestIngestedMs = tm; }
      const rawRing = { syncedAt: latestIngestedMs || Date.now() };
      const actEv = activityEvents[0];
      if (actEv) { const x = _pd(actEv.data); rawRing.steps = x.steps ?? null; rawRing.calories = x.calories ?? null; rawRing.distance = x.distance_m ?? null; rawRing.stepSlots = x.slots ?? null; }
      rawRing.sleepHistory = sleepEvents.flatMap(ev => _sessionsFromEventData((ev.data_date || '').substring(0, 10), _pd(ev.data))).filter(s => s.totalMinutes > 0).sort((a, b) => ((a.onset || a.date) < (b.onset || b.date) ? -1 : 1));
      const lastNight = _selectLastNight(rawRing.sleepHistory);
      if (lastNight) Object.assign(rawRing, { sleepMinutes: lastNight.totalMinutes ?? null, sleepDeep: lastNight.deep ?? null, sleepLight: lastNight.light ?? null, sleepRem: lastNight.rem ?? null, sleepAwake: lastNight.awake ?? null, sleepStart: lastNight.sleepStart ?? null, sleepEnd: lastNight.sleepEnd ?? null, sleepSlots: lastNight.slots ?? null, sleepOnset: lastNight.onset ?? null, sleepDate: lastNight.date ?? null });
      const hrvSlots = [], spo2Slots = [];
      let latestHrv = null, latestSpo2 = null;
      for (const ev of vitalsEvents) {
        const x = _pd(ev.data); const extId = ev.external_id || '';
        if (extId.includes('_resting_hr_')) { if (rawRing.restingHr == null) { rawRing.restingHr = x.resting_hr ?? null; if (x.hr_slots) rawRing.hrSlots = x.hr_slots; } }
        else if (extId.includes('_hrv_')) { const ts = _tsFromExtId(extId); if (ts) hrvSlots.push({ timestamp: ts, hrv: x.hrv_ms ?? null, stress: x.stress ?? null, breath: x.breath_rate ?? null, heartRate: x.heart_rate_hrv ?? null, highBP: x.bp_systolic ?? null, lowBP: x.bp_diastolic ?? null }); if (!latestHrv) latestHrv = x; }
        else if (extId.includes('_spo2_')) { const ts = _tsFromExtId(extId); if (ts) spo2Slots.push({ timestamp: ts, spo2: x.spo2 ?? null }); if (!latestSpo2 && x.spo2 != null) latestSpo2 = x; }
        else if (extId.includes('_temp_')) { if (rawRing.bodyTempC == null && x.body_temp_c != null) rawRing.bodyTempC = x.body_temp_c; }
        else if (extId.includes('_realtime_')) { if (!latestHrv) latestHrv = x; if (!latestSpo2 && x.spo2 != null) latestSpo2 = x; }
      }
      if (hrvSlots.length) rawRing.hrvSlots = hrvSlots.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
      if (spo2Slots.length) rawRing.spo2Slots = spo2Slots.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
      if (latestHrv) Object.assign(rawRing, { hrv: latestHrv.hrv_ms ?? null, stress: latestHrv.stress ?? null, breathRate: latestHrv.breath_rate ?? null, systolicBP: latestHrv.bp_systolic ?? null, diastolicBP: latestHrv.bp_diastolic ?? null });
      if (latestSpo2) rawRing.spo2 = latestSpo2.spo2;
      const rawReads = rawRing.hrvSlots?.length ? _slotsToReadings(rawRing.hrvSlots, rawRing.spo2Slots) : [];
      const realtimeReadings = _fmtRealtimeReadings(rawReads);
      const charts = _buildReadingLineCharts(rawReads);
      const base = _buildRingDisplayData(rawRing, isZh);
      const ringData = { ...base, realtimeReadings, hasRealtimeReadings: realtimeReadings.length > 0, ...charts, hasSlotCharts: base.hasSlotCharts || charts.hrvChart.hasData || charts.spo2Chart.hasData || charts.stressChart.hasData };
      patch({ wearableConnected: (Date.now() - rawRing.syncedAt) < 24 * 60 * 60 * 1000, ringData, mood: computeMood(ringData), twinLoading: false, hasTwinData: true });
      recomputeTwinLayers();
    } catch { /* ignore */ }
  }, [userId, isZh, patch, recomputeTwinLayers]);

  // _loadHealth — the biomarker-driven half plus the fan-out.
  const loadHealth = useCallback(async () => {
    if (!userId) return;
    loadedAt.current = Date.now();
    patch({ bioLoading: true });
    loadHealthTwin(); loadHealthReports(); loadUserFacts(); loadFoodSensitivity(); loadTwinReports(); loadMetricHistory(); loadWearableHint(); loadRingData(); loadEcg();
    try {
      const res = await api.get(`/biomarkers?openid=${q(userId)}`);
      const records = res?.records || [];
      const kinoRecords = records.filter(r => r.test_type === 'kino_chip');
      const latestAnalyzed = [...kinoRecords].reverse().find(r => r.data?.validated) || null;
      const latestBm = latestAnalyzed?.data?.validated || null;
      const subAgesRaw = latestAnalyzed?.data?.bioage_profile?.SubAges || null;
      const bmList = BM_META.map(({ key, unit, color }) => ({ key, label: t.bmLabels[key], unit, color, value: latestBm?.[key] != null ? latestBm[key] : null }));
      const trendList = BM_META.map(({ key, unit, color }) => {
        const allVals = kinoRecords.slice(-10).map(r => r.data?.validated?.[key] ?? null);
        const defined = allVals.filter(v => v != null);
        const min = defined.length ? Math.min(...defined) : 0, max = defined.length ? Math.max(...defined) : 1;
        const range = max - min || 1;
        const sparkBars = allVals.map(v => (v != null ? { h: Math.round(6 + ((v - min) / range) * 26), color, empty: false } : { h: 6, color, empty: true }));
        return { key, label: t.bmLabels[key], unit, color, lastVal: defined[defined.length - 1] ?? null, sparkBars };
      });
      const cAge = user ? chronoAge(user.birth_date) : null;
      const subAgeList = subAgesRaw ? SUB_AGE_META.map(({ key, color }) => {
        const rawVal = subAgesRaw[key];
        const score = rawVal != null && cAge != null ? Math.max(5, Math.min(95, Math.round((cAge + 15 - rawVal) / 30 * 100))) : 50;
        return { key, label: t.subAgeLabels[key], color, value: rawVal != null ? rawVal.toFixed(1) : '—', score };
      }) : [];
      const baDateMap = new Map();
      kinoRecords.forEach(r => { if (r.bio_age != null) baDateMap.set((r.tested_at || '').substring(0, 10), r); });
      const bioAgeHistory = [...baDateMap.values()].sort((a, b) => (a.tested_at < b.tested_at ? -1 : 1)).map(r => ({ date: (r.tested_at || '').substring(0, 10), bioAge: Number(r.bio_age), chronoAge: r.data?.bioage_profile?.ChronoAge ?? null }));
      const subAgeHistory = {};
      for (const key of SUB_AGE_KEYS) subAgeHistory[key] = [...baDateMap.values()].filter(r => r.data?.bioage_profile?.SubAges?.[key] != null).sort((a, b) => (a.tested_at < b.tested_at ? -1 : 1)).map(r => ({ date: (r.tested_at || '').substring(0, 10), value: Number(r.data.bioage_profile.SubAges[key]) }));
      const rawBioAge = latestAnalyzed?.bio_age ?? (kinoRecords.length > 0 ? kinoRecords[kinoRecords.length - 1]?.bio_age : null) ?? user?.bio_age;
      const bAge = rawBioAge ? Number(rawBioAge).toFixed(1) : null;
      const slMap = {}; subAgeList.forEach(s => { slMap[s.key] = s; });
      const subAgeZ = {};
      for (const { key } of SUB_AGE_META) {
        const sa = slMap[key]; const score = sa?.score ?? 50;
        const color = !sa ? '#2a3550' : score >= 60 ? '#10b981' : score >= 35 ? '#6375EC' : '#f97316';
        const alpha = !sa ? 0.2 : score >= 60 ? 0.16 : score >= 35 ? 0.22 : 0.35;
        const n = parseInt(color.slice(1), 16);
        subAgeZ[key] = { color, fill: `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`, glow: score < 35 ? 7 : 3, pulse: !!sa };
      }
      const newData = { bioLoading: false, subAgeList, subAgeZ, bmList, trendList, cAge, bAge, bAgeColor: bioAgeColor(rawBioAge, cAge), recordCount: kinoRecords.length, hasBm: latestBm !== null, bioAgeHistory, subAgeHistory };
      if (user) {
        const bodyRecords = records.filter(r => r.test_type === 'body_composition').slice().reverse();
        const heightVal = bodyRecords.find(r => r.data?.actual?.height != null)?.data?.actual?.height ?? user.bio_data?.height ?? null;
        const weightVal = bodyRecords.find(r => r.data?.actual?.weight != null)?.data?.actual?.weight ?? user.bio_data?.weight ?? null;
        const weightHistory = records.filter(r => r.test_type === 'body_composition' && r.data?.actual?.weight != null).map(r => ({ date: (r.tested_at || '').substring(0, 10), weight: r.data.actual.weight }));
        const bmiVal = heightVal != null && weightVal != null && heightVal > 0 ? (weightVal / Math.pow(heightVal / 100, 2)).toFixed(1) : null;
        const bmiHistory = heightVal != null && heightVal > 0 ? weightHistory.map(r => ({ date: r.date, bmi: parseFloat((r.weight / Math.pow(heightVal / 100, 2)).toFixed(1)) })) : [];
        const condKeys = user.bio_data?.health_conditions ?? null;
        const otherText = user.bio_data?.health_conditions_other || '';
        const healthConditionsList = condKeys !== null ? condKeys.map(key => ({ key, label: key === 'other' && otherText ? `${t.conditionLabels[key]}（${otherText}）` : (t.conditionLabels[key] || key) })) : [];
        Object.assign(newData, { weightHistory, bmiHistory, healthConditionsList, hasConditionsData: condKeys !== null, rawHeight: heightVal, rawWeight: weightVal, rawBmi: bmiVal });
      }
      patch(newData);
      recomputeTwinLayers();
    } catch { patch({ bioLoading: false }); }
  }, [userId, user, t, patch, loadHealthTwin, loadHealthReports, loadUserFacts, loadFoodSensitivity, loadTwinReports, loadMetricHistory, loadWearableHint, loadRingData, loadEcg, recomputeTwinLayers]);

  const refreshIfStale = useCallback((maxAgeMs = 30000) => {
    if (!userId || dRef.current.bioLoading) return;
    if (loadedAt.current && Date.now() - loadedAt.current < maxAgeMs) return;
    loadHealth();
  }, [userId, loadHealth]);

  const onDocsLoaded = useCallback(({ count = 0, latestDate = null } = {}) => { patch({ docCount: count, latestDocDate: latestDate }); recomputeTwinLayers(); }, [patch, recomputeTwinLayers]);

  useEffect(() => { setD(initial()); if (userId) loadHealth(); }, [userId, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const avatarDisplayUrl = user?.avatar_character ? (resolveAvatarUrl(user.avatar_character, d.mood, user.avatar_moods) || '') : '';

  return { d, patch, loadHealth, refreshIfStale, loadHealthReports, loadUserFacts, onDocsLoaded, avatarDisplayUrl, recomputeTwinLayers };
}
