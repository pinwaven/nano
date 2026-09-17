// The user's nutrition plan, packages and redeem codes — main.js:_loadDots and its mappers
// (parsePlan / mapStructuredSchedules / mapPackages / mapCodes / pkgTitle, lines 972–1180,
// 4241–4301). One store outside React because two surfaces read it: Plans ▸ Dots renders it and
// the chat's :::formula cards resolve their CTA from `packages` + `codes` (_formulaCtaFor).
// Subscribe with useDotsData(); loadDots() is cached for 30 s like _dotsLoadedAt.
import { useSyncExternalStore } from 'react';
import { api, q } from '../api.js';
import { fmtDate, localISODate, MONTH_EN } from '../lib/format.js';

const STALE_MS = 30_000;

const empty = () => ({
  loading: true, loadedAt: 0, hasPlan: false, allDays: [], packages: [], codes: [],
  hasPackageInFlight: false, hasProposedFormula: false, proposedDistinctDots: null, proposedTierWidths: null,
  dispenseSlot: 'morning_cup', dispenseSlotDots: [], dispenseDate: '', dispenseHasToday: false,
  planText: null, structured: null, dotsMap: {},
});

let state = empty();
const listeners = new Set();
const setState = patch => { state = { ...state, ...patch }; listeners.forEach(l => l()); };
const subscribe = l => { listeners.add(l); return () => listeners.delete(l); };
const getSnapshot = () => state;

export function useDotsData() { return useSyncExternalStore(subscribe, getSnapshot); }
export function getDotsState() { return state; }
export function invalidateDots() { setState({ loadedAt: 0 }); }
export function resetDots() { state = empty(); listeners.forEach(l => l()); }

export function pkgTitle(p, fallback) {
  const name = (p && p.package_name) || '';
  const tier = (p && p.tier_label) || '';
  return [name, tier].filter(Boolean).join(' · ') || fallback;
}

export function mapCodes(rawCodes, t, lang) {
  if (!Array.isArray(rawCodes) || !t) return [];
  return rawCodes.map((c, i) => {
    const bits = [];
    if (c.max_distinct_dots) bits.push(t.pkgTierUpTo(c.max_distinct_dots));
    if (c.sold_at) bits.push(t.codeSoldOn(fmtDate(c.sold_at, lang)));
    return {
      key: `${c.code}-${i}`, code: c.code, name: pkgTitle(c, t.codeUnnamed), meta: bits.join(' · '),
      max_distinct_dots: c.max_distinct_dots || null,
      fastTrack: c.fulfillment !== 'expert_review',
    };
  });
}

export function mapPackages(rawPackages, t, lang) {
  if (!Array.isArray(rawPackages) || !t) return [];
  return rawPackages.map((p, i) => {
    const name = pkgTitle(p, t.pkgUnnamed);
    const bits = [];
    if (p.stage === 'active' && p.day_index) bits.push(t.pkgDay(p.day_index, p.total_days));
    else {
      if (p.max_distinct_dots) bits.push(t.pkgTierUpTo(p.max_distinct_dots));
      if (p.ordered_at) bits.push(t.pkgOrderedOn(fmtDate(p.ordered_at, lang)));
    }
    return {
      key: `${p.order_id || 'p'}-${p.plan_id || 'o'}-${i}`,
      stage: p.stage, stageLabel: t['pkgStage_' + p.stage] || name, name, meta: bits.join(' · '),
      order_id: p.order_id || null, max_distinct_dots: p.max_distinct_dots || null, plan_id: p.plan_id || null,
      submit_plan_id: p.submit_plan_id || null, distinct_dots: p.distinct_dots || null,
      tier_widths: p.tier_widths || null,
      can_submit: !!p.can_submit, can_scan: !!p.can_scan, can_order: !!p.can_order, can_pay: !!p.can_pay,
      tracking_number: p.tracking_number || null,
      trackingLabel: [p.shipping_carrier, p.tracking_number, p.tracking_status_desc].filter(Boolean).join(' · '),
      inFlight: !['proposed', 'active', 'cancelled', 'refunded'].includes(p.stage),
    };
  });
}

