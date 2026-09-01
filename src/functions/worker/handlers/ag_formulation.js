'use strict';

/**
 * The lifecycle of a Dots formula authored by the external Viva AG agent, from the moment it is
 * submitted to the moment a nutrition expert approves it.
 *
 *   handlePostVivaAgResult (viva_ag.js)
 *     └─ processAgFormulationResult()      parse → validate → store → tell GCN
 *   GCN expert queue
 *     ├─ handleGetAgFormulationReviewSnapshot()   what the reviewer reads
 *     └─ handlePostAgFormulationApproved()        the decision coming back
 *   user scans their box (boxes.js)
 *     └─ _commitAgFormulation (dots.js)    the formula becomes a live 28-day schedule
 *
 * Its own file rather than more of dots.js or viva_ag.js because it needs both of them, and
 * putting it in either would make lib/agFormulation.js a circular dependency.
 *
 * The two GCN-facing endpoints follow the {valid, reason} always-HTTP-200 convention their
 * siblings in dots.js use (CLAUDE.md §31): the caller branches on `valid`, never on a status code.
 */

const { pool } = require('../lib/db');
const ossLib = require('../lib/oss');
const { gcnFetch } = require('../lib/gcnClient');
const { parseAgFormulation, validateAgFormulation, canonicalizeCapsules } = require('../lib/agFormulation');

function _logError(msg, err, extra = {}) {
    console.error(JSON.stringify({ level: 'ERROR', msg, error: err.message, ...extra }));
}
function _logInfo(msg, extra = {}) {
    console.log(JSON.stringify({ level: 'INFO', msg, ...extra }));
}

// The formulary columns the validator needs, plus the display/colour columns the review snapshot
// and the committed schedule want. One query shape, used by every function here.
const FORMULARY_COLUMNS = `id, key_name, key_name_zh, name, name_zh, ingredients, ingredients_zh,
    timing, timing_flexible, sub_age_target, target_dots_min, target_dots_max,
    dosing_protocol, coating, color_hex`;

async function _loadFormulary() {
    const { rows } = await pool.query(`SELECT ${FORMULARY_COLUMNS} FROM dots ORDER BY id ASC`);
    return rows;
}

// ---------------------------------------------------------------------------------------
// Ingest — called from handlePostVivaAgResult once the result row is committed
// ---------------------------------------------------------------------------------------

// The .md is only read when the agent didn't send the JSON mirror. Fetching it costs an OSS
// round trip, so it is deliberately lazy rather than always-on.
async function _readMarkdownArtifact(files) {
    const md = (files || []).find(f => f.ext === 'md' || f.ext === 'txt');
    if (!md) return null;
    try {
        const buf = await ossLib.getObjectBuffer(md.oss_key);
        return buf ? buf.toString('utf8') : null;
    } catch (err) {
        _logError('ag formulation markdown fetch failed', err, { oss_key: md.oss_key });
        return null;
    }
}

/**
 * Parse and validate a dots_formulation result, and record the outcome.
 *
 * Never throws: this runs inside handlePostVivaAgResult AFTER the agent's result has already been
 * committed, and the agent must not be told its work was rejected — and retry an hours-long
 * analysis — because nano failed to file the formula.
 *
 * @returns {{status:'valid'|'invalid'|'error', formulationId?:number, violations?:Array}}
 */
async function processAgFormulationResult(job, { result, files }) {
    try {
        const formulary = await _loadFormulary();
        const mdText = (result && result.formulation) ? null : await _readMarkdownArtifact(files);

        const parsedOut = parseAgFormulation(result, mdText);
        if (parsedOut.error) {
            return await _recordInvalid(job, [{ code: parsedOut.error, message: `Could not read the formula: ${parsedOut.error}.` }]);
        }
        const parsed = parsedOut.parsed;

        const check = validateAgFormulation(parsed, formulary);
        if (!check.valid) {
            _logInfo('ag formulation rejected', {
                job_uid: job.job_uid, violations: check.violations.length,
                codes: [...new Set(check.violations.map(v => v.code))],
            });
            return await _recordInvalid(job, check.violations);
        }

        const capsules = canonicalizeCapsules(parsed.capsules);
        const { rows: [row] } = await pool.query(
            `INSERT INTO viva_ag_formulations
                (job_id, user_id, status, capsules, totals, total_dots, rationale, source_format)
             VALUES ($1, $2, 'valid', $3, $4, $5, $6, $7)
             ON CONFLICT (job_id) DO UPDATE
                SET status = 'valid', capsules = EXCLUDED.capsules, totals = EXCLUDED.totals,
                    total_dots = EXCLUDED.total_dots, rationale = EXCLUDED.rationale,
                    source_format = EXCLUDED.source_format, validation_errors = NULL,
                    updated_at = NOW()
             RETURNING id`,
            [job.id, job.user_id, JSON.stringify(capsules), JSON.stringify(check.totals),
             check.totalDots, parsed.rationale || null, parsed.source || null]
        );

        _logInfo('ag formulation accepted', {
            job_uid: job.job_uid, formulation_id: row.id,
            total_dots: check.totalDots, source: parsed.source,
        });

        await _notifyGcn(row.id, job, capsules, check);
        return { status: 'valid', formulationId: row.id, totalDots: check.totalDots };
    } catch (err) {
        _logError('processAgFormulationResult failed', err, { job_uid: job.job_uid });
        return { status: 'error' };
    }
}

