/**
 * 综合报告 — the reports card at the top of the 数字孪生 subtab.
 *
 * A report is a completed `viva_ag_jobs` row that carries at least one result file. It is the
 * interpretation OF the twin (the 54-page analysis explaining the BioAge in the hero), not twin
 * data itself, which is why it is neither a fifth layer nor filed under 医疗记录 / 健康文档 —
 * see docs/architecture/digital-twin.md and the placement note in CLAUDE.md §35.
 *
 * Reads are gated on OWNERSHIP, not on the Viva AG entitlement: a report already delivered to a
 * user stays theirs to open after the add-on lapses, the same reasoning §38 applied to
 * health_documents. A coach reads through the same coarse `users.coach_id` check every other
 * per-user read uses. Files are addressed by INDEX; the oss_key never leaves the server.
 */
const { pool } = require('../lib/db');
const ossLib = require('../lib/oss');
const { formatToShanghai } = require('../lib/time-utils');
const { publicResultFiles } = require('./viva_ag');

const URL_TTL_SECONDS = 300;
const MAX_REPORTS = 20;

// Card title per AG preset. Anything else falls back to the free-text command, then a generic
// label — a job created outside the preset list still deserves a name on the card.
const TITLE_BY_COMMAND_KEY = {
    zh: {
        full_analysis: '全维度健康分析报告',
        document_review: '医疗文件解读报告',
        risk_screen: '健康风险筛查报告',
        dots_formulation: '原粒定制配方报告',
        food_sensitivity_review: '食物不耐受解读报告',
    },
    en: {
        full_analysis: 'Comprehensive Health Analysis',
        document_review: 'Medical Document Review',
        risk_screen: 'Health Risk Screen',
        dots_formulation: 'Dots Formulation Report',
        food_sensitivity_review: 'Food Sensitivity Review',
    },
};

function _log(level, msg, data) {
    (level === 'ERROR' ? console.error : console.log)(JSON.stringify({ level, msg, ...data }));
}

async function _resolveOwner(openid, coachId) {
    if (!openid) return { ok: false, error: { success: false, reason: 'missing_openid', error: 'openid is required', statusCode: 400 } };
    const { rows } = await pool.query('SELECT user_id, language FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]);
    const userId = rows[0]?.user_id;
    if (!userId) return { ok: false, error: { success: false, reason: 'user_not_found', error: 'User not found', statusCode: 404 } };
    if (coachId) {
        const check = await pool.query('SELECT 1 FROM users WHERE user_id = $1 AND coach_id = $2', [userId, coachId]);
        if (check.rows.length === 0) return { ok: false, error: { success: false, reason: 'access_denied', error: 'Access denied', statusCode: 403 } };
    }
    return { ok: true, userId, language: rows[0].language === 'en' ? 'en' : 'zh' };
}

function _title(row, lang) {
    const byKey = TITLE_BY_COMMAND_KEY[lang] || TITLE_BY_COMMAND_KEY.zh;
    if (row.command_key && byKey[row.command_key]) return byKey[row.command_key];
    const cmd = String(row.command || '').trim();
    if (cmd && cmd.length <= 40) return cmd;
    return lang === 'en' ? 'Health Report' : '健康报告';
}

// GET /twin-reports?openid=&coach_id=
async function handleGetTwinReports(query) {
    try {
        const owner = await _resolveOwner(query?.openid, query?.coach_id);
        if (!owner.ok) return owner.error;
        const { rows } = await pool.query(
            `SELECT job_uid, command, command_key, result_summary, result_files, result_oss_key, completed_at, created_at
               FROM viva_ag_jobs
              WHERE user_id = $1 AND status = 'completed'
                AND (result_oss_key IS NOT NULL OR jsonb_array_length(COALESCE(result_files, '[]'::jsonb)) > 0)
              ORDER BY completed_at DESC NULLS LAST, created_at DESC
              LIMIT $2`,
            [owner.userId, MAX_REPORTS]
        );
        const reports = rows.map(r => {
            const files = publicResultFiles(r);
            const pdf = files.find(f => f.ext === 'pdf');
            return {
                job_uid: r.job_uid,
                kind: r.command_key || null,
                title: _title(r, owner.language),
                completed_at: formatToShanghai(r.completed_at || r.created_at),
                // Shanghai calendar day, not UTC — a report finished after 08:00 UTC+8 midnight
                // would otherwise show yesterday's date on the card.
                completed_date: formatToShanghai(r.completed_at || r.created_at).slice(0, 10),
                summary: r.result_summary ? String(r.result_summary).slice(0, 400) : null,
                files,
                // The card's primary tap opens the PDF when there is one; otherwise the first file.
                primary_index: pdf ? pdf.index : (files[0]?.index ?? 0),
            };
        });
        return { success: true, reports, latest: reports[0] || null };
    } catch (err) {
        _log('ERROR', 'handleGetTwinReports failed', { error: err.message });
        return { success: false, reason: 'internal_error', error: err.message, statusCode: 500 };
    }
}

// GET /twin-reports/file?openid=&coach_id=&job_uid=&index=
async function handleGetTwinReportFile(query) {
    try {
        const owner = await _resolveOwner(query?.openid, query?.coach_id);
        if (!owner.ok) return owner.error;
        const { rows: [job] } = await pool.query(
            `SELECT job_uid, result_oss_key, result_files FROM viva_ag_jobs WHERE job_uid = $1 AND user_id = $2 AND status = 'completed'`,
            [query?.job_uid, owner.userId]
        );
        if (!job) return { success: false, reason: 'report_not_found', error: 'Report not found', statusCode: 404 };
        const files = Array.isArray(job.result_files) && job.result_files.length
            ? job.result_files
            : (job.result_oss_key ? [{ oss_key: job.result_oss_key }] : []);
        if (!files.length) return { success: false, reason: 'no_file', error: 'This report has no attached file', statusCode: 404 };
        const idx = Math.min(Math.max(parseInt(query?.index, 10) || 0, 0), files.length - 1);
        const file = files[idx];
        const ext = (file.ext || file.oss_key.split('.').pop() || 'bin').toLowerCase();
        const filename = file.filename || `report-${job.job_uid.slice(0, 8)}.${ext}`;
        return {
            success: true,
            url: ossLib.generatePresignedGetUrl(file.oss_key, URL_TTL_SECONDS, null, null, { filename }),
            expires_in: URL_TTL_SECONDS,
            file_type: ext,
            filename,
            size_bytes: file.size_bytes ?? null,
            index: idx,
        };
    } catch (err) {
        _log('ERROR', 'handleGetTwinReportFile failed', { error: err.message });
        return { success: false, reason: 'internal_error', error: err.message, statusCode: 500 };
    }
}

module.exports = { handleGetTwinReports, handleGetTwinReportFile, TITLE_BY_COMMAND_KEY };
