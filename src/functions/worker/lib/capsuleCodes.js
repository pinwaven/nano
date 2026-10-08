'use strict';

// Per-capsule QR codes — the rules, kept apart from the I/O in handlers/capsules.js the way
// lib/formulation.js is kept apart from handlers/dots.js. Everything except the two minting
// functions is pure and DB-free.
//
// A plan's 56 capsules are not interchangeable: N7 isolation days, pulse windows and per-week
// AM/PM levelling make them differ by day, and locked dots make the slot matter. So a scan is
// accepted only for the owner's active plan, today's day and the current slot. Missed capsules
// are not made up: a past day's capsule is a wrong-day block like a future one.

const crypto = require('crypto');
const { DateTime } = require('luxon');
const { SHANGHAI_ZONE } = require('./time-utils');
const { PLAN_DAYS } = require('./dotsProductModel');

// Crockford base32: no I, L, O, U. Every character is in the QR alphanumeric set, so the
// 13-char code fits a version-1 QR at ECC M — big modules on a 27 mm foil.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_PREFIX = 'WVC';
const CODE_BODY_LEN = 10;
const CODE_RE = /WVC[0-9A-HJKMNP-TV-Z]{10}/;

// Shanghai clock. The day rolls at 04:00 so a late evening capsule after midnight still counts
// for the day it belongs to; AM is [04:00, 15:00), PM the rest.
const DAY_ROLLOVER_HOUR = 4;
const PM_START_HOUR = 15;

function generateCapsuleCode() {
    const bytes = crypto.randomBytes(CODE_BODY_LEN);
    let body = '';
    for (let i = 0; i < CODE_BODY_LEN; i++) body += ALPHABET[bytes[i] & 31];
    return CODE_PREFIX + body;
}

// Whatever the scanner returned → the code, or null. Upper-cased first: the code is printed upper,
// but a manual entry may not be.
function extractCapsuleCode(raw) {
    const m = CODE_RE.exec(String(raw || '').trim().toUpperCase());
    return m ? m[0] : null;
}

// now: a JS Date (or anything DateTime.fromJSDate takes). Returns the effective plan date
// (yyyy-MM-dd) and the slot the clock says is due.
function capsuleClock(now = new Date()) {
    const sh = DateTime.fromJSDate(now instanceof Date ? now : new Date(now)).setZone(SHANGHAI_ZONE);
    const slot = (sh.hour >= DAY_ROLLOVER_HOUR && sh.hour < PM_START_HOUR) ? 'AM' : 'PM';
    const effectiveDate = sh.minus({ hours: DAY_ROLLOVER_HOUR }).toISODate();
    return { effectiveDate, slot };
}

// 1-based plan day for an effective date, given the plan's start_date (yyyy-MM-dd). May be ≤ 0
// (before the cycle) or > PLAN_DAYS (after it).
// A pg DATE arrives as a JS Date at local midnight (no type parser is set in lib/db.js), so it is
// read back in the local zone; a string is taken as-is.
const isoDate = (d) => (d instanceof Date ? DateTime.fromJSDate(d).toISODate() : String(d).slice(0, 10));

function planDayIndex(startDate, effectiveDate) {
    const a = DateTime.fromISO(isoDate(startDate), { zone: SHANGHAI_ZONE });
    const b = DateTime.fromISO(effectiveDate, { zone: SHANGHAI_ZONE });
    return Math.round(b.diff(a, 'days').days) + 1;
}

const slotName = (slot) => (slot === 'PM' ? 'evening_cup' : 'morning_cup');

