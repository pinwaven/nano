/**
 * Digital-twin bundle assembly for the external Viva AG agent.
 *
 * SCOPE, deliberately: this module is used by the /viva-ag/twin-bundle endpoint ONLY.
 *
 * The same SQL already exists in lib/agenticTools.js (the 11 typed read tools) and, in a
 * fifth and sixth variation, inside the four llmContext builders (handlePostChat,
 * handlePostHealthAdvice, _handleFormulaDotsAgentic, handleDailyCheckinEvent). Converting
 * those to call these fetchers is the natural next pass and would be a real improvement —
 * but it is NOT part of this feature. Those builders construct the context contract that
 * 20+ prompt templates, runAgenticTurn's JUDGE grounding, and extractToolGroundTruth all
 * consume, and CLAUDE.md 21/27 record several user-visible regressions caused by touching
 * exactly that surface. Refactoring them belongs in its own pass with its own verification,
 * not bundled into a feature that only reads. The duplication here is a decision, not an
 * oversight.
 *
 * Conventions carried over verbatim from agenticTools.js:
 *   - fetchers never throw; a failed sub-fetch yields null/[] rather than killing the bundle
 *   - biomarker-shaped data always comes from data.validated, NEVER data.actual (CLAUDE.md 17)
 *   - every timestamp goes through formatToShanghai() — raw pg timestamptz serializes to UTC
 *     ISO, which has been observed leaking into user-facing text
 *   - clampInt() for every limit
 *
 * The bundle shape follows CLAUDE.md 34's four canonical twin layers. `interventions` sits
 * deliberately OUTSIDE `layers` because 34 states health/nutrition plans are what the user
 * DOES, not what they ARE, and are therefore not a twin layer.
 */
'use strict';

const ossLib = require('./oss');
const { formatQuestionnaireContext } = require('../handlers/questionnaires');
const { formatToShanghai, calculateAge, getNowShanghai } = require('./time-utils');

// Bump when the bundle's shape changes in a way an external consumer must notice. Returned in
// every bundle response and echoed by /viva-ag/ping so the agent can assert compatibility.
// v2 (2026-08-27) added job_questionnaires — purely additive, so a v1 consumer keeps working.
const BUNDLE_VERSION = 2;

// Presigned document URLs default to 6 hours: long enough for a multi-hour job that has to
// resume a large download, short enough that a leaked bundle goes stale the same day.
// GET /viva-ag/document-url re-mints on demand regardless.
const DEFAULT_DOC_URL_TTL_SECONDS = 6 * 3600;

// formatToShanghai() renders "Invalid DateTime" for null/undefined rather than failing, which
// would then ship as a literal string in the bundle. Every timestamp goes through this instead.
//
// DATE columns (report_date, doc_date, scheduled_date, latest_lab_date) are a separate hazard
// and are handled in SQL with an explicit ::text cast rather than here. node-postgres parses a
// DATE into a JS Date at the process's local midnight, which JSON.stringify then renders as a
// UTC instant — so a schedule row for 2026-08-16 ships as "2026-08-15T16:00:00.000Z" and reads
// as the WRONG DAY to any consumer. ::text yields exactly YYYY-MM-DD with no timezone
// interpretation anywhere in the path. Found by an ISO-leak scan over a real dev bundle.
function _ts(value) {
    return value ? formatToShanghai(value instanceof Date ? value : new Date(value)) : null;
}

function clampInt(value, fallback, min, max) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

// Every fetcher is wrapped in this: one unavailable data source degrades that section to
// null/[] instead of failing the whole bundle. A partial twin is far more useful to the agent
// than a 500, and the section is explicitly null rather than silently absent.
async function _safe(label, fn, fallback) {
    try {
        return await fn();
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'twinBundle fetch failed', section: label, error: err.message }));
        return fallback;
    }
}

// ---------------------------------------------------------------------------------------
// Layer 1 — Precision Testing
// ---------------------------------------------------------------------------------------

async function fetchLatestBiomarkers(pool, userId) {
    const { rows } = await pool.query(
        `SELECT data, tested_at FROM biomarkers
         WHERE user_id = $1 AND test_type = 'kino_chip' AND (data->'validated') IS NOT NULL
         ORDER BY tested_at DESC LIMIT 1`,
        [userId]
    );
    const row = rows[0];
    if (!row) return null;
    return {
        validated: row.data?.validated || {},
        bioage_profile: row.data?.bioage_profile || {},
        tested_at: _ts(row.tested_at),
    };
}