export function parsePlan(text, dotsMap, lang, t) {
  if (!text) return [];
  const now = new Date();
  const todayM = now.getMonth() + 1, todayD = now.getDate();
  const tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tmrM = tmr.getMonth() + 1, tmrD = tmr.getDate();
  return text.trim().split('\n').filter(Boolean).map(line => {
    const ci = line.indexOf(':');
    if (ci === -1) return null;
    const dateText = line.slice(0, ci).trim();
    const rest = line.slice(ci + 1).trim();
    const mMatch = rest.match(/(?:早上|Morning)\s+((?:D\d{2}x\d+\s*)+)/i);
    const eMatch = rest.match(/(?:晚上|Evening)\s+((?:D\d{2}x\d+\s*)+)/i);
    const parseDots = str => !str ? [] : [...str.matchAll(/D(\d{2})x(\d+)/g)].map(m => {
      const dot = dotsMap[`DOT${m[1]}`] || {};
      return { displayKey: `D${m[1]}`, count: parseInt(m[2]), color: dot.color_hex || '#6375EC' };
    });
    const zhDate = dateText.match(/(\d+)月(\d+)日/);
    const enDate = dateText.match(/(\w+)\s+(\d+)/);
    let month = null, day = null;
    if (zhDate) { month = parseInt(zhDate[1]); day = parseInt(zhDate[2]); }
    else if (enDate) {
      const mi = MONTH_EN.findIndex(mn => enDate[1].toLowerCase().startsWith(mn.toLowerCase().slice(0, 3)));
      if (mi !== -1) { month = mi + 1; day = parseInt(enDate[2]); }
    }
    let label = dateText;
    if (month !== null && day !== null) {
      if (month === todayM && day === todayD) label = t.today;
      else if (month === tmrM && day === tmrD) label = t.tomorrow;
    }
    const dateStr = month !== null ? `${now.getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
    return { dateStr, label, isToday: month === todayM && day === todayD, morning: parseDots(mMatch?.[1]), evening: parseDots(eMatch?.[1]) };
  }).filter(Boolean);
}

export function mapStructuredSchedules(schedules, dotsMap, lang) {
  const dayGroups = {};
  const todayStr = localISODate(new Date());
  schedules.forEach(s => {
    const dateStr = typeof s.scheduled_date === 'string' ? s.scheduled_date.split('T')[0] : s.scheduled_date;
    if (!dayGroups[dateStr]) dayGroups[dateStr] = { dateStr, label: fmtDate(dateStr, lang), isToday: dateStr === todayStr, morning: [], evening: [] };
    const dots = s.recipe?.dots || {};
    const parsed = Object.entries(dots).map(([key, count]) => {
      const dot = dotsMap[key] || {};
      return { displayKey: key.replace('DOT', 'D'), count, color: dot.color_hex || '#6375EC' };
    });
    if (s.slot_name === 'morning_cup') dayGroups[dateStr].morning = parsed;
    else if (s.slot_name === 'evening_cup') dayGroups[dateStr].evening = parsed;
  });
  return Object.values(dayGroups).sort((a, b) => a.dateStr.localeCompare(b.dateStr));
}

export async function loadDots(user, lang, t, { force = false } = {}) {
  if (!user?.user_id) return state;
  if (!force && state.loadedAt && Date.now() - state.loadedAt < STALE_MS) return state;
  setState({ loading: !state.loadedAt, loadedAt: Date.now() });
  try {
    const res = await api.get(`/nutrition-plan?openid=${q(user.user_id)}`);
    const plan = res?.plan || null;
    const structured = res?.structured_plan || null;
    const schedules = res?.schedules || [];
    const dotsMap = {};
    (res?.dots || []).forEach(d => { dotsMap[d.key_name] = d; });
    let allDays = [];
    if (structured && schedules.length > 0) allDays = mapStructuredSchedules(schedules, dotsMap, lang);
    else if (plan) allDays = parsePlan(plan, dotsMap, lang, t);
    const todayDay = allDays.find(d => d.isToday) || null;
    const dispenseSlot = new Date().getHours() < 12 ? 'morning_cup' : 'evening_cup';
    const packages = mapPackages(res?.packages, t, lang);
    const codes = mapCodes(res?.codes, t, lang);
    const proposed = packages.find(p => p.stage === 'proposed');
    setState({
      loading: false, hasPlan: plan !== null || structured !== null, allDays, packages, codes,
      hasPackageInFlight: packages.some(p => p.inFlight), hasProposedFormula: !!proposed,
      proposedDistinctDots: proposed ? proposed.distinct_dots : null,
      proposedTierWidths: (proposed && proposed.tier_widths) || null,
      dispenseSlot, dispenseSlotDots: todayDay ? (dispenseSlot === 'morning_cup' ? todayDay.morning : todayDay.evening) : [],
      dispenseDate: localISODate(new Date()), dispenseHasToday: !!todayDay, planText: plan, structured, dotsMap,
    });
  } catch {
    setState({ loading: false, hasPlan: false, allDays: [], packages: [], codes: [], hasPackageInFlight: false, hasProposedFormula: false, proposedDistinctDots: null, proposedTierWidths: null });
  }
  return state;
}
