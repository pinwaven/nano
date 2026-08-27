'use strict';

const { pool } = require('../lib/db');
// Physical product-model constants (cycle length, capsule fill limit, DOT-N7 isolation) —
// shared with lib/agFormulation.js so nano's own formulator and the validator for an
// externally-authored Viva AG formula can never disagree about what is manufacturable.
const { PLAN_DAYS, MAX_DOTS_PER_CAPSULE, N7_KEY, N7_ISOLATION_DAY_INDEXES } = require('../lib/dotsProductModel');
const { recordOrderCommissions, recordUserReferralCommission } = require('../lib/commissions');
const { applyPartnerDiscount, getPartnerProductDiscount } = require('../lib/partnerCommissions');
const { debitUser } = require('../lib/credits');
const { getNowShanghai, calculateAge, formatToShanghai } = require('../lib/time-utils');
const { getCurrentSolarTerm } = require('../lib/solarTerms');
const { DateTime } = require('luxon');
const OpenAI = require('openai');
const systemNutritionTemplate = require('../prompts/nano/systemNutrition');
const vivaSystemNutritionTemplate = require('../prompts/viva/systemNutrition');
const systemFormulaGenerateTemplate = require('../prompts/nano/systemFormulaGenerate');
const vivaSystemFormulaGenerateTemplate = require('../prompts/viva/systemFormulaGenerate');
const { v4: uuidv4 } = require('uuid');
const { publishChatGenerateEvent } = require('../lib/chatEventBridge');
const { getEssentialBlock } = require('../lib/knowledgeBase');
const { formatQuestionnaireContext } = require('./questionnaires');
const { buildHealthTags } = require('../lib/healthTags');
const { resolveEffectivePersona } = require('../lib/persona');

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

// Server-to-server only (GCN_ALLOWED_PATHS-gated, see worker/index.js) — lets GCN validate a
// custom-formulation purchase against the buyer's real, currently-committed recipe before
// creating an order line, rather than trusting a client-supplied plan id blindly. GCN calls this
// with the openid it already resolved from its own SSO session (never a client-supplied value),
// so `openid` here is the authenticated buyer, not user input to trust independently.
//
// `valid:false` covers every reason a purchase shouldn't proceed: wrong owner, not the user's
// current active plan (stale — a newer formulation superseded it after the client cached an
// older plan id), or plan not found at all. Never throws a 404/500 for a routine "not ready yet"
// case — the caller (GCN's handleOrderCreate) is expected to branch on `valid`, not on HTTP status.
//
// The per-dot breakdown is read from day 0 of the plan (`start_date`) specifically — every day
// in the 28-day cycle recomputes the same steady-state recipe from morningRecipe/eveningRecipe
// EXCEPT the two DOT-N7 isolation days (day-offsets 9-10, see N7_ISOLATION_DAY_INDEXES), which
// are a system-controlled special case (single-ingredient capsules) and would misrepresent the
// real formulation if read instead. Day 0 is never an isolation day, so it's always safe.
// Shared plan-lookup + day-0-schedule + dot-breakdown logic, used by both the GCN checkout
// snapshot below and the box-QR feature (handlers/boxes.js). Reads day-0 of the plan's schedule
// specifically (not any arbitrary day) to avoid the two DOT-N7 "isolation days", which would
// misrepresent the steady-state recipe. `dotColumns` lets a caller ask for just names (checkout
// snapshot's need) or the full ingredient/timing/coating/color payload (box QR page's need).
async function _getCommittedPlanDay0Breakdown(planId, { dotColumns = 'id, key_name, name, name_zh' } = {}) {
    const planResult = await pool.query(
        `SELECT np.id, np.user_id, np.status, np.start_date, np.created_at, np.goal,
                np.primary_health_plan_id, np.secondary_health_plan_id,
                hpt.key_name AS focus_key_name, hpt.name_zh AS focus_label_zh, hpt.name_en AS focus_label_en
         FROM nutrition_plans np
         LEFT JOIN health_plans hp ON hp.id = np.primary_health_plan_id
         LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
         WHERE np.id = $1`,
        [planId]
    );
    if (planResult.rows.length === 0) return { reason: 'plan_not_found' };
    const plan = planResult.rows[0];

    const scheduleResult = await pool.query(
        `SELECT slot_name, recipe FROM nutrition_schedules
         WHERE plan_id = $1 AND scheduled_date = $2`,
        [plan.id, plan.start_date]
    );
    if (scheduleResult.rows.length === 0) return { reason: 'plan_has_no_schedule', plan };

    const dotsResult = await pool.query(`SELECT ${dotColumns} FROM dots ORDER BY id ASC`);
    const dotsByKey = new Map(dotsResult.rows.map(d => [d.key_name, d]));

    const morningRow = scheduleResult.rows.find(r => r.slot_name === 'morning_cup');
    const eveningRow = scheduleResult.rows.find(r => r.slot_name === 'evening_cup');
    const morningDots = morningRow?.recipe?.dots || {};
    const eveningDots = eveningRow?.recipe?.dots || {};

    const allKeys = new Set([...Object.keys(morningDots), ...Object.keys(eveningDots)]);
    const dotBreakdown = [...allKeys].map(key => {
        const dot = dotsByKey.get(key) || {};
        const morning_count = morningDots[key] || 0;
        const evening_count = eveningDots[key] || 0;
        return {
            ...dot,
            key_name: key,
            name: dot.name || key,
            name_zh: dot.name_zh || key,
            morning_count,
            evening_count,
            total_count: morning_count + evening_count,
        };
    }).filter(d => d.total_count > 0);

    if (dotBreakdown.length === 0) return { reason: 'plan_has_no_dots', plan };
    return { plan, dotBreakdown };
}

