const { pool } = require('../lib/db');

// ─────────────────────────────────────────────────────────────────────────────
// COACH CRM — all phases
// ─────────────────────────────────────────────────────────────────────────────

function logActivity(coachId, userId, activityType, metadata = {}) {
    if (!pool) return;
    pool.query(
        `INSERT INTO client_activity_log (coach_id, user_id, activity_type, metadata)
         VALUES ($1, $2, $3, $4)`,
        [coachId, userId, activityType, JSON.stringify(metadata)]
    ).catch(err => console.error(JSON.stringify({ level: 'ERROR', msg: 'activity_log_failed', data: { err: err.message } })));
}

// ── Phase 1: Tags ─────────────────────────────────────────────────────────────

async function handleGetCoachTags(coachId) {
    if (!coachId) return { success: false, error: 'coach_id is required', statusCode: 400 };
    try {
        const r = await pool.query(
            `SELECT id, name, color_hex, created_at FROM client_tags WHERE coach_id = $1 ORDER BY name`,
            [coachId]
        );
        return { success: true, tags: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostCoachTag(body) {
    const { coach_id, name, color_hex } = body;
    if (!coach_id || !name) return { success: false, error: 'coach_id and name are required', statusCode: 400 };
    try {
        const r = await pool.query(
            `INSERT INTO client_tags (coach_id, name, color_hex) VALUES ($1, $2, $3)
             ON CONFLICT (coach_id, name) DO UPDATE SET color_hex = EXCLUDED.color_hex
             RETURNING id, name, color_hex`,
            [coach_id, name, color_hex || '#6375EC']
        );
        return { success: true, tag: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePutCoachTag(tagId, body) {
    const { name, color_hex } = body;
    try {
        const sets = [];
        const vals = [];
        if (name) { sets.push(`name = $${vals.length + 2}`); vals.push(name); }
        if (color_hex) { sets.push(`color_hex = $${vals.length + 2}`); vals.push(color_hex); }
        if (!sets.length) return { success: false, error: 'Nothing to update', statusCode: 400 };
        const r = await pool.query(
            `UPDATE client_tags SET ${sets.join(', ')} WHERE id = $1 RETURNING id, name, color_hex`,
            [tagId, ...vals]
        );
        if (!r.rows.length) return { success: false, error: 'Tag not found', statusCode: 404 };
        return { success: true, tag: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleDeleteCoachTag(tagId) {
    try {
        await pool.query('DELETE FROM client_tags WHERE id = $1', [tagId]);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostCoachTagAssignments(body) {
    const { coach_id, user_id, tag_ids } = body;
    if (!coach_id || !user_id || !Array.isArray(tag_ids)) return { success: false, error: 'coach_id, user_id, tag_ids[] are required', statusCode: 400 };
    try {
        for (const tid of tag_ids) {
            await pool.query(
                `INSERT INTO client_tag_assignments (tag_id, user_id, coach_id)
                 VALUES ($1, $2, $3) ON CONFLICT (tag_id, user_id) DO NOTHING`,
                [tid, user_id, coach_id]
            );
        }
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleDeleteCoachTagAssignment(query) {
    const { tag_id, user_id } = query;
    if (!tag_id || !user_id) return { success: false, error: 'tag_id and user_id are required', statusCode: 400 };
    try {
        await pool.query('DELETE FROM client_tag_assignments WHERE tag_id = $1 AND user_id = $2', [tag_id, user_id]);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 1: Pipeline ─────────────────────────────────────────────────────────

async function handleGetClientPipeline(coachId) {
    if (!coachId) return { success: false, error: 'coach_id is required', statusCode: 400 };
    try {
        const r = await pool.query(
            `SELECT u.user_id, COALESCE(cps.stage, 'lead') AS crm_stage, cps.stage_changed_at, cps.note,
                    u.nickname, u.avatar_url,
                    EXTRACT(YEAR FROM AGE(u.birth_date))::integer AS chrono_age,
                    b.bio_age AS latest_bio_age, b.tested_at AS last_scan_at,
                    COALESCE(
                        (SELECT array_agg(ct.name ORDER BY ct.name)
                         FROM client_tag_assignments cta
                         JOIN client_tags ct ON ct.id = cta.tag_id
                         WHERE cta.user_id = u.user_id AND cta.coach_id = $1),
                        '{}'::text[]
                    ) AS crm_tags
             FROM users u
             LEFT JOIN client_pipeline_stages cps ON cps.user_id = u.user_id AND cps.coach_id = $1
             LEFT JOIN (
                 SELECT DISTINCT ON (user_id) user_id, bio_age, tested_at
                 FROM biomarkers WHERE test_type = 'kino_chip'
                 ORDER BY user_id, tested_at DESC
             ) b ON b.user_id = u.user_id
             WHERE u.coach_id = $1
             ORDER BY COALESCE(cps.stage_changed_at, u.created_at) DESC`,
            [coachId]
        );
        return { success: true, clients: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostClientPipeline(body) {
    const { coach_id, user_id, stage, note } = body;
    if (!coach_id || !user_id || !stage) return { success: false, error: 'coach_id, user_id, stage are required', statusCode: 400 };
    const validStages = ['lead', 'onboarding', 'active', 'at_risk', 'churned', 'graduated'];
    if (!validStages.includes(stage)) return { success: false, error: `stage must be one of: ${validStages.join(', ')}`, statusCode: 400 };
    try {
        const r = await pool.query(
            `INSERT INTO client_pipeline_stages (coach_id, user_id, stage, note, stage_changed_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (coach_id, user_id) DO UPDATE
             SET stage = EXCLUDED.stage, note = EXCLUDED.note, stage_changed_at = NOW()
             RETURNING id, stage, stage_changed_at`,
            [coach_id, user_id, stage, note || null]
        );
        logActivity(coach_id, user_id, 'stage_changed', { stage, note });
        return { success: true, pipeline: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 1: Notes ────────────────────────────────────────────────────────────

async function handleGetCoachNotes(query) {
    const { coach_id, user_id, limit = 50, before } = query;
    if (!coach_id || !user_id) return { success: false, error: 'coach_id and user_id are required', statusCode: 400 };
    try {
        const params = [coach_id, user_id, parseInt(limit, 10)];
        let timeCond = '';
        if (before) { timeCond = `AND created_at < $${params.length + 1}`; params.push(before); }
        const r = await pool.query(
            `SELECT id, content, is_pinned, created_at, updated_at
             FROM coach_client_notes
             WHERE coach_id = $1 AND user_id = $2 ${timeCond}
             ORDER BY is_pinned DESC, created_at DESC
             LIMIT $3`,
            params
        );
        return { success: true, notes: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostCoachNote(body) {
    const { coach_id, user_id, content, is_pinned } = body;
    if (!coach_id || !user_id || !content) return { success: false, error: 'coach_id, user_id, content are required', statusCode: 400 };
    try {
        const r = await pool.query(
            `INSERT INTO coach_client_notes (coach_id, user_id, content, is_pinned)
             VALUES ($1, $2, $3, $4) RETURNING id, content, is_pinned, created_at`,
            [coach_id, user_id, content, is_pinned || false]
        );
        logActivity(coach_id, user_id, 'note_added', { note_id: r.rows[0].id });
        return { success: true, note: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePutCoachNote(noteId, body) {
    const { content, is_pinned } = body;
    try {
        const r = await pool.query(
            `UPDATE coach_client_notes
             SET content = COALESCE($2, content),
                 is_pinned = COALESCE($3, is_pinned),
                 updated_at = NOW()
             WHERE id = $1
             RETURNING id, content, is_pinned, updated_at`,
            [noteId, content || null, is_pinned !== undefined ? is_pinned : null]
        );
        if (!r.rows.length) return { success: false, error: 'Note not found', statusCode: 404 };
        return { success: true, note: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleDeleteCoachNote(noteId) {
    try {
        await pool.query('DELETE FROM coach_client_notes WHERE id = $1', [noteId]);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 1: Activity Feed ────────────────────────────────────────────────────

async function handleGetClientActivity(query) {
    const { coach_id, user_id, limit = 50, before } = query;
    if (!coach_id || !user_id) return { success: false, error: 'coach_id and user_id are required', statusCode: 400 };
    try {
        const params = [coach_id, user_id, parseInt(limit, 10)];
        let timeCond = '';
        if (before) { timeCond = `AND occurred_at < $${params.length + 1}`; params.push(before); }
        const r = await pool.query(
            `SELECT id, activity_type, metadata, occurred_at
             FROM client_activity_log
             WHERE coach_id = $1 AND user_id = $2 ${timeCond}
             ORDER BY occurred_at DESC
             LIMIT $3`,
            params
        );
        return { success: true, activities: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleGetCoachActivityFeed(coachId, limit) {
    if (!coachId) return { success: false, error: 'coach_id is required', statusCode: 400 };
    try {
        const r = await pool.query(
            `SELECT cal.id, cal.user_id, cal.activity_type, cal.metadata, cal.occurred_at,
                    u.nickname, u.avatar_url
             FROM client_activity_log cal
             JOIN users u ON u.user_id = cal.user_id
             WHERE cal.coach_id = $1
             ORDER BY cal.occurred_at DESC
             LIMIT $2`,
            [coachId, parseInt(limit, 10) || 30]
        );
        return { success: true, activities: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 2: Message Templates ────────────────────────────────────────────────

async function handleGetMessageTemplates(query) {
    const { coach_id, channel_id, category } = query;
    try {
        const conditions = ['is_active = true'];
        const params = [];
        if (coach_id) { conditions.push(`(coach_id = $${params.length + 1} OR coach_id IS NULL)`); params.push(coach_id); }
        if (channel_id) { conditions.push(`(channel_id = $${params.length + 1} OR channel_id IS NULL)`); params.push(channel_id); }
        if (category) { conditions.push(`category = $${params.length + 1}`); params.push(category); }
        const r = await pool.query(
            `SELECT id, coach_id, channel_id, title, content_zh, content_en, category, variables, use_count, created_at
             FROM message_templates
             WHERE ${conditions.join(' AND ')}
             ORDER BY use_count DESC, created_at DESC`,
            params
        );
        return { success: true, templates: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostMessageTemplate(body) {
    const { coach_id, channel_id, title, content_zh, content_en, category, variables } = body;
    if (!title || !content_zh) return { success: false, error: 'title and content_zh are required', statusCode: 400 };
    try {
        const r = await pool.query(
            `INSERT INTO message_templates (coach_id, channel_id, title, content_zh, content_en, category, variables)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, title, category`,
            [coach_id || null, channel_id || null, title, content_zh, content_en || null, category || 'general', variables || []]
        );
        return { success: true, template: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePutMessageTemplate(id, body) {
    const { title, content_zh, content_en, category, variables, is_active } = body;
    try {
        const r = await pool.query(
            `UPDATE message_templates
             SET title = COALESCE($2, title),
                 content_zh = COALESCE($3, content_zh),
                 content_en = COALESCE($4, content_en),
                 category = COALESCE($5, category),
                 variables = COALESCE($6, variables),
                 is_active = COALESCE($7, is_active)
             WHERE id = $1
             RETURNING id, title, category, is_active`,
            [id, title || null, content_zh || null, content_en || null, category || null,
             variables ? JSON.stringify(variables) : null, is_active !== undefined ? is_active : null]
        );
        if (!r.rows.length) return { success: false, error: 'Template not found', statusCode: 404 };
        return { success: true, template: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleDeleteMessageTemplate(id) {
    try {
        await pool.query('UPDATE message_templates SET is_active = false WHERE id = $1', [id]);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostMessageTemplatePreview(id, body) {
    const { user_id, lang } = body;
    try {
        const tpl = await pool.query('SELECT content_zh, content_en, variables FROM message_templates WHERE id = $1', [id]);
        if (!tpl.rows.length) return { success: false, error: 'Template not found', statusCode: 404 };
        const { content_zh, content_en } = tpl.rows[0];
        let vars = { name: '用户', bio_age: '--', plan_name: '--', days_left: '--' };
        if (user_id) {
            const u = await pool.query(
                `SELECT u.nickname, ht.latest_bio_age, hp.start_date, hp.target_end_date,
                        hpt.name_zh AS plan_name_zh, hpt.name_en AS plan_name_en
                 FROM users u
                 LEFT JOIN health_twin ht ON ht.user_id = u.user_id
                 LEFT JOIN health_plans hp ON hp.user_id = u.user_id AND hp.status = 'active'
                 LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
                 WHERE u.user_id = $1 LIMIT 1`,
                [user_id]
            );
            if (u.rows.length) {
                const row = u.rows[0];
                vars.name = row.nickname || vars.name;
                vars.bio_age = row.latest_bio_age ? row.latest_bio_age.toFixed(1) : '--';
                vars.plan_name = (lang === 'en' ? row.plan_name_en : row.plan_name_zh) || '--';
                if (row.target_end_date) {
                    const daysLeft = Math.ceil((new Date(row.target_end_date) - new Date()) / 86400000);
                    vars.days_left = daysLeft > 0 ? String(daysLeft) : '0';
                }
            }
        }
        const substitute = (str) => str ? str.replace(/\{(\w+)\}/g, (_, k) => vars[k] || `{${k}}`) : null;
        return { success: true, rendered_zh: substitute(content_zh), rendered_en: substitute(content_en) };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 2: Bulk Campaigns ───────────────────────────────────────────────────

async function resolveBulkRecipients(coachId, filter) {
    const conditions = [`u.coach_id = (SELECT id FROM coaches WHERE id = $1)`];
    const params = [coachId];
    if (filter.stage && filter.stage.length) {
        conditions.push(`COALESCE(cps.stage, 'lead') = ANY($${params.length + 1}::text[])`);
        params.push(filter.stage);
    }
    if (filter.tag_ids && filter.tag_ids.length) {
        conditions.push(`cta.tag_id = ANY($${params.length + 1}::int[])`);
        params.push(filter.tag_ids);
    }
    if (filter.has_scanned === true) {
        conditions.push(`b.user_id IS NOT NULL`);
    }
    const r = await pool.query(
        `SELECT DISTINCT u.user_id, u.nickname, u.language
         FROM users u
         JOIN coaches c ON c.id = u.coach_id AND c.id = $1
         LEFT JOIN client_pipeline_stages cps ON cps.user_id = u.user_id AND cps.coach_id = $1
         LEFT JOIN client_tag_assignments cta ON cta.user_id = u.user_id AND cta.coach_id = $1
         LEFT JOIN (SELECT DISTINCT user_id FROM biomarkers WHERE test_type = 'kino_chip') b ON b.user_id = u.user_id
         WHERE ${conditions.join(' AND ')}`,
        params
    );
    return r.rows;
}

async function handlePostBulkCampaign(body) {
    const { coach_id, title, content, target_filter, template_id, scheduled_at } = body;
    if (!coach_id || !title || !content) return { success: false, error: 'coach_id, title, content are required', statusCode: 400 };
    try {
        const recipients = await resolveBulkRecipients(coach_id, target_filter || {});
        const r = await pool.query(
            `INSERT INTO bulk_message_campaigns (coach_id, template_id, title, content, target_filter, recipient_count, scheduled_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, title, recipient_count, status`,
            [coach_id, template_id || null, title, content, JSON.stringify(target_filter || {}), recipients.length, scheduled_at || null]
        );
        const campaignId = r.rows[0].id;
        if (recipients.length) {
            const values = recipients.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(', ');
            const flatArgs = [campaignId];
            recipients.forEach(rec => { flatArgs.push(rec.user_id); flatArgs.push(null); });
            await pool.query(
                `INSERT INTO bulk_message_recipients (campaign_id, user_id, personalized) VALUES ${values}`,
                flatArgs
            );
        }
        return { success: true, campaign: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostBulkCampaignSend(id) {
    try {
        const camp = await pool.query('SELECT * FROM bulk_message_campaigns WHERE id = $1', [id]);
        if (!camp.rows.length) return { success: false, error: 'Campaign not found', statusCode: 404 };
        if (camp.rows[0].status === 'sent') return { success: false, error: 'Already sent', statusCode: 400 };
        await pool.query(`UPDATE bulk_message_campaigns SET status = 'sending' WHERE id = $1`, [id]);
        const { coach_id, content } = camp.rows[0];
        const recipients = await pool.query(
            `SELECT user_id FROM bulk_message_recipients WHERE campaign_id = $1 AND status = 'pending'`,
            [id]
        );
        setImmediate(async () => {
            let sent = 0;
            const batchSize = 50;
            const users = recipients.rows;
            for (let i = 0; i < users.length; i += batchSize) {
                const batch = users.slice(i, i + batchSize);
                for (const { user_id } of batch) {
                    try {
                        await pool.query(
                            `INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)`,
                            [user_id, 'coach', content]
                        );
                        await pool.query(
                            `UPDATE bulk_message_recipients SET status = 'sent', sent_at = NOW() WHERE campaign_id = $1 AND user_id = $2`,
                            [id, user_id]
                        );
                        logActivity(coach_id, user_id, 'bulk_message_sent', { campaign_id: id });
                        sent++;
                    } catch (e) {
                        await pool.query(
                            `UPDATE bulk_message_recipients SET status = 'failed' WHERE campaign_id = $1 AND user_id = $2`,
                            [id, user_id]
                        ).catch(() => {});
                    }
                }
                if (i + batchSize < users.length) await new Promise(r => setTimeout(r, 100));
            }
            await pool.query(
                `UPDATE bulk_message_campaigns SET status = 'sent', sent_at = NOW(), sent_count = $2 WHERE id = $1`,
                [id, sent]
            ).catch(() => {});
        });
        return { success: true, message: 'Sending in progress', recipient_count: recipients.rows.length };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleGetBulkCampaigns(coachId) {
    if (!coachId) return { success: false, error: 'coach_id is required', statusCode: 400 };
    try {
        const r = await pool.query(
            `SELECT id, title, recipient_count, sent_count, status, scheduled_at, sent_at, created_at
             FROM bulk_message_campaigns WHERE coach_id = $1 ORDER BY created_at DESC`,
            [coachId]
        );
        return { success: true, campaigns: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleGetBulkCampaignRecipients(id) {
    try {
        const r = await pool.query(
            `SELECT bmr.user_id, bmr.status, bmr.sent_at, u.nickname, u.avatar_url
             FROM bulk_message_recipients bmr
             JOIN users u ON u.user_id = bmr.user_id
             WHERE bmr.campaign_id = $1
             ORDER BY bmr.status, u.nickname`,
            [id]
        );
        return { success: true, recipients: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 3: Appointments ─────────────────────────────────────────────────────

async function handleGetAppointments(query) {
    const { coach_id, user_id, status } = query;
    if (!coach_id) return { success: false, error: 'coach_id is required', statusCode: 400 };
    try {
        const conditions = ['a.coach_id = $1'];
        const params = [coach_id];
        if (user_id) { conditions.push(`a.user_id = $${params.length + 1}`); params.push(user_id); }
        if (status) { conditions.push(`a.status = $${params.length + 1}`); params.push(status); }
        const r = await pool.query(
            `SELECT a.id, a.user_id, a.title, a.scheduled_at, a.duration_min, a.format,
                    a.status, a.coach_notes, a.meeting_link, a.created_at,
                    u.nickname, u.avatar_url
             FROM appointments a
             JOIN users u ON u.user_id = a.user_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY a.scheduled_at DESC`,
            params
        );
        return { success: true, appointments: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostAppointment(body) {
    const { coach_id, user_id, title, scheduled_at, duration_min, format, meeting_link, coach_notes } = body;
    if (!coach_id || !user_id || !title || !scheduled_at) return { success: false, error: 'coach_id, user_id, title, scheduled_at are required', statusCode: 400 };
    try {
        const r = await pool.query(
            `INSERT INTO appointments (coach_id, user_id, title, scheduled_at, duration_min, format, meeting_link, coach_notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, title, scheduled_at, format, status`,
            [coach_id, user_id, title, scheduled_at, duration_min || 30, format || 'video', meeting_link || null, coach_notes || null]
        );
        const apptId = r.rows[0].id;
        await pool.query(
            `INSERT INTO reminders (user_id, coach_id, content, scheduled_for)
             VALUES ($1, $2, $3, $4)`,
            [user_id, coach_id, `预约提醒: ${title}`, scheduled_at]
        );
        logActivity(coach_id, user_id, 'appointment_scheduled', { appointment_id: apptId, title, scheduled_at });
        return { success: true, appointment: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePutAppointment(id, body) {
    const { status, coach_notes, meeting_link, scheduled_at } = body;
    try {
        const r = await pool.query(
            `UPDATE appointments
             SET status = COALESCE($2, status),
                 coach_notes = COALESCE($3, coach_notes),
                 meeting_link = COALESCE($4, meeting_link),
                 scheduled_at = COALESCE($5, scheduled_at),
                 updated_at = NOW()
             WHERE id = $1
             RETURNING id, status, coach_notes, meeting_link, scheduled_at`,
            [id, status || null, coach_notes || null, meeting_link || null, scheduled_at || null]
        );
        if (!r.rows.length) return { success: false, error: 'Appointment not found', statusCode: 404 };
        if (status === 'completed') {
            const appt = await pool.query('SELECT coach_id, user_id FROM appointments WHERE id = $1', [id]);
            if (appt.rows.length) logActivity(appt.rows[0].coach_id, appt.rows[0].user_id, 'appointment_completed', { appointment_id: id });
        }
        return { success: true, appointment: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleDeleteAppointment(id) {
    try {
        await pool.query(`UPDATE appointments SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [id]);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleGetUpcomingAppointments(coachId) {
    if (!coachId) return { success: false, error: 'coach_id is required', statusCode: 400 };
    try {
        const r = await pool.query(
            `SELECT a.id, a.user_id, a.title, a.scheduled_at, a.duration_min, a.format, a.meeting_link,
                    u.nickname, u.avatar_url
             FROM appointments a
             JOIN users u ON u.user_id = a.user_id
             WHERE a.coach_id = $1
               AND a.status = 'scheduled'
               AND a.scheduled_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
             ORDER BY a.scheduled_at ASC
             LIMIT 20`,
            [coachId]
        );
        return { success: true, appointments: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 3: Goals ────────────────────────────────────────────────────────────

async function handleGetClientGoals(query) {
    const { coach_id, user_id, status } = query;
    if (!coach_id || !user_id) return { success: false, error: 'coach_id and user_id are required', statusCode: 400 };
    try {
        const conditions = ['coach_id = $1', 'user_id = $2'];
        const params = [coach_id, user_id];
        if (status) { conditions.push(`status = $${params.length + 1}`); params.push(status); }
        const r = await pool.query(
            `SELECT id, goal_type, title_zh, title_en, target_value, target_unit, target_sub_age,
                    baseline_value, current_value, target_date, status, achieved_at, created_at, updated_at
             FROM client_goals
             WHERE ${conditions.join(' AND ')}
             ORDER BY status ASC, target_date ASC NULLS LAST`,
            params
        );
        return { success: true, goals: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostClientGoal(body) {
    const { coach_id, user_id, goal_type, title_zh, title_en, target_value, target_unit, target_sub_age, baseline_value, target_date } = body;
    if (!coach_id || !user_id || !goal_type || !title_zh) return { success: false, error: 'coach_id, user_id, goal_type, title_zh are required', statusCode: 400 };
    try {
        const r = await pool.query(
            `INSERT INTO client_goals (coach_id, user_id, goal_type, title_zh, title_en, target_value, target_unit,
                                       target_sub_age, baseline_value, current_value, target_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10)
             RETURNING id, goal_type, title_zh, status`,
            [coach_id, user_id, goal_type, title_zh, title_en || null, target_value || null, target_unit || null,
             target_sub_age || null, baseline_value || null, target_date || null]
        );
        logActivity(coach_id, user_id, 'goal_set', { goal_id: r.rows[0].id, goal_type, title_zh });
        return { success: true, goal: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePutClientGoal(id, body) {
    const { current_value, status, achieved_at, target_value, target_date, title_zh } = body;
    try {
        const r = await pool.query(
            `UPDATE client_goals
             SET current_value = COALESCE($2, current_value),
                 status = COALESCE($3, status),
                 achieved_at = COALESCE($4, achieved_at),
                 target_value = COALESCE($5, target_value),
                 target_date = COALESCE($6, target_date),
                 title_zh = COALESCE($7, title_zh),
                 updated_at = NOW()
             WHERE id = $1
             RETURNING id, goal_type, title_zh, current_value, status, achieved_at`,
            [id, current_value !== undefined ? current_value : null, status || null,
             achieved_at || null, target_value || null, target_date || null, title_zh || null]
        );
        if (!r.rows.length) return { success: false, error: 'Goal not found', statusCode: 404 };
        if (status === 'achieved') {
            const g = await pool.query('SELECT coach_id, user_id FROM client_goals WHERE id = $1', [id]);
            if (g.rows.length) logActivity(g.rows[0].coach_id, g.rows[0].user_id, 'goal_achieved', { goal_id: id });
        }
        return { success: true, goal: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleDeleteClientGoal(id) {
    try {
        await pool.query(`UPDATE client_goals SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [id]);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function refreshGoalProgress(userId) {
    if (!pool) return;
    try {
        const twin = await pool.query(
            `SELECT latest_bio_age, latest_sub_ages FROM health_twin WHERE user_id = $1`,
            [userId]
        );
        if (!twin.rows.length) return;
        const { latest_bio_age, latest_sub_ages } = twin.rows[0];
        const goals = await pool.query(
            `SELECT id, coach_id, goal_type, target_sub_age, target_value
             FROM client_goals WHERE user_id = $1 AND status = 'active'`,
            [userId]
        );
        for (const goal of goals.rows) {
            let currentVal = null;
            if (goal.goal_type === 'bio_age') currentVal = latest_bio_age;
            else if (goal.goal_type === 'sub_age' && goal.target_sub_age && latest_sub_ages) {
                currentVal = latest_sub_ages[goal.target_sub_age] || null;
            }
            if (currentVal === null) continue;
            const achieved = goal.target_value !== null && currentVal <= parseFloat(goal.target_value);
            await pool.query(
                `UPDATE client_goals SET current_value = $2, status = $3, achieved_at = $4, updated_at = NOW() WHERE id = $1`,
                [goal.id, currentVal, achieved ? 'achieved' : 'active', achieved ? new Date().toISOString() : null]
            );
            if (achieved) logActivity(goal.coach_id, userId, 'goal_achieved', { goal_id: goal.id });
        }
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'refresh_goal_progress_failed', data: { err: err.message, userId } }));
    }
}

// ── Phase 4: NPS Surveys ──────────────────────────────────────────────────────

async function handlePostNpsSurvey(body) {
    const { coach_id, user_id, survey_type, plan_id } = body;
    if (!coach_id || !user_id) return { success: false, error: 'coach_id and user_id are required', statusCode: 400 };
    try {
        const r = await pool.query(
            `INSERT INTO client_nps_surveys (coach_id, user_id, survey_type, plan_id)
             VALUES ($1, $2, $3, $4) RETURNING id, survey_type, sent_at, status`,
            [coach_id, user_id, survey_type || 'nps', plan_id || null]
        );
        logActivity(coach_id, user_id, 'nps_received', { survey_id: r.rows[0].id, survey_type: survey_type || 'nps' });
        return { success: true, survey: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePatchNpsSurvey(id, body) {
    const { score, feedback_text } = body;
    if (score === undefined) return { success: false, error: 'score is required', statusCode: 400 };
    try {
        const r = await pool.query(
            `UPDATE client_nps_surveys
             SET score = $2, feedback_text = $3, responded_at = NOW(), status = 'responded'
             WHERE id = $1
             RETURNING id, score, feedback_text, responded_at, status`,
            [id, score, feedback_text || null]
        );
        if (!r.rows.length) return { success: false, error: 'Survey not found', statusCode: 404 };
        return { success: true, survey: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleGetNpsSurveys(query, adminCtx = {}) {
    const { coach_id, period, start, end } = query;
    try {
        const conditions = [];
        const params = [];

        if (coach_id) {
            conditions.push(`n.coach_id = $${params.push(coach_id)}`);
        } else {
            // Channel-wide view — scope to the admin's channel
            const channelId = adminCtx.channelId;
            if (channelId) {
                conditions.push(`c.channel_id = $${params.push(channelId)}`);
            }
        }

        if (start) conditions.push(`n.sent_at >= $${params.push(start)}`);
        if (end)   conditions.push(`n.sent_at <  $${params.push(end + ' 23:59:59')}`);
        if (period && !start && !end) {
            conditions.push(`TO_CHAR(n.sent_at, 'YYYY-MM') = $${params.push(period)}`);
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const r = await pool.query(
            `SELECT n.id, n.coach_id, n.user_id, n.survey_type, n.score, n.feedback_text,
                    n.sent_at, n.responded_at, n.status,
                    u.nickname, u.avatar_url
             FROM client_nps_surveys n
             JOIN users u ON u.user_id = n.user_id
             JOIN coaches c ON c.id = n.coach_id
             ${where}
             ORDER BY n.sent_at DESC
             LIMIT 500`,
            params
        );
        const surveys = r.rows;
        const responded = surveys.filter(s => s.status === 'responded' && s.score !== null);
        const avg_score = responded.length ? (responded.reduce((a, s) => a + s.score, 0) / responded.length).toFixed(2) : null;
        const promoters  = responded.filter(s => s.score >= 9).length;
        const passives   = responded.filter(s => s.score >= 7 && s.score < 9).length;
        const detractors = responded.filter(s => s.score < 7).length;
        return { success: true, surveys, aggregate: { avg_score: avg_score ? parseFloat(avg_score) : null, promoters, passives, detractors, total: responded.length } };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 4: Coach KPIs ───────────────────────────────────────────────────────

async function handleGetCoachKpis(query) {
    const { coach_id, period } = query;
    if (!coach_id) return { success: false, error: 'coach_id is required', statusCode: 400 };
    const targetPeriod = period || new Date().toISOString().slice(0, 7);
    try {
        const isCurrentMonth = targetPeriod === new Date().toISOString().slice(0, 7);
        if (!isCurrentMonth) {
            const snap = await pool.query(
                `SELECT * FROM coach_performance_snapshots WHERE coach_id = $1 AND period = $2`,
                [coach_id, targetPeriod]
            );
            if (snap.rows.length) return { success: true, kpis: snap.rows[0], source: 'snapshot' };
        }
        const [pipeline, scans, plans, msgs, appts, nps, commissions] = await Promise.all([
            pool.query(
                `SELECT COALESCE(cps.stage, 'lead') AS stage, COUNT(u.user_id) AS cnt
                 FROM users u
                 LEFT JOIN client_pipeline_stages cps ON cps.user_id = u.user_id AND cps.coach_id = $1
                 WHERE u.coach_id = $1
                 GROUP BY COALESCE(cps.stage, 'lead')`,
                [coach_id]
            ),
            pool.query(`SELECT COUNT(*) AS cnt FROM biomarkers b JOIN users u ON u.user_id = b.user_id WHERE u.coach_id = (SELECT id FROM coaches WHERE id = $1) AND b.test_type = 'kino_chip' AND TO_CHAR(b.tested_at, 'YYYY-MM') = $2`, [coach_id, targetPeriod]),
            pool.query(`SELECT COUNT(*) AS cnt FROM health_plans WHERE coach_id = $1 AND TO_CHAR(created_at, 'YYYY-MM') = $2`, [coach_id, targetPeriod]),
            pool.query(`SELECT COUNT(*) AS cnt FROM client_activity_log WHERE coach_id = $1 AND activity_type = 'message_sent' AND TO_CHAR(occurred_at, 'YYYY-MM') = $2`, [coach_id, targetPeriod]),
            pool.query(`SELECT COUNT(*) AS cnt FROM appointments WHERE coach_id = $1 AND status = 'completed' AND TO_CHAR(scheduled_at, 'YYYY-MM') = $2`, [coach_id, targetPeriod]),
            pool.query(`SELECT AVG(score) AS avg_score, COUNT(*) AS cnt FROM client_nps_surveys WHERE coach_id = $1 AND status = 'responded' AND TO_CHAR(sent_at, 'YYYY-MM') = $2`, [coach_id, targetPeriod]),
            pool.query(`SELECT COALESCE(SUM(amount_cny), 0) AS total FROM coach_commissions WHERE coach_id = $1 AND TO_CHAR(created_at, 'YYYY-MM') = $2`, [coach_id, targetPeriod]),
        ]);
        const stageMap = {};
        for (const row of pipeline.rows) stageMap[row.stage] = parseInt(row.cnt, 10);
        const totalClients = Object.values(stageMap).reduce((a, b) => a + b, 0);
        const kpis = {
            coach_id: parseInt(coach_id, 10),
            period: targetPeriod,
            total_clients: totalClients,
            active_clients: stageMap['active'] || 0,
            at_risk_count: stageMap['at_risk'] || 0,
            scans_facilitated: parseInt(scans.rows[0].cnt, 10),
            plans_assigned: parseInt(plans.rows[0].cnt, 10),
            messages_sent: parseInt(msgs.rows[0].cnt, 10),
            appointments_held: parseInt(appts.rows[0].cnt, 10),
            avg_nps_score: nps.rows[0].avg_score ? parseFloat(parseFloat(nps.rows[0].avg_score).toFixed(2)) : null,
            nps_response_count: parseInt(nps.rows[0].cnt, 10),
            commission_cny: parseFloat(commissions.rows[0].total),
        };
        return { success: true, kpis, source: 'live' };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostCoachKpisCompute(body) {
    const { period } = body;
    if (!period) return { success: false, error: 'period (YYYY-MM) is required', statusCode: 400 };
    try {
        const coaches = await pool.query('SELECT id FROM coaches');
        let computed = 0;
        for (const { id: coachId } of coaches.rows) {
            const kpisResult = await handleGetCoachKpis({ coach_id: coachId, period });
            if (kpisResult.success) {
                const k = kpisResult.kpis;
                await pool.query(
                    `INSERT INTO coach_performance_snapshots
                         (coach_id, period, total_clients, active_clients, at_risk_count, scans_facilitated,
                          plans_assigned, messages_sent, appointments_held, avg_nps_score, nps_response_count, commission_cny)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                     ON CONFLICT (coach_id, period) DO UPDATE SET
                         total_clients = EXCLUDED.total_clients, active_clients = EXCLUDED.active_clients,
                         at_risk_count = EXCLUDED.at_risk_count, scans_facilitated = EXCLUDED.scans_facilitated,
                         plans_assigned = EXCLUDED.plans_assigned, messages_sent = EXCLUDED.messages_sent,
                         appointments_held = EXCLUDED.appointments_held, avg_nps_score = EXCLUDED.avg_nps_score,
                         nps_response_count = EXCLUDED.nps_response_count, commission_cny = EXCLUDED.commission_cny,
                         computed_at = NOW()`,
                    [coachId, period, k.total_clients, k.active_clients, k.at_risk_count, k.scans_facilitated,
                     k.plans_assigned, k.messages_sent, k.appointments_held, k.avg_nps_score, k.nps_response_count, k.commission_cny]
                );
                computed++;
            }
        }
        return { success: true, computed };
    } catch (err) { return { success: false, error: err.message }; }
}

// ── Phase 5: Follow-Up Rules ──────────────────────────────────────────────────

async function handleGetFollowUpRules(coachId) {
    if (!coachId) return { success: false, error: 'coach_id is required', statusCode: 400 };
    try {
        const r = await pool.query(
            `SELECT id, rule_name, trigger_event, trigger_value, action_type, template_id, action_payload, is_active, last_run_at
             FROM follow_up_rules WHERE coach_id = $1 ORDER BY created_at DESC`,
            [coachId]
        );
        return { success: true, rules: r.rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostFollowUpRule(body) {
    const { coach_id, rule_name, trigger_event, trigger_value, action_type, template_id, action_payload } = body;
    if (!coach_id || !rule_name || !trigger_event) return { success: false, error: 'coach_id, rule_name, trigger_event are required', statusCode: 400 };
    try {
        const r = await pool.query(
            `INSERT INTO follow_up_rules (coach_id, rule_name, trigger_event, trigger_value, action_type, template_id, action_payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, rule_name, trigger_event, is_active`,
            [coach_id, rule_name, trigger_event, trigger_value || null, action_type || 'send_reminder',
             template_id || null, JSON.stringify(action_payload || {})]
        );
        return { success: true, rule: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePutFollowUpRule(id, body) {
    const { rule_name, trigger_event, trigger_value, action_type, template_id, action_payload, is_active } = body;
    try {
        const r = await pool.query(
            `UPDATE follow_up_rules
             SET rule_name = COALESCE($2, rule_name),
                 trigger_event = COALESCE($3, trigger_event),
                 trigger_value = COALESCE($4, trigger_value),
                 action_type = COALESCE($5, action_type),
                 template_id = COALESCE($6, template_id),
                 action_payload = COALESCE($7, action_payload),
                 is_active = COALESCE($8, is_active)
             WHERE id = $1
             RETURNING id, rule_name, trigger_event, is_active`,
            [id, rule_name || null, trigger_event || null, trigger_value !== undefined ? trigger_value : null,
             action_type || null, template_id !== undefined ? template_id : null,
             action_payload ? JSON.stringify(action_payload) : null,
             is_active !== undefined ? is_active : null]
        );
        if (!r.rows.length) return { success: false, error: 'Rule not found', statusCode: 404 };
        return { success: true, rule: r.rows[0] };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handleDeleteFollowUpRule(id) {
    try {
        await pool.query('DELETE FROM follow_up_rules WHERE id = $1', [id]);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostFollowUpRulesEvaluate() {
    try {
        const rules = await pool.query(`SELECT * FROM follow_up_rules WHERE is_active = true`);
        let fired = 0;
        for (const rule of rules.rows) {
            const { id: ruleId, coach_id, trigger_event, trigger_value, action_type, template_id, action_payload } = rule;
            let targetUsers = [];
            if (trigger_event === 'no_scan_days') {
                const days = trigger_value || 14;
                const r = await pool.query(
                    `SELECT u.user_id FROM users u
                     JOIN client_pipeline_stages cps ON cps.user_id = u.user_id AND cps.coach_id = $1
                     WHERE cps.stage IN ('active','onboarding')
                       AND (
                           u.last_scanned_at IS NULL
                           OR u.last_scanned_at < NOW() - ($2 || ' days')::INTERVAL
                       )`,
                    [coach_id, days]
                );
                targetUsers = r.rows;
            } else if (trigger_event === 'no_message_days') {
                const days = trigger_value || 7;
                const r = await pool.query(
                    `SELECT u.user_id FROM users u
                     JOIN client_pipeline_stages cps ON cps.user_id = u.user_id AND cps.coach_id = $1
                     WHERE cps.stage IN ('active','onboarding')
                       AND u.user_id NOT IN (
                           SELECT DISTINCT user_id FROM client_activity_log
                           WHERE coach_id = $1 AND activity_type = 'message_sent'
                             AND occurred_at > NOW() - ($2 || ' days')::INTERVAL
                       )`,
                    [coach_id, days]
                );
                targetUsers = r.rows;
            } else if (trigger_event === 'goal_deadline_approaching') {
                const days = trigger_value || 7;
                const r = await pool.query(
                    `SELECT DISTINCT user_id FROM client_goals
                     WHERE coach_id = $1 AND status = 'active'
                       AND target_date IS NOT NULL
                       AND target_date BETWEEN NOW() AND NOW() + ($2 || ' days')::INTERVAL`,
                    [coach_id, days]
                );
                targetUsers = r.rows;
            } else if (trigger_event === 'bio_age_increased') {
                const r = await pool.query(
                    `SELECT DISTINCT u.user_id
                     FROM users u
                     JOIN (
                         SELECT user_id, bio_age, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY tested_at DESC) AS rn
                         FROM biomarkers WHERE test_type = 'kino_chip'
                     ) latest ON latest.user_id = u.user_id AND latest.rn = 1
                     JOIN (
                         SELECT user_id, bio_age, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY tested_at DESC) AS rn
                         FROM biomarkers WHERE test_type = 'kino_chip'
                     ) prev ON prev.user_id = u.user_id AND prev.rn = 2
                     WHERE u.coach_id = $1 AND latest.bio_age > prev.bio_age + 2`,
                    [coach_id]
                );
                targetUsers = r.rows;
            }
            for (const { user_id } of targetUsers) {
                try {
                    if (action_type === 'send_reminder') {
                        let content = (action_payload && action_payload.content) || '您的教练为您发送了一条提醒';
                        if (template_id) {
                            const tpl = await pool.query('SELECT content_zh FROM message_templates WHERE id = $1', [template_id]);
                            if (tpl.rows.length) content = tpl.rows[0].content_zh;
                        }
                        await pool.query(
                            `INSERT INTO reminders (user_id, coach_id, content, scheduled_for)
                             VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour')`,
                            [user_id, coach_id, content]
                        );
                    } else if (action_type === 'send_message') {
                        let content = (action_payload && action_payload.content) || '';
                        if (template_id) {
                            const tpl = await pool.query('SELECT content_zh FROM message_templates WHERE id = $1', [template_id]);
                            if (tpl.rows.length) content = tpl.rows[0].content_zh;
                        }
                        if (content) {
                            await pool.query(
                                `INSERT INTO chat_messages (user_id, role, content) VALUES ($1, $2, $3)`,
                                [user_id, 'coach', content]
                            );
                            logActivity(coach_id, user_id, 'message_sent', { rule_id: ruleId, auto: true });
                        }
                    } else if (action_type === 'change_stage') {
                        const newStage = (action_payload && action_payload.stage) || 'at_risk';
                        await pool.query(
                            `INSERT INTO client_pipeline_stages (coach_id, user_id, stage, stage_changed_at)
                             VALUES ($1, $2, $3, NOW())
                             ON CONFLICT (coach_id, user_id) DO UPDATE SET stage = EXCLUDED.stage, stage_changed_at = NOW()`,
                            [coach_id, user_id, newStage]
                        );
                        logActivity(coach_id, user_id, 'stage_changed', { stage: newStage, rule_id: ruleId, auto: true });
                    }
                    fired++;
                } catch (e) {
                    console.error(JSON.stringify({ level: 'ERROR', msg: 'follow_up_action_failed', data: { ruleId, user_id, err: e.message } }));
                }
            }
            await pool.query('UPDATE follow_up_rules SET last_run_at = NOW() WHERE id = $1', [ruleId]);
        }
        return { success: true, rules_evaluated: rules.rows.length, actions_fired: fired };
    } catch (err) { return { success: false, error: err.message }; }
}

module.exports = {
    logActivity,
    handleGetCoachTags,
    handlePostCoachTag,
    handlePutCoachTag,
    handleDeleteCoachTag,
    handlePostCoachTagAssignments,
    handleDeleteCoachTagAssignment,
    handleGetClientPipeline,
    handlePostClientPipeline,
    handleGetCoachNotes,
    handlePostCoachNote,
    handlePutCoachNote,
    handleDeleteCoachNote,
    handleGetClientActivity,
    handleGetCoachActivityFeed,
    handleGetMessageTemplates,
    handlePostMessageTemplate,
    handlePutMessageTemplate,
    handleDeleteMessageTemplate,
    handlePostMessageTemplatePreview,
    resolveBulkRecipients,
    handlePostBulkCampaign,
    handlePostBulkCampaignSend,
    handleGetBulkCampaigns,
    handleGetBulkCampaignRecipients,
    handleGetAppointments,
    handlePostAppointment,
    handlePutAppointment,
    handleDeleteAppointment,
    handleGetUpcomingAppointments,
    handleGetClientGoals,
    handlePostClientGoal,
    handlePutClientGoal,
    handleDeleteClientGoal,
    refreshGoalProgress,
    handlePostNpsSurvey,
    handlePatchNpsSurvey,
    handleGetNpsSurveys,
    handleGetCoachKpis,
    handlePostCoachKpisCompute,
    handleGetFollowUpRules,
    handlePostFollowUpRule,
    handlePutFollowUpRule,
    handleDeleteFollowUpRule,
    handlePostFollowUpRulesEvaluate,
};
