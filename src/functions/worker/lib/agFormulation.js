'use strict';

/**
 * Parse and validate a 28-day / 56-capsule Dots formula authored by the external Viva AG agent.
 *
 * This module is the ONLY thing standing between an LLM-authored table and a compounded physical
 * capsule. docs/viva-ag-api.md §8 used to say "nano does not parse or validate this file" — that
 * was true while the formula was a read-only artifact. It stopped being true when an approved
 * formula started driving a real order, so §8 now documents these rules as enforced.
 *
 * Two principles it must keep:
 *
 *   1. REJECT, NEVER REPAIR. A count outside a dot's range is not clamped into range and a bad
 *      checksum is not recomputed — either would silently ship a formula nobody authored. Every
 *      violation is collected and returned; the caller asks the user to re-run.
 *   2. NO DB, NO I/O. Everything comes in as arguments, so the whole rule set is testable without
 *      a database. `dotsFormulary` is the rows of `dots` the caller already had to fetch.
 *
 * Pure functions only — see handlers/ag_formulation.js for the persistence and order plumbing.
 */

const { PLAN_DAYS, MAX_DOTS_PER_CAPSULE, N7_KEY, N7_ISOLATION_DAY_INDEXES } = require('./dotsProductModel');

const SLOTS = ['AM', 'PM'];
const EXPECTED_CAPSULES = PLAN_DAYS * SLOTS.length;
const FORMAT_ID = 'viva-ag-dots-formulation/1';

// N7_ISOLATION_DAY_INDEXES is 0-indexed day offsets (matching _commitNutritionPlan's loop);
// the .md contract and everything user-facing counts days from 1.
const N7_ISOLATION_DAYS = N7_ISOLATION_DAY_INDEXES.map(i => i + 1);

// ---------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------

function _toInt(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? v : null;
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (!/^-?\d+$/.test(t)) return null;
    return parseInt(t, 10);
}

function _normalizeSlot(raw) {
    const s = String(raw || '').trim().toUpperCase();
    if (s === 'AM' || s === 'MORNING') return 'AM';
    if (s === 'PM' || s === 'EVENING') return 'PM';
    return null;
}

// "DOT-N1x2 DOT-N5x14" -> { 'DOT-N1': 2, 'DOT-N5': 14 }. Returns null on any malformed token so
// the caller reports a parse error rather than silently dropping a dot from a capsule.
function _parseDotsCell(cell) {
    const dots = {};
    const tokens = String(cell || '').trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;
    for (const token of tokens) {
        const m = /^([A-Za-z0-9_-]+)[xX](\d+)$/.exec(token);
        if (!m) return null;
        const count = parseInt(m[2], 10);
        if (!Number.isFinite(count) || count <= 0) return null;
        // A repeated key within one capsule is ambiguous, not additive — reject rather than guess.
        if (dots[m[1]] !== undefined) return null;
        dots[m[1]] = count;
    }
    return dots;
}

// Pulls the rows out of one GitHub-flavoured markdown table that follows the given heading.
// Returns an array of cell arrays, header and separator rows dropped.
function _extractTableRows(md, heading) {
    const re = new RegExp(`^##\\s+${heading}\\s*$`, 'im');
    const m = re.exec(md);
    if (!m) return null;
    const rest = md.slice(m.index + m[0].length);
    // Stop at the next heading — anything after the Totals table is free prose by contract.
    const end = /^##\s+/im.exec(rest);
    const block = end ? rest.slice(0, end.index) : rest;

    const rows = [];
    for (const line of block.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('|')) continue;
        const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
        // Separator row: every cell is dashes/colons.
        if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;
        rows.push(cells);
    }
    return rows.length ? rows : null;
}