async function handleGetFormulationCheckoutSnapshot(planId, openid) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (!planId || !openid) return { valid: false, reason: 'missing_params' };

        const planIdNum = parseInt(planId, 10);
        if (!Number.isFinite(planIdNum)) return { valid: false, reason: 'invalid_plan_id' };

        const { plan, dotBreakdown, reason } = await _getCommittedPlanDay0Breakdown(planIdNum);
        if (reason === 'plan_not_found') return { valid: false, reason };
        if (plan.user_id !== openid) return { valid: false, reason: 'plan_owner_mismatch' };
        if (plan.status !== 'active') return { valid: false, reason: 'plan_not_active' };
        if (reason) return { valid: false, reason };

        return {
            valid: true,
            plan: {
                id: plan.id,
                status: plan.status,
                committed_at: plan.created_at,
                primary_focus: plan.focus_key_name
                    ? { key_name: plan.focus_key_name, name_zh: plan.focus_label_zh, name_en: plan.focus_label_en }
                    : null,
            },
            recipe_summary: { dot_breakdown: dotBreakdown },
            verification_ref: uuidv4(),
        };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetFormulationCheckoutSnapshot failed', error: err.message }));
        return { valid: false, reason: 'internal_error' };
    }
}

// The health context a nutrition expert judges a formulation against — everything the model
// itself saw when it produced the recipe, so the reviewer is weighing the AI against the same
// evidence rather than a different slice of it.
//
// Shared by BOTH review snapshots: handleGetFormulationReviewSnapshot (a committed nutrition_plan,
// nano's own formulator) and handleGetAgFormulationReviewSnapshot (a Viva AG formula, in
// handlers/ag_formulation.js). They differ only in where the recipe comes from; keeping the twin
// half in one place is what stops the two drifting into showing reviewers different evidence.
async function _buildReviewTwinContext(userId) {
    const userResult = await pool.query(
        `SELECT user_id, nickname, gender, birth_date, language, bio_data FROM users WHERE user_id = $1 LIMIT 1`,
        [userId]
    );
    const user = userResult.rows[0] || {};
    const lang = user.language || 'zh';
    const heightCm = user.bio_data?.height;
    const weightKg = user.bio_data?.weight;
    const bmi = heightCm && weightKg ? Math.round((weightKg / ((heightCm / 100) ** 2)) * 10) / 10 : null;

    // Same four context queries _handleFormulaDotsAgentic runs to build llmContext.
    const [twinResult, bioResult, questionnaireResult, activePlansResult] = await Promise.all([
        pool.query(`SELECT * FROM health_twin WHERE user_id = $1`, [userId]),
        pool.query(
            `SELECT bio_age, data, tested_at FROM biomarkers
             WHERE user_id = $1 AND test_type = 'kino_chip' AND (data->'validated') IS NOT NULL
             ORDER BY tested_at DESC LIMIT 1`,
            [userId]
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
            [userId]
        ),
        pool.query(
            `SELECT hp.id, hp.plan_type, hp.status, hp.start_date, hp.duration_weeks,
                    hpt.name_en, hpt.name_zh, hpt.goal_en, hpt.goal_zh, hpt.target_sub_ages,
                    hpt.recommended_dot_ids
             FROM health_plans hp
             LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
             WHERE hp.user_id = $1 AND hp.status = 'active'
             ORDER BY hp.start_date DESC LIMIT 5`,
            [userId]
        ),
    ]);

    const twin = twinResult.rows[0] || null;
    const latestBio = bioResult.rows[0] || {};
    const bioData = latestBio.data || {};
    const validated = bioData.validated || null;

    return {
        user_profile: {
            nickname: user.nickname || null,
            gender: user.gender || null,
            age: calculateAge(user.birth_date),
            bmi,
            language: lang,
            health_conditions: user.bio_data?.health_conditions || [],
        },
        health_twin: twin ? { ...twin, tags: buildHealthTags(twin, validated, user.bio_data?.health_conditions || []) } : null,
        biomarkers: {
            validated,
            bioage_profile: bioData.bioage_profile || null,
            bio_age: latestBio.bio_age ?? null,
            tested_at: latestBio.tested_at || null,
        },
        questionnaire_context: formatQuestionnaireContext(questionnaireResult.rows, lang),
        active_health_plans: activePlansResult.rows.map(p => ({
            id: p.id,
            plan_type: p.plan_type,
            name: lang === 'zh' ? p.name_zh : p.name_en,
            goal: lang === 'zh' ? p.goal_zh : p.goal_en,
            target_sub_ages: p.target_sub_ages || [],
            recommended_dot_ids: p.recommended_dot_ids || [],
            weeks_elapsed: Math.max(0, Math.floor((Date.now() - new Date(p.start_date).getTime()) / (7 * 86400000))),
            total_weeks: p.duration_weeks,
        })),
    };
}