async function fetchBiomarkerHistory(pool, userId, limit = 30) {
    const n = clampInt(limit, 30, 1, 100);
    const [countResult, rowsResult] = await Promise.all([
        pool.query(
            `SELECT COUNT(*) FROM biomarkers
             WHERE user_id = $1 AND test_type = 'kino_chip' AND (data->'validated') IS NOT NULL`,
            [userId]
        ),
        pool.query(
            `SELECT data, tested_at FROM biomarkers
             WHERE user_id = $1 AND test_type = 'kino_chip' AND (data->'validated') IS NOT NULL
             ORDER BY tested_at DESC LIMIT $2`,
            [userId, n]
        ),
    ]);
    return {
        total_count: parseInt(countResult.rows[0].count, 10),
        tests: rowsResult.rows.map(r => ({
            tested_at: _ts(r.tested_at),
            validated: r.data?.validated || {},
            bioage_profile: r.data?.bioage_profile || {},
        })),
    };
}

// ---------------------------------------------------------------------------------------
// Layer 2 — Daily Monitoring
// ---------------------------------------------------------------------------------------

// Same 15-column projection every other reader uses — never SELECT *, so an added column
// can't silently widen what leaves the platform.
async function fetchHealthTwin(pool, userId) {
    const { rows } = await pool.query(
        `SELECT avg_hrv_ms, avg_resting_hr, avg_spo2,
                avg_sleep_hours, avg_sleep_score, avg_deep_sleep_pct,
                avg_daily_steps, avg_active_minutes,
                latest_weight_kg, latest_bmi, latest_body_fat_pct,
                latest_lab_data, latest_lab_date::text AS latest_lab_date,
                trend_data, data_coverage
         FROM health_twin WHERE user_id = $1`,
        [userId]
    );
    return rows[0] || null;
}

async function fetchWeightHistory(pool, userId, limit = 30) {
    const n = clampInt(limit, 30, 1, 100);
    const { rows } = await pool.query(
        `SELECT data, tested_at FROM biomarkers
         WHERE user_id = $1 AND test_type = 'body_composition'
         ORDER BY tested_at DESC LIMIT $2`,
        [userId, n]
    );
    return rows.map(r => ({
        weight_kg: r.data?.actual?.weight ?? null,
        tested_at: _ts(r.tested_at),
    }));
}

// ---------------------------------------------------------------------------------------
// Layer 3 — Medical Records
// ---------------------------------------------------------------------------------------

async function fetchHealthReports(pool, userId, limit = 30) {
    const n = clampInt(limit, 30, 1, 100);
    const { rows } = await pool.query(
        `SELECT report_date::text AS report_date, source, institution, report_type, status, raw_data
         FROM health_reports WHERE user_id = $1 ORDER BY report_date DESC LIMIT $2`,
        [userId, n]
    );
    // raw_data holds parsed observations plus an image_url; the URL is a 10-year signed link
    // to an OSS object and has no business leaving with the bundle, so only observations go.
    return rows.map(r => ({
        report_date: r.report_date,
        source: r.source,
        institution: r.institution,
        report_type: r.report_type,
        status: r.status,
        observations: r.raw_data?.observations || [],
    }));
}

async function fetchHealthDocuments(pool, userId, documentIds = null) {
    const params = [userId];
    let scope = '';
    if (Array.isArray(documentIds) && documentIds.length > 0) {
        params.push(documentIds);
        scope = `AND id = ANY($${params.length}::bigint[])`;
    }
    const { rows } = await pool.query(
        `SELECT id, oss_key, filename, content_type, size_bytes, etag,
                doc_type, doc_date::text AS doc_date, institution, note, created_at
         FROM health_documents
         WHERE user_id = $1 AND status = 'active' ${scope}
         ORDER BY COALESCE(doc_date, created_at::date) DESC, id DESC`,
        params
    );
    return rows;
}

