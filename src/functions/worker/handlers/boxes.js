'use strict';

const crypto = require('crypto');
const { pool } = require('../lib/db');
const { formatToShanghai } = require('../lib/time-utils');
const { _getCommittedPlanDay0Breakdown, _commitAgFormulation } = require('./dots');

// Full ingredient/timing/coating/color columns — the box QR page needs the actual per-dot
// composition (mg amounts), not just names like the GCN checkout-snapshot endpoint does.
const BOX_DOT_COLUMNS = `id, key_name, name, name_zh, color, color_zh, color_hex,
    coating, timing, ingredients, ingredients_zh, ingredients_summary`;

async function _generateBoxCode() {
    for (let i = 0; i < 10; i++) {
        const code = 'WVB' + crypto.randomBytes(6).toString('hex').toUpperCase();
        const { rows } = await pool.query('SELECT 1 FROM boxes WHERE box_code = $1', [code]);
        if (rows.length === 0) return code;
    }
    throw new Error('Failed to generate a unique box code');
}

// The printed box shows what is in it per day, so an AG formula's 56 capsules are collapsed to
// the same per-dot AM/PM shape _getCommittedPlanDay0Breakdown returns for a nano-formulated plan.
// Averaged over the days each dot actually appears, because a pulse dot (and every dot on the
// two DOT-N7 isolation days) is absent on some days by design — a flat cycle-total divided by 28
// would understate the dose the user actually takes.
async function _agDotBreakdown(capsules) {
    const dotsRes = await pool.query(`SELECT ${BOX_DOT_COLUMNS} FROM dots ORDER BY id ASC`);
    const byKey = new Map(dotsRes.rows.map(d => [d.key_name, d]));

    const agg = new Map();
    for (const c of capsules || []) {
        for (const [key, count] of Object.entries(c.dots || {})) {
            if (!agg.has(key)) agg.set(key, { am: 0, pm: 0, days: new Set() });
            const e = agg.get(key);
            e[c.slot === 'PM' ? 'pm' : 'am'] += count;
            e.days.add(c.day);
        }
    }
    return [...agg.entries()].map(([key, e]) => {
        const dot = byKey.get(key) || {};
        const days = e.days.size || 1;
        return {
            ...dot,
            key_name: key,
            name: dot.name || key,
            name_zh: dot.name_zh || key,
            morning_count: Math.round(e.am / days),
            evening_count: Math.round(e.pm / days),
            total_count: Math.round((e.am + e.pm) / days),
            cycle_total: e.am + e.pm,
            days_dosed: e.days.size,
        };
    }).filter(d => d.cycle_total > 0);
}