// GET /formulation-review-snapshot?planId=&openid=  (GCN service token only — see
// GCN_ALLOWED_PATHS in ../index.js)
//
// The Pro-mode counterpart to handleGetFormulationCheckoutSnapshot above. GCN's aeviva sector
// sells an expert-reviewed ("Pro") variant of the Custom Capsule Formulation, where a nutrition
// expert reviews the AI-generated recipe against the buyer's digital twin before the processing
// center compounds it. This returns everything that reviewer needs in one call: the same committed
// day-0 dot breakdown the checkout snapshot returns, PLUS the health context the model itself saw
// when it produced that recipe (_handleFormulaDotsAgentic's llmContext) — so the expert is judging
// the AI against the same evidence, not a different slice of it.
//
// Deliberately a purpose-built endpoint rather than allowlisting the existing GET /health-twin:
// GCN_ALLOWED_PATHS is per-path, not per-user, and the GCN service token resolves to
// role='superadmin' — allowlisting /health-twin would hand GCN a blanket read over every nano
// user's twin. This one is anchored to a specific plan id AND its owner, and returns nothing for a
// plan the given openid doesn't own (plan_owner_mismatch), so GCN can only ever read the twin of a
// user whose own plan it was already authorized to price at checkout.
//
// Same {valid, reason} contract and always-HTTP-200 convention as the checkout snapshot — the
// caller branches on `valid`, never on status code.
async function handleGetFormulationReviewSnapshot(planId, openid) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (!planId || !openid) return { valid: false, reason: 'missing_params' };

        const planIdNum = parseInt(planId, 10);
        if (!Number.isFinite(planIdNum)) return { valid: false, reason: 'invalid_plan_id' };

        // Richer dot columns than the checkout snapshot's default — the reviewer needs to see what
        // is actually in each cartridge (ingredients, timing, target sub-age) to judge the mix,
        // not just its name.
        const { plan, dotBreakdown, reason } = await _getCommittedPlanDay0Breakdown(planIdNum, {
            dotColumns: 'id, key_name, key_name_zh, name, name_zh, ingredients, ingredients_zh, '
                + 'timing, timing_flexible, sub_age_target, target_dots_min, target_dots_max, '
                + 'dosing_protocol, coating',
        });
        if (reason === 'plan_not_found') return { valid: false, reason };
        if (plan.user_id !== openid) return { valid: false, reason: 'plan_owner_mismatch' };
        if (reason) return { valid: false, reason };
        // NOTE: unlike the checkout snapshot, a non-'active' plan is NOT rejected here. By the time
        // an expert reviews a paid order the buyer may already have re-formulated, superseding the
        // plan that was actually purchased — the review must still show the recipe that was bought.

        const twin = await _buildReviewTwinContext(plan.user_id);

        return {
            valid: true,
            plan: {
                id: plan.id,
                status: plan.status,
                committed_at: plan.created_at,
                // The AI's own written analysis of why it formulated this way — nutrition_plans.goal
                // is where finalizeFormulaDotsGenerate stores it. The single most useful thing for a
                // reviewer to read before judging the numbers.
                goal: plan.goal || null,
                primary_focus: plan.focus_key_name
                    ? { key_name: plan.focus_key_name, name_zh: plan.focus_label_zh, name_en: plan.focus_label_en }
                    : null,
            },
            recipe_summary: { dot_breakdown: dotBreakdown },
            ...twin,
        };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetFormulationReviewSnapshot failed', error: err.message }));
        return { valid: false, reason: 'internal_error' };
    }
}

// Per-dot fallback when the LLM's FORMULATION output omits a key entirely — midpoint of that
// dot's own target_dots_min/max (added by migration_dots_new_lineup.sql; ranges vary wildly,
// e.g. 1-2 for DOT-N1 vs 56-100 for DOT-N15, so a flat constant made no sense). Falls back to
// 4 only if a dot has no min/max configured.
// `isRecommended` biases the fallback toward the high end of the dot's own range when it's one
// of the user's active focus's recommended_dot_ids (true), toward the low end when a focus is
// active but this dot isn't on its list (false), or the plain midpoint when no focus is active
// at all (undefined/omitted) — the existing, unbiased default. Never zeroes a non-recommended
// dot out entirely: soft weighting only, per the confirmed product decision (a real biomarker
// need outside the chosen focus must still be able to surface).
function _fallbackCountForDot(dot, isRecommended) {
    if (dot.target_dots_min != null && dot.target_dots_max != null) {
        const { target_dots_min: min, target_dots_max: max } = dot;
        if (isRecommended === true) return Math.round(min + (max - min) * 0.75);
        if (isRecommended === false) return Math.round(min + (max - min) * 0.25);
        return Math.round((min + max) / 2);
    }
    return 4;
}

// Resolves the union of recommended_dot_ids across a user's active health_plans (primary +
// secondary, if both joined) into a Set of dot key_names — the shared candidate/weighting input
// both the deterministic and agentic formulation paths use. Returns null when no active focus
// has any recommended dots, meaning "no narrowing" (today's default full-18-dot behavior) rather
// than an empty set (which would read as "recommend nothing").
function _resolveCandidateDotKeys(activeHealthPlans, dotsFormulary) {
    const ids = new Set();
    for (const p of activeHealthPlans || []) {
        for (const id of (p.recommended_dot_ids || [])) ids.add(id);
    }
    if (ids.size === 0) return null;
    const byId = new Map((dotsFormulary || []).map(d => [d.id, d]));
    const keys = new Set([...ids].map(id => byId.get(id)?.key_name).filter(Boolean));
    return keys.size > 0 ? keys : null;
}

