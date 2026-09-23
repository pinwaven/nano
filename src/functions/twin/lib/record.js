'use strict';
/**
 * The full record of one subject — for a report written about a person and addressed to them
 * (Curia's health-report skill), which reads far more than the bundle digests: every table that
 * carries a user_id, two joined views, the reference tables, and the files behind the rows.
 *
 * It replaces that skill's direct connection to nano's database and bucket (decided 2026-09-23:
 * nothing between Curia and nano outside this function). That was nano's read-write account over
 * every user; this is one subject per call, read-only, with identifiers and contact data removed:
 *
 *   - `user_id` is dropped from every row, and every column whose name is a credential, a contact
 *     channel or an address (DENY below) is dropped wherever it appears;
 *   - only the tables that are a health record (ALLOW), not the coach CRM, identity or commission
 *     tables beside them;
 *   - the profile keeps what a report is addressed with — nickname, the person's name, gender,
 *     birth date, language, body data — and nothing that reaches them (phone, email, openid, ID);
 *   - a file is reached through /file, which presigns a key only when one of this subject's own
 *     rows names it, for ten minutes.
 *
 * Unlike the rest of this function, /record and /subjects carry the person's name: the report is
 * written to them by name. That is why they are separate routes and not fields on the bundle.
 */
const { pool } = require('../shared/worker/lib/db');
const ossLib = require('../shared/worker/lib/oss');
const { resolveSubject } = require('./read');
const { fail, REASONS } = require('./reasons');

// The tables that are this person's health record, and only those. An allowlist, not the
// catalogue: coach CRM notes, identity tables (user_phones, user_emails, user_identities),
// commissions, academy and partner records are not a health record and a report does not read them.
const ALLOW = new Set([
    'biomarkers', 'box_batches', 'chat_messages', 'food_sensitivity_panels', 'food_sensitivity_results',
    'health_document_tags', 'health_documents', 'health_events', 'health_plan_checkins', 'health_plan_milestones',
    'health_plans', 'health_report_items', 'health_reports', 'health_twin', 'lab_orders', 'nutrition_plans',
    'nutrition_schedules', 'orders', 'program_enrollments', 'questionnaire_assignments', 'reminders', 'scans',
    'user_cartridges', 'user_memory_facts', 'viva_ag_formulations', 'viva_ag_jobs',
]);

// Column names that never leave, in any table: identifiers, credentials, contact channels,
// addresses — and the raw lab exchange, whose JSON carries the person's name, phone and ID number
// as sent to the lab (lab_final_result, the results, stays).
const DENY = /^(user_id|openid|unionid|union_id|phone|phone_number|mobile|contact_phone|email|password.*|pass_hash|.*token.*|.*secret.*|.*api_key.*|id_card.*|id_number|government_id|.*address.*|receiver.*|recipient.*|shipping_.*|consignee.*|wx_.*|wechat_.*|external_id|external_ref|session.*|ip|ip_addr|last_ip|lab_request|lab_response|lab_last_result)$/i;
// What a report is addressed with. first/last name are the person's own name for the cover;
// government_id, phone and email are not here and never will be.
const PROFILE = ['nickname', 'first_name', 'last_name', 'gender', 'birth_date', 'language', 'bio_data', 'preferences',
    'wearable_brand', 'wearable_name', 'viva_ag_expires_at', 'created_at'];
const FILE_TTL = 600;

// A DATE (oid 1082) comes back as its own 'YYYY-MM-DD'. node-postgres otherwise parses it at local
// midnight and JSON renders a UTC instant — a birth date of 1976-10-21 left here as
// "1976-10-20T16:00:00Z" (CLAUDE.md §35's trap). Per query, so the queue handlers sharing this pool
// keep the parsing they were written against.
const pgTypes = require('pg').types;
const TYPES = { getTypeParser: (oid, fmt) => (oid === 1082 ? (v => v) : pgTypes.getTypeParser(oid, fmt)) };
const q = (text, values) => pool.query({ text, values, types: TYPES });
const PAGE_MAX = 2000;

const JOINED = {
    questionnaire_answers: `SELECT r.*, qa.questionnaire_id, qa.status AS assignment_status, q.name_zh AS questionnaire,
                                   qq.key, qq.prompt_zh, qq.prompt_en, qq.input_type
                              FROM questionnaire_responses r JOIN questionnaire_assignments qa ON qa.id = r.assignment_id
                              LEFT JOIN questionnaires q ON q.id = qa.questionnaire_id
                              LEFT JOIN questionnaire_questions qq ON qq.id = r.question_id
                             WHERE qa.user_id = $1 ORDER BY r.answered_at, r.id`,
    cartridges_named: `SELECT c.*, d.key_name, d.name_zh FROM user_cartridges c JOIN dots d ON d.id = c.dot_id
                        WHERE c.user_id = $1 ORDER BY c.dot_id`,
};

function scrub(row) {
    const out = {};
    for (const [k, v] of Object.entries(row)) if (!DENY.test(k)) out[k] = v;
    return out;
}

let _tables = null;
async function userTables() {
    // Read from the catalogue, never from the request: the only table names ever put into SQL.
    if (!_tables) {
        const { rows } = await pool.query(
            `SELECT table_name FROM information_schema.columns
              WHERE table_schema = 'public' AND column_name = 'user_id' ORDER BY 1`);
        _tables = rows.map(r => r.table_name).filter(t => ALLOW.has(t));
    }
    return _tables;
}