// The whole decision, in the order the user should hear about problems: identity before timing,
// and "already taken" before "wrong time" (a second scan of this morning's capsule at 16:00 is a
// double dose, not a slot mistake).
//
//   capsule: { code, plan_id, day_index, slot, taken_at } | null
//   plan:    { id, user_id, status, start_date } | null
//   batchRecalled: boolean
//   userId:  the account the capsule is being taken for (the owner; a coach scans with the
//            managed customer's id, already authorised by lib/userAccess.js)
function decideCapsuleScan({ capsule, plan, batchRecalled = false, userId, now = new Date() }) {
    if (!capsule) return { ok: false, reason: 'capsule_not_found' };
    if (!plan || plan.user_id !== userId) return { ok: false, reason: 'not_your_capsule' };
    if (batchRecalled) return { ok: false, reason: 'batch_recalled' };
    if (plan.status !== 'active' || !plan.start_date) return { ok: false, reason: 'plan_not_active' };

    const { effectiveDate, slot } = capsuleClock(now);
    const today = planDayIndex(plan.start_date, effectiveDate);
    const info = { capsule_day: capsule.day_index, capsule_slot: capsule.slot, today_day: today, current_slot: slot };

    if (today < 1) return { ok: false, reason: 'before_cycle', ...info };
    if (today > PLAN_DAYS) return { ok: false, reason: 'cycle_ended', ...info };
    if (capsule.taken_at) return { ok: false, reason: 'already_taken', taken_at: capsule.taken_at, ...info };
    if (capsule.day_index !== today) return { ok: false, reason: 'wrong_day', ...info };
    if (capsule.slot !== slot) return { ok: false, reason: 'wrong_slot', ...info };
    return { ok: true, ...info, scheduled_date: effectiveDate, slot_name: slotName(slot) };
}

// What the Dots subtab shows: today's plan day, the current slot and whether each of today's two
// capsules has been taken. `schedules` are the plan's nutrition_schedules rows.
function capsuleToday(plan, schedules, now = new Date()) {
    if (!plan || !plan.start_date) return null;
    const { effectiveDate, slot } = capsuleClock(now);
    const day = planDayIndex(plan.start_date, effectiveDate);
    if (day < 1 || day > PLAN_DAYS) return null;
    const isToday = (r) => isoDate(r.scheduled_date) === effectiveDate;
    const taken = (name) => (schedules || []).some(r => isToday(r) && r.slot_name === name && r.is_taken === true);
    return { day_index: day, date: effectiveDate, slot, am_taken: taken('morning_cup'), pm_taken: taken('evening_cup') };
}

// Mints the plan's 56 codes if they do not exist yet. Idempotent: re-running fills only missing
// (day, slot) pairs, and the UNIQUE(plan_id, day_index, slot) constraint makes a concurrent run a
// no-op. A code collision (UNIQUE(code)) is retried with a fresh code.
async function ensurePlanCapsuleCodes(db, planId) {
    const { rows: existing } = await db.query(
        'SELECT day_index, slot FROM capsule_codes WHERE plan_id = $1', [planId]
    );
    const have = new Set(existing.map(r => `${r.day_index}|${r.slot}`));
    for (let day = 1; day <= PLAN_DAYS; day++) {
        for (const slot of ['AM', 'PM']) {
            if (have.has(`${day}|${slot}`)) continue;
            let inserted = false;
            for (let attempt = 0; attempt < 10 && !inserted; attempt++) {
                const { rows } = await db.query(
                    `INSERT INTO capsule_codes (code, plan_id, day_index, slot)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT DO NOTHING RETURNING id`,
                    [generateCapsuleCode(), planId, day, slot]
                );
                if (rows.length) { inserted = true; break; }
                // Either the pair was filled concurrently (done) or the code collided (retry).
                const { rows: pair } = await db.query(
                    'SELECT 1 FROM capsule_codes WHERE plan_id = $1 AND day_index = $2 AND slot = $3',
                    [planId, day, slot]
                );
                if (pair.length) inserted = true;
            }
            if (!inserted) throw new Error('Failed to generate a unique capsule code');
        }
    }
    const { rows } = await db.query(
        `SELECT code, day_index, slot, taken_at FROM capsule_codes
          WHERE plan_id = $1 ORDER BY day_index ASC, slot ASC`,
        [planId]
    );
    return rows;
}

module.exports = {
    ALPHABET, CODE_RE, DAY_ROLLOVER_HOUR, PM_START_HOUR,
    generateCapsuleCode, extractCapsuleCode, capsuleClock, planDayIndex, slotName,
    decideCapsuleScan, capsuleToday, ensurePlanCapsuleCodes,
};
