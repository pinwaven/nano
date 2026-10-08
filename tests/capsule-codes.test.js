'use strict';

// Per-capsule QR scans: the pure rules in lib/capsuleCodes.js, then the scan handler and the
// supplier-sheet handler against a scripted pg client stubbed through require.cache.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');

// ── scripted db ─────────────────────────────────────────────────────────────
// Each query is matched by the first fragment it contains; the handler sees whatever that entry
// returns. Every SQL statement is recorded so tests can assert what was (not) written.
let script = [];
let calls = [];
function run(sql, params) {
    calls.push({ sql, params });
    for (const [frag, fn] of script) {
        if (sql.includes(frag)) return { rows: typeof fn === 'function' ? fn(params, sql) : fn };
    }
    return { rows: [] };
}
const fakeClient = { query: async (sql, p) => run(sql, p), release() {} };
const stub = (rel, exports) => {
    const full = require.resolve(path.join(WORKER, rel));
    require.cache[full] = { id: full, filename: full, loaded: true, exports };
};
stub('lib/db.js', { pool: { query: async (sql, p) => run(sql, p), connect: async () => fakeClient } });

const C = require(path.join(WORKER, 'lib', 'capsuleCodes.js'));
const { handlePostCapsuleScan, handleGetFormulationCapsuleCodes } = require(path.join(WORKER, 'handlers', 'capsules.js'));

// Shanghai wall-clock time → JS Date.
const sh = (iso) => new Date(`${iso}+08:00`);

// ── code format ─────────────────────────────────────────────────────────────

test('a capsule code is WVC + 10 Crockford base32 chars, all QR-alphanumeric', () => {
    for (let i = 0; i < 500; i++) {
        const code = C.generateCapsuleCode();
        assert.match(code, /^WVC[0-9A-HJKMNP-TV-Z]{10}$/);
        assert.ok(/^[0-9A-Z $%*+\-./:]+$/.test(code));
    }
});

test('extractCapsuleCode reads a bare code, a lower-case entry, or a code inside text', () => {
    assert.strictEqual(C.extractCapsuleCode('WVC7K2M9QX4TB0'.slice(0, 13)), 'WVC7K2M9QX4TB');
    assert.strictEqual(C.extractCapsuleCode(' wvc7k2m9qx4tb '), 'WVC7K2M9QX4TB');
    assert.strictEqual(C.extractCapsuleCode('https://x/c/WVC7K2M9QX4TB'), 'WVC7K2M9QX4TB');
    assert.strictEqual(C.extractCapsuleCode('WVB4F2A9C1E08D3'), null);   // a box code is not a capsule
    assert.strictEqual(C.extractCapsuleCode('WVCIIIIIIIIII'), null);     // I is not in the alphabet
    assert.strictEqual(C.extractCapsuleCode(''), null);
});

// ── clock ───────────────────────────────────────────────────────────────────

test('capsuleClock: AM is 04:00–14:59, PM 15:00–03:59, the day rolls at 04:00 (Shanghai)', () => {
    assert.deepStrictEqual(C.capsuleClock(sh('2026-10-08T04:00:00')), { effectiveDate: '2026-10-08', slot: 'AM' });
    assert.deepStrictEqual(C.capsuleClock(sh('2026-10-08T14:59:59')), { effectiveDate: '2026-10-08', slot: 'AM' });
    assert.deepStrictEqual(C.capsuleClock(sh('2026-10-08T15:00:00')), { effectiveDate: '2026-10-08', slot: 'PM' });
    assert.deepStrictEqual(C.capsuleClock(sh('2026-10-08T23:30:00')), { effectiveDate: '2026-10-08', slot: 'PM' });
    // After midnight is still the previous day's evening.
    assert.deepStrictEqual(C.capsuleClock(sh('2026-10-09T00:30:00')), { effectiveDate: '2026-10-08', slot: 'PM' });
    assert.deepStrictEqual(C.capsuleClock(sh('2026-10-09T03:59:00')), { effectiveDate: '2026-10-08', slot: 'PM' });
});

test('planDayIndex accepts a date string or a pg DATE (local-midnight Date)', () => {
    assert.strictEqual(C.planDayIndex('2026-10-01', '2026-10-01'), 1);
    assert.strictEqual(C.planDayIndex('2026-10-01', '2026-10-28'), 28);
    assert.strictEqual(C.planDayIndex('2026-10-01', '2026-09-30'), 0);
    assert.strictEqual(C.planDayIndex(new Date(2026, 9, 1), '2026-10-10'), 10);
});

