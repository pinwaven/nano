'use strict';
/**
 * The read half of the twin function: the change listing, the bundle, the bulk feeds and a
 * document URL, all keyed on subject_ref. Nothing here writes.
 *
 * The bundle and its version come from shared/ — byte-identical copies of the worker's modules
 * (scripts/sync-twin-shared.js) — so a bundle minted here and one minted for a job hash the same.
 */
const { pool } = require('../shared/worker/lib/db');
const { buildTwinBundle, presignDocuments, BUNDLE_VERSION, DEFAULT_DOC_URL_TTL_SECONDS, clampInt } = require('../shared/worker/lib/twinBundle');
const { listTwinVersions, twinChangedAtFor, twinVersionOf } = require('../shared/worker/lib/twinMirror');
const { formatToShanghai } = require('../shared/worker/lib/time-utils');
const { fail, REASONS } = require('./reasons');

// A twin_seq is drawn before its transaction commits, so a lower number can become visible after
// a higher one. A feed only hands out rows stamped longer ago than this; with every write
// transaction shorter than it, a cursor never passes a row that is still to appear.
const SETTLE_SECONDS = Number(process.env.TWIN_SETTLE_SECONDS || 60);
const PAGE_DEFAULT = 500;
const PAGE_MAX = 2000;

async function resolveSubject(subjectRef) {
    const ref = String(subjectRef || '').trim();
    if (!ref) return { error: fail(REASONS.MISSING_PARAMS, 'subject_ref is required') };
    const { rows: [user] } = await pool.query(
        `SELECT u.user_id, u.nickname, u.gender, u.birth_date, u.language, u.bio_data, u.channel_id
           FROM viva_ag_subjects s JOIN users u ON u.user_id = s.user_id
          WHERE s.subject_ref = $1`, [ref]);
    if (!user) return { error: fail(REASONS.SUBJECT_NOT_FOUND, 'No such subject, or the subject no longer exists') };
    return { ref, user };
}

// GET /versions?since=&limit=
async function versions(query) {
    let since = null;
    if (query?.since != null && query.since !== '') {
        const t = new Date(String(query.since));
        if (Number.isNaN(t.getTime())) return fail(REASONS.MISSING_PARAMS, 'since must be an ISO-8601 timestamp');
        since = t.toISOString();
    }
    const limit = clampInt(query?.limit, 500, 1, 2000);
    const subjects = await listTwinVersions(pool, { since, limit });
    return { success: true, as_of: new Date().toISOString(), since, subjects, truncated: subjects.length === limit };
}

// GET /bundle?subject_ref=
async function bundle(query) {
    const { error, ref, user } = await resolveSubject(query?.subject_ref);
    if (error) return error;
    const b = await buildTwinBundle(pool, {
        user, ref, documentIds: null, urlTtlSeconds: DEFAULT_DOC_URL_TTL_SECONDS, questionnaireAssignmentIds: null,
    });
    return {
        success: true, ...b, subject_ref: ref,
        twin_version: twinVersionOf(b),
        twin_changed_at: await twinChangedAtFor(pool, user.user_id),
    };
}

// GET /document-url?subject_ref=&document_id=
async function documentUrl(query) {
    const { error, user } = await resolveSubject(query?.subject_ref);
    if (error) return error;
    const documentId = parseInt(query?.document_id, 10);
    if (!documentId) return fail(REASONS.MISSING_PARAMS, 'document_id is required');
    const { rows: [doc] } = await pool.query(
        `SELECT *, doc_date::text AS doc_date FROM health_documents
          WHERE id = $1 AND user_id = $2 AND status = 'active'`, [documentId, user.user_id]);
    if (!doc) return fail(REASONS.DOCUMENT_NOT_FOUND);
    const [entry] = presignDocuments([doc], DEFAULT_DOC_URL_TTL_SECONDS);
    return { success: true, ...entry };
}