// Splits a dot's total count across morning/evening for the deterministic (non-agentic) path.
// timing_flexible (migration_dots_timing_flexible.sql) marks dots with no real diurnal
// pharmacological constraint — those get ~30% of a total > 10 moved to their non-default slot
// so the day's AM/PM pill counts land closer together. Non-flexible dots (e.g. DOT-N4/DOT-N12's
// stimulating ingredients, DOT-N3's sleep support) always stay entirely in their default slot —
// timing_flexible=false is a real reason, not a guess, so it's never overridden here.
// Renders a committed AM/PM recipe as the chat tab's :::formula display card (see
// utils/markdown.js's directive table and main.wxml's seg.t === 'formula' branch).
//
// This exists because Formulate-Dots is an EVALUATION tool now: it no longer writes to
// nutrition_plans, so there is no Dots subtab for a "view plan" button to point at, and the
// numbers have to be legible in the chat bubble itself. Built here, deterministically, from the
// same validated recipe the rest of this file produces — the model never writes this block, so
// the chart can never disagree with the allocation it is drawing.
//
// One row per dot: key|name|color|am|pm. The renderer derives every total itself, so the parser
// stays dumb and there is no second place for the arithmetic to drift.
function _buildFormulaChartBlock(morningRecipe, eveningRecipe, dotsFormulary, lang) {
    const isZh = (lang || 'zh') !== 'en';
    // Cap here, not at the caller. Every dot is forced to at least its own target_dots_min, and
    // those floors already sum past one capsule, so an uncapped recipe renders a capsule nobody
    // can physically fill. _commitNutritionPlan applies the same cap on the paths that still
    // write a plan; this tool stopped writing one (see the evaluation-tool note above), which
    // left the card as the only surface showing raw, unbuildable counts. Capping inside the
    // renderer covers all three call sites at once, and any future fourth one.
    const morning = _capRecipeTotal(morningRecipe, MAX_DOTS_PER_CAPSULE)?.dots || {};
    const evening = _capRecipeTotal(eveningRecipe, MAX_DOTS_PER_CAPSULE)?.dots || {};
    const rows = [];
    for (const dot of dotsFormulary || []) {
        const am = morning[dot.key_name] || 0;
        const pm = evening[dot.key_name] || 0;
        if (am === 0 && pm === 0) continue;
        const name = (isZh ? (dot.name_zh || dot.name) : (dot.name || dot.name_zh)) || dot.key_name;
        // Pipes would break the row split, and a dot name is admin-editable free text.
        const safeName = String(name).replace(/\|/g, '/');
        rows.push(`${dot.key_name}|${safeName}|${dot.color_hex || ''}|${am}|${pm}`);
    }
    if (!rows.length) return '';
    return `\n\n:::formula\n${rows.join('\n')}\n:::`;
}

// Renders the :::product card for a validated set of store recommendations.
//
// Same contract as _buildFormulaChartBlock directly above, and for the same reason: the SERVER
// writes every name and price, from the catalog snapshot the request already fetched — the model
// only ever supplied a sku_id and a sentence of reasoning. A price the model was never shown is a
// price it cannot get wrong, and the card can never disagree with what checkout will charge.
//
// `items` are already validated against the snapshot and capped by the caller
// (finalizeChatReply). Rows are sku|name|price|reason; the renderer
// (miniapp utils/markdown.js) derives display from these and nothing else.
function _buildProductCardBlock(items, lang) {
    const isZh = (lang || 'zh') !== 'en';
    const rows = [];
    for (const it of items || []) {
        if (!it || !it.sku_id) continue;
        // Pipes would break the row split; product names and reasons are both free text (one
        // admin-authored, one model-authored), so neither may be trusted to be pipe-free.
        const safe = v => String(v == null ? '' : v).replace(/\|/g, '/').replace(/[\r\n]+/g, ' ').trim();
        const price = it.price_cny != null && Number.isFinite(Number(it.price_cny))
            ? `¥${Number(it.price_cny).toFixed(2).replace(/\.00$/, '')}`
            : (isZh ? '价格以商城为准' : 'see store');
        rows.push(`${safe(it.sku_id)}|${safe(it.product_name_zh)}|${price}|${safe(it.reason_zh)}`);
    }
    if (!rows.length) return '';
    return `\n\n:::product\n${rows.join('\n')}\n:::`;
}

function _splitDotTiming(dot, count) {
    const isEveningDefault = dot.timing === 'Evening';
    if (!dot.timing_flexible || count <= 10) {
        return isEveningDefault ? { morning: 0, evening: count } : { morning: count, evening: 0 };
    }
    const secondary = Math.max(1, Math.round(count * 0.3));
    const primary = count - secondary;
    return isEveningDefault ? { morning: secondary, evening: primary } : { morning: primary, evening: secondary };
}

// Fixed reference point for pulse-cycle math (migration_dots_dosing_protocol.sql) — arbitrary,
// just needs to never change once dots start relying on it, so a pulse dot's active window is a
// pure function of the calendar date, never of when a plan happens to be (re)generated. Without
// this, reformulating mid-cycle could shift or duplicate a dot's "2 consecutive days" window.
const PULSE_CYCLE_EPOCH = DateTime.fromISO('2026-01-01');

// True if `dateISO` falls inside a pulse-protocol dot's active window. Non-pulse dots ('daily',
// the default) are always active — this is the single gate _commitNutritionPlan uses to decide
// whether a pulse dot appears in a given day's recipe at all, so "not a daily dose" is enforced
// in code rather than left to the model to remember. DOT-N7 is the only pulse dot configured
// today, but as of 2026-08-08 it's routed through the dedicated week-2 isolation-day mechanism
// instead (see N7_KEY/N7_ISOLATION_DAY_INDEXES in lib/dotsProductModel.js) — this function/gate remains generic
// infrastructure for any *other* future pulse dot.
function _isPulseActiveDate(dot, dateISO) {
    if (dot.dosing_protocol !== 'pulse') return true;
    if (!dot.pulse_days_per_cycle || !dot.pulse_cycle_days) return true; // misconfigured — fail open to daily rather than silently dropping the dot entirely
    const daysSinceEpoch = Math.floor(DateTime.fromISO(dateISO).diff(PULSE_CYCLE_EPOCH, 'days').days);
    const dayInCycle = ((daysSinceEpoch % dot.pulse_cycle_days) + dot.pulse_cycle_days) % dot.pulse_cycle_days;
    return dayInCycle < dot.pulse_days_per_cycle;
}