// Turns document rows into the bundle's document entries, each with a presigned direct-from-OSS
// GET URL. Bytes NEVER pass through Function Compute — the response envelope base64-encodes
// binary bodies, so proxying a 50 MB PDF would inflate it ~33%, buffer it all in the worker, and
// hit FC's response ceiling. OSS carries the bytes; nano only hands out a signature. As a
// consequence these URLs also support HTTP Range for free, so the agent can chunk or resume.
function presignDocuments(docs, ttlSeconds = DEFAULT_DOC_URL_TTL_SECONDS) {
    const expiresAt = _ts(new Date(Date.now() + ttlSeconds * 1000));
    return docs.map(d => ({
        document_id: Number(d.id),
        filename: d.filename,
        doc_type: d.doc_type,
        doc_date: d.doc_date,
        institution: d.institution,
        note: d.note,
        content_type: d.content_type,
        size_bytes: d.size_bytes != null ? Number(d.size_bytes) : null,
        etag: d.etag,
        uploaded_at: _ts(d.created_at),
        url: ossLib.generatePresignedGetUrl(d.oss_key, ttlSeconds, null, null, {
            filename: d.filename,
        }),
        url_expires_at: expiresAt,
        supports_range: true,
    }));
}

// ---------------------------------------------------------------------------------------
// Layer 4 — Personal Profile
// ---------------------------------------------------------------------------------------

// Excludes raw birth_date and body_composition answers on purpose: the bundle already carries
// precomputed age and BMI, and handing over both the raw inputs and the derived values is the
// exact pattern that produced a hallucinated wrong age in 2026-07-16.
async function fetchQuestionnaireRows(pool, userId) {
    const { rows } = await pool.query(
        `SELECT q.name, q.name_zh, qq.prompt_en, qq.prompt_zh, qr.answer
         FROM questionnaire_responses qr
         JOIN questionnaire_questions qq ON qq.id = qr.question_id
         JOIN questionnaire_assignments qa ON qa.id = qr.assignment_id
         JOIN questionnaires q ON q.id = qa.questionnaire_id
         WHERE qa.user_id = $1 AND qa.status = 'completed'
           AND qq.save_field IS DISTINCT FROM 'birth_date'
           AND qq.save_biomarker_type IS DISTINCT FROM 'body_composition'
         ORDER BY qa.completed_at ASC, qq.sort_order ASC`,
        [userId]
    );
    return rows;
}

// The rounds of clarifying questions THIS job asked, with their answers.
//
// Distinct from questionnaire_context above, which is the whole-user view: it merges every
// completed questionnaire the user has ever filled in, so it cannot tell the agent which
// questions were its own, whether the round it asked is finished, or what it asked in a round
// the user abandoned. That matters because the agent has to decide whether it now has what it
// was missing — a question it can only answer against its own rounds.
//
// Ordered by round, then by the order the questions were asked in.
async function fetchJobQuestionnaires(pool, assignmentIds) {
    if (!Array.isArray(assignmentIds) || assignmentIds.length === 0) return [];
    const { rows } = await pool.query(
        `SELECT qa.id AS assignment_id, qa.status, qa.completed_at,
                qq.key, qq.sort_order, qq.input_type, qq.prompt_zh, qq.prompt_en,
                qr.answer, qr.answered_at
           FROM questionnaire_assignments qa
           JOIN questionnaire_questions qq ON qq.questionnaire_id = qa.questionnaire_id AND qq.is_active = true
           LEFT JOIN questionnaire_responses qr ON qr.assignment_id = qa.id AND qr.question_id = qq.id
          WHERE qa.id = ANY($1::int[])
          ORDER BY qa.id ASC, qq.sort_order ASC`,
        [assignmentIds]
    );
    const byAssignment = new Map();
    for (const r of rows) {
        if (!byAssignment.has(r.assignment_id)) {
            byAssignment.set(r.assignment_id, {
                round: byAssignment.size + 1,
                status: r.status,
                completed_at: r.completed_at ? _ts(r.completed_at) : null,
                questions: [],
            });
        }
        byAssignment.get(r.assignment_id).questions.push({
            key: r.key,
            input_type: r.input_type,
            prompt_zh: r.prompt_zh,
            prompt_en: r.prompt_en,
            // null means asked-but-unanswered, which the agent must be able to tell apart from an
            // answer that happens to be empty.
            answer: r.answered_at ? r.answer : null,
            answered_at: r.answered_at ? _ts(r.answered_at) : null,
        });
    }
    return [...byAssignment.values()];
}

async function fetchMemoryFacts(pool, userId) {
    const { rows } = await pool.query(
        `SELECT category, fact_zh, first_mentioned_at, last_mentioned_at
         FROM user_memory_facts WHERE user_id = $1 AND status = 'active'
         ORDER BY category, last_mentioned_at DESC`,
        [userId]
    );
    return rows.map(r => ({
        category: r.category,
        fact: r.fact_zh,
        first_mentioned_at: _ts(r.first_mentioned_at),
        last_mentioned_at: _ts(r.last_mentioned_at),
    }));
}