// ── decision ────────────────────────────────────────────────────────────────

const plan = { id: 7, user_id: 'u1', status: 'active', start_date: '2026-10-01' };
const cap = (day_index, slot, extra = {}) => ({ code: 'WVC0000000000', plan_id: 7, day_index, slot, taken_at: null, ...extra });
const decide = (capsule, now, over = {}) => C.decideCapsuleScan({ capsule, plan, userId: 'u1', now, ...over });

test('the right capsule at the right time is accepted, with the schedule row it marks', () => {
    const r = decide(cap(5, 'AM'), sh('2026-10-05T08:00:00'));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.scheduled_date, '2026-10-05');
    assert.strictEqual(r.slot_name, 'morning_cup');
    const p = decide(cap(5, 'PM'), sh('2026-10-06T01:00:00'));
    assert.strictEqual(p.ok, true, 'day 5 PM after midnight');
    assert.strictEqual(p.slot_name, 'evening_cup');
});

test('the N7 isolation days (10, 11) are ordinary scan days', () => {
    assert.strictEqual(decide(cap(10, 'AM'), sh('2026-10-10T09:00:00')).ok, true);
    assert.strictEqual(decide(cap(11, 'PM'), sh('2026-10-11T20:00:00')).ok, true);
});

test('blocks, in order: not found, not yours, recalled, not active, outside cycle, taken, wrong day, wrong slot', () => {
    const t = sh('2026-10-05T08:00:00');
    assert.strictEqual(decide(null, t).reason, 'capsule_not_found');
    assert.strictEqual(decide(cap(5, 'AM'), t, { userId: 'someone-else' }).reason, 'not_your_capsule');
    assert.strictEqual(decide(cap(5, 'AM'), t, { batchRecalled: true }).reason, 'batch_recalled');
    assert.strictEqual(decide(cap(5, 'AM'), t, { plan: { ...plan, status: 'proposed' } }).reason, 'plan_not_active');
    assert.strictEqual(decide(cap(5, 'AM'), t, { plan: { ...plan, status: 'superseded' } }).reason, 'plan_not_active');
    assert.strictEqual(decide(cap(1, 'AM'), sh('2026-09-30T08:00:00')).reason, 'before_cycle');
    assert.strictEqual(decide(cap(28, 'PM'), sh('2026-10-29T20:00:00')).reason, 'cycle_ended');
    assert.strictEqual(decide(cap(5, 'AM', { taken_at: new Date() }), t).reason, 'already_taken');
    const wd = decide(cap(7, 'AM'), t);
    assert.strictEqual(wd.reason, 'wrong_day');
    assert.strictEqual(wd.capsule_day, 7);
    assert.strictEqual(wd.today_day, 5);
    const ws = decide(cap(5, 'PM'), t);
    assert.strictEqual(ws.reason, 'wrong_slot');
    assert.strictEqual(ws.capsule_slot, 'PM');
    assert.strictEqual(ws.current_slot, 'AM');
});

test('a missed day is not made up: yesterday\'s capsule is a wrong-day block', () => {
    assert.strictEqual(decide(cap(4, 'PM'), sh('2026-10-05T20:00:00')).reason, 'wrong_day');
});

test('a second scan of this morning\'s capsule in the evening is "already taken", not "wrong slot"', () => {
    assert.strictEqual(decide(cap(5, 'AM', { taken_at: new Date() }), sh('2026-10-05T20:00:00')).reason, 'already_taken');
});

test('capsuleToday reports the day, slot and both capsules\' taken state', () => {
    const rows = [
        { scheduled_date: new Date(2026, 9, 5), slot_name: 'morning_cup', is_taken: true },
        { scheduled_date: new Date(2026, 9, 5), slot_name: 'evening_cup', is_taken: false },
        { scheduled_date: new Date(2026, 9, 4), slot_name: 'evening_cup', is_taken: true },
    ];
    assert.deepStrictEqual(C.capsuleToday(plan, rows, sh('2026-10-05T16:00:00')),
        { day_index: 5, date: '2026-10-05', slot: 'PM', am_taken: true, pm_taken: false });
    assert.strictEqual(C.capsuleToday(plan, rows, sh('2026-11-05T16:00:00')), null);
});

// ── minting ─────────────────────────────────────────────────────────────────

