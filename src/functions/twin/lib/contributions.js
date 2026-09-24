'use strict';
/**
 * The write half of the twin function: what an external twin holder (Curia) sends back.
 *
 * One envelope for every kind of write-back, so "the twin changed on the other side" has one
 * shape here however many things can change it:
 *
 *   { subject_ref, contribution_uid, kind, origin, payload, supersedes? }
 *
 * contribution_uid — a UUID the SENDER mints. A POST that arrives twice (a reply lost on the way
 *   back is indistinguishable from a request never sent) finds its own row and returns it; nothing
 *   is written twice.
 * origin — who produced it. Nano shows a contribution to the user and to their coach, and a
 *   report or a finding has to say whose it is: a platform agent (Viva) and a named physician's
 *   agent are different speakers, and output no gate checked is a third thing. Stored verbatim on
 *   the contribution and on the row it lands in.
 * kind — what it is, and therefore where in nano it lands. Only kinds with a decided landing place
 *   are accepted; the rest answer `unsupported_kind` rather than being parked somewhere nano would
 *   not show them.
 *
 *   report        → a completed viva_ag_jobs row with its files, which is what the 数字孪生
 *                   综合报告 card and the Viva AG panel list (handlers/twin_reports.js).
 *   observations  → not yet: see docs/architecture/twin-function.md §Open.
 *   finding       → not yet: see the same section.
 */
const crypto = require('crypto');
const { pool } = require('../shared/worker/lib/db');
const ossLib = require('../shared/worker/lib/oss');
const { resolveSubject } = require('./read');
const { fail, REASONS } = require('./reasons');

const KINDS_ACCEPTED = new Set(['report']);
const KINDS_KNOWN = new Set(['report', 'observations', 'finding']);