// Drops any pulse-protocol dot from a day's recipe on a day outside its active window — the
// model/deterministic formulator still decides one count per dot per cycle (the per-dose amount
// taken ON an active day), _commitNutritionPlan just no longer copies that count into every day
// of the plan verbatim for dots that were never meant to be dosed daily.
function _applyPulseSchedule(recipe, pulseDotsByKey, dateISO) {
    if (!pulseDotsByKey || pulseDotsByKey.size === 0) return recipe;
    const dots = {};
    for (const [key, count] of Object.entries(recipe.dots || {})) {
        const pulseDot = pulseDotsByKey.get(key);
        if (pulseDot && !_isPulseActiveDate(pulseDot, dateISO)) continue;
        dots[key] = count;
    }
    return { dots };
}


// Returns a copy of `recipe` with `key` removed from its dots map — used to strip DOT-N7 out of
// the everyday recipe before the isolation-day override takes over its dosing entirely.
function _omitDotKey(recipe, key) {
    const dots = { ...(recipe?.dots || {}) };
    delete dots[key];
    return { dots };
}

// Caps a single capsule's total dot count at maxTotal, scaling every dot down proportionally
// (largest-remainder method: floor each scaled count, then hand out the leftover budget to the
// entries with the largest fractional remainder) so the rounded counts still sum to exactly
// maxTotal rather than drifting under/over from naive per-dot rounding. A dot whose scaled share
// floors to 0 simply drops out of that capsule — an expected outcome of a ~5x reduction, not a
// bug — relative emphasis between the surviving dots is preserved.
function _capRecipeTotal(recipe, maxTotal) {
    const dots = recipe?.dots || {};
    const total = Object.values(dots).reduce((s, c) => s + c, 0);
    if (total <= maxTotal) return recipe;
    const scale = maxTotal / total;
    const floors = {};
    const remainders = [];
    let flooredSum = 0;
    for (const [key, count] of Object.entries(dots)) {
        const scaled = count * scale;
        const floor = Math.floor(scaled);
        floors[key] = floor;
        flooredSum += floor;
        remainders.push([key, scaled - floor]);
    }
    let remaining = maxTotal - flooredSum;
    remainders.sort((a, b) => b[1] - a[1]);
    for (let i = 0; i < remaining && i < remainders.length; i++) {
        floors[remainders[i][0]] += 1;
    }
    const result = {};
    for (const [key, count] of Object.entries(floors)) {
        if (count > 0) result[key] = count;
    }
    return { dots: result };
}