function mintingDb({ collideFirst = 0 } = {}) {
    const store = [];
    let collisions = collideFirst;
    return {
        store,
        db: {
            query: async (sql, p) => {
                if (sql.startsWith('SELECT day_index, slot FROM capsule_codes')) return { rows: store.map(r => ({ ...r })) };
                if (sql.includes('INSERT INTO capsule_codes')) {
                    if (collisions > 0) { collisions--; return { rows: [] }; }
                    store.push({ code: p[0], plan_id: p[1], day_index: p[2], slot: p[3], taken_at: null });
                    return { rows: [{ id: store.length }] };
                }
                if (sql.includes('WHERE plan_id = $1 AND day_index = $2')) {
                    return { rows: store.filter(r => r.day_index === p[1] && r.slot === p[2]) };
                }
                if (sql.includes('ORDER BY day_index')) return { rows: store };
                return { rows: [] };
            },
        },
    };
}

test('ensurePlanCapsuleCodes mints 56 unique codes once, and a re-run adds nothing', async () => {
    const { db, store } = mintingDb();
    const rows = await C.ensurePlanCapsuleCodes(db, 7);
    assert.strictEqual(rows.length, 56);
    assert.strictEqual(new Set(rows.map(r => r.code)).size, 56);
    assert.strictEqual(new Set(rows.map(r => `${r.day_index}|${r.slot}`)).size, 56);
    await C.ensurePlanCapsuleCodes(db, 7);
    assert.strictEqual(store.length, 56);
});

test('a code collision is retried with a fresh code', async () => {
    const { db, store } = mintingDb({ collideFirst: 3 });
    await C.ensurePlanCapsuleCodes(db, 7);
    assert.strictEqual(store.length, 56);
});

// ── POST /capsule-scan ──────────────────────────────────────────────────────

function scanScript({ capsule, planRow = { id: 7, user_id: 'u1', status: 'active', start_date: '2026-10-01' }, recall = { n: 1, recalled: 0 }, markOk = true }) {
    calls = [];
    script = [
        ['FROM capsule_codes WHERE code', capsule ? [capsule] : []],
        ['FROM nutrition_plans WHERE id', planRow ? [planRow] : []],
        ['FROM box_batches bb', [recall]],
        ['UPDATE capsule_codes', markOk ? [{ taken_at: '2026-10-05T00:00:00Z' }] : []],
        ['UPDATE nutrition_schedules', [{ recipe: { dots: { 'DOT-N3': 2 } } }]],
        ['FROM dots WHERE key_name', [{ key_name: 'DOT-N3', name: 'Mg', name_zh: '镁', color_hex: '#123' }]],
    ];
}
const wrote = (frag) => calls.some(c => c.sql.includes(frag));

// The handler reads the clock itself; pin the plan's start to today so "day 1" is now.
function todayStart() {
    const { effectiveDate, slot } = C.capsuleClock(new Date());
    return { start: effectiveDate, slot };
}

test('scan: today\'s capsule is recorded on both the code and the schedule row', async () => {
    const { start, slot } = todayStart();
    scanScript({ capsule: { id: 1, code: 'WVC0000000000', plan_id: 7, day_index: 1, slot, taken_at: null },
        planRow: { id: 7, user_id: 'u1', status: 'active', start_date: start } });
    const r = await handlePostCapsuleScan({ openid: 'u1', code: 'WVC0000000000' }, 'coach-9');
    assert.strictEqual(r.success, true, JSON.stringify(r));
    assert.deepStrictEqual(r.dots, [{ key_name: 'DOT-N3', name: 'Mg', name_zh: '镁', color_hex: '#123', count: 2 }]);
    const mark = calls.find(c => c.sql.includes('UPDATE capsule_codes'));
    assert.strictEqual(mark.params[1], 'coach-9', 'taken_by is the session user (a coach for a managed customer)');
    const sched = calls.find(c => c.sql.includes('UPDATE nutrition_schedules'));
    assert.deepStrictEqual(sched.params, [7, start, slot === 'AM' ? 'morning_cup' : 'evening_cup']);
    assert.ok(wrote('COMMIT'));
});

test('scan: a lost race (taken between read and write) is "already taken" and writes nothing', async () => {
    const { start, slot } = todayStart();
    scanScript({ capsule: { id: 1, code: 'WVC0000000000', plan_id: 7, day_index: 1, slot, taken_at: null },
        planRow: { id: 7, user_id: 'u1', status: 'active', start_date: start }, markOk: false });
    const r = await handlePostCapsuleScan({ openid: 'u1', code: 'WVC0000000000' }, 'u1');
    assert.strictEqual(r.reason, 'already_taken');
    assert.ok(!wrote('UPDATE nutrition_schedules'));
    assert.ok(wrote('ROLLBACK'));
});

