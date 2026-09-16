// Message construction — main.js:_makeMsg / _fromHistoryRow / _applySeparators / _attachSparks /
// _attachProgramState / _attachFormulaCta. `content` is always the RAW text: AI rows are
// segmented for display here (via the miniapp's own mdToSegments), never re-serialised.
import markdown from '@mini/markdown.js';
import series from '@mini/biomarker-series.js';
import { msgSeparator } from '../lib/format.js';

const { mdToSegments } = markdown;
const { sparkForLabel, buildSeriesIndex } = series;
export { buildSeriesIndex };

let seq = 0;
export const uid = prefix => `${prefix}-${Date.now()}-${++seq}`;

export function makeMsg({ id, role, content, imageUrl, action, label, createdAt, source, notificationType }) {
  const r = role === 'assistant' ? 'ai' : role;
  const msg = { id, role: r, imageUrl: imageUrl || null, source: source || null, ts: createdAt ? +new Date(createdAt) : Date.now(), sep: '', notificationType: notificationType || null };
  if (r === 'action') { msg.action = action; msg.label = label; return msg; }
  if (r === 'coach') { msg.content = (content || '').replace(/\n+/g, ' '); return msg; }
  if (r === 'ai') { msg.content = content || ''; msg.segments = mdToSegments(content || ''); }
  else msg.content = content || '';
  msg.imageOnly = !!msg.imageUrl && !msg.content && !(msg.segments && msg.segments.length);
  return msg;
}

export function fromHistoryRow(m, id) {
  const role = (m.role === 'assistant' || m.role === 'ai') ? 'ai' : m.role;
  if (role === 'action') {
    try {
      const d = JSON.parse(m.content);
      return makeMsg({ id, role: 'action', action: d.action, label: d.label, createdAt: m.created_at });
    } catch {
      return makeMsg({ id, role: 'ai', content: m.content, createdAt: m.created_at });
    }
  }
  return makeMsg({ id, role, content: m.content, imageUrl: m.image_url, source: m.source, createdAt: m.created_at });
}

// Stamps each message's separator relative to its predecessor; `prev` is the message before
// msgs[0]. Mutates and returns msgs.
export function applySeparators(msgs, prev, lang) {
  let last = prev || null;
  for (const m of msgs) { m.sep = msgSeparator(last ? last.ts : 0, m.ts, lang); last = m; }
  return msgs;
}

// The trend behind a :::metric tile comes from the user's OWN biomarker history, never from what
// the model wrote (utils/biomarker-series.js). Mutates in place; reports whether anything changed.
export function attachSparks(segments, bioSeries) {
  if (!bioSeries || !segments) return false;
  let changed = false;
  for (const seg of segments) {
    if (seg.t !== 'metric' || !seg.items) continue;
    for (const it of seg.items) {
      if (it.spark) continue;
      const spark = sparkForLabel(bioSeries, it.label);
      if (spark) { it.spark = spark; changed = true; }
    }
  }
  return changed;
}

// Program-day cards get their watched / checked-in flags from GET /programs/my.
export function attachProgramState(segments, st) {
  const state = st || { lessons: {}, days: {} };
  let changed = false;
  for (const seg of segments || []) {
    if (!seg) continue;
    if (seg.t === 'lesson') {
      const done = !!(state.lessons && state.lessons[seg.lessonId]);
      if (seg.done !== done) { seg.done = done; changed = true; }
    } else if (seg.t === 'checkin') {
      const d = state.days && state.days[`${seg.programId}:${seg.dayIndex}`];
      const done = !!(d && d.checkin_done);
      const lessonDone = !d || d.lesson_done;
      const active = !!d && !d.checkin_done;
      if (seg.done !== done) { seg.done = done; changed = true; }
      if (seg.lessonDone !== lessonDone) { seg.lessonDone = lessonDone; changed = true; }
      if (seg.active !== active) { seg.active = active; changed = true; }
    }
  }
  return changed;
}

// main.js:_formulaCtaFor — what the :::formula card's CTA says and does for ONE package. Exact
// tier match, deliberately (see the miniapp comment): a wider held code compounds ITS OWN variant.
export function formulaCtaFor(tier, { t, codes, packages }) {
  if (!tier || !(Number(tier.width) > 0) || !tier.label) return null;
  const width = Number(tier.width);
  const unpaid = (packages || []).find(p => p.stage === 'pending_payment' && p.order_id && Number(p.max_distinct_dots) === width);
  if (unpaid) return { mode: 'pay', owned: t.formulaOrderedPkg(tier.label), btn: t.pkgPayBtn, code: '', max: null, orderId: unpaid.order_id, label: tier.label, width };
  const held = (codes || []).find(c => c.fastTrack && Number(c.max_distinct_dots) === width);
  if (held) return { mode: 'redeem', owned: t.formulaOwnedPkg(tier.label), btn: t.formulaStartCta, code: held.code, max: held.max_distinct_dots || width, orderId: '', label: tier.label, width };
  return { mode: 'buy', owned: '', btn: t.formulaBuyPkgCta(tier.label), code: '', max: null, orderId: '', label: tier.label, width };
}

export function attachFormulaCta(segments, ctx) {
  for (const seg of segments || []) {
    if (!seg || seg.t !== 'formula' || !Array.isArray(seg.tiers)) continue;
    seg.cta = formulaCtaFor(seg.tiers.find(x => x.open) || seg.tiers[0], ctx);
  }
}

// Inline rpx values the segmenter emits (utils/markdown.js) → px for the web.
export const rpxToPx = html => String(html || '').replace(/(-?\d+(?:\.\d+)?)rpx/g, (_, n) => `${n / 2}px`);