// The original (2026-07 and earlier) formulation path: one non-agentic LLM completion over the
// latest biomarker snapshot, parsed into per-dot morning/evening counts. Used directly for Nano
// (unchanged), and as the deterministic fallback for Viva when the richer async agentic path
// (handleChatGenerateEvent's 'formula_dots_generate' kind) can't run — EventBridge publish
// failure, or the agentic turn itself throwing — so a formulation request never ends with the
// user getting nothing. Does NOT touch the DB; callers own the transaction.
async function _runDeterministicFormulation({ biomarkers, bioageProfile, dotsFormulary, personaType, lang, currentSolarTerm, essentialKnowledge, userFacts, activeHealthPlans }) {
    const recommendedKeySet = _resolveCandidateDotKeys(activeHealthPlans, dotsFormulary);
    const nutritionContext = {
        language: lang,
        biomarkers,
        bioage_profile: bioageProfile,
        dots_formulary: dotsFormulary,
        start_date: getNowShanghai().toISODate(),
        days_needed: PLAN_DAYS,
        current_solar_term: currentSolarTerm,
        essential_knowledge: essentialKnowledge,
        user_facts: userFacts,
        recommended_dot_keys: recommendedKeySet ? [...recommendedKeySet] : null,
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

    // Fill any missing keys with the deterministic per-dot fallback, biased by focus (see
    // _fallbackCountForDot) when the user has an active health plan with recommended dots.
    for (const dot of dotsFormulary) {
        const k = dot.key_name.replace(/^DOT/, 'D');
        if (!dotCounts[k]) {
            const isRecommended = recommendedKeySet ? recommendedKeySet.has(dot.key_name) : undefined;
            dotCounts[k] = _fallbackCountForDot(dot, isRecommended);
        }
    }

    // The chat message deliberately does NOT include a raw per-dot text dump (previously
    // _generatePlanText's D-N1x3 D-N2x3 ... breakdown, repeated once per identical day) —
    // found 2026-07-29 that this read as confusing technical noise. Exact per-dot numbers now
    // live in the :::formula chart the caller appends (_buildFormulaChartBlock), which is where
    // the old "查看方案" button used to send people.
    const finalContent = analysis || (lang === 'zh'
        ? '这是根据您当前数据评估出的原粒配比，仅供参考。'
        : 'Here is the dot allocation evaluated from your current data, for reference.');

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
// pending one when planId is given), and writes PLAN_DAYS (28) days of morning/evening schedules.
// Every day's capsule is capped at MAX_DOTS_PER_CAPSULE via _capRecipeTotal. DOT-N7 is stripped
// out of the everyday recipe entirely and instead written only on the 2 dedicated week-2
// isolation days (N7_ISOLATION_DAY_INDEXES), where it's the sole dot in both capsules at its own
// target_dots_max — see the constants above for why. Any *other* pulse-protocol dot (none exist
// today) still follows the older generic epoch-based pulse window (_isPulseActiveDate), included
// only on the days that actually fall inside its active window and omitted from the rest.
// `dotsFormulary` is optional (callers that never touch a pulse dot can omit it) — without it,
// pulse/N7 enforcement simply doesn't run (N7 stays in the everyday recipe uncapped-by-isolation,
// falling back to a default target_dots_max of 50 if it ever is isolated) and only the 72/capsule
// cap still applies.
//
// Stale-pending guard: when `planId` is given, the current active plan is only superseded AFTER
// confirming the pending->active flip actually landed (WHERE status='pending' on that UPDATE). A
// formula-dots request publishes its chat.generate event with a brand-new pending row every time
// it's called (handlers/dots.js's _handleFormulaDotsAgentic); if two calls race, or EventBridge's
// at-least-once delivery redelivers an older event late, that older pending row may already be
// 'superseded' by the time its event is finally processed. Without this guard, that late
// delivery would silently supersede whatever plan is genuinely active now and resurrect stale
// data in its place — confirmed possible via live testing 2026-08-08 (two formula-dots calls for
// the same user produced 3 pending rows but only 1 delivered event; the other 2 remained
// undelivered and could still land later). Returns the plan id normally, or `null` if the commit
// was skipped as stale — callers should treat `null` as "nothing changed, don't notify the user".
async function _commitNutritionPlan(client, { userId, analysis, morningRecipe, eveningRecipe, planId, dotsFormulary, activeHealthPlans }) {
    const startDateObj = getNowShanghai();
    const endDateObj = startDateObj.plus({ days: PLAN_DAYS - 1 });
    const primaryHealthPlanId = (activeHealthPlans || []).find(p => p.plan_type === 'primary')?.id ?? null;
    const secondaryHealthPlanId = (activeHealthPlans || []).find(p => p.plan_type === 'secondary')?.id ?? null;

    let finalPlanId = planId;
    if (finalPlanId) {
        const activated = await client.query(
            `UPDATE nutrition_plans SET status = 'active', start_date = $1, end_date = $2, goal = $3,
                    primary_health_plan_id = $5, secondary_health_plan_id = $6
             WHERE id = $4 AND status = 'pending' RETURNING id`,
            [startDateObj.toISODate(), endDateObj.toISODate(), analysis || 'Personalized Formulation', finalPlanId, primaryHealthPlanId, secondaryHealthPlanId]
        );
        if (activated.rows.length === 0) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'commit_nutrition_plan_stale_pending_skipped', userId, planId: finalPlanId }));
            return null; // signals "no-op" so callers skip notifying the user about nothing
        }
        await client.query(`UPDATE nutrition_plans SET status = 'superseded' WHERE user_id = $1 AND status = 'active' AND id != $2`, [userId, finalPlanId]);
    } else {
        await client.query(`UPDATE nutrition_plans SET status = 'superseded' WHERE user_id = $1 AND status = 'active'`, [userId]);
        const planInsert = await client.query(
            `INSERT INTO nutrition_plans (user_id, start_date, end_date, goal, status, primary_health_plan_id, secondary_health_plan_id)
             VALUES ($1, $2, $3, $4, 'active', $5, $6) RETURNING id`,
            [userId, startDateObj.toISODate(), endDateObj.toISODate(), analysis || 'Personalized Formulation', primaryHealthPlanId, secondaryHealthPlanId]
        );
        finalPlanId = planInsert.rows[0].id;
    }

    const dotsByKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));
    const n7Dot = dotsByKey.get(N7_KEY);
    const n7MaxCount = n7Dot?.target_dots_max ?? 50;
    const n7IsolationRecipe = { dots: { [N7_KEY]: n7MaxCount } };

    const baseMorningRecipe = _omitDotKey(morningRecipe, N7_KEY);
    const baseEveningRecipe = _omitDotKey(eveningRecipe, N7_KEY);
    const pulseDotsByKey = new Map((dotsFormulary || []).filter(d => d.dosing_protocol === 'pulse' && d.key_name !== N7_KEY).map(d => [d.key_name, d]));

    for (let i = 0; i < PLAN_DAYS; i++) {
        const currentDate = startDateObj.plus({ days: i }).toISODate();
        const isN7IsolationDay = N7_ISOLATION_DAY_INDEXES.includes(i);

        const dayMorningRecipe = isN7IsolationDay
            ? n7IsolationRecipe
            : _capRecipeTotal(_applyPulseSchedule(baseMorningRecipe, pulseDotsByKey, currentDate), MAX_DOTS_PER_CAPSULE);
        const dayEveningRecipe = isN7IsolationDay
            ? n7IsolationRecipe
            : _capRecipeTotal(_applyPulseSchedule(baseEveningRecipe, pulseDotsByKey, currentDate), MAX_DOTS_PER_CAPSULE);

        await client.query(
            'INSERT INTO nutrition_schedules (plan_id, user_id, scheduled_date, slot_name, recipe) VALUES ($1, $2, $3, $4, $5)',
            [finalPlanId, userId, currentDate, 'morning_cup', dayMorningRecipe]
        );
        await client.query(
            'INSERT INTO nutrition_schedules (plan_id, user_id, scheduled_date, slot_name, recipe) VALUES ($1, $2, $3, $4, $5)',
            [finalPlanId, userId, currentDate, 'evening_cup', dayEveningRecipe]
        );
    }
    return finalPlanId;
}