// Admin: POST /box-batches — { user_id, quantity, notes? }
// Snapshots the user's currently-active nutrition plan into a frozen recipe and generates
// `quantity` unique box_codes for it, one per physical box produced in this manufacturing run.
async function handlePostBoxBatch(body, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { user_id, quantity, notes, ag_formulation_id } = body || {};
        if (!user_id) return { success: false, error: 'user_id is required' };
        const qty = parseInt(quantity, 10);
        if (!qty || qty < 1 || qty > 5000) return { success: false, error: 'quantity must be 1-5000' };

        const userRes = await pool.query('SELECT user_id, channel_id FROM users WHERE user_id = $1', [user_id]);
        if (userRes.rows.length === 0) return { success: false, error: 'User not found' };
        if (adminCtx.role === 'channel' && userRes.rows[0].channel_id !== adminCtx.channelId) {
            return { success: false, error: 'Forbidden', statusCode: 403 };
        }

        // Two sources, because the AG ordering flow manufactures a box BEFORE its plan is in
        // effect: an expert-approved viva_ag_formulations row exists while its nutrition_plans row
        // is still 'approved' with no schedules, so the usual "snapshot the active plan" lookup
        // would find the user's PREVIOUS formula and box the wrong thing.
        let planId = null;
        let agFormulationId = null;
        let snapshot;

        if (ag_formulation_id) {
            const agRes = await pool.query(
                `SELECT id, user_id, status, capsules, adjusted_capsules, rationale, approved_at, nutrition_plan_id
                 FROM viva_ag_formulations WHERE id = $1`,
                [parseInt(ag_formulation_id, 10)]
            );
            const f = agRes.rows[0];
            if (!f) return { success: false, error: 'Formulation not found' };
            if (f.user_id !== user_id) return { success: false, error: 'Formulation belongs to a different user' };
            if (!['approved', 'committed'].includes(f.status)) {
                return { success: false, error: `Formulation is ${f.status}, not approved — it must not be compounded yet` };
            }
            agFormulationId = f.id;
            planId = f.nutrition_plan_id;
            snapshot = {
                ag_formulation_id: f.id,
                plan_id: planId,
                committed_at: f.approved_at,
                manufactured_at: new Date().toISOString(),
                rationale: f.rationale || null,
                dot_breakdown: await _agDotBreakdown(f.adjusted_capsules || f.capsules),
            };
        } else {
            const planRes = await pool.query(
                `SELECT id FROM nutrition_plans WHERE user_id = $1 AND status = 'active'
                 ORDER BY created_at DESC LIMIT 1`,
                [user_id]
            );
            if (planRes.rows.length === 0) return { success: false, error: 'User has no committed (active) nutrition plan' };
            planId = planRes.rows[0].id;

            const { plan, dotBreakdown, reason } = await _getCommittedPlanDay0Breakdown(planId, { dotColumns: BOX_DOT_COLUMNS });
            if (reason) return { success: false, error: `Cannot snapshot plan: ${reason}` };

            snapshot = {
                plan_id: planId,
                committed_at: plan.created_at,
                manufactured_at: new Date().toISOString(),
                dot_breakdown: dotBreakdown,
            };
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const batchRes = await client.query(
                `INSERT INTO box_batches (user_id, plan_id, quantity, recipe_snapshot, notes, created_by, ag_formulation_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                [user_id, planId, qty, JSON.stringify(snapshot), notes || null, adminCtx.username || null, agFormulationId]
            );
            const batchId = batchRes.rows[0].id;

            const codes = [];
            for (let i = 0; i < qty; i++) codes.push(await _generateBoxCode());

            const vals = [], params = [];
            codes.forEach(code => {
                vals.push(`($${params.length + 1}, $${params.length + 2})`);
                params.push(batchId, code);
            });
            await client.query(`INSERT INTO boxes (batch_id, box_code) VALUES ${vals.join(', ')}`, params);

            await client.query('COMMIT');
            return { success: true, id: batchId, quantity: qty };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostBoxBatch failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// Admin: GET /box-batches — list, channel-scoped like handleGetUsers
async function handleGetBoxBatches(query, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const params = [];
        const channelFilter = adminCtx.channelId ? `WHERE u.channel_id = $${params.push(adminCtx.channelId)}` : '';
        const res = await pool.query(
            `SELECT bb.id, bb.user_id, u.nickname, bb.quantity, bb.status, bb.notes, bb.created_at, bb.created_by
             FROM box_batches bb
             JOIN users u ON u.user_id = bb.user_id
             ${channelFilter}
             ORDER BY bb.created_at DESC`,
            params
        );
        return { success: true, batches: res.rows };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetBoxBatches failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// Admin: GET /box-batches/:id/boxes?page=&limit= — paginated list of codes within a batch
async function handleGetBoxBatchBoxes(batchId, query) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const page = Math.max(1, parseInt(query.page || '1', 10));
        const limit = Math.min(200, parseInt(query.limit || '50', 10));
        const offset = (page - 1) * limit;
        const idNum = parseInt(batchId, 10);

        const rowsRes = await pool.query(
            `SELECT id, box_code, created_at FROM boxes WHERE batch_id = $1 ORDER BY id LIMIT $2 OFFSET $3`,
            [idNum, limit, offset]
        );
        const cntRes = await pool.query('SELECT COUNT(*) FROM boxes WHERE batch_id = $1', [idNum]);
        return { success: true, boxes: rowsRes.rows, total: parseInt(cntRes.rows[0].count, 10), page, limit };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetBoxBatchBoxes failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

const COATING_LABEL = {
    zh: { gastric: '普通包衣', enteric: '肠溶包衣' },
    en: { gastric: 'Standard coating', enteric: 'Enteric coating' },
};

function _escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function _pageShell({ lang, title, bodyHtml }) {
    return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${_escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px 48px; background: #0f172a; color: #e2e8f0;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  .wrap { max-width: 520px; margin: 0 auto; }
  .header { text-align: center; margin-bottom: 24px; }
  .header h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: 0.02em; }
  .header .meta { font-size: 13px; color: #94a3b8; }
  .lang-toggle { text-align: center; margin-bottom: 20px; font-size: 13px; }
  .lang-toggle a { color: #7dd3fc; text-decoration: none; margin: 0 6px; }
  .lang-toggle a.active { color: #e2e8f0; font-weight: 600; }
  .banner { background: #7f1d1d; border: 1px solid #b91c1c; color: #fecaca;
            padding: 12px 16px; border-radius: 10px; margin-bottom: 20px; font-size: 14px; text-align: center; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 14px;
          padding: 16px 18px; margin-bottom: 14px; }
  .card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .swatch { width: 14px; height: 14px; border-radius: 50%; flex: none; border: 1px solid rgba(255,255,255,0.25); }
  .dot-name { font-size: 16px; font-weight: 600; flex: 1; }
  .badge { font-size: 11px; padding: 3px 8px; border-radius: 999px; background: #334155; color: #cbd5e1; white-space: nowrap; }
  .counts { font-size: 13px; color: #94a3b8; margin-bottom: 10px; }
  table.ing { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.ing td { padding: 4px 0; border-top: 1px solid #334155; }
  table.ing td:last-child { text-align: right; color: #94a3b8; white-space: nowrap; padding-left: 8px; }
  .footer { text-align: center; font-size: 12px; color: #64748b; margin-top: 28px; }
</style>
</head>
<body>
<div class="wrap">${bodyHtml}</div>
</body>
</html>`;
}

function _renderBoxHtml(row, lang) {
    const t = lang === 'en'
        ? { title: 'Waven Dots — Box Ingredients', manufactured: 'Manufactured', box: 'Box', morning: 'AM', evening: 'PM', total: 'per day', recalled: 'This batch has been recalled — do not consume.' }
        : { title: 'Waven Dots — 成分详情', manufactured: '生产日期', box: '盒号', morning: '早', evening: '晚', total: '每日', recalled: '此批次已被召回，请勿服用。' };

    const dots = (row.recipe_snapshot?.dot_breakdown || []);
    const cards = dots.map((d) => {
        const name = lang === 'en' ? (d.name || d.key_name) : (d.name_zh || d.name || d.key_name);
        const coatingLabel = COATING_LABEL[lang === 'en' ? 'en' : 'zh'][d.coating] || d.coating || '';
        const ingredients = (lang === 'en' ? d.ingredients : (d.ingredients_zh || d.ingredients)) || [];
        const ingRows = ingredients.map((ing) =>
            `<tr><td>${_escapeHtml(ing.name)}</td><td>${_escapeHtml(ing.mg)} mg</td></tr>`
        ).join('');
        return `<div class="card">
  <div class="card-head">
    <span class="swatch" style="background:${_escapeHtml(d.color_hex || '#64748b')}"></span>
    <span class="dot-name">${_escapeHtml(name)}</span>
    <span class="badge">${_escapeHtml(coatingLabel)}</span>
  </div>
  <div class="counts">${_escapeHtml(t.morning)} ${d.morning_count || 0} · ${_escapeHtml(t.evening)} ${d.evening_count || 0} · ${d.total_count || 0} ${_escapeHtml(t.total)}</div>
  ${ingRows ? `<table class="ing">${ingRows}</table>` : ''}
</div>`;
    }).join('\n');

    const banner = row.status === 'recalled' ? `<div class="banner">${_escapeHtml(t.recalled)}</div>` : '';
    const langLinks = `<div class="lang-toggle">
  <a href="?lang=zh" class="${lang !== 'en' ? 'active' : ''}">中文</a>|<a href="?lang=en" class="${lang === 'en' ? 'active' : ''}">English</a>
</div>`;

    const bodyHtml = `<div class="header">
  <h1>${_escapeHtml(t.title)}</h1>
  <div class="meta">${_escapeHtml(t.box)} ${_escapeHtml(row.box_code)} &middot; ${_escapeHtml(t.manufactured)} ${_escapeHtml(formatToShanghai(row.batch_created_at))}</div>
</div>
${langLinks}
${banner}
${cards}
<div class="footer">Waven Nano</div>`;

    return _pageShell({ lang, title: t.title, bodyHtml });
}

function _renderNotFoundHtml(lang) {
    const t = lang === 'en' ? { title: 'Box not found', body: 'This QR code does not match any known box.' } : { title: '未找到该盒子', body: '该二维码无法匹配任何已知的盒子。' };
    return _pageShell({ lang, title: t.title, bodyHtml: `<div class="header"><h1>${_escapeHtml(t.title)}</h1></div><div class="card">${_escapeHtml(t.body)}</div>` });
}

function _renderErrorHtml(lang) {
    const t = lang === 'en' ? { title: 'Something went wrong', body: 'Please try again later.' } : { title: '出错了', body: '请稍后再试。' };
    return _pageShell({ lang, title: t.title, bodyHtml: `<div class="header"><h1>${_escapeHtml(t.title)}</h1></div><div class="card">${_escapeHtml(t.body)}</div>` });
}

// PUBLIC — no auth. GET /box/:box_code?lang=zh|en (default zh, matches users.language DEFAULT 'zh')
async function handleGetBoxPage(boxCode, query = {}) {
    const lang = query.lang === 'en' ? 'en' : 'zh';
    try {
        if (!pool) return { html: _renderErrorHtml(lang), statusCode: 500 };
        const res = await pool.query(
            `SELECT b.box_code, b.created_at AS box_created_at,
                    bb.recipe_snapshot, bb.quantity, bb.status, bb.created_at AS batch_created_at
             FROM boxes b
             JOIN box_batches bb ON bb.id = b.batch_id
             WHERE b.box_code = $1`,
            [boxCode]
        );
        if (res.rows.length === 0) return { html: _renderNotFoundHtml(lang), statusCode: 404 };
        return { html: _renderBoxHtml(res.rows[0], lang), statusCode: 200 };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetBoxPage failed', error: err.message }));
        return { html: _renderErrorHtml(lang), statusCode: 500 };
    }
}


// POST /box-claim  { openid, box_code }  (app bearer)
//
// The user scanning the box they just received. This is the moment an AG formulation stops being
// a plan-on-paper and becomes a live 28-day schedule — start_date is TODAY, so the cycle is
// aligned to when they can actually take the capsules rather than when the box was compounded.
//
// Idempotent by design: a second scan of the same box returns the plan the first scan made. A
// user tapping twice must not get two overlapping 28-day schedules.
async function handlePostBoxClaim(body) {
    const { openid } = body || {};
    if (!openid) return { success: false, reason: 'missing_params' };

    // WeChat's scanner returns whatever the QR encodes — the bare code from a code-only QR, or the
    // full https://…/box/WVB… URL from the public ingredient page's QR. Both are the same box.
    const raw = String(body?.box_code || '').trim();
    const match = /WVB[0-9A-Fa-f]{12}/.exec(raw);
    const boxCode = match ? match[0].toUpperCase() : null;
    if (!boxCode) return { success: false, reason: 'invalid_box_code' };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: [box] } = await client.query(
            `SELECT b.id, b.box_code, b.claimed_by_user_id, b.nutrition_plan_id,
                    bb.id AS batch_id, bb.user_id AS batch_user_id, bb.status AS batch_status,
                    bb.ag_formulation_id, bb.plan_id
             FROM boxes b JOIN box_batches bb ON bb.id = b.batch_id
             WHERE b.box_code = $1
             FOR UPDATE OF b`,
            [boxCode]
        );
        if (!box) { await client.query('ROLLBACK'); return { success: false, reason: 'box_not_found' }; }
        if (box.batch_status === 'recalled') { await client.query('ROLLBACK'); return { success: false, reason: 'batch_recalled' }; }

        if (box.claimed_by_user_id) {
            await client.query('ROLLBACK');
            if (box.claimed_by_user_id !== openid) return { success: false, reason: 'claimed_by_other' };
            return { success: true, already_claimed: true, plan_id: box.nutrition_plan_id, box_code: boxCode };
        }
        // These capsules were compounded for one named person from their own biomarkers — the box
        // is not transferable, and taking someone else's formulation is a real safety issue.
        if (box.batch_user_id !== openid) { await client.query('ROLLBACK'); return { success: false, reason: 'not_your_box' }; }

        let planId = box.plan_id;
        if (box.ag_formulation_id) {
            const { rows: [f] } = await client.query(
                `SELECT id, status, capsules, adjusted_capsules, rationale, nutrition_plan_id
                 FROM viva_ag_formulations WHERE id = $1 FOR UPDATE`,
                [box.ag_formulation_id]
            );
            if (!f) { await client.query('ROLLBACK'); return { success: false, reason: 'formulation_not_found' }; }
            if (f.status === 'committed' && f.nutrition_plan_id) {
                // Another box from the same batch already activated this formulation. Claim this
                // box against the existing plan rather than generating the schedule twice.
                planId = f.nutrition_plan_id;
            } else if (f.status !== 'approved') {
                await client.query('ROLLBACK');
                return { success: false, reason: 'formulation_not_approved' };
            } else {
                const capsules = f.adjusted_capsules || f.capsules || [];
                const committed = await _commitAgFormulation(client, {
                    userId: openid, planId: f.nutrition_plan_id, capsules, analysis: f.rationale,
                });
                if (!committed) { await client.query('ROLLBACK'); return { success: false, reason: 'formulation_not_approved' }; }
                planId = committed;
                await client.query(
                    `UPDATE viva_ag_formulations SET status = 'committed', committed_at = NOW(), updated_at = NOW() WHERE id = $1`,
                    [f.id]
                );
            }
        }

        await client.query(
            `UPDATE boxes SET claimed_by_user_id = $2, claimed_at = NOW(), nutrition_plan_id = $3 WHERE id = $1`,
            [box.id, openid, planId]
        );
        await client.query('COMMIT');

        console.log(JSON.stringify({ level: 'INFO', msg: 'box claimed', box_code: boxCode, user_id: openid, plan_id: planId }));
        return { success: true, already_claimed: false, plan_id: planId, box_code: boxCode };
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostBoxClaim failed', error: err.message, box_code: boxCode }));
        return { success: false, reason: 'internal_error' };
    } finally {
        client.release();
    }
}

module.exports = {
    handlePostBoxBatch,
    handleGetBoxBatches,
    handleGetBoxBatchBoxes,
    handleGetBoxPage,
    handlePostBoxClaim,
};