// The four bulk tables, each paged on twin_seq (migration_twin_sync.sql). `cols` and `where` are
// literals chosen here, never request data. `origin` is the contribution a row came from, when it
// came from one, so a replica can recognise its own writes coming back.
const FEEDS = {
    'health-events': {
        table: 'health_events',
        cols: `id, source, category, data_date::text AS data_date, recorded_at, data, external_id,
               wearable_name, report_id, ingested_at`,
        filter(query, params, where) {
            if (query?.category) { params.push(String(query.category)); where.push(`category = $${params.length}`); }
        },
        map: r => ({
            event_id: Number(r.id), source: r.source, category: r.category, data_date: r.data_date,
            recorded_at: formatToShanghai(r.recorded_at), wearable_name: r.wearable_name,
            report_id: r.report_id ? Number(r.report_id) : null, data: r.data,
            origin: r.source === 'curia' ? (r.external_id || null) : null,
        }),
    },
    'lab-reports': {
        table: 'health_reports',
        cols: `id, report_date::text AS report_date, source, institution, report_type, status, raw_data,
               created_at, source_document_id`,
        map: r => ({
            report_id: Number(r.id), report_date: r.report_date, source: r.source, institution: r.institution,
            report_type: r.report_type, status: r.status,
            source_document_id: r.source_document_id ? Number(r.source_document_id) : null,
            // image_url / oss_key are signed-link material, not data.
            observations: r.raw_data?.observations || [],
            created_at: formatToShanghai(r.created_at),
        }),
    },
    'biomarkers': {
        table: 'biomarkers',
        cols: `id, test_type, tested_at, data, created_at`,
        filter(query, params, where) {
            if (query?.test_type) { params.push(String(query.test_type)); where.push(`test_type = $${params.length}`); }
        },
        // data.validated and the profile only, never data.actual (CLAUDE.md §17).
        map: r => ({
            biomarker_id: Number(r.id), test_type: r.test_type, tested_at: formatToShanghai(r.tested_at),
            validated: r.data?.validated || null, bioage_profile: r.data?.bioage_profile || null,
            created_at: formatToShanghai(r.created_at),
        }),
    },
    'chat-messages': {
        table: 'chat_messages',
        cols: `id, role, content, image_url, persona_type, source, created_at`,
        // 'action' rows are buttons, not anything either party said.
        where: `role IN ('user','ai','assistant','coach')`,
        map: r => ({
            message_id: Number(r.id), role: r.role === 'assistant' ? 'ai' : r.role, persona_type: r.persona_type,
            content: r.content, has_image: !!r.image_url, created_at: formatToShanghai(r.created_at),
        }),
    },
};

function parseSeq(v) {
    if (v == null || v === '') return '0';
    const s = String(v);
    return /^\d{1,19}$/.test(s) ? s : null;
}

/**
 * GET /feed/<name>?subject_ref=&after=&limit=
 *
 * One stream per table: upserts and deletions merged in twin_seq order. `after` is the `next_after`
 * of the previous page (0 or absent to start from the beginning); a replica applies a page in
 * order and stores `next_after`. An upsert is the whole row as it is now — apply it by id. A
 * deletion names the id. `has_more: false` means caught up to the settle horizon, not forever.
 */
async function feed(name, query) {
    const spec = FEEDS[name];
    if (!spec) return fail(REASONS.NOT_FOUND, `no feed '${name}'; feeds: ${Object.keys(FEEDS).join(', ')}`);
    const { error, user } = await resolveSubject(query?.subject_ref);
    if (error) return error;
    const after = parseSeq(query?.after);
    if (after == null) return fail(REASONS.MISSING_PARAMS, 'after must be a non-negative integer (a previous next_after)');
    const limit = clampInt(query?.limit, PAGE_DEFAULT, 1, PAGE_MAX);

    const params = [user.user_id, after, SETTLE_SECONDS];
    const where = ['user_id = $1', 'twin_seq > $2::bigint', 'twin_seq_at < NOW() - make_interval(secs => $3)'];
    if (spec.where) where.push(spec.where);
    if (spec.filter) spec.filter(query, params, where);
    params.push(limit + 1);
    const { rows } = await pool.query(
        `SELECT ${spec.cols}, twin_seq::text AS twin_seq FROM ${spec.table}
          WHERE ${where.join(' AND ')} ORDER BY twin_seq LIMIT $${params.length}`, params);
    const { rows: gone } = await pool.query(
        `SELECT seq::text AS seq, row_id FROM twin_tombstones
          WHERE user_id = $1 AND tbl = $2 AND seq > $3::bigint AND at < NOW() - make_interval(secs => $4)
          ORDER BY seq LIMIT $5`, [user.user_id, spec.table, after, SETTLE_SECONDS, limit + 1]);

    const merged = [
        ...rows.map(r => ({ seq: BigInt(r.twin_seq), op: 'upsert', row: r })),
        ...gone.map(g => ({ seq: BigInt(g.seq), op: 'delete', id: Number(g.row_id) })),
    ].sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
    const page = merged.slice(0, limit);
    const last = page[page.length - 1];
    return {
        success: true,
        feed: name,
        after,
        next_after: last ? last.seq.toString() : after,
        has_more: merged.length > limit,
        settle_seconds: SETTLE_SECONDS,
        count: page.length,
        changes: page.map(c => c.op === 'delete'
            ? { seq: c.seq.toString(), op: 'delete', id: c.id }
            : { seq: c.seq.toString(), op: 'upsert', item: spec.map(c.row) }),
    };
}

module.exports = { resolveSubject, versions, bundle, documentUrl, feed, FEEDS, SETTLE_SECONDS, BUNDLE_VERSION };