// ---------------------------------------------------------------------------------------
// Interventions (NOT a twin layer — CLAUDE.md 34)
// ---------------------------------------------------------------------------------------

async function fetchActiveHealthPlans(pool, userId, language) {
    const { rows } = await pool.query(
        `SELECT hp.id, hp.plan_type, hp.status, hp.start_date, hp.duration_weeks, hp.baseline_data,
                hpt.name_en, hpt.name_zh, hpt.goal_en, hpt.goal_zh, hpt.target_sub_ages,
                (SELECT COUNT(*) FROM health_plan_checkins WHERE plan_id = hp.id) AS checkin_count,
                (SELECT COUNT(*) FROM health_plan_milestones WHERE plan_id = hp.id) AS milestones_done
         FROM health_plans hp
         LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
         WHERE hp.user_id = $1 AND hp.status = 'active'
         ORDER BY hp.start_date DESC LIMIT 5`,
        [userId]
    );
    return rows.map(p => ({
        plan_type: p.plan_type,
        name: language === 'zh' ? p.name_zh : p.name_en,
        goal: language === 'zh' ? p.goal_zh : p.goal_en,
        target_sub_ages: p.target_sub_ages || [],
        weeks_elapsed: Math.max(0, Math.floor((Date.now() - new Date(p.start_date).getTime()) / (7 * 86400000))),
        total_weeks: p.duration_weeks,
        checkin_count: parseInt(p.checkin_count || 0, 10),
        milestones_done: parseInt(p.milestones_done || 0, 10),
    }));
}

// recipe is JSONB ({dots: {"DOT-N1": count}}), not per-dot columns — flatten in JS. Scoped to
// the ACTIVE plan: a user accumulates schedule rows across superseded/pending plans from
// repeated re-formulation, so an unscoped query returns contradictory overlapping days.
async function fetchNutritionSchedule(pool, userId, limit = 60) {
    const n = clampInt(limit, 60, 1, 200);
    const { rows } = await pool.query(
        `SELECT ns.scheduled_date::text AS scheduled_date, ns.slot_name, ns.recipe, ns.is_taken, np.status AS plan_status
         FROM nutrition_schedules ns JOIN nutrition_plans np ON np.id = ns.plan_id
         WHERE ns.user_id = $1 AND np.status = 'active'
         ORDER BY ns.scheduled_date DESC LIMIT $2`,
        [userId, n]
    );
    const flattened = [];
    for (const row of rows) {
        const dots = row.recipe?.dots || {};
        for (const [dotKey, count] of Object.entries(dots)) {
            flattened.push({
                scheduled_date: row.scheduled_date,
                slot_name: row.slot_name,
                dot_key: dotKey,
                count,
                is_taken: row.is_taken,
                plan_status: row.plan_status,
            });
        }
    }
    return flattened;
}

async function fetchDotInventory(pool, userId) {
    const { rows } = await pool.query(
        `SELECT uc.dot_id, d.key_name, d.name, d.name_zh, uc.total_dots, uc.remaining_dots,
                uc.status, uc.last_dispensed_at
         FROM user_cartridges uc JOIN dots d ON d.id = uc.dot_id
         WHERE uc.user_id = $1 AND uc.status = 'active'
         ORDER BY uc.last_dispensed_at DESC NULLS LAST LIMIT 20`,
        [userId]
    );
    return rows.map(r => ({ ...r, last_dispensed_at: _ts(r.last_dispensed_at) }));
}

async function fetchReminders(pool, userId, limit = 20) {
    const n = clampInt(limit, 20, 1, 50);
    const { rows } = await pool.query(
        `SELECT content, scheduled_for, recurrence, status FROM reminders
         WHERE user_id = $1 ORDER BY scheduled_for DESC LIMIT $2`,
        [userId, n]
    );
    return rows.map(r => ({ ...r, scheduled_for: _ts(r.scheduled_for) }));
}

async function fetchDotsFormulary(pool) {
    const { rows } = await pool.query(
        `SELECT id, key_name, key_name_zh, name, name_zh, description, is_isolate, timing,
                timing_flexible, sub_age_target, ingredients, ingredients_zh,
                target_dots_min, target_dots_max, dosing_protocol,
                pulse_days_per_cycle, pulse_cycle_days
         FROM dots ORDER BY id ASC`
    );
    return rows;
}

// ---------------------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------------------

