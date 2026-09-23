const { pool } = require('../lib/db');
const {
    requirePermission,
    verifySubchannelOwnership,
    signChannelAdminToken,
    CHANNEL_ADMIN_FULL_PERMS,
    expandPermissions,
    getWxAccessToken,
} = require('../lib/auth');

// GET /channel-branding?id=<channels.id> — the public display fields of one channel, read by
// the miniapp login page BEFORE any login when it was opened from a channel QR code
// (scene `ch:<id>`, see pages/login/login.js). Only what the login response already returns
// to every user of that channel (name/logo/locale) — nothing operational. Keyed on the numeric
// id so a printed QR survives a channel rename; web landing links may use key_name.
async function handleGetChannelBranding(query) {
    const id = Number(query?.id);
    const key = typeof query?.key_name === 'string' ? query.key_name.trim() : '';
    const byKey = query?.id == null && /^[a-zA-Z0-9_-]{1,100}$/.test(key);
    if (!byKey && (!Number.isSafeInteger(id) || id <= 0)) return { statusCode: 400, success: false, error: 'id or key_name is required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query(
            `SELECT id, name, key_name, effective_channel_logo(id) AS logo_url,
                    effective_channel_config(id, 'locale') #>> '{}' AS locale
             FROM channels WHERE ${byKey ? 'key_name' : 'id'} = $1 LIMIT 1`,
            [byKey ? key : id]
        );
        if (rows.length === 0) return { statusCode: 404, success: false, error: 'channel_not_found' };
        const c = rows[0];
        return { success: true, channel: { id: c.id, name: c.name, key_name: c.key_name, logo_url: c.logo_url || null, locale: c.locale || 'zh' } };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetChannelBranding failed', data: { id, error: err.message } }));
        return { success: false, error: err.message };
    }
}

// GET /channels/:id/miniapp-qrcode — a WeChat 小程序码 for the ROOT (Waven) miniprogram that
// opens pages/login/login with scene `ch:<id>`, so the login screen shows this channel's logo
// and a brand-new scanner is assigned to it (channel_slug fallback in handlers/login.js).
// Always minted against WX_APPID_WAVEN: the brand-specific builds (aeviva/fusion appids) get
// their branding from utils/config.js's APPID_TO_CHANNEL and don't need a scene. Returned as
// base64 JSON rather than image bytes so the admin panel can drop it in an <img> and the
// caller can save it; wxacode.getUnlimited codes never expire, so nothing is cached here.
async function handleGetChannelMiniappQrcode(channelId, adminCtx) {
    const id = parseInt(channelId, 10);
    if (!Number.isInteger(id) || id <= 0) return { statusCode: 400, success: false, error: 'invalid channel id' };
    if (adminCtx?.role === 'channel' && id !== adminCtx.channelId) {
        const owns = await verifySubchannelOwnership(id, adminCtx);
        if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
    }
    const appid = process.env.WX_APPID_WAVEN || process.env.WX_APPID;
    const secret = process.env.WX_APPID_WAVEN ? process.env.WX_SECRET_WAVEN : process.env.WX_SECRET;
    if (!appid || !secret) return { success: false, error: 'WeChat root miniprogram credentials not configured' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query('SELECT id, name, key_name FROM channels WHERE id = $1 LIMIT 1', [id]);
        if (rows.length === 0) return { statusCode: 404, success: false, error: 'channel_not_found' };
        const scene = `ch:${id}`;
        const page = 'pages/login/login';
        const token = await getWxAccessToken(appid, secret);
        const res = await fetch(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // check_path=false: the code must be mintable before a build that contains the page
            // is released; env_version stays 'release' so scanning opens the published app.
            body: JSON.stringify({ scene, page, check_path: false, env_version: 'release', width: 430 }),
        });
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json') || ct.includes('text/plain')) {
            const data = await res.json().catch(() => ({}));
            const msg = `WX wxacode error: ${data.errmsg || 'unknown'} (${data.errcode ?? '?'})`;
            console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetChannelMiniappQrcode wxacode failed', data: { id, appid, errcode: data.errcode, errmsg: data.errmsg } }));
            return { success: false, error: msg };
        }
        const buf = Buffer.from(await res.arrayBuffer());
        return { success: true, channel: rows[0], appid, scene, page, content_type: ct || 'image/jpeg', image_base64: buf.toString('base64') };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetChannelMiniappQrcode failed', data: { id, error: err.message } }));
        return { success: false, error: err.message };
    }
}