async function _recordInvalid(job, violations) {
    try {
        await pool.query(
            `INSERT INTO viva_ag_formulations (job_id, user_id, status, capsules, totals, validation_errors)
             VALUES ($1, $2, 'invalid', '[]'::jsonb, '{}'::jsonb, $3)
             ON CONFLICT (job_id) DO UPDATE
                SET status = 'invalid', validation_errors = EXCLUDED.validation_errors, updated_at = NOW()`,
            [job.id, job.user_id, JSON.stringify(violations)]
        );
    } catch (err) {
        _logError('_recordInvalid failed', err, { job_uid: job.job_uid });
    }
    return { status: 'invalid', violations };
}

// Fire-and-forget, matching every other cross-repo notify in this integration: the formula is
// already safely recorded, and GCN being down must not fail the agent's submission. A 'valid'
// row with a NULL gcn_order_id is the query that finds these (idx_..._unnotified).
async function _notifyGcn(formulationId, job, capsules, check) {
    try {
        const res = await gcnFetch('/api/mall/aeviva/formulation-ready', {
            method: 'POST',
            body: {
                nano_formulation_id: formulationId,
                nano_user_id: job.user_id,
                nano_job_uid: job.job_uid,
                capsules,
                totals: check.totals,
                total_dots: check.totalDots,
            },
        });
        if (res && res.order_id) {
            await pool.query(
                `UPDATE viva_ag_formulations
                    SET gcn_order_id = $2, gcn_order_item_id = $3, notified_gcn_at = NOW(), updated_at = NOW()
                  WHERE id = $1`,
                [formulationId, String(res.order_id), res.order_item_id ? String(res.order_item_id) : null]
            );
            _logInfo('ag formulation handed to gcn', { formulation_id: formulationId, order_id: res.order_id });
        } else {
            // GCN answered but had no awaiting order to attach it to — a real state (the user ran
            // a formulation without having bought the bundle), not an error.
            _logInfo('ag formulation has no awaiting gcn order', { formulation_id: formulationId, reason: res && res.reason });
        }
    } catch (err) {
        _logError('ag formulation gcn notify failed', err, { formulation_id: formulationId });
    }
}

// ---------------------------------------------------------------------------------------
// Review snapshot — what the GCN nutrition expert reads
// ---------------------------------------------------------------------------------------

// Per-dot daily totals, which is how a reviewer actually judges a formula. The 56-capsule list is
// returned alongside for the detail view, but this is the primary shape.
function _buildDotBreakdown(capsules, formulary) {
    const byKey = new Map(formulary.map(d => [d.key_name, d]));
    const agg = new Map();
    const daysPresent = new Map();
    for (const c of capsules) {
        for (const [key, count] of Object.entries(c.dots || {})) {
            if (!agg.has(key)) agg.set(key, { am: 0, pm: 0 });
            agg.get(key)[c.slot === 'AM' ? 'am' : 'pm'] += count;
            if (!daysPresent.has(key)) daysPresent.set(key, new Set());
            daysPresent.get(key).add(c.day);
        }
    }
    return [...agg.entries()].map(([key, t]) => {
        const dot = byKey.get(key) || {};
        const days = daysPresent.get(key).size;
        const cycle = t.am + t.pm;
        return {
            ...dot,
            key_name: key,
            name: dot.name || key,
            name_zh: dot.name_zh || key,
            am_total: t.am,
            pm_total: t.pm,
            cycle_total: cycle,
            days_dosed: days,
            // What a reviewer compares against target_dots_min/max, which are per-day bounds.
            daily_avg: days ? Math.round((cycle / days) * 10) / 10 : 0,
        };
    }).sort((a, b) => b.cycle_total - a.cycle_total);
}

/**
 * GET /ag-formulation-review-snapshot?formulationId=&openid=   (GCN service token only)
 *
 * The AG counterpart to handleGetFormulationReviewSnapshot. Same contract, same twin context
 * (via the shared _buildReviewTwinContext in dots.js) — the only difference is where the recipe
 * comes from: viva_ag_formulations.capsules rather than a committed plan's day-0 schedule.
 *
 * Anchored to a formulation AND its owner, so GCN can only ever read the twin of a user whose own
 * formulation it was already handed. Requiring `openid` to match is what keeps this from becoming
 * a blanket read over every nano user (the same reasoning that kept /health-twin off the
 * allowlist).
 */
