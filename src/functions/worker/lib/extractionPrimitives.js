'use strict';

/**
 * The primitive coercions shared by every external-extraction validator.
 *
 * These were originally private to lib/docExtraction.js. They moved here when
 * lib/foodSensitivity.js needed the same rules: a food panel and a lab panel arrive in the same
 * submission, from the same OCR of the same page, and if their date and number handling ever
 * diverged the twin would carry two different notions of when a report was taken.
 *
 * Pure, no I/O, no dependencies. Every rule here is a REFUSAL, never a repair — see
 * lib/docExtraction.js's header for why that is the doctrine for anything that auto-writes.
 */

// Unit strings arrive from OCR, so they carry whatever casing, spacing and Unicode the report
// used. µ vs u and L vs l are the two that actually show up.
function normalizeUnit(raw) {
    return String(raw == null ? '' : raw)
        .trim().toLowerCase()
        .replace(/µ/g, 'u')      // MICRO SIGN
        .replace(/μ/g, 'u')      // GREEK SMALL LETTER MU
        .replace(/\s+/g, '');
}

// Deliberately refuses "<0.1", "1.2e3" and "3,5". A censored value is not a small number and must
// be carried as a flag by the caller, not coerced to the detection limit — storing 0.1 for "<0.1"
// asserts a measurement the lab explicitly declined to make.
function toNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
}

// Accepts only a plain calendar date. A timestamp is truncated to its date part; anything else is
// refused rather than coerced, because the caller's fallback for "no readable date" is to write no
// report at all, and a wrong date is worse than no report.
function toIsoDate(v) {
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
    if (typeof v !== 'string') return null;
    const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
    if (!m) return null;
    const [, y, mo, d] = m;
    const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() !== Number(mo) - 1
        || dt.getUTCDate() !== Number(d)) return null;                 // 2026-02-31 and friends
    // A lab result dated in the future is a misread year, not a prophecy. One day of slack covers
    // a report issued across a timezone boundary.
    if (dt.getTime() > Date.now() + 24 * 3600 * 1000) return null;
    return dt.toISOString().slice(0, 10);
}

function trim(v, max) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    return s.length > max ? s.slice(0, max).trim() : s;
}

// The ':::' display-card fences are interpreted by the miniapp chat renderer, so an external
// system emitting them could render arbitrary UI in the user's chat. Same strip
// handlers/viva_ag.js applies to an AG summary on ingest, for the same reason.
function sanitizeText(raw, max) {
    let text = String(raw == null ? '' : raw).replace(/^:::.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return null;
    return text.length > max ? text.slice(0, max).trim() : text;
}

function reject(list, code, entry, detail) {
    list.push({ reason: code, entry, ...(detail ? { detail } : {}) });
}

module.exports = { normalizeUnit, toNumber, toIsoDate, trim, sanitizeText, reject };
