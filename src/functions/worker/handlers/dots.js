'use strict';

const { pool } = require('../lib/db');
const { recordOrderCommissions, recordUserReferralCommission } = require('../lib/commissions');
const { applyPartnerDiscount, getPartnerProductDiscount } = require('../lib/partnerCommissions');
const { debitUser } = require('../lib/credits');
const { getNowShanghai, calculateAge, formatToShanghai } = require('../lib/time-utils');
const { getCurrentSolarTerm } = require('../lib/solarTerms');
const OpenAI = require('openai');
const systemNutritionTemplate = require('../prompts/nano/systemNutrition');
const vivaSystemNutritionTemplate = require('../prompts/viva/systemNutrition');
const systemFormulaGenerateTemplate = require('../prompts/nano/systemFormulaGenerate');
const vivaSystemFormulaGenerateTemplate = require('../prompts/viva/systemFormulaGenerate');
const { v4: uuidv4 } = require('uuid');
const { publishChatGenerateEvent } = require('../lib/chatEventBridge');
const { getEssentialBlock } = require('../lib/knowledgeBase');
const { formatQuestionnaireContext } = require('./questionnaires');

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

        // 1. Get latest ACTIVE structured plan — while a new Viva formulation is still
        // 'pending' (async agentic decision in flight), this naturally keeps returning the
        // previous plan rather than an empty/half-formed one.
        const planResult = await pool.query(
            `SELECT id, start_date, end_date, goal, created_at
             FROM nutrition_plans
             WHERE user_id = $1 AND status = 'active'
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

// Per-dot fallback when the LLM's FORMULATION output omits a key entirely — midpoint of that
// dot's own target_dots_min/max (added by migration_dots_new_lineup.sql; ranges vary wildly,
// e.g. 1-2 for DOT-N1 vs 56-100 for DOT-N15, so a flat constant made no sense). Falls back to
// 4 only if a dot has no min/max configured.
function _fallbackCountForDot(dot) {
    if (dot.target_dots_min != null && dot.target_dots_max != null) {
        return Math.round((dot.target_dots_min + dot.target_dots_max) / 2);
    }
    return 4;
}

// Splits a dot's total count across morning/evening for the deterministic (non-agentic) path.
// timing_flexible (migration_dots_timing_flexible.sql) marks dots with no real diurnal
// pharmacological constraint — those get ~30% of a total > 10 moved to their non-default slot
// so the day's AM/PM pill counts land closer together. Non-flexible dots (e.g. DOT-N4/DOT-N12's
// stimulating ingredients, DOT-N3's sleep support) always stay entirely in their default slot —
// timing_flexible=false is a real reason, not a guess, so it's never overridden here.
function _splitDotTiming(dot, count) {
    const isEveningDefault = dot.timing === 'Evening';
    if (!dot.timing_flexible || count <= 10) {
        return isEveningDefault ? { morning: 0, evening: count } : { morning: count, evening: 0 };
    }
    const secondary = Math.max(1, Math.round(count * 0.3));
    const primary = count - secondary;
    return isEveningDefault ? { morning: secondary, evening: primary } : { morning: primary, evening: secondary };
}

// The original (2026-07 and earlier) formulation path: one non-agentic LLM completion over the
// latest biomarker snapshot, parsed into per-dot morning/evening counts. Used directly for Nano
// (unchanged), and as the deterministic fallback for Viva when the richer async agentic path
// (handleChatGenerateEvent's 'formula_dots_generate' kind) can't run — EventBridge publish
// failure, or the agentic turn itself throwing — so a formulation request never ends with the
// user getting nothing. Does NOT touch the DB; callers own the transaction.
async function _runDeterministicFormulation({ biomarkers, bioageProfile, dotsFormulary, personaType, lang, currentSolarTerm, essentialKnowledge, userFacts }) {
    const nutritionContext = {
        language: lang,
        biomarkers,
        bioage_profile: bioageProfile,
        dots_formulary: dotsFormulary,
        start_date: getNowShanghai().toISODate(),
        days_needed: 7,
        current_solar_term: currentSolarTerm,
        essential_knowledge: essentialKnowledge,
        user_facts: userFacts,
    };
    const llmClient = getLlmClient();
    const model = process.env.MODEL || 'qwen-plus-latest';
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
    const dotsByKey = new Map(dotsFormulary.map(d => [d.key_name.replace(/^DOT/, 'D'), d]));

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
            const m = trimmed.match(/^(D-N\d+):\s*(\d+)$/);
            if (m) {
                const dot = dotsByKey.get(m[1]);
                const min = dot?.target_dots_min ?? 1;
                const max = dot?.target_dots_max ?? 10;
                dotCounts[m[1]] = Math.min(max, Math.max(min, parseInt(m[2], 10)));
            }
        } else if (currentSection === 'analysis' && !analysis) {
            // In case it's multi-line (though prompt says brief)
            analysis = trimmed;
        }
    }

    // Fill any missing keys with the deterministic per-dot fallback
    for (const dot of dotsFormulary) {
        const k = dot.key_name.replace(/^DOT/, 'D');
        if (!dotCounts[k]) dotCounts[k] = _fallbackCountForDot(dot);
    }

    // The chat message deliberately does NOT include a raw per-dot text dump (previously
    // _generatePlanText's D-N1x3 D-N2x3 ... breakdown, repeated once per identical day) —
    // found 2026-07-29 that this read as confusing technical noise; the "查看方案" (view
    // plan) action button is the actual place users should see exact per-dot numbers.
    const finalContent = analysis || (lang === 'zh' ? '您的专属原粒方案已生成，点击下方"查看方案"了解详情。' : 'Your personalized dot plan has been generated — tap "View Plan" below for the details.');

    const morningRecipe = { dots: {} };
    const eveningRecipe = { dots: {} };
    for (const dot of dotsFormulary) {
        const k = dot.key_name.replace(/^DOT/, 'D');
        const count = dotCounts[k];
        if (!count || count <= 0) continue;
        const { morning, evening } = _splitDotTiming(dot, count);
        if (morning > 0) morningRecipe.dots[dot.key_name] = morning;
        if (evening > 0) eveningRecipe.dots[dot.key_name] = evening;
    }

    return { analysis, finalContent, morningRecipe, eveningRecipe, dotCounts };
}

// Commits a deterministic-formulation result as the one active plan for a user: supersedes any
// existing active plan, inserts a fresh 'active' nutrition_plans row (or activates an existing
// pending one when planId is given), and writes 7 identical days of morning/evening schedules.
async function _commitNutritionPlan(client, { userId, analysis, morningRecipe, eveningRecipe, planId }) {
    const startDateObj = getNowShanghai();
    const endDateObj = startDateObj.plus({ days: 6 });

    await client.query(`UPDATE nutrition_plans SET status = 'superseded' WHERE user_id = $1 AND status = 'active'`, [userId]);

    let finalPlanId = planId;
    if (finalPlanId) {
        await client.query(
            `UPDATE nutrition_plans SET status = 'active', start_date = $1, end_date = $2, goal = $3 WHERE id = $4`,
            [startDateObj.toISODate(), endDateObj.toISODate(), analysis || 'Personalized Formulation', finalPlanId]
        );
    } else {
        const planInsert = await client.query(
            `INSERT INTO nutrition_plans (user_id, start_date, end_date, goal, status) VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
            [userId, startDateObj.toISODate(), endDateObj.toISODate(), analysis || 'Personalized Formulation']
        );
        finalPlanId = planInsert.rows[0].id;
    }

    for (let i = 0; i < 7; i++) {
        const currentDate = startDateObj.plus({ days: i }).toISODate();
        await client.query(
            'INSERT INTO nutrition_schedules (plan_id, user_id, scheduled_date, slot_name, recipe) VALUES ($1, $2, $3, $4, $5)',
            [finalPlanId, userId, currentDate, 'morning_cup', morningRecipe]
        );
        await client.query(
            'INSERT INTO nutrition_schedules (plan_id, user_id, scheduled_date, slot_name, recipe) VALUES ($1, $2, $3, $4, $5)',
            [finalPlanId, userId, currentDate, 'evening_cup', eveningRecipe]
        );
    }
    return finalPlanId;
}