// GET /subjects?q=<nano user id | exact nickname>
// For the operator who knows who the report is for. Exact matches only — no pattern, no listing.
async function subjects(query) {
    const term = String(query?.q || '').trim();
    if (!term) return fail(REASONS.MISSING_PARAMS, 'q is required: a nano user id or an exact nickname');
    const { rows } = await pool.query(
        `SELECT s.subject_ref, u.nickname, u.created_at FROM users u JOIN viva_ag_subjects s ON s.user_id = u.user_id
          WHERE u.user_id = $1 OR lower(u.nickname) = lower($1) ORDER BY u.created_at LIMIT 10`, [term]);
    return { success: true, subjects: rows.map(r => ({ subject_ref: r.subject_ref, nickname: r.nickname, created_at: r.created_at })) };
}

// GET /record/profile?subject_ref=
async function profile(query) {
    const { error, ref, user } = await resolveSubject(query?.subject_ref);
    if (error) return error;
    const { rows: [u] } = await q('SELECT * FROM users WHERE user_id = $1', [user.user_id]);
    const p = {};
    for (const k of PROFILE) if (u && k in u) p[k] = u[k];
    const { rows: [ch] } = await pool.query('SELECT key_name, name FROM channels WHERE id = $1', [u?.channel_id ?? null]);
    return { success: true, subject_ref: ref, profile: { ...p, channel: ch || null } };
}

// GET /record/tables?subject_ref=  — which tables hold rows for this subject, and how many.
async function tables(query) {
    const { error, ref, user } = await resolveSubject(query?.subject_ref);
    if (error) return error;
    const out = [];
    for (const t of await userTables()) {
        const { rows: [c] } = await pool.query(`SELECT COUNT(*)::int AS n FROM "${t}" WHERE user_id = $1`, [user.user_id]);
        if (c.n) out.push({ table: t, rows: c.n });
    }
    for (const [name, sql] of Object.entries(JOINED)) {
        const { rows: [c] } = await pool.query(`SELECT COUNT(*)::int AS n FROM (${sql}) x`, [user.user_id]);
        if (c.n) out.push({ table: name, rows: c.n, joined: true });
    }
    return { success: true, subject_ref: ref, tables: out };
}

// GET /record/table?subject_ref=&table=&offset=&limit=
async function table(query) {
    const { error, user } = await resolveSubject(query?.subject_ref);
    if (error) return error;
    const name = String(query?.table || '');
    const offset = Math.max(0, parseInt(query?.offset, 10) || 0);
    const limit = Math.min(PAGE_MAX, Math.max(1, parseInt(query?.limit, 10) || PAGE_MAX));
    let sql;
    if (JOINED[name]) sql = JOINED[name];
    else if ((await userTables()).includes(name)) sql = `SELECT * FROM "${name}" WHERE user_id = $1`;
    else return fail(REASONS.NOT_FOUND, `no table '${name}' for a subject`);
    // Ordered outside the subquery: an inner ORDER BY is not promised to survive OFFSET, and a page
    // boundary that moves between calls drops or repeats rows.
    const { rows } = await q(`SELECT * FROM (${sql}) x ORDER BY 1 OFFSET $2 LIMIT $3`, [user.user_id, offset, limit + 1]);
    const page = rows.slice(0, limit).map(scrub);
    return { success: true, table: name, offset, count: page.length, has_more: rows.length > limit, rows: page };
}

// GET /record/reference — the tables every report needs and no subject owns.
async function reference() {
    const { rows: dots } = await pool.query(
        `SELECT id, key_name, name, name_zh, key_name_zh, description, ingredients_zh, ingredients, ingredients_summary,
                sub_age_target, sub_age_target_zh, timing, timing_flexible, target_dots_min, target_dots_max, is_isolate,
                group_name_zh, color_hex, dosing_protocol, pulse_days_per_cycle, pulse_cycle_days FROM dots ORDER BY id`);
    const opt = async (sql) => { try { return (await q(sql)).rows; } catch (e) { return []; } };
    return {
        success: true, dots,
        biomarker_catalog: await opt('SELECT * FROM biomarker_catalog ORDER BY 1'),
        health_plan_templates: await opt('SELECT * FROM health_plan_templates ORDER BY id'),
    };
}

// GET /file?subject_ref=&key=  — a ten-minute URL for a file one of this subject's rows names.
async function file(query) {
    const { error, user } = await resolveSubject(query?.subject_ref);
    if (error) return error;
    const key = String(query?.key || '').trim();
    if (!key || key.includes('..')) return fail(REASONS.MISSING_PARAMS, 'key is required');
    // Exact matches, and strpos rather than LIKE for the image URL: a key carrying % or _ must not
    // become a pattern that matches some other row and presigns a file nobody named.
    const encoded = key.split('/').map(encodeURIComponent).join('/');
    const { rows: [hit] } = await pool.query(
        `SELECT 1 FROM health_documents WHERE user_id = $1 AND oss_key = $2
         UNION ALL SELECT 1 FROM health_reports WHERE user_id = $1
                AND (oss_key = $2 OR strpos(raw_data->>'image_url', '/' || $2) > 0 OR strpos(raw_data->>'image_url', '/' || $3) > 0)
         UNION ALL SELECT 1 FROM biomarkers WHERE user_id = $1 AND data->>'oss_key' = $2
         UNION ALL SELECT 1 FROM lab_orders WHERE user_id = $1 AND report_pdf_key = $2
         LIMIT 1`, [user.user_id, key, encoded]);
    if (!hit) return fail(REASONS.NOT_FOUND, 'no file by that key for this subject');
    return { success: true, url: ossLib.generatePresignedGetUrl(key, FILE_TTL), expires_in: FILE_TTL };
}

module.exports = { subjects, profile, tables, table, reference, file, DENY, ALLOW, PROFILE, scrub };