test('scan: someone else\'s capsule says only "not yours"', async () => {
    const { start, slot } = todayStart();
    scanScript({ capsule: { id: 1, code: 'WVC0000000000', plan_id: 7, day_index: 1, slot, taken_at: null },
        planRow: { id: 7, user_id: 'other', status: 'active', start_date: start } });
    const r = await handlePostCapsuleScan({ openid: 'u1', code: 'WVC0000000000' }, 'u1');
    assert.deepStrictEqual(r, { success: false, reason: 'not_your_capsule' });
    assert.ok(!wrote('UPDATE capsule_codes'));
});

test('scan: a wrong-day capsule is blocked with both days for the message', async () => {
    const { start, slot } = todayStart();
    scanScript({ capsule: { id: 1, code: 'WVC0000000000', plan_id: 7, day_index: 3, slot, taken_at: null },
        planRow: { id: 7, user_id: 'u1', status: 'active', start_date: start } });
    const r = await handlePostCapsuleScan({ openid: 'u1', code: 'WVC0000000000' }, 'u1');
    assert.strictEqual(r.reason, 'wrong_day');
    assert.strictEqual(r.capsule_day, 3);
    assert.strictEqual(r.today_day, 1);
    assert.ok(!wrote('UPDATE capsule_codes'));
});

test('scan: every batch recalled blocks; one live batch does not', async () => {
    const { start, slot } = todayStart();
    const capsule = { id: 1, code: 'WVC0000000000', plan_id: 7, day_index: 1, slot, taken_at: null };
    const planRow = { id: 7, user_id: 'u1', status: 'active', start_date: start };
    scanScript({ capsule, planRow, recall: { n: 2, recalled: 2 } });
    assert.strictEqual((await handlePostCapsuleScan({ openid: 'u1', code: capsule.code }, 'u1')).reason, 'batch_recalled');
    scanScript({ capsule, planRow, recall: { n: 2, recalled: 1 } });
    assert.strictEqual((await handlePostCapsuleScan({ openid: 'u1', code: capsule.code }, 'u1')).success, true);
});

test('scan: garbage and unknown codes', async () => {
    scanScript({ capsule: null });
    assert.strictEqual((await handlePostCapsuleScan({ openid: 'u1', code: 'hello' }, 'u1')).reason, 'invalid_code');
    assert.strictEqual((await handlePostCapsuleScan({ openid: 'u1', code: 'WVC0000000000' }, 'u1')).reason, 'capsule_not_found');
    assert.strictEqual((await handlePostCapsuleScan({ code: 'WVC0000000000' }, 'u1')).reason, 'missing_params');
});

// ── GET /formulation-capsule-codes ──────────────────────────────────────────

test('supplier sheet: resolves the plan by label_code and returns 56 codes, no identity', async () => {
    const store = [];
    calls = [];
    script = [
        ['FROM nutrition_plans WHERE label_code', [{ id: 7, status: 'proposed', gcn_order_id: 'abcdef123456' }]],
        ['SELECT day_index, slot FROM capsule_codes', () => store],
        ['INSERT INTO capsule_codes', (p) => { store.push({ code: p[0], day_index: p[2], slot: p[3] }); return [{ id: 1 }]; }],
        ['ORDER BY day_index', () => store],
    ];
    const r = await handleGetFormulationCapsuleCodes('https://aeviva.gcn.net/formulation-label.html?c=WVB4F2A9C1E08D3');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.capsules.length, 56);
    assert.strictEqual(r.order_short_id, 'abcdef12');
    assert.deepStrictEqual(Object.keys(r.capsules[0]).sort(), ['code', 'day_index', 'slot']);
    assert.ok(!('user_id' in r));
});

test('supplier sheet: a pending (still formulating) plan and an unknown code mint nothing', async () => {
    calls = [];
    script = [['FROM nutrition_plans WHERE label_code', [{ id: 7, status: 'pending' }]]];
    assert.strictEqual((await handleGetFormulationCapsuleCodes('WVB4F2A9C1E08D3')).reason, 'plan_not_ready');
    script = [];
    assert.strictEqual((await handleGetFormulationCapsuleCodes('WVB4F2A9C1E08D3')).reason, 'not_found');
    assert.strictEqual((await handleGetFormulationCapsuleCodes('nope')).reason, 'invalid_code');
    assert.ok(!wrote('INSERT INTO capsule_codes'));
});