async function handlePostFormulaDots(body) {
    const { openid } = body;
    if (!openid) return { success: false, error: 'openid is required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        const [userResult, bioResult, dotsResult] = await Promise.all([
            pool.query('SELECT * FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]),
            pool.query(
                `SELECT bio_age, data, tested_at FROM biomarkers WHERE user_id = (SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1)
                 AND test_type = 'kino_chip' AND (data->'validated') IS NOT NULL ORDER BY tested_at DESC LIMIT 1`,
                [openid]
            ),
            pool.query(`SELECT id, key_name, key_name_zh, name, name_zh, timing, timing_flexible, ingredients, ingredients_zh, sub_age_target, target_dots_min, target_dots_max FROM dots ORDER BY id ASC`),
        ]);

        if (userResult.rows.length === 0) return { success: false, error: 'User not found' };
        const user = userResult.rows[0];
        const latestBio = bioResult.rows[0] || {};
        const data = latestBio.data || {};
        const biomarkers = data.validated || {};
        const bioageProfile = data.bioage_profile || {};

        let personaType = 'nano';
        if (user.channel_id) {
            try {
                const chResult = await pool.query('SELECT config FROM channels WHERE id = $1', [user.channel_id]);
                personaType = chResult.rows[0]?.config?.persona_type ?? 'nano';
            } catch (_) {}
        }

        const lang = user.language || 'zh';
        const currentSolarTerm = getCurrentSolarTerm(getNowShanghai().toJSDate());
        const essentialKnowledge = await getEssentialBlock(personaType);
        const userFactsResult = await pool.query(
            `SELECT category, fact_zh FROM user_memory_facts WHERE user_id = $1 AND status = 'active' ORDER BY category, last_mentioned_at DESC`,
            [user.user_id]
        );

        // Both personas now run the actual dot-count decision through the agentic
        // PLAN→GENERATE→JUDGE→REVISE loop, delivered async (see _handleFormulaDotsAgentic) —
        // Nano and Viva share the engine, differing only in prompt wording/branding and
        // knowledge_entries rows. _runDeterministicFormulation below is no longer the primary
        // entry point for either persona, but stays as the deterministic fallback used on
        // agentic failure (handleChatGenerateEvent's catch block) and EventBridge publish
        // failure (this function's own fail-open path, below).
        return await _handleFormulaDotsAgentic({ user, biomarkers, bioageProfile, dotsFormulary: dotsResult.rows, latestBio, lang, currentSolarTerm, essentialKnowledge, userFacts: userFactsResult.rows, personaType });
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostFormulaDots failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// Shared by both personas — the actual dot-count decision is made by the full agentic
// PLAN→GENERATE→JUDGE→REVISE loop, using the user's full digital twin (health_twin,
// questionnaire history, active health-plan goals) plus tool access to biomarker history /
// dot inventory / prior schedules, not just the latest biomarker snapshot. Because that loop
// can take 10s-180s+, and Aliyun FC cancels an invocation the instant the HTTP client
// disconnects (CLAUDE.md §22), the decision itself runs asynchronously via the same
// chat.generate event → notifications-poll pipeline already shipped for chat/health-advice —
// this handler only inserts a 'pending' plan row and publishes the event, returning immediately.
async function _handleFormulaDotsAgentic({ user, biomarkers, bioageProfile, dotsFormulary, latestBio, lang, currentSolarTerm, essentialKnowledge, userFacts, personaType }) {
    const startDateObj = getNowShanghai();
    const endDateObj = startDateObj.plus({ days: 6 });

    const pendingClient = await pool.connect();
    let pendingPlanId;
    try {
        await pendingClient.query('BEGIN');
        await pendingClient.query(`UPDATE nutrition_plans SET status = 'superseded' WHERE user_id = $1 AND status = 'pending'`, [user.user_id]);
        const pendingInsert = await pendingClient.query(
            `INSERT INTO nutrition_plans (user_id, start_date, end_date, goal, status) VALUES ($1, $2, $3, NULL, 'pending') RETURNING id`,
            [user.user_id, startDateObj.toISODate(), endDateObj.toISODate()]
        );
        pendingPlanId = pendingInsert.rows[0].id;
        await pendingClient.query('COMMIT');
    } catch (e) {
        await pendingClient.query('ROLLBACK');
        throw e;
    } finally {
        pendingClient.release();
    }

    const age = calculateAge(user.birth_date);
    const heightCm = user.bio_data?.height;
    const weightKg = user.bio_data?.weight;
    const bmi = heightCm && weightKg ? Math.round((weightKg / ((heightCm / 100) ** 2)) * 10) / 10 : null;

    const [healthTwinResult, questionnaireResult, activePlansResult] = await Promise.all([
        pool.query(
            `SELECT avg_hrv_ms, avg_resting_hr, avg_spo2, avg_sleep_hours, avg_sleep_score, avg_deep_sleep_pct,
                    avg_daily_steps, avg_active_minutes, latest_weight_kg, latest_bmi, latest_body_fat_pct,
                    latest_lab_data, latest_lab_date, trend_data, data_coverage
             FROM health_twin WHERE user_id = $1`,
            [user.user_id]
        ),
        pool.query(
            `SELECT q.name, q.name_zh, qq.prompt_en, qq.prompt_zh, qr.answer
             FROM questionnaire_responses qr
             JOIN questionnaire_questions qq ON qq.id = qr.question_id
             JOIN questionnaire_assignments qa ON qa.id = qr.assignment_id
             JOIN questionnaires q ON q.id = qa.questionnaire_id
             WHERE qa.user_id = $1 AND qa.status = 'completed'
               AND qq.save_field IS DISTINCT FROM 'birth_date'
               AND qq.save_biomarker_type IS DISTINCT FROM 'body_composition'
             ORDER BY qa.completed_at ASC, qq.sort_order ASC`,
            [user.user_id]
        ),
        pool.query(
            `SELECT hp.id, hp.plan_type, hp.status, hp.start_date, hp.duration_weeks,
                    hpt.name_en, hpt.name_zh, hpt.goal_en, hpt.goal_zh, hpt.target_sub_ages
             FROM health_plans hp
             LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
             WHERE hp.user_id = $1 AND hp.status = 'active'
             ORDER BY hp.start_date DESC LIMIT 5`,
            [user.user_id]
        ),
    ]);

    const llmContext = {
        user_profile: { nickname: user.nickname, gender: user.gender, age, bmi, language: lang },
        biomarkers,
        biomarkers_tested_at: latestBio?.tested_at ? formatToShanghai(new Date(latestBio.tested_at)).slice(0, 10) : null,
        bioage: bioageProfile || {},
        dots: dotsFormulary,
        plan: null,
        health_twin: healthTwinResult.rows[0] || null,
        now_iso: getNowShanghai().toISO(),
        questionnaire_context: formatQuestionnaireContext(questionnaireResult.rows, lang),
        active_health_plans: activePlansResult.rows.map(p => ({
            name: lang === 'zh' ? p.name_zh : p.name_en,
            goal: lang === 'zh' ? p.goal_zh : p.goal_en,
            target_sub_ages: p.target_sub_ages || [],
            weeks_elapsed: Math.max(0, Math.floor((Date.now() - new Date(p.start_date).getTime()) / (7 * 86400000))),
            total_weeks: p.duration_weeks,
        })),
        sub_age_display_names: null,
        current_solar_term: currentSolarTerm,
        essential_knowledge: essentialKnowledge,
        user_facts: userFacts,
        pending_plan_id: pendingPlanId,
    };
    const formulaGenerateTemplate = personaType === 'viva' ? vivaSystemFormulaGenerateTemplate : systemFormulaGenerateTemplate;
    const systemPrompt = formulaGenerateTemplate(llmContext);
    const triggerMsg = lang === 'zh'
        ? '请根据我的完整健康数据配置本周的 Dots 方案。'
        : "Please formulate this week's Dots plan based on my complete health data.";

    try {
        await publishChatGenerateEvent({
            event_id: uuidv4(), user_id: user.user_id, kind: 'formula_dots_generate',
            message: triggerMsg, intent: 'nutrition_question', llmContext,
            systemPrompt, cleanHistory: [], language: lang, personaType,
        });
        return { success: true, processing: true };
    } catch (ebErr) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'chat_generate_publish_failed_fallback_sync', user_id: user.user_id, handler: 'handlePostFormulaDots', error: ebErr.message }));
        // Fail open: publish itself failed, so run the deterministic formulator synchronously
        // end-to-end and commit it directly as 'active' — the pending row from above gets
        // superseded by _commitNutritionPlan's own supersede-then-activate step.
        const { analysis, finalContent, morningRecipe, eveningRecipe } = await _runDeterministicFormulation({
            biomarkers, bioageProfile, dotsFormulary, personaType, lang, currentSolarTerm, essentialKnowledge, userFacts,
        });
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`UPDATE nutrition_plans SET status = 'superseded' WHERE id = $1 AND status = 'pending'`, [pendingPlanId]);
            await _commitNutritionPlan(client, { userId: user.user_id, analysis, morningRecipe, eveningRecipe });
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
        await pool.query(
            'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
            [user.user_id, 'nutrition_plan', finalContent, 'pending']
        );
        await _saveChatMessage(user.user_id, 'ai', finalContent, null, personaType);
        return { success: true };
    }
}