// What EXISTS for this subject, as counts and date ranges — not the data itself.
//
// The bundle is a digest, deliberately: a document_review job needs none of the bulk history,
// and inlining it would make every job pay for data most ignore while the payload grows without
// bound as a user accumulates tenure. But a worker cannot sensibly decide what to pull if it has
// to probe blindly, so the bundle carries this instead: one cheap aggregate per resource telling
// it exactly what is there and over what period. Everything listed here is then reachable
// through the paginated /viva-ag/* resource endpoints.
async function fetchInventory(pool, userId) {
    const one = async (label, sql, params = [userId]) => {
        try {
            const { rows: [r] } = await pool.query(sql, params);
            const count = parseInt(r.count, 10) || 0;
            return { count, first: r.first ? _ts(r.first) : null, last: r.last ? _ts(r.last) : null };
        } catch (err) {
            console.error(JSON.stringify({ level: 'ERROR', msg: 'twinBundle inventory failed', section: label, error: err.message }));
            return { count: 0, first: null, last: null, error: true };
        }
    };

    const [kino, bodyComp, events, reports, documents, chat, labEvents] = await Promise.all([
        one('kino', `SELECT COUNT(*) count, MIN(tested_at) first, MAX(tested_at) last FROM biomarkers
                     WHERE user_id=$1 AND test_type='kino_chip' AND (data->'validated') IS NOT NULL`),
        one('body_composition', `SELECT COUNT(*) count, MIN(tested_at) first, MAX(tested_at) last FROM biomarkers
                     WHERE user_id=$1 AND test_type='body_composition'`),
        one('health_events', `SELECT COUNT(*) count, MIN(recorded_at) first, MAX(recorded_at) last FROM health_events WHERE user_id=$1`),
        one('health_reports', `SELECT COUNT(*) count, MIN(report_date) first, MAX(report_date) last FROM health_reports WHERE user_id=$1`),
        one('documents', `SELECT COUNT(*) count, MIN(created_at) first, MAX(created_at) last FROM health_documents WHERE user_id=$1 AND status='active'`),
        one('chat', `SELECT COUNT(*) count, MIN(created_at) first, MAX(created_at) last FROM chat_messages WHERE user_id=$1 AND role IN ('user','ai','assistant','coach')`),
        one('lab_events', `SELECT COUNT(*) count, MIN(recorded_at) first, MAX(recorded_at) last FROM health_events WHERE user_id=$1 AND category='lab_result'`),
    ]);

    // Per-category breakdown: 'vitals' outnumbers everything else by ~50x, so a worker that only
    // wants sleep should be able to see that before paging through tens of thousands of rows.
    let byCategory = {};
    try {
        const { rows } = await pool.query(
            `SELECT category, COUNT(*) count, MIN(recorded_at) first, MAX(recorded_at) last
             FROM health_events WHERE user_id=$1 GROUP BY category ORDER BY 2 DESC`, [userId]);
        byCategory = Object.fromEntries(rows.map(r => [r.category,
            { count: parseInt(r.count, 10), first: _ts(r.first), last: _ts(r.last) }]));
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'twinBundle inventory categories failed', error: err.message }));
    }

    return {
        // Each entry names the endpoint that serves it, so the contract is discoverable from a
        // live bundle rather than only from the docs.
        kino_tests:        { ...kino,      endpoint: '/api/viva-ag/biomarker-history' },
        body_composition:  { ...bodyComp,  endpoint: '/api/viva-ag/biomarker-history?test_type=body_composition' },
        health_events:     { ...events,    endpoint: '/api/viva-ag/health-events', by_category: byCategory },
        lab_results:       { ...labEvents, endpoint: '/api/viva-ag/lab-results' },
        health_reports:    { ...reports,   endpoint: '/api/viva-ag/lab-results' },
        documents:         { ...documents, endpoint: '(included in layers.medical_records.documents)' },
        chat_messages:     { ...chat,      endpoint: '/api/viva-ag/chat-history',
                             note: 'Not included in this bundle. Opt-in per job; defaults to a recent window.' },
    };
}

// ---------------------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------------------

/**
 * Builds the complete twin bundle for one user.
 *
 * `subject` deliberately carries NO user_id, external_id, nickname or phone. The agent does
 * not need an identity to analyze a twin, so the bundle is pseudonymous: a copy leaked from
 * the agent's side cannot be tied back to a person from its own contents. The only handle is
 * the caller-supplied `ref` (the job_uid).
 *
 * @param {object} pool  pg pool
 * @param {object} opts
 * @param {object} opts.user         a users row (needs bio_data, birth_date, gender, language)
 * @param {string} opts.ref          opaque reference echoed into `subject.ref` (the job_uid)
 * @param {number[]|null} opts.documentIds  restrict documents to this snapshot; null = all active
 * @param {number} opts.urlTtlSeconds       presigned document URL lifetime
 */