// Mirrors handlers/viva_ag.js — the card presents exactly these.
const FILE_TYPES = { pdf: 'application/pdf', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8' };
const FILE_RANK = { pdf: 0, md: 1, txt: 2 };
const MAX_FILES = 5;
const MAX_SUMMARY_LENGTH = 4000;
// handlers/twin_reports.js titles these; anything else would show as its free-text command.
const REPORT_KEYS = new Set(['full_analysis', 'document_review', 'risk_screen', 'dots_formulation', 'food_sensitivity_review']);
const REPORT_COMMAND = {
    full_analysis: '全维度健康分析报告',
    document_review: '医疗文件解读报告',
    risk_screen: '健康风险筛查报告',
    dots_formulation: '原粒定制配方报告',
    food_sensitivity_review: '食物不耐受解读报告',
};
// Rows written by the health-report skill before this function existed are claimed_by
// 'claude-code-analyst'; a contribution may supersede those and its own, never a job nano's
// queue delivered through /viva-ag/jobs/result.
const SUPERSEDABLE_BY = ['curia-twin', 'claude-code-analyst'];
const CLAIMED_BY = 'curia-twin';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const keyPrefix = uid => `viva-ag-results/${uid}/`;

function _uid(v) {
    const s = String(v || '').trim().toLowerCase();
    return UUID.test(s) ? s : null;
}

function _str(v, max) {
    return String(v ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim().slice(0, max);
}

/**
 * origin: { agent_id, principal_kind: 'platform-agent'|'physician', display_name, gated, reviewed? }
 * Required, and checked for shape only: nano cannot verify a Curia principal, and says so by
 * storing what it was told under `origin` rather than promoting it into anything nano asserts.
 */
function _origin(raw) {
    const o = raw && typeof raw === 'object' ? raw : null;
    if (!o) return { error: fail(REASONS.INVALID_ORIGIN, 'origin is required') };
    const agentId = _str(o.agent_id, 64);
    const kind = _str(o.principal_kind, 32);
    const display = _str(o.display_name, 80);
    if (!agentId) return { error: fail(REASONS.INVALID_ORIGIN, 'origin.agent_id is required') };
    if (kind !== 'platform-agent' && kind !== 'physician') {
        return { error: fail(REASONS.INVALID_ORIGIN, "origin.principal_kind must be 'platform-agent' or 'physician'") };
    }
    if (!display) return { error: fail(REASONS.INVALID_ORIGIN, 'origin.display_name is required') };
    if (typeof o.gated !== 'boolean') {
        return { error: fail(REASONS.INVALID_ORIGIN, 'origin.gated must be true or false — whether the content passed the sender\'s own output checks') };
    }
    return { origin: {
        system: 'curia', agent_id: agentId, principal_kind: kind, display_name: display, gated: o.gated,
        reviewed: typeof o.reviewed === 'boolean' ? o.reviewed : null,
    } };
}

function _safeFilename(raw, ext) {
    let name = String(raw || '').replace(/[\r\n\t\x00-\x1f]/g, '').replace(/[\\/"]/g, '_').trim();
    if (!name) name = `report.${ext}`;
    if (name.length > 120) name = name.slice(0, 120);
    if (!name.toLowerCase().endsWith(`.${ext}`)) name = `${name}.${ext}`;
    return name;
}

async function _existing(uid) {
    const { rows: [row] } = await pool.query(
        `SELECT contribution_uid::text AS contribution_uid, user_id, kind, status, target
           FROM twin_contributions WHERE contribution_uid = $1`, [uid]);
    return row || null;
}

// POST /contributions/upload-url { subject_ref, contribution_uid, filename }
// A presigned PUT under the contribution's own prefix. The uid is the sender's; nothing is stored
// until the contribution itself is posted, and that post accepts only keys under this prefix.
async function uploadUrl(body) {
    const { error, user } = await resolveSubject(body?.subject_ref);
    if (error) return error;
    const uid = _uid(body?.contribution_uid);
    if (!uid) return fail(REASONS.MISSING_PARAMS, 'contribution_uid must be a UUID the sender minted');
    const prior = await _existing(uid);
    if (prior) {
        return prior.user_id === user.user_id
            ? fail(REASONS.CONFLICT, 'this contribution is already registered; files cannot be added to it')
            : fail(REASONS.CONFLICT, 'contribution_uid is in use');
    }
    const filename = String(body?.filename || 'report.pdf').trim();
    const ext = (filename.includes('.') ? filename.split('.').pop() : 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const contentType = FILE_TYPES[ext];
    if (!contentType) return fail(REASONS.UNSUPPORTED_FILE_TYPE, `allowed: ${Object.keys(FILE_TYPES).join(', ')}`);
    const key = `${keyPrefix(uid)}${crypto.randomBytes(8).toString('hex')}.${ext}`;
    return {
        success: true,
        oss_key: key,
        put_url: ossLib.generatePresignedPutUrl(key, 3600, null, contentType),
        // Part of the signature, and the only chance to set the stored type: the bucket refuses a
        // response-content-type override at download time.
        put_content_type: contentType,
        expires_in: 3600,
    };
}

async function _reportFiles(uid, raw) {
    if (!Array.isArray(raw) || !raw.length) return { error: fail(REASONS.MISSING_PARAMS, 'payload.files must name at least one uploaded file') };
    if (raw.length > MAX_FILES) return { error: fail(REASONS.TOO_MANY_FILES, `at most ${MAX_FILES} files`) };
    const seen = new Set();
    const files = [];
    for (const item of raw) {
        const entry = typeof item === 'string' ? { oss_key: item } : (item || {});
        const key = String(entry.oss_key || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (!key.startsWith(keyPrefix(uid)) || key.includes('..')) {
            return { error: fail(REASONS.INVALID_FILE_KEY, `'${key}' was not minted for this contribution`) };
        }
        const ext = key.split('.').pop().toLowerCase();
        if (!FILE_TYPES[ext]) return { error: fail(REASONS.UNSUPPORTED_FILE_TYPE, `'${ext}'`) };
        const meta = await ossLib.headObject(key);
        if (!meta) return { error: fail(REASONS.FILE_MISSING, `'${key}' was never uploaded`) };
        files.push({
            oss_key: key, filename: _safeFilename(entry.filename, ext), ext,
            content_type: meta.content_type || FILE_TYPES[ext], size_bytes: meta.size_bytes ?? null, etag: meta.etag || null,
        });
    }
    files.sort((a, b) => (FILE_RANK[a.ext] ?? 9) - (FILE_RANK[b.ext] ?? 9));
    return { files };
}

// Only documents of this subject, so a report cannot claim to rest on someone else's upload.
async function _documentIds(userId, raw) {
    if (!Array.isArray(raw) || !raw.length) return [];
    const ids = raw.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n) && n > 0).slice(0, 500);
    if (!ids.length) return [];
    const { rows } = await pool.query(
        `SELECT id FROM health_documents WHERE user_id = $1 AND id = ANY($2::bigint[]) ORDER BY id DESC`, [userId, ids]);
    return rows.map(r => Number(r.id));
}

async function _report(client, { uid, user, origin, payload }) {
    const commandKey = _str(payload?.command_key, 40);
    if (!REPORT_KEYS.has(commandKey)) {
        return { error: fail(REASONS.MISSING_PARAMS, `payload.command_key must be one of ${[...REPORT_KEYS].join(', ')}`) };
    }
    const summary = _str(payload?.summary, MAX_SUMMARY_LENGTH).replace(/^:::.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    if (!summary) return { error: fail(REASONS.MISSING_PARAMS, 'payload.summary is required — it is the chat-sized abstract shown on the card') };
    const { error, files } = await _reportFiles(uid, payload?.files);
    if (error) return { error };
    const documentIds = await _documentIds(user.user_id, payload?.document_ids);
    const command = _str(payload?.title, 60) || REPORT_COMMAND[commandKey];

    await client.query(
        `INSERT INTO viva_ag_jobs (job_uid, user_id, channel_id, persona_type, language, command_key, command, params,
                document_ids, status, priority, attempts, max_attempts, claimed_by, claimed_at, started_at, completed_at,
                result_token, result_summary, result_oss_key, result_files, result, created_at, updated_at)
         VALUES ($1, $2, $3, 'viva', $4, $5, $6, '{}'::jsonb, $7::bigint[], 'completed', 0, 1, 3, $8, NOW(), NOW(), NOW(),
                 $9, $10, $11, $12::jsonb, $13::jsonb, NOW(), NOW())`,
        [uid, user.user_id, user.channel_id || null, user.language === 'en' ? 'en' : 'zh', commandKey, command, documentIds,
         CLAIMED_BY, crypto.randomBytes(24).toString('hex'), summary, files[0].oss_key, JSON.stringify(files),
         JSON.stringify({ source: 'curia', contribution_uid: uid, origin })]);
    return { target: { viva_ag_jobs: uid }, files: files.map(f => ({ filename: f.filename, ext: f.ext, size_bytes: f.size_bytes })) };
}

// A superseded report leaves the card; its row and files stay, cancelled, with the pointer.
async function _supersede(client, { uid, user, raw }) {
    const olds = (Array.isArray(raw) ? raw : []).map(_uid).filter(Boolean).filter(u => u !== uid);
    const done = [];
    for (const old of olds) {
        const { rowCount } = await client.query(
            `UPDATE viva_ag_jobs
                SET status = 'cancelled', updated_at = NOW(),
                    result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('superseded_by', $1::text)
              WHERE job_uid = $2 AND user_id = $3 AND status = 'completed' AND claimed_by = ANY($4)`,
            [uid, old, user.user_id, SUPERSEDABLE_BY]);
        await client.query(
            `UPDATE twin_contributions SET status = 'superseded', superseded_by = $1, updated_at = NOW()
              WHERE contribution_uid = $2 AND user_id = $3 AND status = 'accepted'`, [uid, old, user.user_id]);
        if (rowCount) done.push(old);
    }
    return done;
}

// POST /contributions { subject_ref, contribution_uid, kind, origin, payload, supersedes? }
async function contribute(body) {
    const { error: subjErr, ref, user } = await resolveSubject(body?.subject_ref);
    if (subjErr) return subjErr;
    const uid = _uid(body?.contribution_uid);
    if (!uid) return fail(REASONS.MISSING_PARAMS, 'contribution_uid must be a UUID the sender minted');
    const kind = _str(body?.kind, 20);
    if (!KINDS_KNOWN.has(kind)) return fail(REASONS.UNSUPPORTED_KIND, `kind must be one of ${[...KINDS_KNOWN].join(', ')}`);
    if (!KINDS_ACCEPTED.has(kind)) {
        return fail(REASONS.UNSUPPORTED_KIND, `'${kind}' has no landing place in nano yet; accepted now: ${[...KINDS_ACCEPTED].join(', ')}`);
    }
    const { error: oErr, origin } = _origin(body?.origin);
    if (oErr) return oErr;

    const prior = await _existing(uid);
    if (prior) {
        if (prior.user_id !== user.user_id || prior.kind !== kind) return fail(REASONS.CONFLICT, 'contribution_uid is in use');
        return { success: true, already_registered: true, contribution_uid: uid, subject_ref: ref, kind, status: prior.status, target: prior.target };
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const landed = await _report(client, { uid, user, origin, payload: body?.payload });
        if (landed.error) { await client.query('ROLLBACK'); return landed.error; }
        await client.query(
            `INSERT INTO twin_contributions (contribution_uid, user_id, kind, origin, target) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
            [uid, user.user_id, kind, JSON.stringify(origin), JSON.stringify(landed.target)]);
        const superseded = await _supersede(client, { uid, user, raw: body?.supersedes });
        await client.query('COMMIT');
        return { success: true, contribution_uid: uid, subject_ref: ref, kind, status: 'accepted', target: landed.target, files: landed.files, superseded };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        // Two concurrent posts of one uid: the loser hits the primary key; answer as the retry would.
        if (err.code === '23505') {
            const again = await _existing(uid);
            if (again && again.user_id === user.user_id && again.kind === kind) {
                return { success: true, already_registered: true, contribution_uid: uid, subject_ref: ref, kind, status: again.status, target: again.target };
            }
            return fail(REASONS.CONFLICT, 'contribution_uid is in use');
        }
        throw err;
    } finally {
        client.release();
    }
}

// POST /contributions/withdraw { subject_ref, contribution_uid, reason }
// The sender takes something back — a report found wrong after delivery. The row stays, marked.
async function withdraw(body) {
    const { error, user } = await resolveSubject(body?.subject_ref);
    if (error) return error;
    const uid = _uid(body?.contribution_uid);
    if (!uid) return fail(REASONS.MISSING_PARAMS, 'contribution_uid is required');
    const reason = _str(body?.reason, 500);
    if (!reason) return fail(REASONS.MISSING_PARAMS, 'reason is required');
    const prior = await _existing(uid);
    if (!prior || prior.user_id !== user.user_id) return fail(REASONS.NOT_FOUND, 'no such contribution for this subject');
    if (prior.status === 'withdrawn') return { success: true, contribution_uid: uid, status: 'withdrawn', already: true };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE twin_contributions SET status = 'withdrawn', status_reason = $2, updated_at = NOW() WHERE contribution_uid = $1`,
            [uid, reason]);
        if (prior.kind === 'report') {
            await client.query(
                `UPDATE viva_ag_jobs SET status = 'cancelled', updated_at = NOW(),
                        result = COALESCE(result, '{}'::jsonb) || jsonb_build_object('withdrawn', $2::text)
                  WHERE job_uid = $1 AND user_id = $3 AND claimed_by = $4`, [uid, reason, user.user_id, CLAIMED_BY]);
        }
        await client.query('COMMIT');
        return { success: true, contribution_uid: uid, status: 'withdrawn' };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

// GET /contributions?subject_ref=  — what this sender has contributed for one subject.
async function list(query) {
    const { error, ref, user } = await resolveSubject(query?.subject_ref);
    if (error) return error;
    const { rows } = await pool.query(
        `SELECT contribution_uid::text AS contribution_uid, kind, origin, status, target, superseded_by::text AS superseded_by,
                status_reason, received_at
           FROM twin_contributions WHERE user_id = $1 ORDER BY received_at DESC LIMIT 200`, [user.user_id]);
    return { success: true, subject_ref: ref, contributions: rows.map(r => ({ ...r, received_at: new Date(r.received_at).toISOString() })) };
}

module.exports = { uploadUrl, contribute, withdraw, list, KINDS_ACCEPTED, KINDS_KNOWN, _origin, _uid };