async function handlePostDots(body) {
    const { key_name, key_name_zh, name, name_zh, color, color_zh, color_hex, group_name, group_name_zh, sub_age_target, sub_age_target_zh, timing, timing_flexible, ingredients_summary, description, is_isolate, ingredients, ingredients_zh } = body;
    if (!key_name || !name) return { success: false, error: 'key_name and name are required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const maxIdResult = await pool.query('SELECT MAX(id) as max_id FROM dots');
        const nextId = (maxIdResult.rows[0].max_id || 0) + 1;

        const result = await pool.query(
            `INSERT INTO dots (id, key_name, key_name_zh, name, name_zh, color, color_zh, color_hex, group_name, group_name_zh, sub_age_target, sub_age_target_zh, timing, timing_flexible, ingredients_summary, description, is_isolate, ingredients, ingredients_zh)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
            [nextId, key_name, key_name_zh || null, name, name_zh || null, color || null, color_zh || null, color_hex || null,
             group_name || null, group_name_zh || null, sub_age_target || null, sub_age_target_zh || null,
             timing || null, !!timing_flexible, ingredients_summary || null, description || null, !!is_isolate,
             ingredients ? JSON.stringify(ingredients) : null,
             ingredients_zh ? JSON.stringify(ingredients_zh) : null]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutDot(dotId, body) {
    const { name, name_zh, key_name_zh, color, color_zh, color_hex, group_name, group_name_zh, sub_age_target, sub_age_target_zh, timing, timing_flexible, ingredients_summary, description, is_isolate, ingredients, ingredients_zh } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query(
            `UPDATE dots SET name=$1, name_zh=$2, key_name_zh=$3, color=$4, color_zh=$5, color_hex=$6, group_name=$7,
             group_name_zh=$8, sub_age_target=$9, sub_age_target_zh=$10, timing=$11, timing_flexible=$12, ingredients_summary=$13,
             description=$14, is_isolate=$15, ingredients=$16, ingredients_zh=$17 WHERE id=$18`,
            [name, name_zh || null, key_name_zh || null, color || null, color_zh || null, color_hex || null,
             group_name || null, group_name_zh || null, sub_age_target || null, sub_age_target_zh || null,
             timing || null, !!timing_flexible, ingredients_summary || null, description || null, !!is_isolate,
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
    _runDeterministicFormulation,
    _commitNutritionPlan,
    _fallbackCountForDot,
    _splitDotTiming,
};
