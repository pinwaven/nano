const { pool } = require('../lib/db');

async function handleGetInventoryStock(query, adminCtx = {}) {
    if (!pool) return { success: false, error: 'Database pool not initialized' };
    try {
        let rows;
        if (adminCtx.role === 'superadmin') {
            ({ rows } = await pool.query(
                `SELECT i.*, s.sku_code, s.name_zh AS sku_name_zh, s.name_en AS sku_name_en, c.name AS channel_name
                 FROM inventory_stock i
                 JOIN skus s ON i.sku_id = s.id
                 LEFT JOIN channels c ON i.channel_id = c.id
                 ORDER BY s.sku_code ASC, i.location_type ASC`
            ));
        } else if (adminCtx.canManageWarehouses) {
            ({ rows } = await pool.query(
                `SELECT i.*, s.sku_code, s.name_zh AS sku_name_zh, s.name_en AS sku_name_en, c.name AS channel_name
                 FROM inventory_stock i
                 JOIN skus s ON i.sku_id = s.id
                 LEFT JOIN channels c ON i.channel_id = c.id
                 WHERE (i.channel_id = \$1 AND i.location_type = 'channel')
                    OR (i.location_type = 'warehouse' AND i.sku_id IN (SELECT id FROM skus WHERE channel_id = \$1))
                 ORDER BY s.sku_code ASC, i.location_type ASC`,
                [adminCtx.channelId]
            ));
        } else {
            ({ rows } = await pool.query(
                `SELECT i.*, s.sku_code, s.name_zh AS sku_name_zh, s.name_en AS sku_name_en, c.name AS channel_name
                 FROM inventory_stock i
                 JOIN skus s ON i.sku_id = s.id
                 LEFT JOIN channels c ON i.channel_id = c.id
                 WHERE i.channel_id = \$1 AND i.location_type = 'channel'
                 ORDER BY s.sku_code ASC`,
                [adminCtx.channelId]
            ));
        }
        return { success: true, inventory: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostInventoryStock(body, adminCtx = {}) {
    let { sku_id, location_type, channel_id, warehouse_name, quantity, low_stock_threshold } = body;
    if (adminCtx.role !== 'superadmin') {
        if (location_type === 'warehouse' && adminCtx.canManageWarehouses) {
            // Warehouse entry: verify the SKU belongs to this channel
            if (!pool) return { success: false, error: 'Database pool not initialized' };
            const skuCheck = await pool.query('SELECT channel_id FROM skus WHERE id = $1', [sku_id]);
            if (!skuCheck.rows[0] || String(skuCheck.rows[0].channel_id) !== String(adminCtx.channelId))
                return { statusCode: 403, success: false, error: 'SKU does not belong to your channel' };
        } else {
            location_type = 'channel';
            channel_id = adminCtx.channelId;
        }
    }
    if (!sku_id) return { success: false, error: 'sku_id is required', statusCode: 400 };
    if (!location_type) return { success: false, error: 'location_type is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let existing;
        if (location_type === 'channel') {
            existing = await pool.query(
                'SELECT id FROM inventory_stock WHERE sku_id = \$1 AND location_type = \$2 AND channel_id = \$3',
                [sku_id, location_type, channel_id]
            );
        } else {
            existing = await pool.query(
                'SELECT id FROM inventory_stock WHERE sku_id = \$1 AND location_type = \$2 AND warehouse_name = \$3',
                [sku_id, location_type, warehouse_name]
            );
        }

        if (existing.rows.length > 0) {
            const updateRes = await pool.query(
                `UPDATE inventory_stock
                 SET quantity = \$1, low_stock_threshold = \$2, updated_at = NOW()
                 WHERE id = \$3 RETURNING *`,
                [quantity != null ? quantity : null, low_stock_threshold != null ? low_stock_threshold : 0, existing.rows[0].id]
            );
            return { success: true, stock: updateRes.rows[0] };
        } else {
            const insertRes = await pool.query(
                `INSERT INTO inventory_stock (sku_id, location_type, channel_id, warehouse_name, quantity, low_stock_threshold, updated_at)
                 VALUES (\$1, \$2, \$3, \$4, \$5, \$6, NOW()) RETURNING *`,
                [sku_id, location_type, location_type === 'channel' ? channel_id : null, location_type === 'warehouse' ? warehouse_name : null, quantity != null ? quantity : null, low_stock_threshold != null ? low_stock_threshold : 0]
            );
            return { success: true, stock: insertRes.rows[0] };
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Warehouse handlers ────────────────────────────────────────────────────────

async function handleGetWarehouses() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query('SELECT * FROM warehouses ORDER BY name ASC');
        return { success: true, warehouses: rows };
    } catch (err) { return { success: false, error: err.message }; }
}

async function handlePostWarehouse(body) {
    const { name, address } = body;
    if (!name?.trim()) return { success: false, error: 'name is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query(
            'INSERT INTO warehouses (name, address) VALUES ($1, $2) RETURNING *',
            [name.trim(), address?.trim() || null]
        );
        return { success: true, warehouse: rows[0] };
    } catch (err) {
        if (err.code === '23505') return { success: false, error: 'Warehouse name already exists', statusCode: 409 };
        return { success: false, error: err.message };
    }
}

async function handlePutWarehouse(id, body) {
    const { name, address, active } = body;
    if (!name?.trim()) return { success: false, error: 'name is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query(
            'UPDATE warehouses SET name=$1, address=$2, active=$3 WHERE id=$4 RETURNING *',
            [name.trim(), address?.trim() || null, active !== false, id]
        );
        if (!rows.length) return { success: false, error: 'Warehouse not found', statusCode: 404 };
        return { success: true, warehouse: rows[0] };
    } catch (err) {
        if (err.code === '23505') return { success: false, error: 'Warehouse name already exists', statusCode: 409 };
        return { success: false, error: err.message };
    }
}

async function handleDeleteWarehouse(id) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('DELETE FROM warehouses WHERE id=$1', [id]);
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

module.exports = {
    handleGetInventoryStock,
    handlePostInventoryStock,
    handleGetWarehouses,
    handlePostWarehouse,
    handlePutWarehouse,
    handleDeleteWarehouse,
};