async function handleGetChannels(adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (adminCtx?.role === 'channel' && adminCtx.canManageSubchannels) {
            const result = await pool.query(`
                WITH RECURSIVE subtree AS (
                    SELECT id, 1 AS depth FROM channels WHERE id = $1
                    UNION ALL
                    SELECT c.id, s.depth + 1 FROM channels c
                    JOIN subtree s ON c.parent_channel_id = s.id
                    WHERE s.depth < 20
                )
                SELECT c.id, c.key_name, c.name, c.logo_url, c.config, c.created_at, effective_persona_type(c.id) AS effective_persona_type, effective_channel_config(c.id, 'admin_tabs') AS effective_admin_tabs, effective_channel_config(c.id, 'sub_age_display_names') AS effective_sub_age_display_names, effective_channel_config(c.id, 'locale') #>> '{}' AS effective_locale,
                       c.parent_channel_id, c.can_manage_subchannels, c.can_customize_rewards, c.can_customize_partner_tiers, c.can_customize_partner_system, c.can_customize_store, c.can_manage_warehouses, c.autonomous,
                       st.depth,
                       COUNT(DISTINCT u.user_id) AS user_count,
                       COUNT(DISTINCT p.id) AS coach_count,
                       COUNT(DISTINCT kd.id) AS kino_device_count,
                       COUNT(DISTINCT CASE WHEN kd.status = 'active' THEN kd.id END) AS kino_active_count,
                       COUNT(DISTINCT b.id) AS scan_count
                FROM subtree st
                JOIN channels c ON c.id = st.id
                LEFT JOIN users u ON u.channel_id = c.id
                LEFT JOIN coaches p ON p.user_id = u.user_id
                LEFT JOIN kino_devices kd ON kd.channel_id = c.id
                LEFT JOIN biomarkers b ON b.kino_device_id = kd.id
                GROUP BY c.id, st.depth
                ORDER BY st.depth, c.id
            `, [adminCtx.channelId]);
            return { success: true, channels: result.rows };
        }
        const result = await pool.query(`
            SELECT c.id, c.key_name, c.name, c.logo_url, c.config, c.created_at, effective_persona_type(c.id) AS effective_persona_type, effective_channel_config(c.id, 'admin_tabs') AS effective_admin_tabs, effective_channel_config(c.id, 'sub_age_display_names') AS effective_sub_age_display_names, effective_channel_config(c.id, 'locale') #>> '{}' AS effective_locale, c.parent_channel_id, c.can_manage_subchannels, c.can_customize_rewards, c.can_customize_partner_tiers, c.can_customize_store, c.can_manage_warehouses, c.autonomous,
                   COUNT(DISTINCT u.user_id) AS user_count,
                   COUNT(DISTINCT p.id) AS coach_count,
                   COUNT(DISTINCT kd.id) AS kino_device_count,
                   COUNT(DISTINCT CASE WHEN kd.status = 'active' THEN kd.id END) AS kino_active_count,
                   COUNT(DISTINCT b.id) AS scan_count
            FROM channels c
            LEFT JOIN users u ON u.channel_id = c.id
            LEFT JOIN coaches p ON p.user_id = u.user_id
            LEFT JOIN kino_devices kd ON kd.channel_id = c.id
            LEFT JOIN biomarkers b ON b.kino_device_id = kd.id
            GROUP BY c.id
            ORDER BY c.id
        `);
        return { success: true, channels: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostChannel(body, adminCtx) {
    const isCmsAdmin = adminCtx?.role === 'channel' && adminCtx?.canManageSubchannels;
    if (adminCtx?.role === 'channel' && !isCmsAdmin) return { statusCode: 403, success: false, error: 'Forbidden' };
    const { key_name, name, logo_url, parent_channel_id } = body;
    if (!key_name) return { success: false, error: 'key_name is required', statusCode: 400 };
    if (!name)     return { success: false, error: 'name is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let parentChannelId = null;
        if (isCmsAdmin) {
            const reqParent = parent_channel_id ? parseInt(parent_channel_id) : adminCtx.channelId;
            if (reqParent === adminCtx.channelId) {
                parentChannelId = adminCtx.channelId;
            } else {
                const owns = await verifySubchannelOwnership(reqParent, adminCtx);
                if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
                parentChannelId = reqParent;
            }
        } else if (parent_channel_id) {
            parentChannelId = parseInt(parent_channel_id);
        }
        const result = await pool.query(
            `INSERT INTO channels (key_name, name, logo_url, parent_channel_id) VALUES ($1, $2, $3, $4) RETURNING id`,
            [key_name, name, logo_url || null, parentChannelId]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutChannel(channelId, body, adminCtx) {
    if (adminCtx?.role === 'channel') {
        const isSelf = parseInt(channelId) === adminCtx.channelId;
        if (!isSelf) {
            if (!adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
            const owns = await verifySubchannelOwnership(channelId, adminCtx);
            if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
        }
    }
    const { name, logo_url, commission_config, persona_type, credit_exchange_rate, currency, locale } = body;
    if (!name) return { success: false, error: 'name is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            `UPDATE channels SET name=$1, logo_url=$2, commission_config=$3 WHERE id=$4`,
            [name, logo_url || null, commission_config ? JSON.stringify(commission_config) : null, channelId]
        );
        const configPatch = {};
        if (persona_type !== undefined) configPatch.persona_type = persona_type;
        if (credit_exchange_rate !== undefined) configPatch.credit_exchange_rate = parseFloat(credit_exchange_rate) || 1.0;
        if (currency !== undefined) configPatch.currency = currency;
        if (locale !== undefined) configPatch.locale = locale;
        if (Object.keys(configPatch).length > 0) {
            await pool.query(
                `UPDATE channels SET config = config || $1 WHERE id = $2`,
                [JSON.stringify(configPatch), channelId]
            );
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteChannel(channelId, adminCtx) {
    if (adminCtx?.role === 'channel') {
        if (!adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
        const owns = await verifySubchannelOwnership(channelId, adminCtx);
        if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const subcheck = await pool.query('SELECT 1 FROM channels WHERE parent_channel_id = $1 LIMIT 1', [channelId]);
        if (subcheck.rows.length > 0) return { statusCode: 400, success: false, error: 'Cannot delete a channel that has sub-channels. Remove all sub-channels first.' };
        await pool.query('DELETE FROM channels WHERE id = $1', [channelId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutChannelManageSubchannels(channelId, body, adminCtx) {
    if (adminCtx?.role === 'channel') {
        if (!adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
        const owns = await verifySubchannelOwnership(channelId, adminCtx);
        if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
    }
    const { can_manage_subchannels } = body || {};
    if (typeof can_manage_subchannels !== 'boolean') return { statusCode: 400, success: false, error: 'can_manage_subchannels must be a boolean' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('UPDATE channels SET can_manage_subchannels = $1 WHERE id = $2', [can_manage_subchannels, channelId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutChannelAdminTabs(channelId, body, adminCtx) {
    if (adminCtx?.role === 'channel') {
        if (!adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
        const owns = await verifySubchannelOwnership(channelId, adminCtx);
        if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
    }
    const { tabs } = body || {};
    if (!Array.isArray(tabs)) return { statusCode: 400, success: false, error: 'tabs must be an array' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            `UPDATE channels SET config = jsonb_set(COALESCE(config, '{}'), '{admin_tabs}', $1::jsonb) WHERE id = $2`,
            [JSON.stringify(tabs), channelId]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutChannelSubAgeLabels(channelId, body, adminCtx) {
    if (adminCtx?.role === 'channel') {
        if (!adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
        const owns = await verifySubchannelOwnership(channelId, adminCtx);
        if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
    }
    const { sub_age_display_names } = body || {};
    if (!sub_age_display_names || typeof sub_age_display_names !== 'object')
        return { statusCode: 400, success: false, error: 'sub_age_display_names must be an object' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            `UPDATE channels SET config = jsonb_set(COALESCE(config, '{}'), '{sub_age_display_names}', $1::jsonb) WHERE id = $2`,
            [JSON.stringify(sub_age_display_names), channelId]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetChannelRewardsConfig(channelId, adminCtx) {
    if (adminCtx?.role === 'channel') {
        const targetId = parseInt(channelId);
        if (targetId !== adminCtx.channelId) {
            const owns = await verifySubchannelOwnership(channelId, adminCtx);
            if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
        }
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { getEffectiveCommissionConfig } = require('../lib/commissions');
        const { config, source, sourceChannelId, sourceChannelName } = await getEffectiveCommissionConfig(parseInt(channelId));

        // Also walk up for referral_commission_rate, credit_exchange_rate, currency
        const { rows } = await pool.query(`
            WITH RECURSIVE chain AS (
                SELECT id, parent_channel_id, config, can_customize_rewards, 0 AS depth
                FROM channels WHERE id = $1
                UNION ALL
                SELECT c.id, c.parent_channel_id, c.config, c.can_customize_rewards, chain.depth + 1
                FROM channels c JOIN chain ON c.id = chain.parent_channel_id
                WHERE chain.depth < 10
            )
            SELECT * FROM chain ORDER BY depth ASC
        `, [channelId]);

        const ownRow = rows[0];
        let referral_commission_rate = 5;
        let credit_exchange_rate = 1.0;
        let currency = 'CNY';
        for (const row of rows) {
            const isRoot = row.parent_channel_id == null;
            const canUseOwn = isRoot || row.can_customize_rewards;
            if (canUseOwn) {
                if (row.config?.referral_commission_rate != null) referral_commission_rate = Number(row.config.referral_commission_rate);
                if (row.config?.credit_exchange_rate != null) credit_exchange_rate = parseFloat(row.config.credit_exchange_rate);
                if (row.config?.currency) currency = row.config.currency;
                break;
            }
            if (isRoot) break;
        }

        return {
            success: true,
            commission_config: config,
            source,
            source_channel_id: sourceChannelId,
            source_channel_name: sourceChannelName,
            can_customize_rewards: ownRow?.can_customize_rewards ?? false,
            referral_commission_rate,
            credit_exchange_rate,
            currency,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutChannelRewardsConfig(channelId, body, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const cid = parseInt(channelId);

        // Check permission: superadmin always ok; channel admin must own it AND either be root or have can_customize_rewards
        if (adminCtx?.role === 'channel') {
            if (cid !== adminCtx.channelId) {
                const owns = await verifySubchannelOwnership(channelId, adminCtx);
                if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
            }
            // Sub-channel (has parent) requires can_customize_rewards
            const { rows } = await pool.query(
                'SELECT parent_channel_id, can_customize_rewards FROM channels WHERE id = $1', [cid]
            );
            const ch = rows[0];
            if (ch?.parent_channel_id != null && !ch?.can_customize_rewards) {
                return { statusCode: 403, success: false, error: 'Custom rewards not permitted for this channel' };
            }
        }

        const { commission_config, referral_commission_rate } = body || {};
        if (commission_config !== undefined) {
            await pool.query(
                'UPDATE channels SET commission_config = $1 WHERE id = $2',
                [commission_config ? JSON.stringify(commission_config) : null, cid]
            );
        }
        if (referral_commission_rate !== undefined) {
            await pool.query(
                `UPDATE channels SET config = jsonb_set(COALESCE(config, '{}'), '{referral_commission_rate}', $1::jsonb) WHERE id = $2`,
                [JSON.stringify(referral_commission_rate), cid]
            );
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutChannelRewardsPermission(channelId, body, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const cid = parseInt(channelId);

        if (adminCtx?.role === 'channel') {
            // Only the parent channel's admin (with canManageSubchannels) can grant this
            if (!adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
            const { rows } = await pool.query('SELECT parent_channel_id FROM channels WHERE id = $1', [cid]);
            const parentId = rows[0]?.parent_channel_id;
            if (!parentId) return { statusCode: 403, success: false, error: 'Cannot grant rewards permission to a root channel' };
            // Verify the target's parent is within this admin's subtree
            const owns = await verifySubchannelOwnership(parentId, adminCtx);
            if (!owns && parentId !== adminCtx.channelId) return { statusCode: 403, success: false, error: 'Forbidden' };
        }

        const { can_customize_rewards } = body || {};
        if (typeof can_customize_rewards !== 'boolean')
            return { statusCode: 400, success: false, error: 'can_customize_rewards must be a boolean' };
        await pool.query('UPDATE channels SET can_customize_rewards = $1 WHERE id = $2', [can_customize_rewards, cid]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutChannelStorePermission(channelId, body, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const cid = parseInt(channelId);

        if (adminCtx?.role === 'channel') {
            if (!adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
            const { rows } = await pool.query(
                'SELECT parent_channel_id FROM channels WHERE id = $1', [cid]
            );
            const parentId = rows[0]?.parent_channel_id;
            if (!parentId) return { statusCode: 403, success: false, error: 'Cannot grant store permission to a root channel' };
            const owns = await verifySubchannelOwnership(parentId, adminCtx);
            if (!owns && parentId !== adminCtx.channelId) return { statusCode: 403, success: false, error: 'Forbidden' };
            // Parent must itself have can_customize_store to delegate it
            const { rows: parentRows } = await pool.query(
                'SELECT can_customize_store FROM channels WHERE id = $1', [adminCtx.channelId]
            );
            if (!parentRows[0]?.can_customize_store) {
                return { statusCode: 403, success: false, error: 'Your channel does not have store customization permission' };
            }
        }

        const { can_customize_store } = body || {};
        if (typeof can_customize_store !== 'boolean')
            return { statusCode: 400, success: false, error: 'can_customize_store must be a boolean' };
        await pool.query('UPDATE channels SET can_customize_store = $1 WHERE id = $2', [can_customize_store, cid]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutChannelAutonomous(channelId, body, adminCtx) {
    if (adminCtx?.role !== 'superadmin')
        return { statusCode: 403, success: false, error: 'Only superadmins can set the autonomous flag' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { autonomous } = body || {};
        if (typeof autonomous !== 'boolean')
            return { statusCode: 400, success: false, error: 'autonomous must be a boolean' };
        await pool.query('UPDATE channels SET autonomous = $1 WHERE id = $2', [autonomous, parseInt(channelId)]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutChannelWarehousePermission(channelId, body, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const cid = parseInt(channelId);
        if (adminCtx?.role === 'channel') {
            if (!adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
            const { rows } = await pool.query('SELECT parent_channel_id FROM channels WHERE id = $1', [cid]);
            const parentId = rows[0]?.parent_channel_id;
            if (!parentId) return { statusCode: 403, success: false, error: 'Cannot grant warehouse permission to a root channel' };
            const owns = await verifySubchannelOwnership(parentId, adminCtx);
            if (!owns && parentId !== adminCtx.channelId) return { statusCode: 403, success: false, error: 'Forbidden' };
            const { rows: parentRows } = await pool.query('SELECT can_manage_warehouses FROM channels WHERE id = $1', [adminCtx.channelId]);
            if (!parentRows[0]?.can_manage_warehouses)
                return { statusCode: 403, success: false, error: 'Your channel does not have warehouse management permission' };
        }
        const { can_manage_warehouses } = body || {};
        if (typeof can_manage_warehouses !== 'boolean')
            return { statusCode: 400, success: false, error: 'can_manage_warehouses must be a boolean' };
        await pool.query('UPDATE channels SET can_manage_warehouses = $1 WHERE id = $2', [can_manage_warehouses, cid]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetChannelPartnerTiersConfig(channelId, adminCtx) {
    if (adminCtx?.role === 'channel') {
        const targetId = parseInt(channelId);
        if (targetId !== adminCtx.channelId) {
            const owns = await verifySubchannelOwnership(channelId, adminCtx);
            if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
        }
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const cid = parseInt(channelId);
        const { rows } = await pool.query(`
            WITH RECURSIVE chain AS (
                SELECT id, parent_channel_id, name, partner_tiers_config, can_customize_partner_tiers, 0 AS depth
                FROM channels WHERE id = $1
                UNION ALL
                SELECT c.id, c.parent_channel_id, c.name, c.partner_tiers_config, c.can_customize_partner_tiers, chain.depth + 1
                FROM channels c JOIN chain ON c.id = chain.parent_channel_id
                WHERE chain.depth < 10
            )
            SELECT * FROM chain ORDER BY depth ASC
        `, [cid]);

        const ownRow = rows[0];
        let effectiveConfig = null;
        let source = 'global';
        let sourceChannelId = null;
        let sourceChannelName = null;

        for (const row of rows) {
            const isRoot = row.parent_channel_id == null;
            const canUseOwn = isRoot || row.can_customize_partner_tiers;
            if (canUseOwn && row.partner_tiers_config != null) {
                effectiveConfig = row.partner_tiers_config;
                source = row.id === cid ? 'own' : 'inherited';
                sourceChannelId = row.id;
                sourceChannelName = row.name;
                break;
            }
            if (isRoot) break;
        }

        return {
            success: true,
            partner_tiers_config: effectiveConfig,
            source,
            source_channel_id: sourceChannelId,
            source_channel_name: sourceChannelName,
            can_customize_partner_tiers: ownRow?.can_customize_partner_tiers ?? false,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutChannelPartnerTiersConfig(channelId, body, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const cid = parseInt(channelId);

        if (adminCtx?.role === 'channel') {
            if (cid !== adminCtx.channelId) {
                const owns = await verifySubchannelOwnership(channelId, adminCtx);
                if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
            }
            const { rows } = await pool.query(
                'SELECT parent_channel_id, can_customize_partner_tiers FROM channels WHERE id = $1', [cid]
            );
            const ch = rows[0];
            if (ch?.parent_channel_id != null && !ch?.can_customize_partner_tiers) {
                return { statusCode: 403, success: false, error: 'Custom partner tier config not permitted for this channel' };
            }
        }

        const { partner_tiers_config } = body || {};
        if (partner_tiers_config != null) {
            const { rows: validTypes } = await pool.query(`SELECT key FROM partner_types`);
            const validKeys = new Set(validTypes.map(r => r.key));
            for (const key of Object.keys(partner_tiers_config)) {
                if (!validKeys.has(key)) {
                    return { statusCode: 400, success: false, error: `Invalid tier key: ${key}` };
                }
            }
        }
        await pool.query(
            'UPDATE channels SET partner_tiers_config = $1 WHERE id = $2',
            [partner_tiers_config != null ? JSON.stringify(partner_tiers_config) : null, cid]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutChannelPartnerTiersPermission(channelId, body, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const cid = parseInt(channelId);

        if (adminCtx?.role === 'channel') {
            if (!adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
            const { rows } = await pool.query('SELECT parent_channel_id FROM channels WHERE id = $1', [cid]);
            const parentId = rows[0]?.parent_channel_id;
            if (!parentId) return { statusCode: 403, success: false, error: 'Cannot grant partner tier permission to a root channel' };
            const owns = await verifySubchannelOwnership(parentId, adminCtx);
            if (!owns && parentId !== adminCtx.channelId) return { statusCode: 403, success: false, error: 'Forbidden' };
        }

        const { can_customize_partner_tiers } = body || {};
        if (typeof can_customize_partner_tiers !== 'boolean')
            return { statusCode: 400, success: false, error: 'can_customize_partner_tiers must be a boolean' };
        await pool.query('UPDATE channels SET can_customize_partner_tiers = $1 WHERE id = $2', [can_customize_partner_tiers, cid]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    handleGetChannelBranding,
    handleGetChannelMiniappQrcode,
    handleGetChannels,
    handlePostChannel,
    handlePutChannel,
    handleDeleteChannel,
    handlePutChannelManageSubchannels,
    handlePutChannelAdminTabs,
    handlePutChannelSubAgeLabels,
    handleGetChannelRewardsConfig,
    handlePutChannelRewardsConfig,
    handlePutChannelRewardsPermission,
    handlePutChannelStorePermission,
    handlePutChannelAutonomous,
    handlePutChannelWarehousePermission,
    handleGetChannelPartnerTiersConfig,
    handlePutChannelPartnerTiersConfig,
    handlePutChannelPartnerTiersPermission,
};
