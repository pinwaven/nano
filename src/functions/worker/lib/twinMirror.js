/**
 * Twin mirror support for the external Viva AG agent (Curia).
 *
 * The agent keeps a per-subject replica of the twin bundle so a job does not re-download
 * an unchanged twin across a border on every claim. Nano's side of that is three things,
 * all read-only from the agent's point of view:
 *
 *   - a subject_ref per AG subject (viva_ag_subjects), minted here at first claim;
 *   - a cheap "when did this subject's twin last change" — GREATEST over the change
 *     columns of every table buildTwinBundle reads, so it can be listed for every subject
 *     in one query without assembling a single bundle;
 *   - a version hash over an assembled bundle with its volatile fields removed, so two
 *     bundles of the same twin hash the same however many times they are minted.
 *
 * The change columns are not uniform — most of these tables carry created_at only and
 * are updated in place (health_documents has deleted_at / extracted_json_at /
 * user_edited_at / summary_generated_at and no updated_at). GREATEST over what exists
 * is a change *signal*, not a proof; the agent runs a periodic full pass for what a
 * timestamp misses, and the version hash is the truth about whether a bundle changed.
 */
'use strict';

const crypto = require('crypto');

const SUBJECT_REF_PREFIX = 'vs_';

function mintSubjectRef() {
    return SUBJECT_REF_PREFIX + crypto.randomBytes(12).toString('hex');
}

