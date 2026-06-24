const { pool } = require('../lib/db');
const { getNowShanghai } = require('../lib/time-utils');

// ── Health Plan System ────────────────────────────────────────────────────────

async function handleGetHealthPlanTemplates(query) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const includeInactive = query.all === 'true';
        const channelId = query.channel_id ? parseInt(query.channel_id, 10) : null;
        const params = [];
        let whereClause = channelId
            ? `WHERE (hpt.channel_id IS NULL OR hpt.channel_id = $1)` + (includeInactive ? '' : ` AND hpt.is_active = true`)
            : `WHERE hpt.channel_id IS NULL` + (includeInactive ? '' : ` AND hpt.is_active = true`);
        if (channelId) params.push(channelId);
        const result = await pool.query(
            `SELECT hpt.*,
                    (SELECT COUNT(*) FROM health_plans hp WHERE hp.template_id = hpt.id AND hp.status = 'active') AS active_enrollments
             FROM health_plan_templates hpt
             ${whereClause}
             ORDER BY hpt.sort_order ASC, hpt.id ASC`,
            params
        );
        return { success: true, templates: result.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetHealthPlanTemplates', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostHealthPlanTemplate(body) {
    const { key_name, name_zh, name_en, desc_zh, desc_en, goal_zh, goal_en,
            duration_weeks, target_sub_ages, recommended_dot_ids, activity_guidance,
            milestones, reminders, daily_tasks, sort_order, channel_id, created_by } = body || {};
    if (!key_name || !name_zh || !name_en) return { statusCode: 400, success: false, error: 'key_name, name_zh, name_en required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `INSERT INTO health_plan_templates
             (key_name, name_zh, name_en, desc_zh, desc_en, goal_zh, goal_en,
              duration_weeks, target_sub_ages, recommended_dot_ids, activity_guidance, milestones, reminders,
              daily_tasks, sort_order, channel_id, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             RETURNING *`,
            [key_name, name_zh, name_en, desc_zh || null, desc_en || null, goal_zh || null, goal_en || null,
             duration_weeks || 4, target_sub_ages || null,
             JSON.stringify(recommended_dot_ids || []),
             JSON.stringify(activity_guidance || {}),
             JSON.stringify(milestones || []),
             JSON.stringify(reminders || []),
             JSON.stringify(daily_tasks || []),
             sort_order || 0, channel_id || null, created_by || null]
        );
        console.log(JSON.stringify({ level: 'INFO', msg: 'handlePostHealthPlanTemplate', key_name }));
        return { success: true, template: result.rows[0] };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostHealthPlanTemplate', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePutHealthPlanTemplate(id, body) {
    const { name_zh, name_en, desc_zh, desc_en, goal_zh, goal_en,
            duration_weeks, target_sub_ages, recommended_dot_ids, activity_guidance,
            milestones, reminders, daily_tasks, sort_order, is_active } = body || {};
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `UPDATE health_plan_templates
             SET name_zh=$1, name_en=$2, desc_zh=$3, desc_en=$4, goal_zh=$5, goal_en=$6,
                 duration_weeks=$7, target_sub_ages=$8, recommended_dot_ids=$9,
                 activity_guidance=$10, milestones=$11, reminders=$12, daily_tasks=$13,
                 sort_order=$14, is_active=COALESCE($15, is_active), updated_at=NOW()
             WHERE id=$16
             RETURNING *`,
            [name_zh, name_en, desc_zh || null, desc_en || null, goal_zh || null, goal_en || null,
             duration_weeks, target_sub_ages || null,
             JSON.stringify(recommended_dot_ids || []),
             JSON.stringify(activity_guidance || {}),
             JSON.stringify(milestones || []),
             JSON.stringify(reminders || []),
             JSON.stringify(daily_tasks || []),
             sort_order || 0, is_active !== undefined ? is_active : null, id]
        );
        if (result.rows.length === 0) return { statusCode: 404, success: false, error: 'Template not found' };
        return { success: true, template: result.rows[0] };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePutHealthPlanTemplate', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleDeleteHealthPlanTemplate(id) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const active = await pool.query(
            `SELECT COUNT(*) AS cnt FROM health_plans WHERE template_id=$1 AND status='active'`, [id]
        );
        if (parseInt(active.rows[0].cnt) > 0) {
            return { statusCode: 409, success: false, error: 'Cannot delete template with active enrollments' };
        }
        await pool.query('DELETE FROM health_plan_templates WHERE id=$1', [id]);
        return { success: true };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleDeleteHealthPlanTemplate', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleGetHealthPlans(query) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const isAdmin = query.all === 'true';
        const openid = query.openid;
        if (!isAdmin && !openid) return { statusCode: 400, success: false, error: 'openid required' };

        let whereClause = isAdmin ? `WHERE hp.status = 'active'` : `WHERE hp.user_id = $1 AND hp.status = 'active'`;
        const params = isAdmin ? [] : [openid];

        const result = await pool.query(
            `SELECT hp.*,
                    hpt.key_name AS template_key, hpt.name_zh, hpt.name_en,
                    hpt.desc_zh, hpt.desc_en, hpt.goal_zh, hpt.goal_en,
                    hpt.target_sub_ages, hpt.recommended_dot_ids, hpt.activity_guidance, hpt.milestones AS template_milestones,
                    hpt.duration_weeks AS template_duration_weeks, hpt.daily_tasks,
                    (SELECT COUNT(*) FROM health_plan_checkins hpc WHERE hpc.plan_id = hp.id) AS checkin_count,
                    (SELECT COUNT(*) FROM health_plan_checkins hpc WHERE hpc.plan_id = hp.id AND hpc.checkin_date = CURRENT_DATE) AS checked_in_today,
                    (SELECT row_to_json(t) FROM (SELECT dots_taken, activities_done FROM health_plan_checkins WHERE plan_id = hp.id AND checkin_date = CURRENT_DATE LIMIT 1) t) AS today_checkin,
                    u.nickname AS user_nickname
             FROM health_plans hp
             LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
             LEFT JOIN users u ON u.user_id = hp.user_id
             ${whereClause}
             ORDER BY hp.plan_type ASC, hp.created_at ASC`,
            params
        );
        return { success: true, plans: result.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetHealthPlans', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostJoinHealthPlan(body) {
    const { openid, template_id, plan_type = 'primary', source = 'self',
            coach_id, custom_name_zh, custom_name_en, custom_goal_zh, custom_goal_en,
            duration_weeks } = body || {};
    if (!openid) return { statusCode: 400, success: false, error: 'openid required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        // Check for existing active plan of same type
        const existing = await pool.query(
            `SELECT id, plan_type FROM health_plans WHERE user_id=$1 AND plan_type=$2 AND status='active'`,
            [openid, plan_type]
        );
        if (existing.rows.length > 0) {
            return { statusCode: 409, success: false, error: 'conflict', existing_plan_id: existing.rows[0].id };
        }

        // Capture baseline from latest kino_chip biomarker
        const bioRow = await pool.query(
            `SELECT data FROM biomarkers WHERE user_id=$1 AND test_type='kino_chip' ORDER BY tested_at DESC LIMIT 1`,
            [openid]
        );
        const baseline_data = bioRow.rows.length > 0
            ? { bioage_profile: bioRow.rows[0].data?.bioage_profile || {}, biomarkers: bioRow.rows[0].data?.validated || {} }
            : {};

        // Resolve duration and reminders from template
        let resolvedDuration = duration_weeks || 4;
        let templateReminders = [];
        if (template_id) {
            const tpl = await pool.query('SELECT duration_weeks, reminders FROM health_plan_templates WHERE id=$1', [template_id]);
            if (tpl.rows.length > 0) {
                resolvedDuration = duration_weeks || tpl.rows[0].duration_weeks;
                templateReminders = tpl.rows[0].reminders || [];
            }
        }

        const startDate = new Date();
        const targetEnd = new Date(startDate);
        targetEnd.setDate(targetEnd.getDate() + resolvedDuration * 7);

        const result = await pool.query(
            `INSERT INTO health_plans
             (user_id, template_id, coach_id, plan_type, status, source,
              custom_name_zh, custom_name_en, custom_goal_zh, custom_goal_en,
              duration_weeks, baseline_data, start_date, target_end_date)
             VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10,$11,$12,$13)
             RETURNING *`,
            [openid, template_id || null, coach_id || null, plan_type, source,
             custom_name_zh || null, custom_name_en || null, custom_goal_zh || null, custom_goal_en || null,
             resolvedDuration, JSON.stringify(baseline_data),
             startDate.toISOString().slice(0, 10),
             targetEnd.toISOString().slice(0, 10)]
        );
        // Auto-create linked daily reminders from template config
        if (templateReminders.length > 0) {
            const userRow = await pool.query('SELECT language FROM users WHERE user_id=$1', [openid]);
            const lang = userRow.rows[0]?.language || 'zh';
            const planId = result.rows[0].id;
            for (const r of templateReminders) {
                if (!r.time) continue;
                const [hh, mm] = r.time.split(':').map(Number);
                const now = new Date();
                const fire = new Date(now);
                fire.setHours(hh, mm, 0, 0);
                if (fire <= now) fire.setDate(fire.getDate() + 1);
                const content = lang === 'zh' ? (r.message_zh || r.message_en || '') : (r.message_en || r.message_zh || '');
                await pool.query(
                    `INSERT INTO reminders (user_id, content, scheduled_for, recurrence, plan_id) VALUES ($1,$2,$3,'daily',$4)`,
                    [openid, content, fire.toISOString(), planId]
                );
            }
        }

        console.log(JSON.stringify({ level: 'INFO', msg: 'handlePostJoinHealthPlan', openid, plan_type, template_id }));
        return { success: true, plan: result.rows[0] };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostJoinHealthPlan', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleGetHealthPlanDetail(id, openid) {
    if (!openid) return { statusCode: 400, success: false, error: 'openid required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const planRes = await pool.query(
            `SELECT hp.*,
                    hpt.key_name AS template_key, hpt.name_zh, hpt.name_en,
                    hpt.desc_zh, hpt.desc_en, hpt.goal_zh, hpt.goal_en,
                    hpt.target_sub_ages, hpt.recommended_dot_ids, hpt.activity_guidance,
                    hpt.milestones AS template_milestones
             FROM health_plans hp
             LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
             WHERE hp.id=$1 AND hp.user_id=$2`,
            [id, openid]
        );
        if (planRes.rows.length === 0) return { statusCode: 404, success: false, error: 'Plan not found' };

        const [checkinsRes, milestonesRes, remindersRes] = await Promise.all([
            pool.query(
                `SELECT * FROM health_plan_checkins WHERE plan_id=$1 ORDER BY checkin_date DESC LIMIT 30`, [id]
            ),
            pool.query(
                `SELECT * FROM health_plan_milestones WHERE plan_id=$1 ORDER BY milestone_index ASC`, [id]
            ),
            pool.query(
                `SELECT id, content, scheduled_for, recurrence, status FROM reminders
                 WHERE plan_id=$1 AND status != 'sent' AND status != 'cancelled'
                 ORDER BY scheduled_for ASC`, [id]
            ),
        ]);
        return {
            success: true,
            plan: planRes.rows[0],
            checkins: checkinsRes.rows,
            milestones: milestonesRes.rows,
            reminders: remindersRes.rows,
        };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetHealthPlanDetail', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePutHealthPlan(id, body) {
    const { status, plan_type, openid } = body || {};
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        // plan_type swap: must do in a transaction to avoid unique index violation
        if (plan_type) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const current = await client.query(`SELECT user_id, plan_type FROM health_plans WHERE id=$1`, [id]);
                if (current.rows.length === 0) { await client.query('ROLLBACK'); return { statusCode: 404, success: false, error: 'Plan not found' }; }
                const { user_id, plan_type: oldType } = current.rows[0];
                if (oldType !== plan_type) {
                    // Move any existing plan in the target slot to the old slot
                    await client.query(
                        `UPDATE health_plans SET plan_type=$1, updated_at=NOW() WHERE user_id=$2 AND plan_type=$3 AND status='active' AND id != $4`,
                        [oldType, user_id, plan_type, id]
                    );
                }
                await client.query(`UPDATE health_plans SET plan_type=$1, updated_at=NOW() WHERE id=$2`, [plan_type, id]);
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            } finally {
                client.release();
            }
        }

        if (status) {
            const endedAt = ['completed', 'abandoned'].includes(status) ? 'NOW()' : 'NULL';
            await pool.query(
                `UPDATE health_plans SET status=$1, ended_at=${endedAt}, updated_at=NOW() WHERE id=$2`,
                [status, id]
            );
            if (['completed', 'abandoned'].includes(status)) {
                await pool.query(
                    `UPDATE reminders SET status='cancelled' WHERE plan_id=$1 AND status IN ('pending','paused')`,
                    [id]
                );
            }
        }
        console.log(JSON.stringify({ level: 'INFO', msg: 'handlePutHealthPlan', id, status, plan_type }));
        return { success: true };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePutHealthPlan', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePatchPlanReminder(reminderId, body) {
    const { openid, status } = body || {};
    if (!openid) return { statusCode: 400, success: false, error: 'openid required' };
    if (!['pending', 'paused'].includes(status)) return { statusCode: 400, success: false, error: 'status must be pending or paused' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `UPDATE reminders SET status=$1
             WHERE id=$2 AND user_id=$3 AND plan_id IS NOT NULL AND status IN ('pending','paused')
             RETURNING id`,
            [status, reminderId, openid]
        );
        if (result.rows.length === 0) return { statusCode: 404, success: false, error: 'Reminder not found' };
        return { success: true };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePatchPlanReminder', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostHealthPlanCheckin(planId, body) {
    const { openid, checkin_date, dots_taken = false, activities_done = [], notes } = body || {};
    if (!openid || !checkin_date) return { statusCode: 400, success: false, error: 'openid and checkin_date required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `INSERT INTO health_plan_checkins (plan_id, user_id, checkin_date, dots_taken, activities_done, notes)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (plan_id, checkin_date) DO UPDATE
             SET dots_taken=EXCLUDED.dots_taken, activities_done=EXCLUDED.activities_done,
                 notes=COALESCE(EXCLUDED.notes, health_plan_checkins.notes)
             RETURNING *`,
            [planId, openid, checkin_date, dots_taken, JSON.stringify(activities_done), notes || null]
        );
        return { success: true, checkin: result.rows[0] };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostHealthPlanCheckin', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostHealthPlanMilestone(planId, body) {
    const { openid, biomarker_id, milestone_index = 0, label_zh, label_en } = body || {};
    if (!openid) return { statusCode: 400, success: false, error: 'openid required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let snapshot_data = {};
        if (biomarker_id) {
            const bRes = await pool.query('SELECT data FROM biomarkers WHERE id=$1 AND user_id=$2', [biomarker_id, openid]);
            if (bRes.rows.length > 0) snapshot_data = bRes.rows[0].data || {};
        }
        const result = await pool.query(
            `INSERT INTO health_plan_milestones (plan_id, user_id, biomarker_id, milestone_index, label_zh, label_en, snapshot_data)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             RETURNING *`,
            [planId, openid, biomarker_id || null, milestone_index, label_zh || null, label_en || null, JSON.stringify(snapshot_data)]
        );
        return { success: true, milestone: result.rows[0] };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostHealthPlanMilestone', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleGetCoachClientPlans(coachId) {
    if (!coachId) return { statusCode: 400, success: false, error: 'coach_id required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `SELECT hp.*, u.nickname AS user_nickname,
                    hpt.name_zh, hpt.name_en, hpt.key_name AS template_key,
                    (SELECT COUNT(*) FROM health_plan_checkins hpc WHERE hpc.plan_id = hp.id) AS checkin_count
             FROM health_plans hp
             JOIN users u ON u.user_id = hp.user_id
             JOIN coaches c ON c.user_id = u.user_id OR c.id = hp.coach_id
             LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
             WHERE c.id = $1 AND hp.status = 'active'
             ORDER BY hp.plan_type ASC, hp.created_at ASC`,
            [coachId]
        );
        return { success: true, plans: result.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetCoachClientPlans', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

// ─── Health Reports ────────────────────────────────────────────────────────────

async function handleGetHealthReports(query) {
    try {
        const { openid, user_id } = query;
        if (!openid && !user_id) return { statusCode: 400, success: false, error: 'openid or user_id required' };
        const uid = user_id || (await pool.query('SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid])).rows[0]?.user_id;
        if (!uid) return { statusCode: 404, success: false, error: 'User not found' };
        const result = await pool.query(
            `SELECT id, report_date, source, institution, report_type, status, created_at,
                    oss_key, raw_data->>'image_url' AS image_url
             FROM health_reports WHERE user_id = $1 ORDER BY report_date DESC LIMIT 50`,
            [uid]
        );
        return { success: true, reports: result.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetHealthReports', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleGetHealthReport(reportId, query) {
    try {
        const reportRes = await pool.query(
            'SELECT * FROM health_reports WHERE id = $1',
            [reportId]
        );
        if (reportRes.rows.length === 0) return { statusCode: 404, success: false, error: 'Report not found' };
        const eventsRes = await pool.query(
            'SELECT id, category, data_date, data FROM health_events WHERE report_id = $1 ORDER BY data_date',
            [reportId]
        );
        return { success: true, report: reportRes.rows[0], events: eventsRes.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetHealthReport', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostHealthReport(body, deps = {}) {
    try {
        const { user_id, openid, report_date, source = 'manual_upload', institution, report_type = 'lab_panel', observations = [], fhir_bundle, oss_key = null, get_url = null, compute_bioage = false } = body || {};
        if (!user_id && !openid) return { statusCode: 400, success: false, error: 'user_id or openid required' };

        let uid = user_id;
        if (!uid) {
            const userRes = await pool.query('SELECT user_id FROM users WHERE external_id = $1 OR user_id = $1 LIMIT 1', [openid]);
            if (userRes.rows.length === 0) return { statusCode: 404, success: false, error: 'User not found' };
            uid = userRes.rows[0].user_id;
        }

        // Extract observations from FHIR bundle if provided
        let obs = observations;
        if (fhir_bundle && fhir_bundle.resourceType === 'Bundle') {
            obs = extractObservationsFromFhir(fhir_bundle);
        }
        // Allow a photo-only report (no parseable observations) as long as we have an image.
        if (obs.length === 0 && !oss_key) return { statusCode: 400, success: false, error: 'No observations provided' };

        // Resolve catalog metadata by LOINC code AND by canonical key_name (chat-uploaded
        // reports come from the vision model keyed by key_name, lab imports by loinc_code).
        const catalogRes = await pool.query(
            'SELECT key_name, loinc_code, nano_dimension, is_kino_core, unit FROM biomarker_catalog WHERE is_active = TRUE'
        );
        const loincMap = {};
        const keyNameMap = {};
        for (const row of catalogRes.rows) {
            if (row.loinc_code) loincMap[row.loinc_code] = row;
            keyNameMap[row.key_name] = row;
        }

        const date = report_date || obs[0]?.data_date?.split('T')[0] || new Date().toISOString().split('T')[0];

        const reportRes = await pool.query(
            `INSERT INTO health_reports (user_id, report_date, source, institution, report_type, status, oss_key, raw_data)
             VALUES ($1, $2, $3, $4, $5, 'parsed', $6, $7) RETURNING id`,
            [uid, date, source, institution || null, report_type, oss_key, JSON.stringify({ observations: obs, image_url: get_url || null })]
        );
        const reportId = reportRes.rows[0].id;

        let hasKinoCore = false;
        for (const o of obs) {
            const catalog = o.loinc_code ? loincMap[o.loinc_code] : keyNameMap[o.key_name];
            if (!catalog) continue;
            const dataDate = (o.data_date || date).split('T')[0];
            const externalId = `${catalog.key_name}::${dataDate}`;
            await pool.query(
                `INSERT INTO health_events (user_id, source, category, data_date, recorded_at, data, report_id, external_id)
                 VALUES ($1, $2, 'lab_result', $3, NOW(), $4, $5, $6)
                 ON CONFLICT (user_id, source, external_id) WHERE external_id IS NOT NULL DO NOTHING`,
                [
                    uid, source, dataDate,
                    JSON.stringify({
                        key_name:       catalog.key_name,
                        loinc_code:     catalog.loinc_code,
                        value:          parseFloat(o.value),
                        unit:           o.unit || catalog.unit,
                        nano_dimension: catalog.nano_dimension,
                        is_kino_core:   catalog.is_kino_core,
                    }),
                    reportId, externalId,
                ]
            );
            if (catalog.is_kino_core) hasKinoCore = true;
        }

        // Optionally run the BioAge import inline (reuses the lab-import pipeline:
        // estimator → BioAgeCalculator → biomarkers(lab_import) → updateHealthTwin).
        let bioageUpdated = false;
        if (compute_bioage && hasKinoCore && deps.handleLabImportEvent && deps.fetchTagDerivationContext) {
            try {
                await deps.handleLabImportEvent({ report_id: reportId, user_id: uid }, deps.fetchTagDerivationContext);
                bioageUpdated = true;
            } catch (bioErr) {
                console.log(JSON.stringify({ level: 'WARN', msg: 'handlePostHealthReport BioAge import failed', error: bioErr.message }));
            }
        }

        return { success: true, report_id: reportId, has_kino_core: hasKinoCore, bioage_updated: bioageUpdated };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostHealthReport', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

function extractObservationsFromFhir(bundle) {
    const obs = [];
    for (const entry of bundle.entry || []) {
        const res = entry.resource;
        if (!res || res.resourceType !== 'Observation') continue;
        const loincCode = res.code?.coding?.find(c => c.system === 'http://loinc.org')?.code;
        if (!loincCode) continue;
        const value = res.valueQuantity?.value ?? res.valueCodeableConcept?.coding?.[0]?.code;
        if (value == null) continue;
        obs.push({
            loinc_code: loincCode,
            value,
            unit: res.valueQuantity?.unit || '',
            data_date: res.effectiveDateTime || res.issued || new Date().toISOString(),
        });
    }
    return obs;
}

module.exports = {
    handleGetHealthPlanTemplates,
    handlePostHealthPlanTemplate,
    handlePutHealthPlanTemplate,
    handleDeleteHealthPlanTemplate,
    handleGetHealthPlans,
    handlePostJoinHealthPlan,
    handleGetHealthPlanDetail,
    handlePutHealthPlan,
    handlePatchPlanReminder,
    handlePostHealthPlanCheckin,
    handlePostHealthPlanMilestone,
    handleGetCoachClientPlans,
    handleGetHealthReports,
    handleGetHealthReport,
    handlePostHealthReport,
};
