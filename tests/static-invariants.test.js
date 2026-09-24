// Cross-cutting invariants that CLAUDE.md states in prose and nothing pinned in code. Each one
// has an incident or a documented failure mode behind it; the test names it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const FN = path.join(ROOT, 'src', 'functions');
const WORKER = path.join(FN, 'worker');
const MINI = path.join(ROOT, 'src', 'mini', 'nano-miniapp');
const read = (p) => fs.readFileSync(p, 'utf8');

// Run the shipping `const T = { zh: {...}, en: {...} }` block of a page/component as source.
function loadT(js) {
    const start = js.indexOf('\nconst T = {') + 1;
    assert.ok(start > 0, 'no `const T = {` block');
    const ctx = vm.createContext({});
    vm.runInContext(js.slice(start, js.indexOf('\n}\n', start) + 3) + '\nglobalThis.T = T;', ctx);
    return ctx.T;
}

// ── §32: the shared PolarDB cluster ──────────────────────────────────────────────────────────

test('every Postgres pool is capped (CLAUDE.md §32 connection-exhaustion incident)', () => {
    // 2026-08-16: five uncapped node-postgres pools across warm FC containers took the cluster to
    // 227 connections and knocked GCN prod over. GCN's own pool has always been max:5.
    for (const fn of ['worker', 'dispatcher', 'agent', 'lab', 'kino']) {
        const db = read(path.join(FN, fn, 'lib', 'db.js'));
        const pools = db.split('new Pool(').slice(1);
        assert.ok(pools.length >= 1, `${fn}/lib/db.js constructs no Pool`);
        for (const [i, body] of pools.entries()) {
            const head = body.slice(0, body.indexOf('})'));
            assert.match(head, /max:\s*5\b/, `${fn}/lib/db.js Pool #${i + 1} has no max: 5`);
            assert.match(head, /idleTimeoutMillis:\s*\d+/, `${fn}/lib/db.js Pool #${i + 1} has no idleTimeoutMillis`);
        }
    }
});

// ── §22/§35: two-channel delivery and the client's de-dup set ───────────────────────────────

test('every notification type written to BOTH chat_messages and notifications is in AI_ECHO_TYPES', () => {
    // A type in both tables but missing from the miniapp Set renders the bubble twice (§25's
    // "second real bug", §35, §39). A type in the Set but only ever in notifications is harmless.
    const mainJs = read(path.join(MINI, 'pages', 'main', 'main.js'));
    const m = mainJs.match(/const AI_ECHO_TYPES = new Set\(\[([\s\S]*?)\]\)/);
    assert.ok(m, 'AI_ECHO_TYPES not found in main.js');
    const echo = new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));

    // Known dual-write sites, by inspection of every `INSERT INTO notifications` in the repo.
    const knownDual = [
        'biological_report',       // handlers/chat.js + kino/lib/deviceHandlers.js
        'chat_reply', 'formulation_proposal', 'nutrition_plan', 'formulation_order_paid',
        'coach_message',           // agent/index.js
        'morning_checkin', 'midday_checkin', 'evening_checkin',   // handlers/checkin.js
        'program_day', 'program_day_nudge',   // handlers/programs.js (claim row + saveChatMessage, §42)
    ];
    for (const t of knownDual) assert.ok(echo.has(t), `${t} is dual-written but not in AI_ECHO_TYPES`);

    // Every deliverTerminalMessage() caller writes both channels by construction. Resolve the
    // type argument whether it is a literal or a NOTIFY_* constant in the calling file.
    const handlers = fs.readdirSync(path.join(WORKER, 'handlers')).filter((f) => f.endsWith('.js'));
    let sites = 0;
    for (const f of handlers) {
        const src = read(path.join(WORKER, 'handlers', f));
        const consts = Object.fromEntries([...src.matchAll(/const (NOTIFY_[A-Z_]+) = '([a-z_]+)'/g)].map((x) => [x[1], x[2]]));
        for (const call of src.matchAll(/(?<!function )\b_?deliverTerminalMessage\(\s*[^,]+,\s*[^,]+,\s*([^,]+),/g)) {
            const arg = call[1].trim();
            if (/^[a-z]\w*$/i.test(arg) && !consts[arg]) continue; // the function's own parameter, at its definition
            const types = arg.startsWith("'") ? [arg.slice(1, -1)]
                : consts[arg] ? [consts[arg]]
                : [...arg.slice(arg.indexOf('?')).matchAll(/'([a-z_]+)'/g)].map((x) => x[1]); // a ternary: its two branches
            assert.ok(types.length > 0, `${f}: cannot resolve the type passed to deliverTerminalMessage: ${arg}`);
            for (const t of types) { sites++; assert.ok(echo.has(t), `${f} delivers '${t}' on both channels but AI_ECHO_TYPES lacks it`); }
        }
    }
    assert.ok(sites >= 8, `only ${sites} deliverTerminalMessage sites found — the scan regex is stale`);
});