async function handleGetAgFormulationReviewSnapshot(formulationId, openid) {
    try {
        if (!pool) return { valid: false, reason: 'internal_error' };
        if (!formulationId || !openid) return { valid: false, reason: 'missing_params' };
        const idNum = parseInt(formulationId, 10);
        if (!Number.isFinite(idNum)) return { valid: false, reason: 'invalid_formulation_id' };

        const { rows: [f] } = await pool.query(
            `SELECT f.*, j.job_uid, j.command, j.command_key, j.result_summary, j.result_files
             FROM viva_ag_formulations f
             JOIN viva_ag_jobs j ON j.id = f.job_id
             WHERE f.id = $1`,
            [idNum]
        );
        if (!f) return { valid: false, reason: 'formulation_not_found' };
        if (f.user_id !== openid) return { valid: false, reason: 'formulation_owner_mismatch' };
        if (f.status === 'invalid') return { valid: false, reason: 'formulation_invalid' };

        const formulary = await _loadFormulary();
        // An expert reviewing an already-adjusted formulation should see their own adjustment.
        const capsules = f.adjusted_capsules || f.capsules || [];

        // Required lazily: dots.js requires nothing from this module, so there is no cycle, but
        // keeping the require at call time documents the direction of the dependency.
        const { _buildReviewTwinContext } = require('./dots');
        const twin = await _buildReviewTwinContext(f.user_id);

        // Short-lived signed links so the reviewer can read the agent's own report, not just its
        // numbers — the reasoning behind a formula is most of what there is to review.
        const reportFiles = (f.result_files || []).map((file, index) => ({
            index,
            filename: file.filename,
            ext: file.ext,
            size_bytes: file.size_bytes ?? null,
            url: ossLib.generatePresignedGetUrl(file.oss_key, 3600, null, null, { filename: file.filename }),
        }));

        return {
            valid: true,
            formulation: {
                id: f.id,
                status: f.status,
                created_at: f.created_at,
                approved_at: f.approved_at,
                total_dots: f.total_dots,
                rationale: f.rationale,
                adjusted: !!f.adjusted_capsules,
                job_uid: f.job_uid,
                command: f.command,
                command_key: f.command_key,
                agent_summary: f.result_summary || null,
            },
            recipe_summary: {
                cycle_days: 28,
                capsules_count: capsules.length,
                dot_breakdown: _buildDotBreakdown(capsules, formulary),
                capsules,
            },
            report_files: reportFiles,
            ...twin,
        };
    } catch (err) {
        _logError('handleGetAgFormulationReviewSnapshot failed', err, { formulationId });
        return { valid: false, reason: 'internal_error' };
    }
}

// ---------------------------------------------------------------------------------------
// The expert's decision, coming back from GCN
// ---------------------------------------------------------------------------------------

/**
 * POST /ag-formulation-approved   (GCN service token only)
 * Body: { formulation_id, decision: 'approve'|'reject', adjusted_capsules?, review_notes?, reviewer_ref? }
 *
 * On approval this creates the nutrition_plans row — status 'approved', with NO schedules. The
 * 28-day schedule is generated when the user scans the delivered box, so the cycle starts on the
 * day they can actually take the capsules rather than while the box is still being compounded.
 */