async function buildTwinBundle(pool, { user, ref, documentIds = null, urlTtlSeconds = DEFAULT_DOC_URL_TTL_SECONDS, questionnaireAssignmentIds = null }) {
    const userId = user.user_id;
    const language = user.language || 'zh';

    const [
        latestBio, bioHistory, twin, weightHistory,
        reports, documents, questionnaireRows, memoryFacts,
        healthPlans, schedule, inventory, reminders, formulary, dataInventory, jobQuestionnaires,
    ] = await Promise.all([
        _safe('latest_biomarkers', () => fetchLatestBiomarkers(pool, userId), null),
        _safe('biomarker_history', () => fetchBiomarkerHistory(pool, userId), { total_count: 0, tests: [] }),
        _safe('health_twin', () => fetchHealthTwin(pool, userId), null),
        _safe('weight_history', () => fetchWeightHistory(pool, userId), []),
        _safe('health_reports', () => fetchHealthReports(pool, userId), []),
        _safe('health_documents', () => fetchHealthDocuments(pool, userId, documentIds), []),
        _safe('questionnaires', () => fetchQuestionnaireRows(pool, userId), []),
        _safe('memory_facts', () => fetchMemoryFacts(pool, userId), []),
        _safe('health_plans', () => fetchActiveHealthPlans(pool, userId, language), []),
        _safe('nutrition_schedule', () => fetchNutritionSchedule(pool, userId), []),
        _safe('dot_inventory', () => fetchDotInventory(pool, userId), []),
        _safe('reminders', () => fetchReminders(pool, userId), []),
        _safe('dots_formulary', () => fetchDotsFormulary(pool), []),
        _safe('inventory', () => fetchInventory(pool, userId), null),
        _safe('job_questionnaires', () => fetchJobQuestionnaires(pool, questionnaireAssignmentIds), []),
    ]);

    // Same BMI precedence handlePostChat uses: prefer a real scale/wearable reading over the
    // onboarding self-report, and precompute rather than shipping raw height/weight for the
    // consumer to (mis)derive.
    const heightCm = user.bio_data?.height;
    const weightKg = twin?.latest_weight_kg ?? user.bio_data?.weight;
    const bmi = twin?.latest_bmi != null
        ? Math.round(twin.latest_bmi * 10) / 10
        : (heightCm && weightKg ? Math.round((weightKg / ((heightCm / 100) ** 2)) * 10) / 10 : null);

    return {
        bundle_version: BUNDLE_VERSION,
        generated_at: _ts(getNowShanghai().toJSDate()),
        subject: {
            ref,
            age: calculateAge(user.birth_date),
            gender: user.gender || null,
            language,
            height_cm: heightCm ?? null,
            bmi,
            health_conditions: user.bio_data?.health_conditions || [],
            health_conditions_other: user.bio_data?.health_conditions_other || null,
        },
        layers: {
            precision_testing: {
                latest: latestBio,
                total_tests: bioHistory.total_count,
                history: bioHistory.tests,
            },
            daily_monitoring: {
                health_twin: twin,
                weight_history: weightHistory,
            },
            medical_records: {
                health_reports: reports,
                lab_panel: twin?.latest_lab_data || null,
                lab_date: twin?.latest_lab_date || null,
                documents: presignDocuments(documents, urlTtlSeconds),
            },
            personal_profile: {
                bio_data: user.bio_data || null,
                questionnaire_context: formatQuestionnaireContext(questionnaireRows, language),
                memory_facts: memoryFacts,
            },
        },
        interventions: {
            active_health_plans: healthPlans,
            nutrition_schedule: schedule,
            dot_inventory: inventory,
            reminders,
        },
        dots_formulary: formulary,
        // Clarifying questions THIS job asked, per round. Empty for a job that never asked.
        job_questionnaires: jobQuestionnaires,
        // What else exists but is NOT inlined here — see fetchInventory's docblock.
        inventory: dataInventory,
    };
}

module.exports = {
    BUNDLE_VERSION,
    fetchInventory,
    DEFAULT_DOC_URL_TTL_SECONDS,
    buildTwinBundle,
    presignDocuments,
    fetchHealthDocuments,
    fetchJobQuestionnaires,
    clampInt,
};
