// A completed Kino scan must refresh health_twin.
//
// handlePostBiomarkers is the ONLY writer of latest_bio_age / latest_sub_ages /
// latest_kino_scan_at, but it never called updateHealthTwin — that ran on lab import, weight
// save and wearable sync only. Prod on 2026-09-01 had 42 health_twin rows against 587 scanned
// users: 548 users whose llmContext.health_twin was empty for every prompt (§21/§34) and whose
// Health tab had nothing to render. Nothing failed loudly, which is why it survived so long —
// hence this guard.
//
// Also pins the two properties that make the call safe to sit in the request path:
//   - it is AWAITED (FC 3.0 freezes the context on return; a fire-and-forget promise here
//     would often never run — the same trap documented for the viva-ag resume hook), and
//   - a twin failure never fails the scan, which is the caller's primary work.
//
// Runs fully offline: lib/db and the openai SDK are stubbed through require.cache.

const assert = require('assert');
const path = require('path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
const stub = (rel, exports) => {
    const full = require.resolve(path.join(WORKER, rel));
    require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

const USER = {
    user_id: 'u-kino', birth_date: new Date('1985-04-02'), bio_data: { height: 170, weight: 65 },
    nickname: 'T', language: 'zh', channel_id: 2,
};

let queries = [];
let twinShouldThrow = false;
const pool = {
    query: async (sql, params) => {
        queries.push({ sql, params });
        if (twinShouldThrow && /INTO health_twin/.test(sql)) throw new Error('twin upsert exploded');
        if (/FROM users WHERE user_id = \$1/.test(sql)) return { rows: [USER] };
        if (/INSERT INTO biomarkers/.test(sql)) return { rows: [{ id: 4242 }] };
        if (/FROM kino_devices/.test(sql)) return { rows: [] };
        return { rows: [] };
    },
    connect: async () => { throw new Error('not used'); },
};
stub('lib/db', { pool });

const { handlePostBiomarkers } = require(path.join(WORKER, 'handlers', 'chat.js'));

const SCAN = {
    openid: USER.user_id,
    test_type: 'kino_chip',
    tested_at: '2026-09-01T08:00:00.000Z',
    test_data: { hsCRP: 1.2, IL6: 1.0, GDF15: 600, CD38: 1.8, GA: 13.5, CystatinC: 0.8 },
};

const twinWrites = () => queries.filter(q => /INTO health_twin/.test(q.sql));
const biomarkerWrites = () => queries.filter(q => /INSERT INTO biomarkers/.test(q.sql));
const reset = () => { queries = []; twinShouldThrow = false; };

let passed = 0;
const check = (name, fn) => {
    try { fn(); console.log(`  ok  ${name}`); passed++; }
    catch (err) { console.error(`  FAIL  ${name}\n      ${err.message}`); process.exitCode = 1; }
};

(async () => {
    reset();
    const res = await handlePostBiomarkers(SCAN);

    check('the scan itself still succeeds', () => {
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.biomarker_id, 4242);
        assert.ok(res.bioage_profile.BioAge > 0);
    });

    check('a Kino scan refreshes health_twin', () => {
        assert.strictEqual(twinWrites().length, 1, 'expected exactly one health_twin upsert');
    });

    check('the twin is refreshed AFTER the biomarker row exists', () => {
        // updateHealthTwin reads the latest kino_chip row back out of `biomarkers`; running it
        // before the INSERT would upsert a twin that misses the scan that triggered it.
        const bmIdx = queries.findIndex(q => /INSERT INTO biomarkers/.test(q.sql));
        const twinIdx = queries.findIndex(q => /INTO health_twin/.test(q.sql));
        assert.ok(bmIdx > -1 && twinIdx > bmIdx, `biomarker@${bmIdx} must precede twin@${twinIdx}`);
    });

    check('the twin refresh is awaited, not fire-and-forget', () => {
        // handlePostBiomarkers has already resolved here. FC 3.0 freezes the container on
        // return, so if the call were not awaited the upsert would not be in `queries` yet.
        assert.ok(twinWrites().length > 0, 'twin upsert had not run by the time the handler resolved');
    });

    reset();
    twinShouldThrow = true;
    const stillOk = await handlePostBiomarkers(SCAN);
    check('a twin failure never fails the scan', () => {
        assert.strictEqual(stillOk.success, true);
        assert.strictEqual(biomarkerWrites().length, 1);
    });

    reset();
    await handlePostBiomarkers({ ...SCAN, test_type: 'food_photo', test_data: { note: 'x' } });
    check('a non-scored biomarker type does not touch the twin', () => {
        assert.strictEqual(twinWrites().length, 0);
    });

    console.log(`\n${passed} passed`);
})().catch(err => { console.error(err); process.exit(1); });