// Commits a Viva AG formula — the box-scan half of the AG ordering flow.
//
// A DELIBERATE SIBLING of _commitNutritionPlan, not a reuse of it. That function takes a
// steady-state morning/evening recipe and EXPANDS it across the cycle, applying
// _applyPulseSchedule, _capRecipeTotal and the DOT-N7 isolation override day by day as it goes.
// An AG formula already encodes all 56 capsules explicitly — pulse days, isolation days and all,
// validated against exactly those rules by lib/agFormulation.js — so running it through that
// expansion would apply every rule a second time and flatten the per-day variation the agent
// deliberately produced. The capsules are written verbatim instead.
//
// `planId` is the 'approved' row created at expert-approval time. Its start_date is rewritten to
// TODAY here: the 28-day cycle starts when the user physically has the capsules, not when the
// formula was authored or the box was compounded.
async function _commitAgFormulation(client, { userId, planId, capsules, analysis }) {
    const startDateObj = getNowShanghai();
    const endDateObj = startDateObj.plus({ days: PLAN_DAYS - 1 });

    const activated = await client.query(
        `UPDATE nutrition_plans SET status = 'active', start_date = $1, end_date = $2,
                goal = COALESCE($3, goal)
          WHERE id = $4 AND status = 'approved' RETURNING id`,
        [startDateObj.toISODate(), endDateObj.toISODate(), analysis || null, planId]
    );
    if (activated.rows.length === 0) {
        // Already active (a re-scan that raced this one) or never approved. Either way this is a
        // no-op, not an error — the caller reports the existing plan rather than making a second.
        console.log(JSON.stringify({ level: 'WARN', msg: 'commit_ag_formulation_not_approved', userId, planId }));
        return null;
    }
    await client.query(
        `UPDATE nutrition_plans SET status = 'superseded' WHERE user_id = $1 AND status = 'active' AND id != $2`,
        [userId, planId]
    );

    for (const capsule of capsules) {
        const slotName = capsule.slot === 'PM' ? 'evening_cup' : 'morning_cup';
        const date = startDateObj.plus({ days: capsule.day - 1 }).toISODate();
        // Defensive only — validateAgFormulation already rejects an over-full capsule, so this
        // never fires for a formula that got this far. A physical fill limit is worth enforcing on
        // both sides of the boundary rather than trusting that it was checked upstream.
        const recipe = _capRecipeTotal({ dots: { ...capsule.dots } }, MAX_DOTS_PER_CAPSULE);
        await client.query(
            'INSERT INTO nutrition_schedules (plan_id, user_id, scheduled_date, slot_name, recipe) VALUES ($1, $2, $3, $4, $5)',
            [planId, userId, date, slotName, recipe]
        );
    }
    return planId;
}

