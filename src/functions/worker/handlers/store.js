const { pool } = require('../lib/db');

async function handleGetOrders(query = {}, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const channelId = adminCtx?.role === 'channel' ? adminCtx.channelId : (query.channel_id || null);
        const params = [];
        const channelFilter = channelId ? `AND o.channel_id = \$${params.push(channelId)}` : '';
        const result = await pool.query(
            `SELECT o.id, o.user_id, o.item_id, o.channel_inventory_item_id, o.item_key,
                    o.quantity, o.price_cny, o.price_usd, o.price_credits, o.status, o.created_at, o.channel_id,
                    o.shipping_name, o.shipping_phone, o.shipping_address, o.shipping_carrier, o.tracking_number,
                    o.shipped_at, o.delivered_at, o.payment_status, o.payment_method, o.fulfillment_notes, o.fulfilled_assets,
                    u.nickname, u.external_id,
                    COALESCE(ci.name_en, s.name_en, sk.name_en, o.item_key) AS name_en,
                    COALESCE(ci.name_zh, s.name_zh, sk.name_zh, o.item_key) AS name_zh,
                    COALESCE(ci.unit_en, s.unit_en, sk.unit_en, 'times') AS unit_en,
                    COALESCE(ci.unit_zh, s.unit_zh, sk.unit_zh, '次') AS unit_zh
             FROM orders o
             LEFT JOIN users u ON o.user_id = u.user_id
             LEFT JOIN store_items s ON o.item_id = s.id
             LEFT JOIN channel_inventory_items ci ON o.channel_inventory_item_id = ci.id
             LEFT JOIN skus sk ON o.sku_id = sk.id
             WHERE TRUE ${channelFilter}
             ORDER BY o.created_at DESC
             LIMIT 500`,
            params
        );
        return { success: true, orders: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetMyOrders(openid) {
    if (!openid) return { success: false, error: 'openid is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `SELECT o.id, o.item_key, o.quantity, o.price_cny, o.price_usd, o.price_credits, o.status, o.created_at,
                    o.shipping_name, o.shipping_phone, o.shipping_address, o.shipping_carrier, o.tracking_number,
                    o.shipped_at, o.delivered_at, o.payment_status, o.payment_method, o.fulfillment_notes, o.fulfilled_assets,
                    COALESCE(ci.name_zh, s.name_zh, sk.name_zh, o.item_key) AS name_zh,
                    COALESCE(ci.name_en, s.name_en, sk.name_en, o.item_key) AS name_en,
                    COALESCE(ci.unit_zh, s.unit_zh, sk.unit_zh, '次') AS unit_zh,
                    COALESCE(ci.unit_en, s.unit_en, sk.unit_en, 'times') AS unit_en
             FROM orders o
             LEFT JOIN store_items s ON o.item_id = s.id
             LEFT JOIN channel_inventory_items ci ON o.channel_inventory_item_id = ci.id
             LEFT JOIN skus sk ON o.sku_id = sk.id
             WHERE o.user_id = $1
             ORDER BY o.created_at DESC`,
            [openid]
        );
        return { success: true, orders: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostStoreItem(body) {
    const { key_name, name_en, name_zh, desc_en, desc_zh, unit_en, unit_zh, price_cny, price_usd, price_credits, tag, sort_order, active, image_url, sku_id } = body;
    if (!key_name) return { success: false, error: 'key_name is required', statusCode: 400 };
    if (!name_en)  return { success: false, error: 'name_en is required', statusCode: 400 };
    if (!sku_id)   return { success: false, error: 'sku_id is required — create the SKU first', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `INSERT INTO store_items (key_name, name_en, name_zh, desc_en, desc_zh, unit_en, unit_zh, price_cny, price_usd, price_credits, tag, sort_order, active, image_url, sku_id)
             VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12, \$13, \$14, \$15) RETURNING id`,
            [key_name, name_en, name_zh || '', desc_en || '', desc_zh || '', unit_en || '', unit_zh || '',
             parseFloat(price_cny) || 0, parseFloat(price_usd) || 0,
             price_credits != null ? parseFloat(price_credits) : null,
             tag || null, parseInt(sort_order) || 0, active !== false, image_url || null, sku_id]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutStoreItem(itemId, body) {
    const { name_en, name_zh, desc_en, desc_zh, unit_en, unit_zh, price_cny, price_usd, price_credits, tag, sort_order, active, image_url, sku_id } = body;
    if (!sku_id) return { success: false, error: 'sku_id is required — create the SKU first', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            `UPDATE store_items SET name_en=\$1, name_zh=\$2, desc_en=\$3, desc_zh=\$4,
             unit_en=\$5, unit_zh=\$6, price_cny=\$7, price_usd=\$8, price_credits=\$9, tag=\$10, sort_order=\$11, active=\$12,
             image_url=\$13, sku_id=\$14
             WHERE id=\$15`,
            [name_en, name_zh || '', desc_en || '', desc_zh || '', unit_en || '', unit_zh || '',
             parseFloat(price_cny), parseFloat(price_usd),
             price_credits != null ? parseFloat(price_credits) : null,
             tag || null, parseInt(sort_order) || 0, active !== false,
             image_url || null, sku_id, itemId]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteStoreItem(itemId) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('DELETE FROM store_items WHERE id = $1', [itemId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── SKU & Stock handlers ──────────────────────────────────────────────────────
async function handleGetSkus(adminCtx = {}) {
    if (!pool) return { success: false, error: 'Database pool not initialized' };
    try {
        let rows;
        if (adminCtx.role === 'superadmin') {
            ({ rows } = await pool.query('SELECT * FROM skus ORDER BY channel_id NULLS FIRST, sku_code ASC'));
        } else {
            ({ rows } = await pool.query(
                'SELECT * FROM skus WHERE channel_id = $1 OR channel_id IS NULL ORDER BY channel_id NULLS FIRST, sku_code ASC',
                [adminCtx.channelId]
            ));
        }
        return { success: true, skus: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostSku(body, adminCtx = {}) {
    const { sku_code, name_zh, name_en, desc_zh, desc_en, item_type, unit_zh, unit_en, channel_id: bodyChannelId, parent_sku_id, attributes, is_parent } = body;
    if (!sku_code) return { success: false, error: 'sku_code is required', statusCode: 400 };
    if (!name_zh || !name_en) return { success: false, error: 'name_zh and name_en are required', statusCode: 400 };
    const channelId = adminCtx.role === 'superadmin'
        ? (bodyChannelId || null)
        : (adminCtx.channelId || null);
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `INSERT INTO skus (sku_code, name_zh, name_en, desc_zh, desc_en, item_type, unit_zh, unit_en, channel_id, parent_sku_id, attributes, is_parent)
             VALUES (\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12) RETURNING *`,
            [sku_code, name_zh, name_en, desc_zh || null, desc_en || null, item_type || 'physical', unit_zh || '个', unit_en || 'pcs', channelId, parent_sku_id || null, JSON.stringify(attributes || {}), is_parent === true]
        );
        return { success: true, sku: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.detail || err.message, statusCode: 500 };
    }
}

async function handlePutSku(id, body, adminCtx = {}) {
    const { sku_code, name_zh, name_en, desc_zh, desc_en, item_type, unit_zh, unit_en, parent_sku_id, attributes, is_parent } = body;
    if (!sku_code) return { success: false, error: 'sku_code is required', statusCode: 400 };
    if (!name_zh || !name_en) return { success: false, error: 'name_zh and name_en are required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const base = [sku_code, name_zh, name_en, desc_zh || null, desc_en || null, item_type || 'physical', unit_zh || '个', unit_en || 'pcs', parent_sku_id || null, JSON.stringify(attributes || {}), is_parent === true, id];
        const sql = adminCtx.role === 'superadmin'
            ? `UPDATE skus SET sku_code=\$1, name_zh=\$2, name_en=\$3, desc_zh=\$4, desc_en=\$5, item_type=\$6, unit_zh=\$7, unit_en=\$8, parent_sku_id=\$9, attributes=\$10, is_parent=\$11 WHERE id=\$12 RETURNING *`
            : `UPDATE skus SET sku_code=\$1, name_zh=\$2, name_en=\$3, desc_zh=\$4, desc_en=\$5, item_type=\$6, unit_zh=\$7, unit_en=\$8, parent_sku_id=\$9, attributes=\$10, is_parent=\$11 WHERE id=\$12 AND channel_id=\$13 RETURNING *`;
        const params = adminCtx.role === 'superadmin' ? base : [...base, adminCtx.channelId];
        const result = await pool.query(sql, params);
        if (result.rows.length === 0) return { success: false, error: 'SKU not found or not owned by your channel', statusCode: 404 };
        return { success: true, sku: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteSku(id, adminCtx = {}) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (adminCtx.role === 'superadmin') {
            await pool.query('DELETE FROM skus WHERE id = \$1', [id]);
        } else {
            const res = await pool.query('DELETE FROM skus WHERE id = \$1 AND channel_id = \$2 RETURNING id', [id, adminCtx.channelId]);
            if (res.rows.length === 0) return { success: false, error: 'SKU not found or not owned by your channel', statusCode: 403 };
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    handleGetOrders,
    handleGetMyOrders,
    handlePostStoreItem,
    handlePutStoreItem,
    handleDeleteStoreItem,
    handleGetSkus,
    handlePostSku,
    handlePutSku,
    handleDeleteSku,
};