function _parseFromMarkdown(md) {
    if (typeof md !== 'string' || !md.trim()) return { error: 'no_markdown' };

    const capsuleRows = _extractTableRows(md, 'Capsules');
    if (!capsuleRows) return { error: 'capsules_table_missing' };

    const capsules = [];
    for (const cells of capsuleRows) {
        if (cells.length < 3) continue;
        const day = _toInt(cells[0]);
        const slot = _normalizeSlot(cells[1]);
        // The header row ("day | slot | dots") parses to day=null — skip it rather than error.
        if (day === null && slot === null) continue;
        if (day === null || slot === null) return { error: 'capsules_row_malformed' };
        const dots = _parseDotsCell(cells[2]);
        if (dots === null) return { error: 'capsules_row_malformed' };
        capsules.push({ day, slot, dots });
    }
    if (!capsules.length) return { error: 'capsules_table_empty' };

    // Summary is optional to parse — the checksum below is recomputed from the capsules anyway,
    // and its declared value is validated separately when present.
    let declaredTotalDots = null;
    let rationale = null;
    const summaryRows = _extractTableRows(md, 'Summary') || [];
    for (const cells of summaryRows) {
        if (cells.length < 2) continue;
        const field = String(cells[0]).trim().toLowerCase();
        if (field === 'total_dots') declaredTotalDots = _toInt(cells[1]);
        if (field === 'rationale') rationale = String(cells[1]).trim() || null;
    }

    return { parsed: { capsules, declaredTotalDots, rationale, source: 'markdown' } };
}

function _parseFromJson(formulation) {
    if (!formulation || typeof formulation !== 'object') return { error: 'no_json' };
    if (!Array.isArray(formulation.capsules)) return { error: 'json_capsules_missing' };

    const capsules = [];
    for (const raw of formulation.capsules) {
        const day = _toInt(raw?.day);
        const slot = _normalizeSlot(raw?.slot);
        if (day === null || slot === null) return { error: 'json_capsule_malformed' };
        if (!raw.dots || typeof raw.dots !== 'object' || Array.isArray(raw.dots)) {
            return { error: 'json_capsule_malformed' };
        }
        const dots = {};
        for (const [key, value] of Object.entries(raw.dots)) {
            const count = _toInt(value);
            if (count === null || count <= 0) return { error: 'json_capsule_malformed' };
            dots[key] = count;
        }
        capsules.push({ day, slot, dots });
    }
    if (!capsules.length) return { error: 'json_capsules_missing' };

    return {
        parsed: {
            capsules,
            declaredTotalDots: _toInt(formulation.total_dots),
            rationale: typeof formulation.rationale === 'string' ? formulation.rationale.trim() || null : null,
            source: 'json',
        },
    };
}

/**
 * Prefer the JSON mirror in `result.formulation` — a consumer reading JSON cannot misparse a
 * table, which is why §8 requires it for this command_key. The .md is a documented fallback so a
 * formula that is otherwise perfect isn't thrown away over a missing serialization.
 *
 * @returns {{parsed}|{error}}
 */
function parseAgFormulation(result, mdText) {
    const fromJson = _parseFromJson(result && result.formulation);
    if (fromJson.parsed) return fromJson;
    const fromMd = _parseFromMarkdown(mdText);
    if (fromMd.parsed) return fromMd;
    // Report the JSON problem when there was JSON to have a problem with; otherwise the .md one.
    return { error: fromJson.error === 'no_json' ? fromMd.error : fromJson.error };
}

// ---------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------

function _violation(code, message, detail) {
    return detail === undefined ? { code, message } : { code, message, detail };
}

/**
 * Derives per-dot AM/PM/cycle totals from the capsules. This is always computed, never read from
 * the agent's own Totals table — that table is checked AGAINST this, not trusted as input.
 */
function computeTotals(capsules) {
    const totals = {};
    for (const c of capsules) {
        for (const [key, count] of Object.entries(c.dots)) {
            if (!totals[key]) totals[key] = { am: 0, pm: 0, cycle: 0 };
            totals[key][c.slot === 'AM' ? 'am' : 'pm'] += count;
            totals[key].cycle += count;
        }
    }
    return totals;
}