// ── §35: the Viva AG contract documents itself ──────────────────────────────────────────────

test('VIVA_AG_ALLOWED_PATHS and viva-ag-openapi.json agree in both directions', () => {
    // doc-extraction-contract.test.js pins this for the extraction queue; the older AG queue had
    // no equivalent, and "the spec's paths and VIVA_AG_ALLOWED_PATHS should agree" was prose.
    // Answered by the twin function since 2026-09-23 (CLAUDE.md §48).
    const indexJs = read(path.join(FN, 'twin', 'index.js'));
    const block = indexJs.slice(indexJs.indexOf('const VIVA_AG_ALLOWED_PATHS'));
    const allowed = [...block.slice(0, block.indexOf(']')).matchAll(/'(\/viva-ag\/[^']+)'/g)].map((x) => x[1]).sort();
    const spec = JSON.parse(read(path.join(FN, 'twin', 'docs', 'viva-ag-openapi.json')));
    const documented = Object.keys(spec.paths).sort();
    assert.ok(allowed.length > 0, 'VIVA_AG_ALLOWED_PATHS could not be read out of twin/index.js');
    assert.deepStrictEqual(documented.filter((p) => !allowed.includes(p)), [], 'documented but not allowlisted');
    assert.deepStrictEqual(allowed.filter((p) => !documented.includes(p)), [], 'allowlisted but undocumented');
});

// ── §26/§37/§28f: the essential block lives in three places ─────────────────────────────────

test('the two hardcoded essential-knowledge fallbacks are byte-identical', () => {
    // The third copy is the knowledge_entries row (checked live). If these two drift, a transient
    // DB error silently ships a different guardrail depending on which fallback a handler hit.
    const grab = (src, name) => {
        const i = src.indexOf(`const ${name} = \``);
        assert.ok(i > -1, `${name} not found`);
        return src.slice(i + name.length + 10, src.indexOf('`;', i));
    };
    const kb = grab(read(path.join(WORKER, 'lib', 'knowledgeBase.js')), 'FALLBACK_ESSENTIAL_BLOCK');
    const fc = grab(read(path.join(WORKER, 'prompts', 'chat', 'factConstraint.js')), 'FALLBACK_ZH');
    assert.strictEqual(kb, fc);
});

// ── i18n: WXML has no compile-time key check ────────────────────────────────────────────────

test('every t.<key> a template reads exists in both T.zh and T.en', () => {
    // A renamed key renders as empty text with no error (CLAUDE.md §28d, §34).
    const hosts = [
        ['pages/main/main', ['pages/main/main.wxml']],
        ['pages/coach/coach', ['pages/coach/coach.wxml']],
        ['components/user-health/user-health', ['components/user-health/user-health.wxml']],
    ];
    for (const [jsRel, wxmls] of hosts) {
        const T = loadT(read(path.join(MINI, jsRel + '.js')));
        const missing = [];
        for (const w of wxmls) {
            const wxml = read(path.join(MINI, w));
            const keys = new Set([...wxml.matchAll(/\bt\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((x) => x[1]));
            for (const k of keys) {
                for (const lang of ['zh', 'en']) {
                    if (!(k in T[lang])) missing.push(`${w}: t.${k} missing in T.${lang}`);
                }
            }
        }
        assert.deepStrictEqual(missing, [], `${jsRel}: ${missing.join('; ')}`);
        const zh = Object.keys(T.zh), en = Object.keys(T.en);
        const onlyZh = zh.filter((k) => !(k in T.en)), onlyEn = en.filter((k) => !(k in T.zh));
        assert.deepStrictEqual({ onlyZh, onlyEn }, { onlyZh: [], onlyEn: [] }, `${jsRel}: T.zh/T.en key sets differ`);
    }
});