// Background reformulation triggered by the dispatcher's periodic nutrition.topup CloudEvent
// (source acs.dispatcher, see dispatcher/index.js's nutritionQuery and worker/index.js's
// EventBridge router — this case was previously missing there entirely, so the event was
// silently dropped and this handler never ran). Runs the deterministic single-completion
// formulator directly rather than the full agentic PLAN->GENERATE->JUDGE->REVISE loop: this is
// an unattended background job with no user waiting on a reply, so the richer interactive loop's
// extra latency/cost isn't warranted, mirroring the same choice already made for every other
// fallback path in this file.
async function handleNutritionTopupEvent(payload) {
    const { user_id } = payload || {};
    if (!user_id) return;
    try {
        if (!pool) return;
        const [userResult, bioResult, dotsResult] = await Promise.all([
            pool.query('SELECT * FROM users WHERE user_id = $1 LIMIT 1', [user_id]),
            pool.query(
                `SELECT data FROM biomarkers WHERE user_id = $1
                 AND test_type = 'kino_chip' AND (data->'validated') IS NOT NULL ORDER BY tested_at DESC LIMIT 1`,
                [user_id]
            ),
            pool.query(`SELECT id, key_name, key_name_zh, name, name_zh, color_hex, timing, timing_flexible, ingredients, ingredients_zh, sub_age_target, target_dots_min, target_dots_max, dosing_protocol, pulse_days_per_cycle, pulse_cycle_days FROM dots ORDER BY id ASC`),
        ]);
        if (userResult.rows.length === 0) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'nutrition_topup_user_not_found', user_id }));
            return;
        }
        const user = userResult.rows[0];
        const data = bioResult.rows[0]?.data || {};
        const biomarkers = data.validated || {};
        const bioageProfile = data.bioage_profile || {};

        let channelPersonaType = 'nano';
        if (user.channel_id) {
            try {
                const chResult = await pool.query('SELECT config FROM channels WHERE id = $1', [user.channel_id]);
                channelPersonaType = chResult.rows[0]?.config?.persona_type ?? 'nano';
            } catch (_) {}
        }
        const personaType = resolveEffectivePersona({
            channelPersonaType,
            personaOverrideType: user.persona_override_type,
            personaOverrideExpiresAt: user.persona_override_expires_at,
        });

        const lang = user.language || 'zh';
        const currentSolarTerm = getCurrentSolarTerm(getNowShanghai().toJSDate());
        const essentialKnowledge = await getEssentialBlock(personaType);
        const [userFactsResult, activePlansResult] = await Promise.all([
            pool.query(
                `SELECT category, fact_zh FROM user_memory_facts WHERE user_id = $1 AND status = 'active' ORDER BY category, last_mentioned_at DESC`,
                [user.user_id]
            ),
            pool.query(
                `SELECT hp.id, hp.plan_type, hpt.recommended_dot_ids
                 FROM health_plans hp
                 LEFT JOIN health_plan_templates hpt ON hpt.id = hp.template_id
                 WHERE hp.user_id = $1 AND hp.status = 'active'
                 ORDER BY hp.start_date DESC LIMIT 5`,
                [user.user_id]
            ),
        ]);

        const { analysis, finalContent, morningRecipe, eveningRecipe } = await _runDeterministicFormulation({
            biomarkers, bioageProfile, dotsFormulary: dotsResult.rows, personaType, lang, currentSolarTerm,
            essentialKnowledge, userFacts: userFactsResult.rows, activeHealthPlans: activePlansResult.rows,
        });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await _commitNutritionPlan(client, {
                userId: user.user_id, analysis, morningRecipe, eveningRecipe,
                dotsFormulary: dotsResult.rows, activeHealthPlans: activePlansResult.rows,
            });
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

        // Reorder-ready nudge: only for a user who has already bought a custom formulation at
        // least once — handlers/users.js's handlePostFormulationPurchaseConfirmed is the only
        // way nano learns this (GCN has no other channel to signal it back through). A user who
        // has never purchased just gets the normal 'nutrition_plan' notification, same as today.
        const notificationType = user.custom_formulation_purchased_at ? 'formulation_reorder_ready' : 'nutrition_plan';
        const notificationContent = user.custom_formulation_purchased_at
            ? (lang === 'zh'
                ? '您的原粒方案已根据最新数据刷新，点击查看并重新购买。'
                : 'Your dot formulation has been refreshed with your latest data — tap to view and reorder.')
            : finalContent;
        await pool.query(
            'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
            [user.user_id, notificationType, notificationContent, 'pending']
        );
        await _saveChatMessage(user.user_id, 'ai', finalContent, null, personaType);
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleNutritionTopupEvent failed', user_id, error: err.message }));
    }
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
            pool.query(`SELECT id, key_name, key_name_zh, name, name_zh, color_hex, timing, timing_flexible, ingredients, ingredients_zh, sub_age_target, target_dots_min, target_dots_max, dosing_protocol, pulse_days_per_cycle, pulse_cycle_days FROM dots ORDER BY id ASC`),
        ]);

        if (userResult.rows.length === 0) return { success: false, error: 'User not found' };
        const user = userResult.rows[0];
        const latestBio = bioResult.rows[0] || {};
        const data = latestBio.data || {};
        const biomarkers = data.validated || {};
        const bioageProfile = data.bioage_profile || {};

        let channelPersonaType = 'nano';
        if (user.channel_id) {
            try {
                const chResult = await pool.query('SELECT config FROM channels WHERE id = $1', [user.channel_id]);
                channelPersonaType = chResult.rows[0]?.config?.persona_type ?? 'nano';
            } catch (_) {}
        }
        const personaType = resolveEffectivePersona({
            channelPersonaType,
            personaOverrideType: user.persona_override_type,
            personaOverrideExpiresAt: user.persona_override_expires_at,
        });

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
// this handler only publishes the event and returns immediately.
//
// EVALUATION ONLY. Since the 28-day formula the user actually receives now comes from Viva AG's
// dots_formulation job, this tool no longer writes anything: no 'pending' row is inserted here
// and nothing is ever committed to nutrition_plans / nutrition_schedules. The result is a chat
// message carrying a :::formula chart of the proposed AM/PM allocation, and that is the whole
// deliverable — which is also why there is no longer a "view plan" button pointing at a Dots
// subtab that this run did not change.
async function _handleFormulaDotsAgentic({ user, biomarkers, bioageProfile, dotsFormulary, latestBio, lang, currentSolarTerm, essentialKnowledge, userFacts, personaType }) {
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
                    hpt.name_en, hpt.name_zh, hpt.goal_en, hpt.goal_zh, hpt.target_sub_ages,
                    hpt.recommended_dot_ids
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
            id: p.id,
            plan_type: p.plan_type,
            name: lang === 'zh' ? p.name_zh : p.name_en,
            goal: lang === 'zh' ? p.goal_zh : p.goal_en,
            target_sub_ages: p.target_sub_ages || [],
            recommended_dot_ids: p.recommended_dot_ids || [],
            weeks_elapsed: Math.max(0, Math.floor((Date.now() - new Date(p.start_date).getTime()) / (7 * 86400000))),
            total_weeks: p.duration_weeks,
        })),
        sub_age_display_names: null,
        current_solar_term: currentSolarTerm,
        essential_knowledge: essentialKnowledge,
        user_facts: userFacts,
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
        // Fail open: publish itself failed, so run the deterministic formulator synchronously and
        // deliver the same evaluation the async path would have — still no DB write.
        const { finalContent, morningRecipe, eveningRecipe } = await _runDeterministicFormulation({
            biomarkers, bioageProfile, dotsFormulary, personaType, lang, currentSolarTerm, essentialKnowledge, userFacts,
            activeHealthPlans: llmContext.active_health_plans,
        });
        const message = finalContent + _buildFormulaChartBlock(morningRecipe, eveningRecipe, dotsFormulary, lang);
        await pool.query(
            'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
            [user.user_id, 'nutrition_plan', message, 'pending']
        );
        await _saveChatMessage(user.user_id, 'ai', message, null, personaType);
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
    handleGetFormulationCheckoutSnapshot,
    handleGetFormulationReviewSnapshot,
    _buildReviewTwinContext,
    _getCommittedPlanDay0Breakdown,
    handleNutritionTopupEvent,
    handlePostFormulaDots,
    handlePostDots,
    handlePutDot,
    handleDeleteDot,
    _runDeterministicFormulation,
    _commitNutritionPlan,
    _commitAgFormulation,
    _fallbackCountForDot,
    _resolveCandidateDotKeys,
    _splitDotTiming,
    _buildFormulaChartBlock,
    _buildProductCardBlock,
    _isPulseActiveDate,
    _applyPulseSchedule,
};
