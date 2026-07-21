'use strict';

const { pool } = require('../lib/db');
const { recordOrderCommissions, recordUserReferralCommission } = require('../lib/commissions');
const { applyPartnerDiscount, getPartnerProductDiscount } = require('../lib/partnerCommissions');
const { debitUser } = require('../lib/credits');
const { getNowShanghai } = require('../lib/time-utils');
const OpenAI = require('openai');
const systemNutritionTemplate = require('../prompts/nano/systemNutrition');
const vivaSystemNutritionTemplate = require('../prompts/viva/systemNutrition');

const getLlmClient = () => new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

// Inline helper — mirrors index.js saveChatMessage
async function _saveChatMessage(user_id, role, content, image_url = null, persona_type = 'nano') {
    try {
        await pool.query(
            'INSERT INTO chat_messages (user_id, role, content, image_url, persona_type) VALUES ($1, $2, $3, $4, $5)',
            [user_id, role, content, image_url, persona_type]
        );
    } catch (err) {
        console.error('Failed to save chat message:', err);
    }
}

async function handleGetDotsInventory() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query('SELECT * FROM dots ORDER BY id ASC');
        return { success: true, dots: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetMyCartridges(openid) {
    if (!openid) return { success: false, error: 'openid is required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const userResult = await pool.query(
            'SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]
        );
        if (userResult.rows.length === 0) return { success: false, error: 'User not found' };
        const userId = userResult.rows[0].user_id;

        const result = await pool.query(`
            SELECT uc.id, uc.nfc_tag_id, uc.total_dots, uc.remaining_dots, uc.status,
                   uc.inserted_at, uc.last_dispensed_at,
                   d.key_name AS dot_key, d.name AS dot_name, d.name_zh AS dot_name_zh,
                   d.color_hex, d.timing
            FROM user_cartridges uc
            JOIN dots d ON d.id = uc.dot_id
            WHERE uc.user_id = $1 AND uc.status != 'removed'
            ORDER BY d.id ASC
        `, [userId]);

        return { success: true, cartridges: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostCartridgeInsert(body) {
    const { openid, nfc_tag_id, dot_key } = body;
    if (!openid || !nfc_tag_id || !dot_key) return { success: false, error: 'openid, nfc_tag_id and dot_key are required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        const [userResult, dotResult] = await Promise.all([
            pool.query('SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]),
            pool.query('SELECT id FROM dots WHERE key_name = $1 LIMIT 1', [dot_key.toUpperCase()]),
        ]);
        if (userResult.rows.length === 0) return { success: false, error: 'User not found' };
        if (dotResult.rows.length === 0) return { success: false, error: `Dot not found: ${dot_key}` };
        const userId = userResult.rows[0].user_id;
        const dotId = dotResult.rows[0].id;

        // Previous active cartridge of same dot type is auto-removed
        await pool.query(
            `UPDATE user_cartridges SET status = 'removed' WHERE user_id = $1 AND dot_id = $2 AND status = 'active'`,
            [userId, dotId]
        );

        // Upsert: if this NFC tag existed before (e.g. removed), reactivate it fresh
        await pool.query(`
            INSERT INTO user_cartridges (user_id, dot_id, nfc_tag_id, total_dots, remaining_dots, status, inserted_at)
            VALUES ($1, $2, $3, 800, 800, 'active', NOW())
            ON CONFLICT (nfc_tag_id) DO UPDATE
              SET user_id = EXCLUDED.user_id, dot_id = EXCLUDED.dot_id,
                  status = 'active', inserted_at = NOW(), remaining_dots = 800, total_dots = 800
        `, [userId, dotId, nfc_tag_id]);

        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostCartridgeRemove(body) {
    const { openid, nfc_tag_id } = body;
    if (!openid || !nfc_tag_id) return { success: false, error: 'openid and nfc_tag_id are required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const userResult = await pool.query(
            'SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]
        );
        if (userResult.rows.length === 0) return { success: false, error: 'User not found' };
        const userId = userResult.rows[0].user_id;
        await pool.query(
            `UPDATE user_cartridges SET status = 'removed' WHERE nfc_tag_id = $1 AND user_id = $2`,
            [nfc_tag_id, userId]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostDispense(body) {
    const { openid, slot, date, dispensed } = body;
    if (!openid || !slot || !date || !dispensed) return { success: false, error: 'openid, slot, date and dispensed are required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const userResult = await pool.query(
            'SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]
        );
        if (userResult.rows.length === 0) return { success: false, error: 'User not found' };
        const userId = userResult.rows[0].user_id;

        const dispenseLog = {};
        const updatedCartridges = [];

        for (const [dotKey, count] of Object.entries(dispensed)) {
            const cartResult = await pool.query(`
                SELECT uc.id, uc.remaining_dots
                FROM user_cartridges uc
                JOIN dots d ON d.id = uc.dot_id
                WHERE uc.user_id = $1 AND d.key_name = $2 AND uc.status = 'active'
                LIMIT 1
            `, [userId, dotKey]);

            if (cartResult.rows.length === 0) continue;
            const cart = cartResult.rows[0];
            const newRemaining = Math.max(0, cart.remaining_dots - count);
            const newStatus = newRemaining <= 0 ? 'empty' : 'active';

            await pool.query(
                `UPDATE user_cartridges SET remaining_dots = $1, status = $2, last_dispensed_at = NOW() WHERE id = $3`,
                [newRemaining, newStatus, cart.id]
            );

            dispenseLog[dotKey] = { deducted: count, cartridge_id: cart.id, remaining_after: newRemaining };
            updatedCartridges.push({ dot_key: dotKey, cartridge_id: cart.id, remaining: newRemaining, status: newStatus });
        }

        await pool.query(
            `UPDATE nutrition_schedules SET dispensed_at = NOW(), dispense_log = $1
             WHERE user_id = $2 AND scheduled_date = $3 AND slot_name = $4`,
            [JSON.stringify(dispenseLog), userId, date, slot]
        );

        return { success: true, dispensed: updatedCartridges };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetStoreItems(query = {}) {
    if (!pool) return { success: false, error: 'Database pool not initialized' };
    try {
        if (query.openid) {
            const userRes = await pool.query(
                'SELECT channel_id FROM users WHERE user_id = $1',
                [query.openid]
            );
            const channelId = userRes.rows[0]?.channel_id;
            if (!channelId) return { success: true, items: [] };
            const result = await pool.query(
                `SELECT ci.id, ci.key_name, ci.name_zh, ci.name_en, ci.desc_zh, ci.desc_en,
                        ci.unit_zh, ci.unit_en, ci.price_cny, ci.price_usd, ci.price_credits, ci.tag, ci.sort_order,
                        ci.active, ci.image_url, ci.item_type, ci.sku_id,
                        COALESCE(ist.quantity, ci.stock_quantity) AS stock_quantity,
                        sk.is_parent,
                        CASE WHEN sk.is_parent THEN (
                            SELECT json_agg(json_build_object(
                                'id', child_ci.id,
                                'sku_id', child_ci.sku_id,
                                'sku_code', child_sk.sku_code,
                                'attributes', child_sk.attributes,
                                'stock_quantity', COALESCE(child_ist.quantity, child_ci.stock_quantity)
                            ) ORDER BY child_sk.sku_code)
                            FROM channel_inventory_items child_ci
                            JOIN skus child_sk ON child_sk.id = child_ci.sku_id
                            LEFT JOIN inventory_stock child_ist
                                ON child_ist.sku_id = child_ci.sku_id
                                AND child_ist.location_type = 'channel'
                                AND child_ist.channel_id = $1
                            WHERE child_ci.parent_item_id = ci.id AND child_ci.active = TRUE
                        ) END AS variants
                 FROM channel_inventory_items ci
                 LEFT JOIN skus sk ON sk.id = ci.sku_id
                 LEFT JOIN inventory_stock ist ON ci.sku_id = ist.sku_id AND ist.location_type = 'channel' AND ist.channel_id = $1
                 WHERE ci.channel_id = $1 AND ci.show_in_store = TRUE AND ci.active = TRUE
                   AND ci.parent_item_id IS NULL
                 ORDER BY ci.sort_order ASC, ci.created_at ASC`,
                [channelId]
            );
            const discount = await getPartnerProductDiscount(query.openid);
            if (discount) {
                const items = result.rows.map(it => ({
                    ...it,
                    partner_price_cny: applyPartnerDiscount(it.price_cny, discount.rate),
                    partner_price_usd: applyPartnerDiscount(it.price_usd, discount.rate),
                }));
                return { success: true, items, partner: { tier: discount.tier, discount_rate: discount.rate } };
            }
            return { success: true, items: result.rows };
        }
        const showAll = query.all === 'true';
        const result = await pool.query(
            `SELECT s.id, s.key_name, s.name_zh, s.name_en, s.desc_zh, s.desc_en,
                    s.unit_zh, s.unit_en, s.price_cny, s.price_usd, s.price_credits, s.tag, s.sort_order, s.active, s.image_url, s.sku_id,
                    COALESCE(ist.quantity, 0) AS stock_quantity
             FROM store_items s
             LEFT JOIN inventory_stock ist ON s.sku_id = ist.sku_id AND ist.location_type = 'warehouse' AND ist.warehouse_name = 'shanghai-central'
             ${showAll ? '' : 'WHERE s.active = TRUE'}
             ORDER BY s.sort_order ASC, s.created_at ASC`
        );
        return { success: true, items: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetChannelInventory(query, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const channelId = adminCtx?.role === 'channel' ? adminCtx.channelId : query.channel_id;
        if (!channelId) return { success: false, error: 'channel_id required', statusCode: 400 };
        const { rows } = await pool.query(
            `SELECT ci.*,
                    COALESCE(ist.quantity, ci.stock_quantity) AS stock_quantity
             FROM channel_inventory_items ci
             LEFT JOIN inventory_stock ist ON ci.sku_id = ist.sku_id AND ist.location_type = 'channel' AND ist.channel_id = $1
             WHERE ci.channel_id = $1
             ORDER BY ci.sort_order, ci.created_at`,
            [channelId]
        );
        return { success: true, items: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// GET /store-items/by-channel?channel=<key_name>
// Server-to-server read-only listing of a channel's storefront-visible items, keyed by
// channel key_name (not numeric id) — same lookup-by-key pattern as handleGetPartnerByPhone,
// so callers (e.g. GCN's aeviva integration) never need to know nano's internal channel ids.
// Recurses through parent_channel_id so a parent channel key (e.g. "aeviva") also picks up
// items scoped to its sub-channels (e.g. "aeviva-china").
async function handleGetStoreItemsByChannel(query = {}) {
    const channelKey = query.channel;
    if (!channelKey) return { success: false, error: 'channel query param required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query(
            `WITH RECURSIVE subtree AS (
                SELECT id FROM channels WHERE key_name = $1
                UNION ALL
                SELECT c.id FROM channels c JOIN subtree s ON c.parent_channel_id = s.id
            )
            SELECT ci.*,
                   COALESCE(ist.quantity, ci.stock_quantity) AS stock_quantity
            FROM channel_inventory_items ci
            LEFT JOIN inventory_stock ist ON ci.sku_id = ist.sku_id AND ist.location_type = 'channel' AND ist.channel_id = ci.channel_id
            WHERE ci.channel_id IN (SELECT id FROM subtree)
              AND ci.active = TRUE AND ci.show_in_store = TRUE AND ci.parent_item_id IS NULL
            ORDER BY ci.sort_order, ci.created_at`,
            [channelKey]
        );
        return { success: true, items: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostChannelInventory(body, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const channelId = adminCtx?.role === 'channel' ? adminCtx.channelId : body.channel_id;
        if (!channelId) return { success: false, error: 'channel_id required', statusCode: 400 };
        if (!body.key_name) return { success: false, error: 'key_name required', statusCode: 400 };
        if (!body.name_en) return { success: false, error: 'name_en required', statusCode: 400 };
        if (!body.sku_id)  return { success: false, error: 'sku_id required — create the SKU first', statusCode: 400 };

        const skuRes = await pool.query('SELECT id, is_parent FROM skus WHERE id = $1', [body.sku_id]);
        if (!skuRes.rows.length) return { success: false, error: 'SKU not found', statusCode: 404 };
        const sku = skuRes.rows[0];

        const { rows } = await pool.query(
            `INSERT INTO channel_inventory_items
              (channel_id, key_name, name_zh, name_en, desc_zh, desc_en, item_type,
               unit_zh, unit_en, price_cny, price_usd, price_credits, stock_quantity, tag, sort_order, active, image_url, metadata, store_item_id, show_in_store, sku_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
             RETURNING *`,
            [channelId, body.key_name, body.name_zh || '', body.name_en,
             body.desc_zh || '', body.desc_en || '', body.item_type || 'physical',
             body.unit_zh || '', body.unit_en || '',
             body.price_cny != null ? body.price_cny : null,
             body.price_usd != null ? body.price_usd : null,
             body.price_credits != null ? body.price_credits : null,
             body.stock_quantity != null ? body.stock_quantity : null,
             body.tag || '', body.sort_order || 0, body.active !== false,
             body.image_url || '', body.metadata || null, body.store_item_id || null,
             body.show_in_store === true || body.show_in_store === 'true',
             body.sku_id || null]
        );
        const parentItem = rows[0];

        // Auto-create one child item per child SKU when the bound SKU is a parent
        let childItems = [];
        if (sku.is_parent) {
            const childSkus = await pool.query(
                'SELECT id, sku_code FROM skus WHERE parent_sku_id = $1 ORDER BY sku_code',
                [sku.id]
            );
            for (const childSku of childSkus.rows) {
                const childKey = childSku.sku_code.toLowerCase();
                const { rows: childRows } = await pool.query(
                    `INSERT INTO channel_inventory_items
                      (channel_id, key_name, name_zh, name_en, desc_zh, desc_en, item_type,
                       unit_zh, unit_en, price_cny, price_usd, price_credits, tag, sort_order,
                       active, image_url, metadata, show_in_store, sku_id, parent_item_id)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
                     ON CONFLICT (channel_id, key_name) DO NOTHING
                     RETURNING *`,
                    [channelId, childKey, body.name_zh || '', body.name_en,
                     body.desc_zh || '', body.desc_en || '', body.item_type || 'physical',
                     body.unit_zh || '', body.unit_en || '',
                     body.price_cny != null ? body.price_cny : null,
                     body.price_usd != null ? body.price_usd : null,
                     body.price_credits != null ? body.price_credits : null,
                     body.tag || '', body.sort_order || 0, body.active !== false,
                     body.image_url || '', body.metadata || null,
                     false, // child items are not independently shown in store
                     childSku.id, parentItem.id]
                );
                if (childRows[0]) childItems.push(childRows[0]);
            }
        }

        return { success: true, item: parentItem, childItems };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutChannelInventory(id, body, adminCtx) {
    if (!body.sku_id) return { success: false, error: 'sku_id required — create the SKU first', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const channelId = adminCtx?.role === 'channel' ? adminCtx.channelId : null;
        const params = [
            body.name_zh || '', body.name_en || '', body.desc_zh || '', body.desc_en || '',
            body.item_type || 'physical', body.unit_zh || '', body.unit_en || '',
            body.price_cny != null ? body.price_cny : null,
            body.price_usd != null ? body.price_usd : null,
            body.price_credits != null ? body.price_credits : null,
            body.stock_quantity != null ? body.stock_quantity : null,
            body.tag || '', body.sort_order || 0, body.active !== false,
            body.image_url || '', body.metadata || null,
            body.show_in_store === true || body.show_in_store === 'true',
            body.sku_id || null,
            id,
        ];
        let sql = `UPDATE channel_inventory_items
             SET name_zh=$1, name_en=$2, desc_zh=$3, desc_en=$4, item_type=$5,
                 unit_zh=$6, unit_en=$7, price_cny=$8, price_usd=$9, price_credits=$10, stock_quantity=$11,
                 tag=$12, sort_order=$13, active=$14, image_url=$15, metadata=$16, show_in_store=$17, sku_id=$18
             WHERE id=$19`;
        if (channelId) { sql += ' AND channel_id=$20'; params.push(channelId); }
        sql += ' RETURNING *';
        const { rows } = await pool.query(sql, params);
        if (!rows.length) return { success: false, error: 'Not found', statusCode: 404 };
        return { success: true, item: rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteChannelInventory(id, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const channelId = adminCtx?.role === 'channel' ? adminCtx.channelId : null;
        if (channelId) {
            await pool.query('DELETE FROM channel_inventory_items WHERE id=$1 AND channel_id=$2', [id, channelId]);
        } else {
            await pool.query('DELETE FROM channel_inventory_items WHERE id=$1', [id]);
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutOrder(orderId, body, adminCtx) {
    const { status, shipping_carrier, tracking_number, fulfillment_notes, fulfilled_assets, payment_status } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        // Get current order state
        const orderCheck = await pool.query(
            `SELECT status, sku_id, quantity, channel_id, payment_status FROM orders WHERE id = $1`,
            [orderId]
        );
        if (orderCheck.rows.length === 0) return { success: false, error: 'Order not found', statusCode: 404 };
        const oldOrder = orderCheck.rows[0];

        // SKU-Based Stock Reclaim on Cancellation — restore to same priority location
        if (status === 'cancelled' && oldOrder.status !== 'cancelled') {
            if (oldOrder.sku_id) {
                const restoreTarget = await pool.query(
                    `SELECT id FROM inventory_stock
                     WHERE sku_id = $1 AND (
                         (location_type = 'channel' AND channel_id = $2) OR
                         (location_type = 'warehouse' AND warehouse_name = 'shanghai-central')
                     ) AND quantity IS NOT NULL
                     ORDER BY (location_type = 'channel') DESC
                     LIMIT 1`,
                    [oldOrder.sku_id, oldOrder.channel_id]
                );
                if (restoreTarget.rows.length > 0) {
                    await pool.query(
                        `UPDATE inventory_stock
                         SET quantity = quantity + $1, updated_at = NOW()
                         WHERE id = $2`,
                        [oldOrder.quantity, restoreTarget.rows[0].id]
                    );
                }
            }
        }

        const updates = [];
        const params = [orderId];

        if (status) {
            updates.push(`status = $${updates.length + 2}`);
            params.push(status);
        }
        if (shipping_carrier !== undefined) {
            updates.push(`shipping_carrier = $${updates.length + 2}`);
            params.push(shipping_carrier);
        }
        if (tracking_number !== undefined) {
            updates.push(`tracking_number = $${updates.length + 2}`);
            params.push(tracking_number);
        }
        if (fulfillment_notes !== undefined) {
            updates.push(`fulfillment_notes = $${updates.length + 2}`);
            params.push(fulfillment_notes);
        }
        if (fulfilled_assets !== undefined) {
            updates.push(`fulfilled_assets = $${updates.length + 2}`);
            params.push(JSON.stringify(fulfilled_assets));
        }
        if (payment_status !== undefined) {
            updates.push(`payment_status = $${updates.length + 2}`);
            params.push(payment_status);
            if (payment_status === 'paid' && oldOrder.payment_status !== 'paid') {
                updates.push(`paid_at = NOW()`);
            }
        }

        if (status === 'shipped' && oldOrder.status !== 'shipped') {
            updates.push(`shipped_at = NOW()`);
        }
        if (status === 'delivered' && oldOrder.status !== 'delivered') {
            updates.push(`delivered_at = NOW()`);
        }

        if (updates.length === 0) return { success: false, error: 'No fields to update', statusCode: 400 };

        const channelFilter = adminCtx?.role === 'channel'
            ? `AND channel_id = $${params.push(adminCtx.channelId)}` : '';

        const sql = `UPDATE orders SET ${updates.join(', ')} WHERE id = $1 ${channelFilter} RETURNING id`;
        const result = await pool.query(sql, params);
        if (result.rows.length === 0) return { success: false, error: 'Order not found or access denied', statusCode: 404 };

        if (status === 'delivered' && oldOrder.status !== 'delivered') {
            await recordOrderCommissions(orderId);
            await recordUserReferralCommission(orderId);
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostOrder(body) {
    const {
        openid,
        item_id,
        channel_inventory_item_id,
        quantity = 1,
        shipping_name,
        shipping_phone,
        shipping_address,
        payment_method = 'wechat_pay',
        payment_status = 'paid',
        payment_id,
        fulfillment_notes
    } = body;
    if (!openid) return { success: false, error: 'openid is required', statusCode: 400 };
    if (!item_id && !channel_inventory_item_id) return { success: false, error: 'item_id or channel_inventory_item_id is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        let sku_id = null;
        let channel_id = null;
        let item_key = '';
        let price_cny = 0;
        let price_usd = 0;

        if (channel_inventory_item_id) {
            const itemResult = await pool.query(
                `SELECT id, key_name, price_cny, price_usd, channel_id, sku_id
                 FROM channel_inventory_items WHERE id = $1 AND active = TRUE`,
                [channel_inventory_item_id]
            );
            if (itemResult.rows.length === 0) return { success: false, error: 'Item not found', statusCode: 404 };
            const item = itemResult.rows[0];
            sku_id = item.sku_id;
            channel_id = item.channel_id;
            item_key = item.key_name;
            price_cny = item.price_cny || 0;
            price_usd = item.price_usd || 0;
        } else {
            const itemResult = await pool.query(
                'SELECT id, key_name, price_cny, price_usd, sku_id FROM store_items WHERE id = $1 AND active = TRUE',
                [item_id]
            );
            if (itemResult.rows.length === 0) return { success: false, error: 'Item not found', statusCode: 404 };
            const item = itemResult.rows[0];
            sku_id = item.sku_id;
            item_key = item.key_name;
            price_cny = item.price_cny || 0;
            price_usd = item.price_usd || 0;
        }

        // Active partners buy at their tier's discounted price (matches store display)
        const partnerDiscount = await getPartnerProductDiscount(openid);
        if (partnerDiscount) {
            price_cny = applyPartnerDiscount(price_cny, partnerDiscount.rate);
            price_usd = applyPartnerDiscount(price_usd, partnerDiscount.rate);
        }

        // SKU-Based Stock Check — channel stock takes priority over warehouse
        if (sku_id) {
            const stockResult = await pool.query(
                `SELECT id, quantity FROM inventory_stock
                 WHERE sku_id = $1 AND (
                     (location_type = 'channel' AND channel_id = $2) OR
                     (location_type = 'warehouse' AND warehouse_name = 'shanghai-central')
                 )
                 ORDER BY (location_type = 'channel') DESC
                 LIMIT 1`,
                [sku_id, channel_id || null]
            );
            if (stockResult.rows.length > 0) {
                const stock = stockResult.rows[0];
                if (stock.quantity !== null) {
                    if (stock.quantity < quantity) {
                        return { success: false, error: 'Insufficient stock', statusCode: 400 };
                    }
                    // Decrement only the one location selected above (by primary key)
                    await pool.query(
                        `UPDATE inventory_stock
                         SET quantity = quantity - $1, updated_at = NOW()
                         WHERE id = $2 AND quantity >= $1`,
                        [quantity, stock.id]
                    );
                }
            }
        }

        const paid_at = payment_status === 'paid' ? 'NOW()' : null;

        const result = await pool.query(
            `INSERT INTO orders (
                user_id, item_id, channel_inventory_item_id, item_key, quantity, price_cny, price_usd, status, channel_id, sku_id,
                shipping_name, shipping_phone, shipping_address, payment_method, payment_status, payment_id, fulfillment_notes, paid_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11, $12, $13, $14, $15, $16, ${paid_at ? 'NOW()' : 'NULL'})
             RETURNING id`,
            [
                openid,
                channel_inventory_item_id ? null : item_id,
                channel_inventory_item_id ? channel_inventory_item_id : null,
                item_key, quantity, price_cny, price_usd, channel_id, sku_id,
                shipping_name, shipping_phone, shipping_address, payment_method, payment_status, payment_id, fulfillment_notes
            ]
        );
        return { success: true, order_id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePostOrderBatch(body) {
    const {
        openid,
        items,
        shipping_name,
        shipping_phone,
        shipping_address,
        payment_method = 'wechat_pay',
        payment_status = 'paid',
    } = body;
    if (!openid) return { success: false, error: 'openid is required', statusCode: 400 };
    if (!Array.isArray(items) || items.length === 0)
        return { success: false, error: 'items array is required', statusCode: 400 };
    if (!pool) return { success: false, error: 'Database pool not initialized' };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const order_ids = [];
        const partnerDiscount = await getPartnerProductDiscount(openid);

        // Collect item data first so we can validate credit balance before touching stock/orders
        const resolvedItems = [];
        for (const entry of items) {
            const { channel_inventory_item_id, item_id, quantity = 1 } = entry;
            if (!item_id && !channel_inventory_item_id)
                throw Object.assign(new Error('Each item requires item_id or channel_inventory_item_id'), { statusCode: 400 });

            let sku_id = null, channel_id = null, item_key = '', price_cny = 0, price_usd = 0, price_credits = null;

            if (channel_inventory_item_id) {
                const r = await client.query(
                    `SELECT id, key_name, price_cny, price_usd, price_credits, channel_id, sku_id
                     FROM channel_inventory_items WHERE id = $1 AND active = TRUE`,
                    [channel_inventory_item_id]
                );
                if (r.rows.length === 0) throw Object.assign(new Error('Item not found'), { statusCode: 404 });
                sku_id = r.rows[0].sku_id;
                channel_id = r.rows[0].channel_id;
                item_key = r.rows[0].key_name;
                price_cny = r.rows[0].price_cny || 0;
                price_usd = r.rows[0].price_usd || 0;
                price_credits = r.rows[0].price_credits != null ? parseFloat(r.rows[0].price_credits) : null;
            } else {
                const r = await client.query(
                    'SELECT id, key_name, price_cny, price_usd, price_credits, sku_id FROM store_items WHERE id = $1 AND active = TRUE',
                    [item_id]
                );
                if (r.rows.length === 0) throw Object.assign(new Error('Item not found'), { statusCode: 404 });
                sku_id = r.rows[0].sku_id;
                item_key = r.rows[0].key_name;
                price_cny = r.rows[0].price_cny || 0;
                price_usd = r.rows[0].price_usd || 0;
                price_credits = r.rows[0].price_credits != null ? parseFloat(r.rows[0].price_credits) : null;
            }

            if (partnerDiscount) {
                price_cny = applyPartnerDiscount(price_cny, partnerDiscount.rate);
                price_usd = applyPartnerDiscount(price_usd, partnerDiscount.rate);
            }

            resolvedItems.push({ channel_inventory_item_id, item_id, quantity, sku_id, channel_id, item_key, price_cny, price_usd, price_credits });
        }

        // If paying with credits, validate balance before touching anything else
        const useCredits = payment_method === 'credits';
        if (useCredits) {
            const totalCreditsNeeded = resolvedItems.reduce((sum, it) => sum + (it.price_credits || 0) * it.quantity, 0);
            const balanceRow = await client.query(
                `SELECT COALESCE(SUM(amount), 0)::NUMERIC(12,2) AS balance FROM credit_ledger WHERE user_id = $1`,
                [openid]
            );
            const balance = parseFloat(balanceRow.rows[0].balance || 0);
            if (balance < totalCreditsNeeded)
                throw Object.assign(new Error(`Insufficient credits (need ${totalCreditsNeeded}, have ${balance.toFixed(2)})`), { statusCode: 400 });
        }

        for (const it of resolvedItems) {
            const { channel_inventory_item_id, item_id, quantity, sku_id, channel_id, item_key, price_cny, price_usd, price_credits } = it;

            if (sku_id) {
                const stockResult = await client.query(
                    `SELECT id, quantity FROM inventory_stock
                     WHERE sku_id = $1 AND (
                         (location_type = 'channel' AND channel_id = $2) OR
                         (location_type = 'warehouse' AND warehouse_name = 'shanghai-central')
                     )
                     ORDER BY (location_type = 'channel') DESC
                     LIMIT 1`,
                    [sku_id, channel_id || null]
                );
                if (stockResult.rows.length > 0) {
                    const stock = stockResult.rows[0];
                    if (stock.quantity !== null) {
                        if (stock.quantity < quantity)
                            throw Object.assign(new Error('Insufficient stock'), { statusCode: 400 });
                        await client.query(
                            `UPDATE inventory_stock SET quantity = quantity - $1, updated_at = NOW()
                             WHERE id = $2 AND quantity >= $1`,
                            [quantity, stock.id]
                        );
                    }
                }
            }

            // Debit credits within the same transaction
            if (useCredits && price_credits != null) {
                const creditsToDebit = parseFloat((price_credits * quantity).toFixed(2));
                await client.query(
                    `INSERT INTO credit_ledger (user_id, amount, type, note)
                     VALUES ($1, $2, 'store_purchase', $3)`,
                    [openid, -creditsToDebit, `Store purchase: ${item_key} x${quantity}`]
                );
            }

            const effectivePaymentMethod = useCredits ? 'credits' : payment_method;
            const effectivePaymentStatus  = useCredits ? 'paid'    : payment_status;
            const inserted = await client.query(
                `INSERT INTO orders (
                    user_id, item_id, channel_inventory_item_id, item_key, quantity, price_cny, price_usd, price_credits,
                    status, channel_id, sku_id, shipping_name, shipping_phone, shipping_address,
                    payment_method, payment_status, paid_at
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11, $12, $13, $14, $15, ${effectivePaymentStatus === 'paid' ? 'NOW()' : 'NULL'})
                 RETURNING id`,
                [
                    openid,
                    channel_inventory_item_id ? null : item_id,
                    channel_inventory_item_id || null,
                    item_key, quantity, price_cny, price_usd, price_credits != null ? price_credits : null,
                    channel_id, sku_id,
                    shipping_name, shipping_phone, shipping_address,
                    effectivePaymentMethod, effectivePaymentStatus,
                ]
            );
            order_ids.push(inserted.rows[0].id);
        }

        await client.query('COMMIT');
        return { success: true, order_ids };
    } catch (err) {
        await client.query('ROLLBACK');
        return { success: false, error: err.message, statusCode: err.statusCode || 500 };
    } finally {
        client.release();
    }
}

async function handleGetNutritionPlan(openid) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (!openid) return { success: true, plan: null, dots: [] };

        // 1. Get latest structured plan
        const planResult = await pool.query(
            `SELECT id, start_date, end_date, goal, created_at
             FROM nutrition_plans
             WHERE user_id = $1
             ORDER BY created_at DESC LIMIT 1`,
            [openid]
        );

        let planData = null;
        let schedules = [];

        if (planResult.rows.length > 0) {
            planData = planResult.rows[0];
            const scheduleResult = await pool.query(
                `SELECT scheduled_date, slot_name, recipe, is_taken, taken_at
                 FROM nutrition_schedules
                 WHERE plan_id = $1
                 ORDER BY scheduled_date ASC, slot_name DESC`,
                [planData.id]
            );
            schedules = scheduleResult.rows;
        }

        // 2. Fallback/Legacy notification content
        const notifyResult = await pool.query(
            `SELECT content, sent_at FROM notifications
             WHERE user_id = $1 AND notification_type = 'nutrition_plan'
             ORDER BY sent_at DESC LIMIT 1`,
            [openid]
        );

        const dotsResult = await pool.query('SELECT * FROM dots ORDER BY id ASC');

        return {
            success: true,
            plan: notifyResult.rows[0]?.content || null,
            plan_date: notifyResult.rows[0]?.sent_at || null,
            structured_plan: planData,
            schedules: schedules,
            dots: dotsResult.rows,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function _scoreMarker(value, normalMax, elevatedMax) {
    const v = parseFloat(value);
    if (isNaN(v)) return 0;
    if (v <= normalMax) return 1;
    if (v <= elevatedMax) return 2;
    return 3;
}

function _calcDotCounts(biomarkers, bioageProfile) {
    const hsCRP = _scoreMarker(biomarkers.hsCRP, 1, 3);
    const il6   = _scoreMarker(biomarkers.IL6, 3, 6);
    const gdf15 = _scoreMarker(biomarkers.GDF15, 750, 1500);
    const ga    = _scoreMarker(biomarkers.GA, 15, 20);
    const cysC  = _scoreMarker(biomarkers.CystatinC, 0.9, 1.2);
    const bioOver = (bioageProfile.BioAge || 0) > (bioageProfile.ChronoAge || 999) ? 2 : 0;

    const base = 3;
    const raw = {
        D01: base + gdf15 + bioOver,
        D02: base + gdf15,
        D03: base + Math.max(gdf15, bioOver),
        D04: base + hsCRP + il6,
        D05: base + gdf15,
        D06: base + 1,
        D07: base + ga,
        D08: base + cysC,
        D09: base + 1,
        D10: base + 1,
        D11: base + ga,
        D12: base + hsCRP,
        D13: base + gdf15 + bioOver,
        D14: base + gdf15,
        D15: base + il6 + hsCRP,
        D16: base + il6,
        D17: base + cysC,
        D18: base + 1,
    };

    const counts = {};
    for (const [k, v] of Object.entries(raw)) {
        counts[k] = Math.min(10, Math.max(1, v));
    }
    return counts;
}

// Derived from dots.timing column at formulation time — do not hardcode here
const MONTH_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAY_EN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const WEEKDAY_ZH = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];

function _generatePlanText(dotCounts, availableDotKeys, lang, startDate, days, morningKeys, eveningKeys) {
    const lines = [];
    const start = new Date(startDate + 'T00:00:00+08:00');

    for (let i = 0; i < days; i++) {
        const d = new Date(start.getTime() + i * 86400000);
        const dow = d.getDay();
        const month = d.getMonth();
        const day = d.getDate();

        const mParts = morningKeys
            .filter(k => availableDotKeys.has(k))
            .map(k => `${k}x${dotCounts[k] || 3}`);
        const eParts = eveningKeys
            .filter(k => availableDotKeys.has(k))
            .map(k => `${k}x${dotCounts[k] || 3}`);

        if (lang === 'zh') {
            lines.push(`${month + 1}月${day}日 (${WEEKDAY_ZH[dow]}): 早上 ${mParts.join(' ')} 晚上 ${eParts.join(' ')}`);
        } else {
            lines.push(`${MONTH_EN[month]} ${day}, ${WEEKDAY_EN[dow]}: Morning ${mParts.join(' ')} Evening ${eParts.join(' ')}`);
        }
    }

    return lines.join('\n');
}

async function handlePostFormulaDots(body) {
    const { openid } = body;
    if (!openid) return { success: false, error: 'openid is required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        const [userResult, bioResult, dotsResult] = await Promise.all([
            pool.query('SELECT * FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]),
            pool.query(
                `SELECT bio_age, data FROM biomarkers WHERE user_id = (SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1)
                 AND test_type = 'kino_chip' ORDER BY tested_at DESC LIMIT 1`,
                [openid]
            ),
            pool.query(`SELECT id, key_name, name, name_zh, timing, ingredients, ingredients_zh FROM dots ORDER BY id ASC`),
        ]);

        if (userResult.rows.length === 0) return { success: false, error: 'User not found' };
        const user = userResult.rows[0];
        const latestBio = bioResult.rows[0] || {};
        const data = latestBio.data || {};
        const biomarkers = data.biomarkers || data.validated || {};
        const bioageProfile = data.bioage_profile || {};

        let personaType = 'nano';
        if (user.channel_id) {
            try {
                const chResult = await pool.query('SELECT config FROM channels WHERE id = $1', [user.channel_id]);
                personaType = chResult.rows[0]?.config?.persona_type ?? 'nano';
            } catch (_) {}
        }

        const startDate = getNowShanghai().toISODate();
        const lang = user.language || 'zh';

        // Ask LLM to assign per-dot counts based on biomarkers
        const nutritionContext = {
            language: lang,
            biomarkers,
            bioage_profile: bioageProfile,
            dots_formulary: dotsResult.rows,
            start_date: startDate,
            days_needed: 7,
        };
        const llmClient = getLlmClient();
        const model = process.env.MODEL || 'qwen3.6-plus';
        const nutritionTemplate = personaType === 'viva' ? vivaSystemNutritionTemplate : systemNutritionTemplate;
        const prompt = nutritionTemplate(nutritionContext);
        console.log(JSON.stringify({ level: 'INFO', msg: 'Formula DOTS Context', data: nutritionContext }));

        const completion = await llmClient.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
        });

        const llmText = completion.choices[0].message.content || '';
        console.log(JSON.stringify({ level: 'INFO', msg: 'LLM Response', text: llmText }));
        let analysis = '';
        const dotCounts = {};

        // Improved parsing for ANALYSIS and FORMULATION sections
        const lines = llmText.split('\n');
        let currentSection = '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith('ANALYSIS:')) {
                analysis = trimmed.replace('ANALYSIS:', '').trim();
                currentSection = 'analysis';
                continue;
            } else if (trimmed.startsWith('FORMULATION:')) {
                currentSection = 'formulation';
                continue;
            }

            if (currentSection === 'formulation') {
                const m = trimmed.match(/^(D\d{2}):\s*(\d+)$/);
                if (m) {
                    dotCounts[m[1]] = Math.min(10, Math.max(1, parseInt(m[2], 10)));
                }
            } else if (currentSection === 'analysis' && !analysis) {
                // In case it's multi-line (though prompt says brief)
                analysis = trimmed;
            }
        }

        // Build morning/evening splits from DB timing column
        const morningKeys = dotsResult.rows.filter(r => r.timing === 'Morning').map(r => r.key_name.replace(/^DOT/, 'D'));
        const eveningKeys = dotsResult.rows.filter(r => r.timing === 'Evening').map(r => r.key_name.replace(/^DOT/, 'D'));

        // Fill any missing keys with deterministic fallback
        const availableDotKeys = new Set(dotsResult.rows.map(r => r.key_name.replace(/^DOT/, 'D')));
        const fallbackCounts = _calcDotCounts(biomarkers, bioageProfile);
        for (const k of availableDotKeys) {
            if (!dotCounts[k]) dotCounts[k] = fallbackCounts[k] || 4;
        }

        const planText = _generatePlanText(dotCounts, availableDotKeys, lang, startDate, 7, morningKeys, eveningKeys);
        const finalContent = analysis ? `${analysis}\n\n${planText}` : planText;

        const startDateObj = getNowShanghai();
        const endDateObj = startDateObj.plus({ days: 6 });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const planInsert = await client.query(
                'INSERT INTO nutrition_plans (user_id, start_date, end_date, goal) VALUES ($1, $2, $3, $4) RETURNING id',
                [user.user_id, startDateObj.toISODate(), endDateObj.toISODate(), analysis || 'Personalized Formulation']
            );
            const planId = planInsert.rows[0].id;

            for (let i = 0; i < 7; i++) {
                const currentDate = startDateObj.plus({ days: i }).toISODate();

                const morningRecipe = { dots: {} };
                morningKeys.forEach(k => {
                    if (availableDotKeys.has(k) && dotCounts[k] > 0) {
                        morningRecipe.dots[k.replace('D', 'DOT')] = dotCounts[k];
                    }
                });

                const eveningRecipe = { dots: {} };
                eveningKeys.forEach(k => {
                    if (availableDotKeys.has(k) && dotCounts[k] > 0) {
                        eveningRecipe.dots[k.replace('D', 'DOT')] = dotCounts[k];
                    }
                });

                await client.query(
                    'INSERT INTO nutrition_schedules (plan_id, user_id, scheduled_date, slot_name, recipe) VALUES ($1, $2, $3, $4, $5)',
                    [planId, user.user_id, currentDate, 'morning_cup', morningRecipe]
                );
                await client.query(
                    'INSERT INTO nutrition_schedules (plan_id, user_id, scheduled_date, slot_name, recipe) VALUES ($1, $2, $3, $4, $5)',
                    [planId, user.user_id, currentDate, 'evening_cup', eveningRecipe]
                );
            }

            await client.query(
                'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
                [user.user_id, 'nutrition_plan', finalContent, 'pending']
            );

            // Also save to chat history for persistence
            await _saveChatMessage(user.user_id, 'ai', finalContent);

            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

        return { success: true };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostFormulaDots failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

async function handlePostDots(body) {
    const { key_name, name, name_zh, color, color_zh, color_hex, group_name, group_name_zh, sub_age_target, sub_age_target_zh, timing, ingredients_summary, description, is_isolate, ingredients, ingredients_zh } = body;
    if (!key_name || !name) return { success: false, error: 'key_name and name are required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const maxIdResult = await pool.query('SELECT MAX(id) as max_id FROM dots');
        const nextId = (maxIdResult.rows[0].max_id || 0) + 1;

        const result = await pool.query(
            `INSERT INTO dots (id, key_name, name, name_zh, color, color_zh, color_hex, group_name, group_name_zh, sub_age_target, sub_age_target_zh, timing, ingredients_summary, description, is_isolate, ingredients, ingredients_zh)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
            [nextId, key_name, name, name_zh || null, color || null, color_zh || null, color_hex || null,
             group_name || null, group_name_zh || null, sub_age_target || null, sub_age_target_zh || null,
             timing || null, ingredients_summary || null, description || null, !!is_isolate,
             ingredients ? JSON.stringify(ingredients) : null,
             ingredients_zh ? JSON.stringify(ingredients_zh) : null]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutDot(dotId, body) {
    const { name, name_zh, color, color_zh, color_hex, group_name, group_name_zh, sub_age_target, sub_age_target_zh, timing, ingredients_summary, description, is_isolate, ingredients, ingredients_zh } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            `UPDATE dots SET name=$1, name_zh=$2, color=$3, color_zh=$4, color_hex=$5, group_name=$6, group_name_zh=$7,
             sub_age_target=$8, sub_age_target_zh=$9, timing=$10, ingredients_summary=$11,
             description=$12, is_isolate=$13, ingredients=$14, ingredients_zh=$15 WHERE id=$16`,
            [name, name_zh || null, color || null, color_zh || null, color_hex || null,
             group_name || null, group_name_zh || null, sub_age_target || null, sub_age_target_zh || null,
             timing || null, ingredients_summary || null, description || null, !!is_isolate,
             ingredients ? JSON.stringify(ingredients) : null,
             ingredients_zh ? JSON.stringify(ingredients_zh) : null,
             dotId]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteDot(dotId) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('DELETE FROM dots WHERE id = $1', [dotId]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    handleGetDotsInventory,
    handleGetMyCartridges,
    handlePostCartridgeInsert,
    handlePostCartridgeRemove,
    handlePostDispense,
    handleGetStoreItems,
    handleGetStoreItemsByChannel,
    handleGetChannelInventory,
    handlePostChannelInventory,
    handlePutChannelInventory,
    handleDeleteChannelInventory,
    handlePutOrder,
    handlePostOrder,
    handlePostOrderBatch,
    handleGetNutritionPlan,
    handlePostFormulaDots,
    handlePostDots,
    handlePutDot,
    handleDeleteDot,
};