// Idempotent: a subject keeps its first ref forever. Two concurrent first claims for one
// user race on the PK and the loser's INSERT is a no-op; both then read the same row.
async function ensureSubjectRef(pool, userId) {
    await pool.query(
        `INSERT INTO viva_ag_subjects (user_id, subject_ref) VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, mintSubjectRef()]
    );
    const { rows: [row] } = await pool.query(
        `SELECT subject_ref FROM viva_ag_subjects WHERE user_id = $1`, [userId]
    );
    return row ? row.subject_ref : null;
}

// One expression, correlated on s.user_id, over every table buildTwinBundle reads that is
// per-user. Keep this list in step with lib/twinBundle.js AND with the table list in
// src/schemas/migration_twin_sync.sql: a table read there and missing here is a change the
// agent will not see until its full pass. twin_touch is what catches in-place updates and
// hard deletes; the created_at columns cover history from before its triggers existed.
//
// Shared with src/functions/twin, which ships a byte-identical copy (scripts/sync-twin-shared.js).
const CHANGED_AT_SQL = `
    GREATEST(
        (SELECT MAX(created_at)  FROM biomarkers            b WHERE b.user_id = s.user_id),
        (SELECT MAX(ingested_at) FROM health_events         e WHERE e.user_id = s.user_id),
        (SELECT MAX(created_at)  FROM health_reports        r WHERE r.user_id = s.user_id),
        (SELECT MAX(created_at)  FROM health_report_items   i WHERE i.user_id = s.user_id),
        (SELECT MAX(GREATEST(created_at, deleted_at, extracted_json_at, user_edited_at, summary_generated_at))
                                 FROM health_documents      d WHERE d.user_id = s.user_id),
        (SELECT MAX(created_at)  FROM health_document_tags  t WHERE t.user_id = s.user_id),
        (SELECT last_updated_at  FROM health_twin           h WHERE h.user_id = s.user_id),
        (SELECT MAX(GREATEST(created_at, updated_at, last_mentioned_at))
                                 FROM user_memory_facts     m WHERE m.user_id = s.user_id),
        (SELECT MAX(GREATEST(assigned_at, started_at, completed_at))
                                 FROM questionnaire_assignments q WHERE q.user_id = s.user_id),
        (SELECT MAX(GREATEST(created_at, updated_at, ended_at))
                                 FROM health_plans          p WHERE p.user_id = s.user_id),
        (SELECT MAX(GREATEST(created_at, dispensed_at, taken_at))
                                 FROM nutrition_schedules   n WHERE n.user_id = s.user_id),
        (SELECT MAX(GREATEST(created_at, inserted_at, last_dispensed_at))
                                 FROM user_cartridges       c WHERE c.user_id = s.user_id),
        (SELECT MAX(created_at)  FROM reminders             rm WHERE rm.user_id = s.user_id),
        (SELECT MAX(created_at)  FROM food_sensitivity_panels fp WHERE fp.user_id = s.user_id),
        (SELECT MAX(created_at)  FROM health_plan_checkins  pc WHERE pc.user_id = s.user_id),
        (SELECT MAX(achieved_at) FROM health_plan_milestones pm WHERE pm.user_id = s.user_id),
        (SELECT MAX(qr.answered_at) FROM questionnaire_responses qr
                                 JOIN questionnaire_assignments qa ON qa.id = qr.assignment_id
                                WHERE qa.user_id = s.user_id),
        -- Every insert, update and delete on a bundle table since migration_twin_sync.sql,
        -- maintained by trigger. The columns above are what predates it.
        (SELECT touched_at       FROM twin_touch            tt WHERE tt.user_id = s.user_id),
        u.updated_at,
        s.created_at
    )`;

// changed_at travels as Postgres's own text at microsecond precision, never through a JS Date.
// A Date keeps milliseconds, so a cursor built from one sits *before* the row it came from and the
// next page returns that row again. Measured on dev 2026-09-23: 1,080 subjects minted in one
// transaction share one instant, and a millisecond cursor re-listed the same 500 every pass.
const ISO_US = `to_char(%s AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const SINCE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/**
 * Every AG subject with when its twin last changed, oldest change first, keyset-paged on
 * (changed_at, subject_ref) so any number of subjects sharing one instant still pages. Pass the
 * previous page's `next` back as { since, afterRef }. A subject whose users row is gone is reported
 * with removed: true whenever includeRemoved is set, regardless of the cursor — removal has no
 * timestamp of its own to page on, so a client asks for it on the first page of each pass (it
 * cannot be keyed on "no after_ref": once a client stores a cursor pair, every request has one).
 * Returns subject_ref only — never user_id.
 */
async function listTwinVersions(pool, { since = null, afterRef = null, limit = 500, includeRemoved = true } = {}) {
    if (since !== null && !SINCE_RE.test(since)) throw new Error('since must be an ISO-8601 UTC timestamp');
    // The expression is evaluated once per subject, in the inner SELECT; the filter reads the column.
    const { rows } = await pool.query(
        `SELECT subject_ref, removed, ${ISO_US.replace('%s', 'changed_at')} AS changed_at
           FROM (SELECT s.subject_ref,
                        (u.user_id IS NULL) AS removed,
                        ${CHANGED_AT_SQL} AS changed_at
                   FROM viva_ag_subjects s
                   LEFT JOIN users u ON u.user_id = s.user_id) x
          WHERE (removed AND $4::boolean)
             OR $1::timestamptz IS NULL
             OR changed_at > $1::timestamptz
             OR (changed_at = $1::timestamptz AND subject_ref > COALESCE($2::text, ''))
          ORDER BY changed_at ASC NULLS FIRST, subject_ref ASC
          LIMIT $3`,
        [since, afterRef, limit, includeRemoved]
    );
    return rows.map(r => ({ subject_ref: r.subject_ref, removed: !!r.removed, changed_at: r.changed_at || null }));
}

async function twinChangedAtFor(pool, userId) {
    const { rows: [row] } = await pool.query(
        `SELECT ${ISO_US.replace('%s', CHANGED_AT_SQL)} AS changed_at
           FROM viva_ag_subjects s LEFT JOIN users u ON u.user_id = s.user_id
          WHERE s.user_id = $1`,
        [userId]
    );
    return row?.changed_at || null;
}

// Fields that differ between two mints of the same twin and must not move the version:
// the mint time, presigned document URLs and their expiry, and anything about the job
// the bundle was assembled for rather than about the subject.
const VOLATILE_TOP = new Set(['success', 'generated_at', 'job', 'job_questionnaires', 'twin_version', 'twin_changed_at', 'subject_ref']);
const VOLATILE_DOC = new Set(['url', 'url_expires_at']);

function _canonical(value) {
    if (Array.isArray(value)) return value.map(_canonical);
    if (value && typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value).sort()) out[k] = _canonical(value[k]);
        return out;
    }
    return value;
}

function _stripVolatile(bundle) {
    const b = {};
    for (const k of Object.keys(bundle)) if (!VOLATILE_TOP.has(k)) b[k] = bundle[k];
    if (b.subject && typeof b.subject === 'object') {
        const { ref, ...rest } = b.subject;   // ref is the job_uid or the subject_ref — not the twin
        b.subject = rest;
    }
    const docs = b.layers?.medical_records?.documents;
    if (Array.isArray(docs)) {
        b.layers = { ...b.layers, medical_records: { ...b.layers.medical_records,
            documents: docs.map(d => {
                const o = {};
                for (const k of Object.keys(d)) if (!VOLATILE_DOC.has(k)) o[k] = d[k];
                return o;
            }) } };
    }
    return b;
}

/** sha256 over the canonical JSON of the bundle minus its volatile fields. */
function twinVersionOf(bundle) {
    return crypto.createHash('sha256')
        .update(JSON.stringify(_canonical(_stripVolatile(bundle))))
        .digest('hex');
}

module.exports = {
    SUBJECT_REF_PREFIX,
    mintSubjectRef,
    ensureSubjectRef,
    listTwinVersions,
    twinChangedAtFor,
    twinVersionOf,
    _stripVolatile,
};