async function handlePostAgFormulationApproved(body) {
    const client = await pool.connect();
    try {
        const formulationId = parseInt(body?.formulation_id, 10);
        const decision = body?.decision === 'reject' ? 'reject' : 'approve';
        if (!Number.isFinite(formulationId)) return { valid: false, reason: 'missing_params' };

        await client.query('BEGIN');
        const { rows: [f] } = await client.query(
            `SELECT * FROM viva_ag_formulations WHERE id = $1 FOR UPDATE`, [formulationId]);
        if (!f) { await client.query('ROLLBACK'); return { valid: false, reason: 'formulation_not_found' }; }

        if (f.status === 'committed') {
            // Already scanned into a live plan — far too late to re-decide it.
            await client.query('ROLLBACK');
            return { valid: false, reason: 'formulation_already_committed' };
        }
        if (f.status === 'approved' && decision === 'approve') {
            await client.query('ROLLBACK');
            return { valid: true, already_approved: true, nutrition_plan_id: f.nutrition_plan_id };
        }

        if (decision === 'reject') {
            await client.query(
                `UPDATE viva_ag_formulations
                    SET status = 'rejected', review_notes = $2, reviewer_ref = $3, updated_at = NOW()
                  WHERE id = $1`,
                [formulationId, body?.review_notes || null, body?.reviewer_ref || null]);
            await client.query('COMMIT');
            _logInfo('ag formulation rejected by expert', { formulation_id: formulationId });
            return { valid: true, status: 'rejected' };
        }

        // An expert's adjustment is re-validated exactly like the agent's original. The reviewer
        // UI can be wrong too, and this recipe is about to be compounded into physical capsules —
        // "it came from a trusted human" is not a reason to skip the only check there is.
        let adjusted = null;
        if (body?.adjusted_capsules != null) {
            const formulary = await _loadFormulary();
            const parsedOut = parseAgFormulation({ formulation: { capsules: body.adjusted_capsules } }, null);
            if (parsedOut.error) {
                await client.query('ROLLBACK');
                return { valid: false, reason: 'adjusted_recipe_unreadable', detail: parsedOut.error };
            }
            const check = validateAgFormulation(parsedOut.parsed, formulary);
            if (!check.valid) {
                await client.query('ROLLBACK');
                return { valid: false, reason: 'adjusted_recipe_invalid', violations: check.violations };
            }
            adjusted = canonicalizeCapsules(parsedOut.parsed.capsules);
        }

        const goal = (f.rationale || 'Viva AG Precision Formulation').slice(0, 2000);
        const { rows: [plan] } = await client.query(
            `INSERT INTO nutrition_plans (user_id, start_date, end_date, goal, status, source, ag_formulation_id)
             VALUES ($1, CURRENT_DATE, CURRENT_DATE + $2::int, $3, 'approved', 'viva_ag', $4)
             RETURNING id`,
            // Provisional dates, rewritten to the real cycle at box-scan time. NOT NULL columns,
            // so they need a value now even though it means nothing yet.
            [f.user_id, 27, goal, formulationId]
        );

        await client.query(
            `UPDATE viva_ag_formulations
                SET status = 'approved', adjusted_capsules = $2, review_notes = $3, reviewer_ref = $4,
                    approved_at = NOW(), nutrition_plan_id = $5, updated_at = NOW()
              WHERE id = $1`,
            [formulationId, adjusted ? JSON.stringify(adjusted) : null,
             body?.review_notes || null, body?.reviewer_ref || null, plan.id]);

        await client.query('COMMIT');
        _logInfo('ag formulation approved', { formulation_id: formulationId, plan_id: plan.id, adjusted: !!adjusted });
        return { valid: true, status: 'approved', nutrition_plan_id: plan.id, adjusted: !!adjusted };
    } catch (err) {
        await client.query('ROLLBACK');
        _logError('handlePostAgFormulationApproved failed', err, { formulation_id: body?.formulation_id });
        return { valid: false, reason: 'internal_error' };
    } finally {
        client.release();
    }
}

// ---------------------------------------------------------------------------------------
// User-facing: what the AG panel shows about a formulation's progress
// ---------------------------------------------------------------------------------------

// GET /viva-ag/formulation?openid=[&job_uid=]  (app bearer)
// The AG panel needs to tell the user where their formula is — validated, with the expert,
// approved and shipping, or already scanned in. Deliberately returns no oss_key and no reviewer
// identity; the client addresses artifacts through the existing result-url endpoint.
async function handleGetAgFormulationStatus(query) {
    try {
        const openid = query?.openid;
        if (!openid) return { success: false, reason: 'missing_params' };
        const params = [openid];
        let where = 'f.user_id = $1';
        if (query?.job_uid) { params.push(query.job_uid); where += ` AND j.job_uid = $${params.length}`; }

        const { rows } = await pool.query(
            `SELECT f.id, f.status, f.total_dots, f.rationale, f.created_at, f.approved_at,
                    f.committed_at, f.nutrition_plan_id, f.validation_errors,
                    (f.adjusted_capsules IS NOT NULL) AS adjusted,
                    j.job_uid
             FROM viva_ag_formulations f
             JOIN viva_ag_jobs j ON j.id = f.job_id
             WHERE ${where}
             ORDER BY f.created_at DESC LIMIT 10`,
            params
        );
        return {
            success: true,
            formulations: rows.map(r => ({
                id: r.id,
                job_uid: r.job_uid,
                status: r.status,
                total_dots: r.total_dots,
                rationale: r.rationale,
                adjusted: r.adjusted,
                created_at: r.created_at,
                approved_at: r.approved_at,
                committed_at: r.committed_at,
                plan_id: r.nutrition_plan_id,
                // Surfaced so an invalid formula can say WHY, rather than just failing quietly.
                issue_count: Array.isArray(r.validation_errors) ? r.validation_errors.length : 0,
            })),
        };
    } catch (err) {
        _logError('handleGetAgFormulationStatus failed', err, { openid: query?.openid });
        return { success: false, reason: 'internal_error' };
    }
}

module.exports = {
    processAgFormulationResult,
    handleGetAgFormulationReviewSnapshot,
    handlePostAgFormulationApproved,
    handleGetAgFormulationStatus,
    _buildDotBreakdown,
};
