const { pool } = require('../lib/db');
const ossLib = require('../lib/oss');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// Kone APK Release Handlers
// ─────────────────────────────────────────────────────────────────────────────

const KONE_APK_BUCKET  = process.env.KONE_APK_OSS_BUCKET  || 'kone-apk';
const KONE_APK_CNAME   = process.env.KONE_APK_CNAME_DOMAIN || null;
const OSS_CNAME        = process.env.OSS_CNAME_DOMAIN       || null;

async function handleGetKoneApkReleases() {
    try {
        const result = await pool.query(
            `SELECT id, version, oss_key, download_url, notes, is_active, created_at
             FROM kone_apk_releases ORDER BY created_at DESC`
        );
        return { success: true, releases: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostKoneApkRelease(body) {
    const { version, oss_key, download_url, notes } = body;
    if (!version || !oss_key || !download_url) {
        return { success: false, error: 'version, oss_key, and download_url are required' };
    }
    try {
        const result = await pool.query(
            `INSERT INTO kone_apk_releases (version, oss_key, download_url, notes)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [version, oss_key, download_url, notes || null]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutKoneApkRelease(id, body) {
    try {
        const releaseId = parseInt(id);
        if (body.is_active === true) {
            // Clear any existing active release, then activate this one
            await pool.query(`UPDATE kone_apk_releases SET is_active = false`);
            await pool.query(`UPDATE kone_apk_releases SET is_active = true WHERE id = $1`, [releaseId]);
        }
        if (body.notes !== undefined) {
            await pool.query(`UPDATE kone_apk_releases SET notes = $1 WHERE id = $2`, [body.notes, releaseId]);
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteKoneApkRelease(id) {
    try {
        const releaseId = parseInt(id);
        const check = await pool.query(`SELECT is_active FROM kone_apk_releases WHERE id = $1`, [releaseId]);
        if (check.rows.length === 0) return { success: false, error: 'Release not found' };
        if (check.rows[0].is_active) return { success: false, error: 'Cannot delete the active release' };
        await pool.query(`DELETE FROM kone_apk_releases WHERE id = $1`, [releaseId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetKoneApkPresign() {
    try {
        const id = crypto.randomBytes(8).toString('hex');
        const key = `apk/${id}.apk`;
        const put_url = ossLib.generatePresignedPutUrl(key, 3600, KONE_APK_BUCKET);
        const get_url = ossLib.generatePresignedGetUrl(key, 315360000, KONE_APK_BUCKET, KONE_APK_CNAME);
        return { success: true, put_url, get_url, key };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetKinoUpgrade() {
    try {
        const result = await pool.query(
            `SELECT version, download_url FROM kone_apk_releases WHERE is_active = true LIMIT 1`
        );
        if (result.rows.length === 0) return { version: '', url: '' };
        const row = result.rows[0];
        return { version: row.version, url: row.download_url };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Digital Assets Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleGetDigitalAssets(query, adminCtx = {}) {
    const { type } = query;
    // Channel admins are always scoped to their channel; superadmins use query.channel_id (admin panel)
    // or query.channel_id (miniapp passing user's channel). No channel_id → global assets only.
    const isChannelAdmin = adminCtx.role === 'channel';
    const effectiveChannelId = isChannelAdmin
        ? adminCtx.channelId
        : (query.channel_id ? parseInt(query.channel_id) : null);
    try {
        const params = [];
        const conditions = [];
        if (!isChannelAdmin) conditions.push('is_active = true');
        if (type) {
            params.push(type);
            conditions.push(`type = $${params.length}`);
        }
        if (effectiveChannelId) {
            params.push(effectiveChannelId);
            // Return channel-specific assets + global assets (channel_id IS NULL) for miniapp;
            // For admin panel (channel admin), return only their assets.
            if (isChannelAdmin) {
                conditions.push(`channel_id = $${params.length}`);
            } else {
                conditions.push(`(channel_id IS NULL OR channel_id = $${params.length})`);
            }
        } else {
            conditions.push('channel_id IS NULL');
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await pool.query(
            `SELECT id, type, title, title_zh, oss_key, content_type, duration_seconds, sort_order, is_active, channel_id
             FROM digital_assets ${where} ORDER BY sort_order ASC, id ASC`,
            params
        );
        const assets = result.rows.map(row => ({
            id: row.id,
            type: row.type,
            title: row.title,
            title_zh: row.title_zh,
            content_type: row.content_type,
            duration_seconds: row.duration_seconds,
            sort_order: row.sort_order,
            is_active: row.is_active,
            channel_id: row.channel_id,
            url: ossLib.generatePresignedGetUrl(row.oss_key, 604800, null, OSS_CNAME),
        }));
        return { success: true, assets };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetDigitalAssets', error: err.message }));
        return { success: false, error: err.message };
    }
}

async function handlePostDigitalAsset(body, adminCtx = {}) {
    const { type, title, title_zh, oss_key, content_type, duration_seconds, sort_order } = body;
    if (!type || !title || !oss_key) return { success: false, error: 'type, title, oss_key are required' };
    // Channel admins always create for their own channel; superadmins can set any channel_id.
    const channelId = adminCtx.role === 'channel'
        ? adminCtx.channelId
        : (body.channel_id ? parseInt(body.channel_id) : null);
    try {
        const result = await pool.query(
            `INSERT INTO digital_assets (type, title, title_zh, oss_key, content_type, duration_seconds, channel_id, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [type, title, title_zh || null, oss_key, content_type || 'audio/mpeg',
             duration_seconds || null, channelId, sort_order || 0]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostDigitalAsset', error: err.message }));
        return { success: false, error: err.message };
    }
}

async function handlePutDigitalAsset(id, body, adminCtx = {}) {
    const assetId = parseInt(id);
    if (adminCtx.role === 'channel') {
        const check = await pool.query('SELECT channel_id FROM digital_assets WHERE id = $1', [assetId]);
        if (!check.rows.length || check.rows[0].channel_id !== adminCtx.channelId)
            return { success: false, error: 'Not found' };
    }
    const fields = ['type', 'title', 'title_zh', 'oss_key', 'content_type', 'duration_seconds', 'is_active', 'sort_order'];
    // Channel admins cannot reassign channel_id; superadmins can.
    if (adminCtx.role === 'superadmin') fields.push('channel_id');
    const updates = [];
    const params = [];
    for (const f of fields) {
        if (body[f] !== undefined) {
            params.push(body[f] === '' ? null : body[f]);
            updates.push(`${f} = $${params.length}`);
        }
    }
    if (updates.length === 0) return { success: false, error: 'No fields to update' };
    params.push(assetId);
    try {
        await pool.query(`UPDATE digital_assets SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
        return { success: true };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePutDigitalAsset', error: err.message }));
        return { success: false, error: err.message };
    }
}

async function handleDeleteDigitalAsset(id, adminCtx = {}) {
    const assetId = parseInt(id);
    if (adminCtx.role === 'channel') {
        const check = await pool.query('SELECT channel_id FROM digital_assets WHERE id = $1', [assetId]);
        if (!check.rows.length || check.rows[0].channel_id !== adminCtx.channelId)
            return { success: false, error: 'Not found' };
    }
    try {
        await pool.query('DELETE FROM digital_assets WHERE id = $1', [assetId]);
        return { success: true };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleDeleteDigitalAsset', error: err.message }));
        return { success: false, error: err.message };
    }
}

async function handleGetDigitalAssetsPresign(query) {
    const { filename, content_type } = query;
    try {
        const ext = filename?.includes('.') ? filename.split('.').pop().toLowerCase() : 'bin';
        const id = crypto.randomBytes(8).toString('hex');
        const key = `assets/media/${id}.${ext}`;
        const put_url = ossLib.generatePresignedPutUrl(key, 3600);
        const get_url = ossLib.generatePresignedGetUrl(key, 315360000, null, OSS_CNAME);
        return { success: true, put_url, get_url, key };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    handleGetKoneApkReleases,
    handlePostKoneApkRelease,
    handlePutKoneApkRelease,
    handleDeleteKoneApkRelease,
    handleGetKoneApkPresign,
    handleGetDigitalAssets,
    handlePostDigitalAsset,
    handlePutDigitalAsset,
    handleDeleteDigitalAsset,
    handleGetDigitalAssetsPresign,
    handleGetKinoUpgrade,
};