/**
 * Enforces every rule in docs/viva-ag-api.md §8.
 *
 * @param {{capsules:Array, declaredTotalDots:?number}} parsed  from parseAgFormulation
 * @param {Array} dotsFormulary  rows of `dots` — needs key_name, timing, timing_flexible,
 *                               target_dots_min, target_dots_max
 * @returns {{valid:boolean, violations:Array, totals:Object, totalDots:number}}
 */
function validateAgFormulation(parsed, dotsFormulary) {
    const violations = [];
    const capsules = (parsed && parsed.capsules) || [];
    const byKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));

    // ── Shape: exactly the 56 expected (day, slot) pairs, each present once ──────────────
    const seen = new Map();
    for (const c of capsules) {
        const id = `${c.day}-${c.slot}`;
        if (seen.has(id)) {
            violations.push(_violation('duplicate_capsule', `Day ${c.day} ${c.slot} appears more than once.`));
            continue;
        }
        seen.set(id, c);
        if (c.day < 1 || c.day > PLAN_DAYS) {
            violations.push(_violation('day_out_of_range', `Day ${c.day} is outside 1-${PLAN_DAYS}.`));
        }
        if (Object.keys(c.dots).length === 0) {
            violations.push(_violation('empty_capsule', `Day ${c.day} ${c.slot} is empty.`));
        }
    }
    for (let day = 1; day <= PLAN_DAYS; day++) {
        for (const slot of SLOTS) {
            if (!seen.has(`${day}-${slot}`)) {
                violations.push(_violation('missing_capsule', `Day ${day} ${slot} is missing.`));
            }
        }
    }
    if (capsules.length !== EXPECTED_CAPSULES) {
        violations.push(_violation('capsule_count',
            `Expected ${EXPECTED_CAPSULES} capsules, found ${capsules.length}.`));
    }

    // ── Per-capsule: known dot keys, and the physical fill limit ─────────────────────────
    const unknownKeys = new Set();
    for (const c of capsules) {
        let capsuleTotal = 0;
        for (const [key, count] of Object.entries(c.dots)) {
            capsuleTotal += count;
            if (!byKey.has(key)) unknownKeys.add(key);
        }
        if (capsuleTotal > MAX_DOTS_PER_CAPSULE) {
            violations.push(_violation('capsule_over_fill',
                `Day ${c.day} ${c.slot} holds ${capsuleTotal} dots, over the ${MAX_DOTS_PER_CAPSULE} limit.`));
        }
    }
    for (const key of unknownKeys) {
        violations.push(_violation('unknown_dot_key', `"${key}" is not a dot in the formulary.`, { key }));
    }

    // ── DOT-N7: isolated on its two days, absent everywhere else ────────────────────────
    // Checked before the daily-range rule below, which deliberately exempts it — its dosing is
    // system-controlled, so "within min..max" is not the constraint that applies to it.
    const n7Dot = byKey.get(N7_KEY);
    for (const c of capsules) {
        const isIsolationDay = N7_ISOLATION_DAYS.includes(c.day);
        const keys = Object.keys(c.dots);
        if (isIsolationDay) {
            if (keys.length !== 1 || keys[0] !== N7_KEY) {
                violations.push(_violation('n7_isolation_violated',
                    `Day ${c.day} ${c.slot} must contain only ${N7_KEY}; found ${keys.join(', ') || 'nothing'}.`));
            } else if (n7Dot && n7Dot.target_dots_max != null && c.dots[N7_KEY] !== Number(n7Dot.target_dots_max)) {
                violations.push(_violation('n7_dose_wrong',
                    `Day ${c.day} ${c.slot} has ${N7_KEY}x${c.dots[N7_KEY]}, expected x${n7Dot.target_dots_max}.`));
            }
        } else if (c.dots[N7_KEY] !== undefined) {
            violations.push(_violation('n7_outside_isolation',
                `${N7_KEY} appears on day ${c.day} ${c.slot}; it is only dosed on days ${N7_ISOLATION_DAYS.join(' and ')}.`));
        }
    }

    // ── Per-dot per-day: dose range, and slot discipline ────────────────────────────────
    // The range applies to a dot's DAILY total (AM + PM), not to each capsule separately, and
    // only on a day the dot actually appears — a pulse dot is absent on most days by design, and
    // an everyday dot is displaced entirely by the DOT-N7 isolation days.
    const perDay = new Map();
    for (const c of capsules) {
        if (!perDay.has(c.day)) perDay.set(c.day, {});
        const day = perDay.get(c.day);
        for (const [key, count] of Object.entries(c.dots)) {
            if (!day[key]) day[key] = { am: 0, pm: 0 };
            day[key][c.slot === 'AM' ? 'am' : 'pm'] += count;
        }
    }
    for (const [day, dots] of perDay) {
        for (const [key, split] of Object.entries(dots)) {
            const dot = byKey.get(key);
            if (!dot || key === N7_KEY) continue;
            const total = split.am + split.pm;

            const min = dot.target_dots_min == null ? null : Number(dot.target_dots_min);
            const max = dot.target_dots_max == null ? null : Number(dot.target_dots_max);
            if (min !== null && total < min) {
                violations.push(_violation('dose_below_min',
                    `Day ${day}: ${key} totals ${total}, below its minimum of ${min}.`, { key, day, total, min }));
            }
            if (max !== null && total > max) {
                violations.push(_violation('dose_above_max',
                    `Day ${day}: ${key} totals ${total}, above its maximum of ${max}.`, { key, day, total, max }));
            }

            // A dot may only leave its own slot if it is explicitly flexible, and even then the
            // majority of its daily count stays in its own slot.
            const ownSlot = String(dot.timing || '').toLowerCase().startsWith('even') ? 'pm' : 'am';
            const otherSlot = ownSlot === 'am' ? 'pm' : 'am';
            if (split[otherSlot] > 0 && !dot.timing_flexible) {
                violations.push(_violation('slot_violation',
                    `Day ${day}: ${key} is not timing-flexible but ${split[otherSlot]} of its dose is in ${otherSlot.toUpperCase()}.`,
                    { key, day }));
            } else if (split[otherSlot] > split[ownSlot]) {
                violations.push(_violation('slot_minority',
                    `Day ${day}: most of ${key}'s dose sits in ${otherSlot.toUpperCase()}, not its own ${ownSlot.toUpperCase()} slot.`,
                    { key, day }));
            }
        }
    }

    // ── Checksum ────────────────────────────────────────────────────────────────────────
    const totals = computeTotals(capsules);
    const totalDots = Object.values(totals).reduce((sum, t) => sum + t.cycle, 0);
    if (parsed && parsed.declaredTotalDots != null && parsed.declaredTotalDots !== totalDots) {
        violations.push(_violation('checksum_mismatch',
            `Declared total_dots ${parsed.declaredTotalDots} does not match the ${totalDots} the capsules add up to.`,
            { declared: parsed.declaredTotalDots, actual: totalDots }));
    }

    return { valid: violations.length === 0, violations, totals, totalDots };
}

/**
 * Canonical storage form: capsules ordered day 1 AM, day 1 PM, … day 28 PM. Ordering the array
 * once here means every downstream consumer (the schedule writer, the review snapshot, GCN's
 * recipe_snapshot) sees the same shape regardless of what order the agent listed them in.
 */
function canonicalizeCapsules(capsules) {
    return [...capsules].sort((a, b) => (a.day - b.day) || (a.slot === 'AM' ? -1 : 1))
        .map(c => ({ day: c.day, slot: c.slot, dots: { ...c.dots } }));
}

module.exports = {
    parseAgFormulation,
    validateAgFormulation,
    computeTotals,
    canonicalizeCapsules,
    FORMAT_ID,
    EXPECTED_CAPSULES,
    N7_ISOLATION_DAYS,
};
