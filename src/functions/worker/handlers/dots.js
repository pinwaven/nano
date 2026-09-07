'use strict';

const { pool } = require('../lib/db');
// Physical product-model constants (cycle length, capsule fill limit, DOT-N7 isolation) —
// shared with lib/agFormulation.js so nano's own formulator and the validator for an
// externally-authored Viva AG formula can never disagree about what is manufacturable.
const { PLAN_DAYS, DAYS_PER_WEEK, PLAN_WEEKS, MAX_DOTS_PER_CAPSULE, N7_KEY, N7_ISOLATION_DAY_INDEXES } = require('../lib/dotsProductModel');
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
// The same validator an externally-authored Viva AG formula must pass. A fast-track formula gets
// no expert review at all, which makes this the ONLY thing standing between a generated table and
// physical capsules — so it runs here too, and a violation refuses the submission outright.
const { validateAgFormulation, canonicalizeCapsules } = require('../lib/agFormulation');
const { fetchFormulationOrders, submitFastTrackFormulation,
        fetchFormulationCodes, redeemFormulationCode,
        fetchFormulationTiers } = require('../lib/gcnClient');
const { generateLabelCode } = require('../lib/labelCode');

// Where the aeviva sector's public pages live. The formulation label QR is a GCN aeviva link
// rather than a nano one because that is the sector the product is sold in — the page that
// renders it already exists there (formulation-label.html), already prints, and already draws the
// QR. Falls back to prod so a missing env var degrades to a real page rather than a broken link.
const AEVIVA_SITE_BASE_URL = (process.env.AEVIVA_SITE_BASE_URL || 'https://aeviva.gcn.net').replace(/\/+$/, '');

// The QR payload. Contains the code, so handlePostBoxClaim's /WVB[0-9A-Fa-f]{12}/ still reads it
// straight out of whatever the scanner returns — one QR that both shows the formulation and
// activates it.
function _formulationLabelUrl(code) {
    return `${AEVIVA_SITE_BASE_URL}/formulation-label.html?c=${encodeURIComponent(code)}`;
}
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Formulation packages — one journey per row, assembled from two systems
//
// A user's custom-dots journey lives half in GCN (the order: paid, compounding, shipped) and half
// in nano (the formula: proposed, approved, active). Neither half alone answers "where are my
// capsules", which is why the Dots subtab could not answer it at all before this — nano's only
// record that an order existed was users.custom_formulation_purchased_at, a bare timestamp.
//
// NOTHING IS MIRRORED. The order half is read from GCN at request time, never copied into a nano
// table. A cached status has nothing to reconcile itself against — an order can be refunded,
// cancelled, or fulfilled by an AG run between two reads — which is the same reasoning
// fetchFormulationOrders already records for pulling rather than stamping a flag.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// The stage a USER is at, which is not the same thing as either system's own status column.
// Two of these ('proposed', 'active') have no GCN order behind them at all, and two more
// ('awaiting_formulation' vs 'awaiting_ag') are one GCN status split by which package was bought,
// because they ask opposite things of the user: one needs them to act, the other explicitly does
// not. The miniapp keys its labels off these strings (t['pkgStage_' + stage]).
const PACKAGE_STAGES = new Set([
    'proposed',              // a formula from the chat tool that nobody has ordered yet
    'pending_payment', 'paid',
    'awaiting_formulation',  // fast-track package waiting on THIS user to confirm a formula
    'awaiting_ag',           // premium package — Viva AG formulates it, the user does nothing
    'expert_review', 'compounding',
    'shipped', 'delivered',  // both mean "scan the box"
    'active',                // the box was scanned; capsules are being taken
    'cancelled', 'refunded',
]);

// Ranked so the row a user can act on is never buried under one they cannot. Within a rank,
// newest first. Deliberately not pure recency: the whole point of the list is to surface the
// package that is waiting on them.
const _STAGE_RANK = {
    awaiting_formulation: 0, shipped: 1, delivered: 1,
    proposed: 2,
    pending_payment: 3, paid: 3, awaiting_ag: 3, expert_review: 3, compounding: 3,
    active: 4,
    completed: 5, cancelled: 6, refunded: 6,
};

// An order that exists but has no formula on it yet — the slot a proposal is going to fill.
// Deliberately NOT every in-flight stage: once a package reaches expert_review or compounding its
// recipe is already attached, so a proposal made after that is a genuine next-cycle formula and
// must stay orderable. 'awaiting_ag' is here because Viva AG will supply that formula, so a
// chat-tool proposal is not what fills it and offering to buy a second package is wrong.
const AWAITING_FORMULA_STAGES = new Set([
    'pending_payment', 'paid', 'awaiting_formulation', 'awaiting_ag',
]);

// GCN's order status → the user-facing stage, for an order that has no nano plan overriding it.
// 'processing' collapses into 'compounding' because to a buyer they are the same sentence ("it is
// being made"); 'completed' becomes 'delivered' because for a physical box the journey is not over
// until they scan it, and that scan is a nano-side event GCN never learns about.
function _stageFromOrderStatus(order) {
    switch (order.status) {
        case 'pending_payment': return 'pending_payment';
        case 'paid': return 'paid';
        case 'awaiting_formulation':
            return order.fulfillment === 'fast_track' ? 'awaiting_formulation' : 'awaiting_ag';
        case 'expert_review': return 'expert_review';
        case 'compounding':
        case 'processing': return 'compounding';
        case 'shipped': return 'shipped';
        case 'completed': return 'delivered';
        case 'cancelled': return 'cancelled';
        case 'refunded': return 'refunded';
        default: return 'compounding';
    }
}

// Which nano plan belongs to which GCN order. Three links, in confidence order:
//   1. nutrition_plans.gcn_order_id  — written by handlePostFormulationSubmit when nano itself
//      submitted the formula. The strongest signal, because nano wrote both sides of it.
//   2. order.nano_nutrition_plan_id  — written by GCN's attach path. Covers the AG flow, where
//      the plan row is created by handlePostAgFormulationApproved and never carries gcn_order_id.
//   3. the AG formulation id         — the last resort for an AG plan whose order-side id was
//      recorded before the plan existed. TEXT on GCN's side, BIGINT here, so compared as strings.
// intended_nano_plan_id is deliberately NOT used: it is what the buyer was looking at, advisory
// only, and may name a formula that was superseded and never compounded (GCN's migration_0086).
function _planMatchesOrder(plan, order) {
    if (plan.gcn_order_id && String(plan.gcn_order_id) === String(order.order_id)) return true;
    if (order.nano_nutrition_plan_id != null && Number(plan.id) === Number(order.nano_nutrition_plan_id)) return true;
    if (order.nano_ag_formulation_id && plan.ag_formulation_id != null
        && String(plan.ag_formulation_id) === String(order.nano_ag_formulation_id)) return true;
    return false;
}

// Day N of 28, for a plan the user is actually taking. Null for every other status: a proposal's
// start_date is a placeholder (CURRENT_DATE at commit time) and an approved plan's is provisional
// until the box is scanned, so counting from either would show a day number for capsules the user
// does not have. Clamped, because a plan that ran past its end date still reads as "day 28",
// never "day 31".
function _planDayIndex(plan) {
    if (!plan || plan.status !== 'active' || !plan.start_date) return null;
    const start = DateTime.fromISO(String(plan.start_date), { zone: 'Asia/Shanghai' });
    if (!start.isValid) return null;
    const elapsed = Math.floor(getNowShanghai().startOf('day').diff(start.startOf('day'), 'days').days);
    return Math.min(PLAN_DAYS, Math.max(1, elapsed + 1));
}

// PURE — no DB, no network. Takes GCN's orders and nano's own non-superseded plans and returns one
// row per journey. Kept pure so every stage mapping is testable without either system.
function _mergeFormulationPackages(orders, plans) {
    const orderList = Array.isArray(orders) ? orders : [];
    const planList = Array.isArray(plans) ? plans : [];
    const claimed = new Set();
    const packages = [];

    for (const order of orderList) {
        const plan = planList.find(pl => !claimed.has(pl.id) && _planMatchesOrder(pl, order)) || null;
        if (plan) claimed.add(plan.id);
        // An active plan outranks whatever the order says. The user scanned the box; that they are
        // taking the capsules is a more useful truth than the order still sitting at 'shipped'
        // because nobody closed it out on the commerce side.
        const stage = plan && plan.status === 'active' ? 'active' : _stageFromOrderStatus(order);
        packages.push(_packageRow({ order, plan, stage }));
    }

    // The formula a waiting package could be filled with. There is at most one un-submitted
    // proposal per user (uniq_nutrition_plans_proposed), and it lives on its OWN row rather than
    // on the order's — so without this, a package that says "needs your formula" would have no
    // way to reach the formula sitting directly above it. Submitting is what binds them; until
    // then the pairing is only an offer, which is why this is a separate field and not a match.
    const submittable = planList.find(pl => !claimed.has(pl.id) && pl.status === 'proposed') || null;
    let offered = false;
    for (const pkg of packages) {
        if (!pkg.can_submit) continue;
        pkg.submit_plan_id = submittable ? Number(submittable.id) : null;
        if (submittable) offered = true;
    }

    // An order that has been placed and is still waiting for a recipe. The plan is not attached
    // until payment is confirmed (_settleFastTrackPackage), so at 'pending_payment' the two halves
    // of one journey are genuinely two rows here — and the standalone one would still be offering
    // 按此配方下单 for a package the user has already ordered.
    const awaitingFormula = packages.some(pkg => pkg.plan_id === null && AWAITING_FORMULA_STAGES.has(pkg.stage));

    // A formula with no order behind it — the chat tool's proposal before anyone has bought it,
    // which is exactly the case the Dots subtab was blindest to. Suppressed once it is spoken for:
    // either offered to a waiting package above, or already ordered against. The same formula
    // listed twice — once as a thing to buy, once as the thing that purchase is for — reads as two
    // different formulas, and the second card's only CTA would place an order that already exists.
    //
    // Note this suppresses on the order's STAGE, not on intended_nano_plan_id. That column names
    // what the buyer was looking at and is advisory (§28d) — but there is at most one un-submitted
    // proposal per user (uniq_nutrition_plans_proposed), so "an order is waiting for a formula"
    // already identifies it without trusting a link that may name a superseded plan.
    for (const plan of planList) {
        if (claimed.has(plan.id)) continue;
        if (plan.status === 'proposed' && (awaitingFormula || (offered && plan.id === submittable.id))) continue;
        packages.push(_packageRow({ order: null, plan, stage: plan.status === 'active' ? 'active' : plan.status }));
    }

    packages.sort((a, b) => {
        const ra = _STAGE_RANK[a.stage] ?? 5;
        const rb = _STAGE_RANK[b.stage] ?? 5;
        if (ra !== rb) return ra - rb;
        return new Date(b.sort_at || 0) - new Date(a.sort_at || 0);
    });
    return packages;
}

function _packageRow({ order, plan, stage }) {
    return {
        stage: PACKAGE_STAGES.has(stage) ? stage : 'compounding',
        order_id: order ? order.order_id : null,
        // The formula behind this package, if one exists yet. plan_id is what the submit and
        // label actions are keyed on, so it stays null rather than guessing.
        plan_id: plan ? Number(plan.id) : null,
        plan_status: plan ? plan.status : null,
        label_code: plan ? (plan.label_code || null) : null,
        day_index: _planDayIndex(plan),
        total_days: plan && plan.status === 'active' ? PLAN_DAYS : null,
        package_name: order ? (order.package_name || null) : null,
        tier_label: order ? (order.tier_label || null) : null,
        max_distinct_dots: order ? (order.max_distinct_dots ?? null) : null,
        fulfillment: order ? order.fulfillment : null,
        ordered_at: order ? (order.created_at || null) : null,
        shipped_at: order ? (order.shipped_at || null) : null,
        // Shown only on a shipped row; the carrier is free text for display and the number is what
        // the user copies into a courier app.
        tracking_number: order ? (order.tracking_number || null) : null,
        shipping_carrier: order ? (order.shipping_carrier || null) : null,
        tracking_status_desc: order ? (order.tracking_status_desc || null) : null,
        // The three CTAs the client renders. Derived here rather than re-derived from `stage` in
        // WXML, so the rule for "can this be acted on" lives in one place.
        can_submit: stage === 'awaiting_formulation',
        can_scan: stage === 'shipped' || stage === 'delivered',
        can_order: stage === 'proposed',
        // How wide this proposal actually is, so the client can warn before a code narrower than
        // it is spent. The WEEKLY width _countDistinctDots measures — the same number
        // handlePostFormulationSubmit compares against the purchased tier, so a warning shown
        // here and a refusal there can never disagree.
        distinct_dots: (plan && plan.status === 'proposed' && plan.proposed_recipe)
            ? _countDistinctDots(
                { dots: plan.proposed_recipe.morning || {}, weeks: plan.proposed_recipe.weeks || undefined },
                { dots: plan.proposed_recipe.evening || {}, weeks: plan.proposed_recipe.weeks || undefined })
            : null,
        // The widths this proposal was laddered for (_buildTierLadder), narrowest first — the
        // client uses it to tell the user WHICH of their formulas a code will compound instead of
        // warning them the code is too narrow. `distinct_dots` above is the base, so for a
        // laddered proposal the over-tier warning can no longer fire; it stays correct, and still
        // fires, for a proposal made before the ladder existed.
        tier_widths: (plan && plan.status === 'proposed' && Array.isArray(plan.proposed_recipe?.tiers))
            ? plan.proposed_recipe.tiers.map(t => Number(t.max_distinct_dots)).filter(w => Number.isFinite(w))
            : null,
        // Filled in by the caller for can_submit rows only: the proposal this package could be
        // filled with, which is a different plan from `plan_id` (nothing is bound until submit).
        submit_plan_id: null,
        sort_at: (order && order.created_at) || (plan && plan.created_at) || null,
    };
}

// The unredeemed codes this user owns, for the 原粒 subtab's 兑换码 section.
//
// A SIBLING of the package list, never a source for it: a code is a thing they can start, not a
// package they have. Never throws — fetchFormulationCodes already degrades to [], and the subtab
// must still render packages and the active plan when the code half is unavailable.
async function _fetchFormulationCodes(userId) {
    if (!userId) return [];
    try {
        return await fetchFormulationCodes(userId);
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: '_fetchFormulationCodes failed',
            user_id: userId, error: err.message }));
        return [];
    }
}

// The DB + GCN half. Never throws: fetchFormulationOrders degrades to [] on any failure, and a
// plan-query failure degrades the whole list to [] rather than failing the caller — the Dots
// subtab must still render the user's active plan when the order half is unavailable.
async function _fetchFormulationPackages(userId) {
    if (!userId) return [];
    try {
        const [orders, plansRes] = await Promise.all([
            fetchFormulationOrders(userId),
            pool.query(
                `SELECT id, status, start_date::text AS start_date, created_at,
                        label_code, gcn_order_id, ag_formulation_id, proposed_recipe
                   FROM nutrition_plans
                  WHERE user_id = $1 AND status IN ('proposed', 'approved', 'active')
                  ORDER BY created_at DESC
                  LIMIT 20`,
                [userId]
            ),
        ]);
        return _mergeFormulationPackages(orders, plansRes.rows);
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: '_fetchFormulationPackages failed',
            user_id: userId, error: err.message }));
        return [];
    }
}

// GET /formulation-orders?openid=   (app bearer, the user's own packages)
//
// The same list handleGetNutritionPlan embeds, on its own endpoint. It exists for the chat card:
// handleFormulaSubmit resolves the awaiting packages at TAP time rather than trusting what the
// card said when it was rendered, because the formulation turn is async and a card can be minutes
// old by the time someone acts on it — the same reason _resolveOrderContext does not cache a mode.
async function handleGetFormulationOrders(openid) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (!openid) return { success: true, packages: [] };
        const { rows: [user] } = await pool.query(
            'SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]);
        if (!user) return { success: true, packages: [] };
        return { success: true, packages: await _fetchFormulationPackages(user.user_id) };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetFormulationOrders failed', error: err.message }));
        return { success: false, error: err.message };
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

        // 2. Fallback/Legacy notification content.
        //
        // Deliberately still 'nutrition_plan' and NOT 'formulation_proposal': this field is what
        // the Plans tab renders as "the plan you are on". A Formulate-Dots proposal is explicitly
        // not that until the box is scanned, so it delivers under its own type and never lands
        // here — otherwise every proposal would repopulate the tab it is designed to stay out of.
        // Nothing writes 'nutrition_plan' any more (the top-up job that did is gone); this reads
        // pre-existing rows only.
        // 3. The rest of the fan-out, in parallel — the package list reaches out to GCN, so it
        // must not be awaited in series behind the dots query. Costs max(db, gcn), not the sum.
        const [notifyResult, dotsResult, packages, codes] = await Promise.all([
            pool.query(
                `SELECT content, sent_at FROM notifications
                 WHERE user_id = $1 AND notification_type = 'nutrition_plan'
                 ORDER BY sent_at DESC LIMIT 1`,
                [openid]
            ),
            pool.query('SELECT * FROM dots ORDER BY id ASC'),
            _fetchFormulationPackages(openid),
            _fetchFormulationCodes(openid),
        ]);

        return {
            success: true,
            plan: notifyResult.rows[0]?.content || null,
            plan_date: notifyResult.rows[0]?.sent_at || null,
            structured_plan: planData,
            schedules: schedules,
            dots: dotsResult.rows,
            // Every dots package this user has, in every state — a SIBLING of the fields above,
            // never a source for them. `plan`/`structured_plan`/`schedules` still mean "the plan
            // you are physically on" and stay 'active'-only; §28b records the live bug where a
            // proposal leaked into this tab and made it report a plan the user did not have.
            packages,
            // Unredeemed codes this user owns — a sibling of `packages` on the same terms. A code
            // is something they can start, not something they have; it becomes a package the
            // moment it is spent, at which point it drops out of this list on its own.
            codes,
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
//
// A 'proposed' plan has no schedules at all — they are generated at box-scan time — so its day 0
// is derived from proposed_recipe through the same _expandPlanDay the scan will later use. Day
// index 0 is never an N7 isolation day, so this yields exactly the steady-state capsules the rest
// of this function promises. That is what lets GCN price a formula the user has not received
// yet, which is the whole point of a proposal.
//
// KNOWN LIMIT, deliberately not changed here: since a purchased package caps distinct dots PER
// WEEK, a formula may legitimately rotate, and day 0 is then week 1 rather than the whole cycle.
// Two callers read this and neither should be silently redefined:
//
//   * GCN's per-dot checkout snapshot prices what it is given. Summing the cycle instead would
//     change what a customer is charged, which is a business decision, not a refactor — and that
//     product is now the FALLBACK path anyway (the tiered package is flat-priced, §28c).
//   * the printed box label would under-list a rotating formula, showing week 1's dots for a box
//     that physically holds all four weeks'.
//
// Both want the cycle-wide union, not a different day. Give them one when someone owns the
// pricing question; do not quietly switch day 0 to mean something else.
async function _getCommittedPlanDay0Breakdown(planId, { dotColumns = 'id, key_name, name, name_zh' } = {}) {
    const planResult = await pool.query(
        `SELECT np.id, np.user_id, np.status, np.start_date, np.start_date::text AS start_date_text,
                np.created_at, np.goal,
                np.proposed_recipe, np.label_code, np.gcn_order_id, np.submitted_to_gcn_at,
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

    let morningDots;
    let eveningDots;
    // Schedules first when the plan has any — they are what the user is actually taking. A plan
    // that never reached a box has none, so it falls back to the recipe still on the row.
    //
    // The fallback is NOT gated on status === 'proposed'. A proposal that was replaced by a newer
    // one becomes 'superseded' while still having no schedules, and gating on 'proposed' made its
    // printed label fail with plan_has_no_schedule — the label on a real box in someone's hands,
    // reading as an error the moment they formulate again. Its recipe is right there; show it, and
    // let the status field tell the reader it has been replaced.
    const scheduleResult = plan.status === 'proposed' ? { rows: [] } : await pool.query(
        `SELECT slot_name, recipe FROM nutrition_schedules
         WHERE plan_id = $1 AND scheduled_date = $2`,
        [plan.id, plan.start_date]
    );
    if (scheduleResult.rows.length > 0) {
        morningDots = scheduleResult.rows.find(r => r.slot_name === 'morning_cup')?.recipe?.dots || {};
        eveningDots = scheduleResult.rows.find(r => r.slot_name === 'evening_cup')?.recipe?.dots || {};
    } else if (plan.proposed_recipe) {
        // timing/timing_flexible/target_dots_min are NOT optional here. _fitRecipeToDailyBudget
        // reads all three — the slot a dot belongs to, whether it may be split, and the floor it
        // may never go under — so a formulary missing them yields a day 0 that disagrees with the
        // capsules the box scan will actually write. This is the printed label and the GCN
        // checkout snapshot: both must show the real formulation, not an approximation of it.
        const { rows: expansionFormulary } = await pool.query(
            `SELECT key_name, timing, timing_flexible, target_dots_min, target_dots_max,
                    dosing_protocol, pulse_days_per_cycle, pulse_cycle_days FROM dots`
        );
        const day0 = _expandPlanDay(0, _planExpansionContext(
            { dots: plan.proposed_recipe.morning || {}, weeks: plan.proposed_recipe.weeks || undefined },
            { dots: plan.proposed_recipe.evening || {}, weeks: plan.proposed_recipe.weeks || undefined },
            expansionFormulary,
        ), null);
        morningDots = day0.morning.dots;
        eveningDots = day0.evening.dots;
    } else {
        return { reason: 'plan_has_no_schedule', plan };
    }

    const dotsResult = await pool.query(`SELECT ${dotColumns} FROM dots ORDER BY id ASC`);
    const dotsByKey = new Map(dotsResult.rows.map(d => [d.key_name, d]));

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
        // 'proposed' is what the Formulate-Dots chat tool writes: a real recipe the user has not
        // been shipped yet, and precisely the thing this endpoint exists to let GCN price. An
        // 'active' plan stays valid too — a user mid-cycle can still reorder what they are on.
        // Unchanged by the label's superseded fallback above: a replaced formulation must never be
        // purchasable, even though it can now still be READ.
        if (plan.status !== 'active' && plan.status !== 'proposed') return { valid: false, reason: 'plan_not_active' };
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

// GET /formulation-label?c=WVB…   (PUBLIC — no auth)
//
// What the box QR resolves to. GCN's aeviva formulation-label.html calls this (server-side, via
// its own mall function — nano's custom domain emits a duplicate CORS header that browsers reject,
// so a direct browser fetch is not an option) and renders the page the user views on screen and
// the label printed on the box.
//
// PUBLIC on purpose, exactly like the older /api/box/{code} page it supersedes: this is a code
// printed on a physical object, so anyone holding the box can read it. That constrains what it may
// return — **no user identity of any kind**: no user_id, openid, nickname, phone, or biomarker
// value. What a stranger scanning a found box learns is what is in the box, which is what a
// nutrition label is for. The order reference is truncated the same way GCN's own label does it.
//
// Resolves a plan's own label_code first, then falls back to boxes.box_code so labels printed
// before the code moved to generation time keep working — physical objects already in the world
// cannot be re-printed.
async function handleGetFormulationLabelByCode(rawCode) {
    try {
        if (!pool) return { valid: false, reason: 'internal_error' };
        const match = /WVB[0-9A-Fa-f]{12}/.exec(String(rawCode || '').trim());
        const code = match ? match[0].toUpperCase() : null;
        if (!code) return { valid: false, reason: 'invalid_code' };

        const { rows: [plan] } = await pool.query(
            `SELECT np.id, np.status, np.created_at, np.start_date, np.end_date, np.label_code,
                    np.gcn_order_id, np.submitted_to_gcn_at,
                    b.claimed_at, b.box_code,
                    bb.status AS batch_status, bb.created_at AS batch_created_at
               FROM nutrition_plans np
               LEFT JOIN boxes b ON b.box_code = COALESCE(np.label_code, '')
               LEFT JOIN box_batches bb ON bb.id = b.batch_id
              WHERE np.label_code = $1
              LIMIT 1`,
            [code]
        );

        let planId = plan?.id;
        let boxRow = plan;
        if (!planId) {
            // A label printed from a box batch rather than from the formulation itself.
            const { rows: [box] } = await pool.query(
                `SELECT b.box_code, b.claimed_at, b.nutrition_plan_id, bb.plan_id,
                        bb.status AS batch_status, bb.created_at AS batch_created_at
                   FROM boxes b JOIN box_batches bb ON bb.id = b.batch_id
                  WHERE b.box_code = $1`,
                [code]
            );
            if (!box) return { valid: false, reason: 'not_found' };
            planId = box.nutrition_plan_id || box.plan_id;
            boxRow = box;
            if (!planId) return { valid: false, reason: 'not_found' };
        }

        const { plan: planRow, dotBreakdown, reason } = await _getCommittedPlanDay0Breakdown(planId, {
            dotColumns: 'id, key_name, key_name_zh, name, name_zh, color_hex, timing, '
                + 'sub_age_target, ingredients, ingredients_zh',
        });
        if (reason) return { valid: false, reason };

        return {
            valid: true,
            code,
            // 'proposed'  — formulated, not yet compounded. The QR exists from this moment.
            // 'approved'  — signed off by a nutrition expert, being compounded.
            // 'active'    — the box was scanned; the user is taking it.
            // 'superseded'— replaced by a newer formulation.
            status: planRow.status,
            formulated_at: planRow.created_at,
            cycle_days: PLAN_DAYS,
            cycle_capsules: PLAN_DAYS * 2,
            // Truncated, matching GCN's own label page: enough to quote to support, not the full
            // order id, on a page anyone holding the box can open.
            order_short_id: planRow.gcn_order_id ? String(planRow.gcn_order_id).slice(0, 8) : null,
            ordered_at: planRow.submitted_to_gcn_at || null,
            manufactured_at: boxRow?.batch_created_at || null,
            recalled: boxRow?.batch_status === 'recalled',
            claimed_at: boxRow?.claimed_at || null,
            // ::text, not the DATE column: node-postgres parses a DATE at local midnight, which
            // serializes to the PREVIOUS day in UTC (CLAUDE.md §35). This is a calendar day the
            // label states, so it must be the day it says.
            started_on: planRow.status === 'active' ? planRow.start_date_text : null,
            dot_breakdown: dotBreakdown,
        };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetFormulationLabelByCode failed', error: err.message }));
        return { valid: false, reason: 'internal_error' };
    }
}

// POST /formulation-submit  { openid, plan_id }   (app bearer, the user's own action)
//
// The "buy first, formulate second" half of the custom-dots flow. The user already paid for a
// flat-priced 28-day package, GCN parked that order at 'awaiting_formulation' with no recipe, and
// this is the user confirming that the proposal the chat tool just showed them is the one to
// compound.
//
// FAST TRACK MEANS NO HUMAN EVER LOOKS AT THIS. The premium (Viva AG) package routes through a
// nutrition expert; this one goes straight to compounding, so `validateAgFormulation` below is the
// only check between a generated allocation and capsules a person swallows. A violation refuses
// the whole submission rather than repairing anything — the same reject-never-repair rule §36
// sets for an AG formula, and for the same reason: a repaired formula is one nobody authored.
//
// The expansion is rule-conformant by construction (it comes out of _expandPlanDay, which applies
// the isolation override and the fill cap), so a violation here means the expansion itself
// regressed. That is exactly the case worth catching.
async function handlePostFormulationSubmit(body) {
    const { openid } = body || {};
    const planId = parseInt(body?.plan_id, 10);
    // Which waiting package this formula is for. Optional: absent means "the one waiting", which
    // is what the auto-attach at payment time (_settleFastTrackPackage) and every single-package
    // user send. Present only when the user was shown a choice and made one.
    const targetOrderId = body?.order_id ? String(body.order_id) : null;
    if (!openid) return { success: false, reason: 'missing_params' };
    if (!Number.isFinite(planId)) return { success: false, reason: 'invalid_plan_id' };

    try {
        if (!pool) return { success: false, reason: 'internal_error' };

        const { rows: [user] } = await pool.query(
            'SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]);
        if (!user) return { success: false, reason: 'user_not_found' };

        const { rows: [plan] } = await pool.query(
            `SELECT id, user_id, status, goal, proposed_recipe, gcn_order_id
               FROM nutrition_plans WHERE id = $1`, [planId]);
        if (!plan) return { success: false, reason: 'plan_not_found' };
        if (plan.user_id !== user.user_id) return { success: false, reason: 'plan_owner_mismatch' };
        // Idempotent: a double tap returns the order the first tap attached to rather than
        // submitting a second formula for the same purchase.
        if (plan.gcn_order_id) return { success: true, already_submitted: true, order_id: plan.gcn_order_id };
        if (plan.status !== 'proposed') return { success: false, reason: 'plan_not_proposed' };
        if (!plan.proposed_recipe) return { success: false, reason: 'plan_has_no_recipe' };

        // Re-checked here rather than trusted from the card the user tapped: the card was rendered
        // when the formulation finished, and the order could have been refunded, cancelled or
        // already fulfilled by a Viva AG run in the meantime.
        const awaiting = _awaitingOrders(await fetchFormulationOrders(user.user_id));
        if (awaiting.length === 0) return { success: false, reason: 'no_awaiting_order' };
        // A named order must still be one of THIS user's waiting packages — the list was fetched
        // for user.user_id, so an id belonging to anyone else simply is not in it. GCN re-checks
        // ownership the same way rather than trusting the id we pass on.
        const order = targetOrderId
            ? awaiting.find(o => String(o.order_id) === targetOrderId)
            : awaiting[0];
        if (!order) return { success: false, reason: 'order_not_available' };
        if (order.fulfillment !== 'fast_track') return { success: false, reason: 'order_requires_expert_review' };

        // Which formula of the ladder this package bought. A single-recipe proposal returns its
        // own recipe here, so everything below is unchanged for one.
        const selected = _selectTierVariant(plan.proposed_recipe, order.max_distinct_dots);
        if (selected.variant) {
            console.log(JSON.stringify({ level: 'INFO', msg: 'formulation tier variant selected',
                user_id: user.user_id, plan_id: planId,
                variant_width: selected.variant.max_distinct_dots, order_max: order.max_distinct_dots }));
        }

        // The purchased tier binds here too, not only at proposal time. A plan proposed BEFORE the
        // package was bought was capped by nothing (there was no order to read a tier from), and
        // it is still a 'proposed' plan this endpoint would happily submit. Refused rather than
        // trimmed: the same reject-never-repair rule the validator below follows, and for the same
        // reason — a formula the user never saw is one nobody authored. Re-running 营养定制 now
        // produces one built for the tier, which is a better formula than this one minus a dot.
        if (order.max_distinct_dots) {
            const distinct = _countDistinctDots(selected.morning, selected.evening);
            if (distinct > order.max_distinct_dots) {
                return { success: false, reason: 'formulation_exceeds_package',
                    distinct_dots: distinct, max_distinct_dots: order.max_distinct_dots,
                    package_name: order.package_name || null };
            }
        }

        // timing/timing_flexible are read by validateAgFormulation's slot rules, not by the
        // expansion — omitting them makes the validator silently weaker, not louder.
        const { rows: formulary } = await pool.query(
            `SELECT key_name, timing, timing_flexible, target_dots_min, target_dots_max,
                    dosing_protocol, pulse_days_per_cycle, pulse_cycle_days FROM dots`);
        const capsules = _expandProposalToCapsules(selected.morning, selected.evening, formulary);
        const check = validateAgFormulation({ capsules }, formulary);
        if (!check.valid) {
            console.error(JSON.stringify({ level: 'ERROR', msg: 'fasttrack_formulation_invalid',
                user_id: user.user_id, plan_id: planId, violations: check.violations }));
            return { success: false, reason: 'formulation_invalid', violations: check.violations };
        }
        // The validator already computed these over the exact capsules it approved; recomputing
        // them separately would let the numbers GCN prints drift from the numbers nano checked.
        const { totals, totalDots } = check;

        let result;
        try {
            result = await submitFastTrackFormulation({
                nano_user_id: user.user_id,
                nano_nutrition_plan_id: plan.id,
                capsules,
                totals,
                total_dots: totalDots ?? null,
                rationale: plan.goal || null,
                // Always sent, even when the user made no choice: the order was resolved above and
                // naming it removes the window where GCN's own oldest-first tie-break picks a
                // different package than the tier check just ran against.
                order_id: order.order_id,
            });
        } catch (err) {
            // Unlike the two read paths, this failure must reach the user: the entire point of the
            // tap was the call, and silently succeeding would leave them believing their paid
            // order is being compounded when GCN never heard about it.
            console.error(JSON.stringify({ level: 'ERROR', msg: 'fasttrack_submit_failed',
                user_id: user.user_id, plan_id: planId, error: err.message, status: err.status }));
            await pool.query('UPDATE nutrition_plans SET submitted_to_gcn_at = NOW() WHERE id = $1', [planId]);
            return { success: false, reason: err.body?.error || 'gcn_unreachable' };
        }
        if (!result || !result.order_id) return { success: false, reason: result?.reason || 'no_awaiting_order' };

        // Collapsed back to a single recipe in the same write that binds it to the order: from
        // here the plan means "these capsules are being compounded", and the box scan, the printed
        // label and the checkout snapshot must all read the variant that was actually submitted
        // rather than the base the ladder was stored around.
        const collapsed = selected.variant
            ? JSON.stringify({
                morning: selected.morning.dots || {},
                evening: selected.evening.dots || {},
                ...(selected.morning.weeks ? { weeks: selected.morning.weeks } : {}),
            })
            : null;
        await pool.query(
            `UPDATE nutrition_plans
                SET gcn_order_id = $2, submitted_to_gcn_at = NOW(),
                    proposed_recipe = COALESCE($3::jsonb, proposed_recipe)
              WHERE id = $1`,
            [planId, String(result.order_id), collapsed]);
        console.log(JSON.stringify({ level: 'INFO', msg: 'fasttrack formulation submitted',
            user_id: user.user_id, plan_id: planId, order_id: result.order_id }));
        return { success: true, order_id: result.order_id };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostFormulationSubmit failed', error: err.message }));
        return { success: false, reason: 'internal_error' };
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
// GCN's sku/product names are jsonb ({zh, en}) and are legitimately empty on some rows.
function _flattenSkuName(name) {
    if (!name) return null;
    if (typeof name === 'string') return name || null;
    return name.zh || name.en || null;
}

// POST /formulation-redeem  { openid, code, plan_id?, shipping_name, shipping_phone,
//                              shipping_address }   (app bearer, the user's own action)
//
// Spending a prepaid 28-day code from inside the Mini Program, instead of bouncing the user out to
// GCN's storefront to do it. The codes themselves live entirely on GCN's side (§28e) — nano keeps
// no code table and must not grow one, because every "is a package waiting for me" answer in this
// flow already comes from one source, fetchFormulationOrders, and a second source would have to be
// merged into all three of its call sites.
//
// IT DOES NOT SUBMIT THE FORMULA, deliberately, even though a proposal is usually on screen when
// this is tapped. GCN's own payment confirmation notifies /formulation-purchase-confirmed, which
// runs _settleFastTrackPackage — the code that already attempts the submit, already falls back to
// the over-tier message, and already owns the chat message either way. Submitting here as well
// would race it, and would leave that function (told nothing about a plan) nudging the user to go
// formulate something they just did. `plan_id` is passed to GCN as the intent instead, and comes
// back to us through that notify.
async function handlePostFormulationRedeem(body) {
    const { openid } = body || {};
    if (!openid) return { success: false, reason: 'missing_params' };

    const code = String(body?.code || '').trim();
    if (!code) return { success: false, reason: 'code_required' };

    // Mandatory on GCN's side and worth refusing here too: the box physically ships and there is
    // no payment step afterwards to come back and collect an address on.
    const shipping = {
        recipient_name: String(body?.shipping_name || '').trim(),
        recipient_phone: String(body?.shipping_phone || '').trim(),
        shipping_address: String(body?.shipping_address || '').trim(),
    };
    if (!shipping.recipient_name || !shipping.recipient_phone || !shipping.shipping_address) {
        return { success: false, reason: 'shipping_required' };
    }

    try {
        if (!pool) return { success: false, reason: 'internal_error' };

        const { rows: [user] } = await pool.query(
            'SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]);
        if (!user) return { success: false, reason: 'user_not_found' };

        // Only ever this user's own proposal, and only a live one. A bad or foreign id is dropped
        // rather than refused: it is advisory downstream, and losing the auto-submit is a far
        // smaller harm than refusing to spend a code the user is entitled to spend.
        let intendedPlanId = null;
        const planId = parseInt(body?.plan_id, 10);
        if (Number.isFinite(planId)) {
            const { rows: [plan] } = await pool.query(
                `SELECT id FROM nutrition_plans
                  WHERE id = $1 AND user_id = $2 AND status = 'proposed'`,
                [planId, user.user_id]);
            if (plan) intendedPlanId = plan.id;
        }

        let result;
        try {
            result = await redeemFormulationCode({
                nano_user_id: user.user_id,
                code,
                intended_nano_plan_id: intendedPlanId,
                ...shipping,
            });
        } catch (err) {
            // Every refusal GCN makes is a real answer the user needs to see verbatim — a code
            // already spent reads completely differently from one that was never bought. Only a
            // transport failure degrades to a generic reason.
            console.error(JSON.stringify({ level: 'ERROR', msg: 'formulation_redeem_failed',
                user_id: user.user_id, error: err.message, status: err.status,
                gcn_error: err.body?.error }));
            return { success: false, reason: err.body?.error || 'gcn_unreachable' };
        }

        console.log(JSON.stringify({ level: 'INFO', msg: 'formulation code redeemed',
            user_id: user.user_id, order_id: result?.order_id, plan_id: intendedPlanId,
            warning: result?.warning || null }));
        return {
            success: true,
            order_id: result?.order_id || null,
            // GCN returns skus.name, which is a jsonb object and is routinely {} on these rows.
            // Flattened here so nothing downstream can render it as [object Object].
            package_name: _flattenSkuName(result?.package_name),
            max_distinct_dots: result?.max_distinct_dots ?? null,
            // GCN burned the code but could not confirm the order (its own 202). The package is
            // recoverable by an admin, and saying so is better than a success the user cannot see
            // the result of.
            pending_confirmation: result?.warning === 'redeemed_but_not_confirmed',
        };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostFormulationRedeem failed',
            error: err.message }));
        return { success: false, reason: 'internal_error' };
    }
}

// Everything the delivery step needs to know about a paid package this user is already holding,
// resolved by asking GCN. Two things come out of one call because they answer the same question
// and must agree with each other:
//
//   mode             which call to action the formula card carries. See _buildFormulaChartBlock's
//                    `#order` note for what each means and why an unknown answer degrades to
//                    'buy'.
//   maxDistinctDots  the tier the user actually bought — how many distinct dots their formula may
//                    contain (GCN's migration_0085). null when no package is waiting, or for a
//                    package with no tier, in which case the formulation is not capped.
async function _resolveOrderContext(userId) {
    const awaiting = _awaitingOrders(await fetchFormulationOrders(userId));
    if (awaiting.length === 0) return { mode: 'buy', maxDistinctDots: null, packageName: null, awaitingCount: 0 };
    // The OLDEST, deliberately — that is the one GCN's _attachRecipeToAwaitingOrder will pick when
    // no order_id is named, so the tier this preview is built against is the tier it would
    // actually be submitted against. Preferring a fast-track order over an older expert-review one
    // would make the card promise a submission GCN then refuses.
    const order = awaiting[0];
    return {
        mode: order.fulfillment === 'fast_track' ? 'submit' : 'ag',
        // Only a fast-track package's tier binds this user's own formulation. An expert-review
        // package is formulated by Viva AG against its own contract, and nothing the chat tool
        // proposes for it is ever submitted, so applying a cap there would only distort a preview.
        maxDistinctDots: order.fulfillment === 'fast_track' ? (order.max_distinct_dots ?? null) : null,
        packageName: order.package_name || null,
        awaitingCount: awaiting.length,
    };
}

// The packages waiting for a recipe, OLDEST FIRST. The order matters: GCN returns newest-first for
// display, but its attach path resolves ties oldest-first, so anything that has to agree with what
// GCN will actually do must re-sort. Not doing this is how a picker and a submission end up
// naming two different packages.
function _awaitingOrders(orders) {
    return (Array.isArray(orders) ? orders : [])
        .filter(o => o && o.status === 'awaiting_formulation')
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
}

// Groups the 28 days of a cycle by what a day's capsules actually contain.
//
// Almost every day of a plan is identical — the only per-day variation is the DOT-N7 isolation
// override (both capsules are N7 alone on N7_ISOLATION_DAY_INDEXES) and, in principle, any other
// pulse-protocol dot's active window. Enumerating 28 near-identical rows in a chat bubble is
// noise, so days that expand to the same two capsules are collapsed into one group carrying the
// day numbers it covers.
//
// `dateISO` is deliberately absent: a proposal has no start date yet (the cycle is anchored when
// the box is scanned), so day numbers here are relative — "Day 1" is the first day the user takes
// a capsule, whenever that turns out to be. See _expandPlanDay for what that costs.
function _planDayGroups(morningRecipe, eveningRecipe, dotsFormulary) {
    const ctx = _planExpansionContext(morningRecipe, eveningRecipe, dotsFormulary);
    const groups = [];
    const bySignature = new Map();
    for (let i = 0; i < PLAN_DAYS; i++) {
        const day = _expandPlanDay(i, ctx, null);
        // Key on the capsule contents themselves, so two days group together exactly when they
        // are genuinely the same dose — never on which rule happened to produce them.
        const signature = JSON.stringify([day.morning.dots, day.evening.dots]);
        const existing = bySignature.get(signature);
        if (existing) { existing.days.push(i + 1); continue; }
        const group = { days: [i + 1], morning: day.morning, evening: day.evening, kind: day.isN7 ? 'n7' : 'regular' };
        bySignature.set(signature, group);
        groups.push(group);
    }
    return groups;
}

// [1,2,3,5,9,10] -> "1-3,5,9-10". Numbers only: the renderer owns the "Day N" / "第N天" wording,
// because this module has no language context and must not hardcode one.
function _formatDayRanges(days) {
    const sorted = [...days].sort((a, b) => a - b);
    const parts = [];
    let runStart = sorted[0];
    let prev = sorted[0];
    for (let i = 1; i <= sorted.length; i++) {
        const d = sorted[i];
        if (d === prev + 1) { prev = d; continue; }
        parts.push(runStart === prev ? `${runStart}` : `${runStart}-${prev}`);
        runStart = d;
        prev = d;
    }
    return parts.join(',');
}

// A rung's pitch is one line under a two-dot list in a chat bubble, not a paragraph. Capped
// server-side rather than only asked for in the prompt, because a model that ignores the word
// limit would otherwise push the card's CTA off the screen.
const RUNG_PITCH_MAX = 90;

// Sanitises a rung's model-authored pitch, and DROPS it outright if it names a dot that is not in
// that rung.
//
// The model writes the copy but the server decides membership, from the tier tags — and live dev
// testing (2026-09-07) caught the two disagreeing on the first real run: a pitch reading "加配肠道
// 焕新与脉络畅流" sat above a rung holding 脉络畅流 and 心血管信号, while the rung below it named
// 抗氧化盾, a dot the formulation did not contain at all. The model had narrated the split it meant
// and then tagged a different one.
//
// The prompt now asks for benefit-framed copy that names no dots (the card lists them on the very
// next line, so naming them was redundant even when it was right). This is the backstop, and it
// drops rather than repairs: an unlabelled rung is a rung, but a rung promising a dot the user will
// not receive is the one thing on this card the server would otherwise have let the model assert.
function _rungPitch(rung, dotsFormulary) {
    const pitch = String(rung.pitch || '').replace(/\|/g, '/').replace(/[\r\n]+/g, ' ').trim().slice(0, RUNG_PITCH_MAX);
    if (!pitch) return '';
    const mine = new Set((rung.added || []).map(a => a.key));
    for (const dot of dotsFormulary || []) {
        if (mine.has(dot.key_name)) continue;
        // Both display names and the conversational key ("原粒13号"), which is how the prompt tells
        // the model to refer to a dot in prose.
        for (const alias of [dot.name_zh, dot.name, dot.key_name_zh]) {
            if (alias && String(alias).length >= 2 && pitch.includes(alias)) return '';
        }
    }
    return pitch;
}

// Renders the :::formula card for a validated allocation.
//
// The SERVER writes every row, from the recipe it just validated — the model never authors this
// block, so the bars can never disagree with the numbers they draw. Every total is derived in the
// renderer, so the arithmetic lives in exactly one place.
//
// Row format (unchanged, and still the only thing a legacy card in chat history contains):
//   key|name|color|am|pm
//
// Meta lines were added when the card became a 28-day proposal rather than a single steady-state
// day. They are all prefixed '#', which no dot key can start with, so a card saved before this
// change simply has none of them and renders as one unlabelled group exactly as it used to:
//   #cycle|<days>|<capsules>   the cycle length, for the footer
//   #plan|<id>                 the nutrition_plans row this proposes, enabling the store CTA
//   #order|<mode>              which call to action this card gets (see below)
//   #label|<url>               the formulation's QR/label page — the same GCN aeviva link that
//                              gets printed on the box and scanned to activate it
//   #day|<ranges>|<kind>       starts a group; every row after it belongs to that group
//   #rung|<label>|<width>|<pitch>
//                              an UPGRADE rung: the rows after it are the dots a wider package
//                              would add on top of everything above. Only ever present in 'buy'
//                              mode (see below) — a user who already paid holds a fixed tier and
//                              cannot upgrade that order.
//
// A custom-dots order can be placed in either sequence, and the card is where the difference
// shows. `#order` is the mode:
//   buy      no paid package waiting — offer to order this formulation. The default, and what a
//            failed/absent order lookup degrades to: a buy button someone has already paid past
//            is ignorable, whereas a submit button with no order behind it fails on tap.
//   submit   a paid fast-track package is waiting — offer to confirm THIS formula for compounding.
//   ag       a paid premium package is waiting, and Viva AG formulates that one after expert
//            review. No CTA at all: this card is a preview, and tapping anything here would
//            compete with the pipeline that actually owns the order.
function _buildFormulaChartBlock(morningRecipe, eveningRecipe, dotsFormulary, lang, opts) {
    const isZh = (lang || 'zh') !== 'en';
    const groups = _planDayGroups(morningRecipe, eveningRecipe, dotsFormulary);
    const lines = [`#cycle|${PLAN_DAYS}|${PLAN_DAYS * 2}`];
    if (opts && opts.planId) lines.push(`#plan|${opts.planId}`);
    if (opts && opts.orderMode) lines.push(`#order|${opts.orderMode}`);
    // A URL, not a bare code: the miniapp opens it in a webview rather than drawing a QR itself,
    // so what the user sees on screen is byte-for-byte the page that prints on the box.
    if (opts && opts.labelCode) lines.push(`#label|${_formulationLabelUrl(opts.labelCode)}`);

    let anyRow = false;
    for (const group of groups) {
        const rows = [];
        for (const dot of dotsFormulary || []) {
            const am = group.morning.dots[dot.key_name] || 0;
            const pm = group.evening.dots[dot.key_name] || 0;
            if (am === 0 && pm === 0) continue;
            const name = (isZh ? (dot.name_zh || dot.name) : (dot.name || dot.name_zh)) || dot.key_name;
            // Pipes would break the row split, and a dot name is admin-editable free text.
            const safeName = String(name).replace(/\|/g, '/');
            rows.push(`${dot.key_name}|${safeName}|${dot.color_hex || ''}|${am}|${pm}`);
        }
        if (!rows.length) continue;
        anyRow = true;
        lines.push(`#day|${_formatDayRanges(group.days)}|${group.kind}`);
        lines.push(...rows);
    }
    if (!anyRow) return '';

    // The upgrade ladder, appended after the day groups it builds on. Rows reuse the same
    // key|name|color|am|pm shape, so the renderer's swatch/name/number code is shared and a rung
    // cannot drift from the chart above it. The pitch is the one model-authored string on this
    // card and is sanitised exactly like _buildProductCardBlock's reason: pipes would break the
    // row split and a newline would break the line split.
    for (const rung of (opts && opts.rungs) || []) {
        const rows = [];
        for (const add of rung.added || []) {
            const dot = (dotsFormulary || []).find(d => d.key_name === add.key);
            if (!dot) continue;
            const name = (isZh ? (dot.name_zh || dot.name) : (dot.name || dot.name_zh)) || dot.key_name;
            // A 6th field, only when the dot does NOT run all four weeks: a width caps a week, so
            // an upgrade can be two extra dots every week or the same dot for two more weeks, and
            // the user is paying for the difference. Absent means all four, which is what every
            // row written before rotation reached the rungs contains.
            const weeks = Array.isArray(add.weeks) && add.weeks.length && add.weeks.length < PLAN_WEEKS
                ? `|${add.weeks.join(',')}` : '';
            rows.push(`${dot.key_name}|${String(name).replace(/\|/g, '/')}|${dot.color_hex || ''}|${add.am || 0}|${add.pm || 0}${weeks}`);
        }
        if (!rows.length) continue;
        const label = String(rung.tier_label || '').replace(/\|/g, '/').replace(/[\r\n]+/g, ' ').trim();
        const pitch = _rungPitch(rung, dotsFormulary);
        lines.push(`#rung|${label}|${rung.max_distinct_dots}|${pitch}`);
        lines.push(...rows);
    }
    return `\n\n:::formula\n${lines.join('\n')}\n:::`;
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

// Lays a day's dots into the two capsules so both hold as close to the same number as the
// timing-locked dots allow.
//
// _splitDotTiming decides one dot at a time and cannot see the day, so it produced whatever total
// fell out: a real dev proposal (2026-09-07) came back 71 in the morning against 31 in the
// evening, purely because four of its six dots happen to default to Morning. Both capsules fit
// under MAX_DOTS_PER_CAPSULE, so _fitRecipeToDailyBudget — which only ever acts under capsule
// pressure — correctly left it alone. Nothing was wrong with it except that one capsule was more
// than twice the other, which is the half the user actually has to swallow.
//
// Two stages, in this order, and only the first is a constraint:
//
//   1. TIMING-LOCKED DOTS FIRST, whole, into their own capsule. A dot with timing_flexible=false
//      (today DOT-N3 静心夜 evening, DOT-N4 持续精力 and DOT-N12 敏锐心智 morning) has a real
//      diurnal reason to be where it is, lib/agFormulation.js's `slot_violation` rule rejects any
//      formula that moves one, and nothing below may touch them. They set the two capsules'
//      starting weights — so a day whose morning is mostly locked stays a heavier morning, and
//      that is the one thing this function will not correct.
//   2. FLEXIBLE DOTS EVEN OUT WHAT IS LEFT. `timing` on a flexible dot is a default, not a
//      requirement — the column means 早晚皆可，可自由拆分, and it is rendered to the model in
//      exactly those words — so the heavier capsule hands dose across, largest dot first, until
//      the two meet. A dot may end up wholly in its non-default capsule; that is what being
//      flexible means, and a dot for which it is not true is a dot that should be marked
//      timing_flexible = false instead.
//
// The move is bounded by half the gap, so the two capsules can meet but never cross: a capsule
// only ever gets closer to the other, and the worst capsule is never made worse than it came in.
// Largest dot first, so the fewest dots are disturbed and at most one is split.
//
// It never changes a daily total, only where in the day it is taken. So it cannot underdose a dot
// (lib/agFormulation.js checks the daily total), cannot change which dots are in the formula, and
// cannot change what a tier counts. An over-budget day is _fitRecipeToDailyBudget's to settle,
// and it runs first.
function _balanceCapsules(morningRecipe, eveningRecipe, dotsFormulary) {
    const byKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));
    const inMorning = { ...(morningRecipe?.dots || {}) };
    const inEvening = { ...(eveningRecipe?.dots || {}) };
    // weeks/levels/order ride through untouched: this decides slots, nothing else, and the tier
    // trim and the daily budget both still need the formulator's ranking afterwards.
    const carry = {};
    const weeks = morningRecipe?.weeks || eveningRecipe?.weeks;
    const levels = _levelsOf(morningRecipe, eveningRecipe);
    const order = _orderOf(morningRecipe, eveningRecipe);
    if (weeks) carry.weeks = weeks;
    if (levels) carry.levels = levels;
    if (order) carry.order = order;
    const asResult = (m, e) => ({ morning: { dots: m, ...carry }, evening: { dots: e, ...carry } });

    const totals = new Map();
    for (const [key, count] of [...Object.entries(inMorning), ...Object.entries(inEvening)]) {
        if (count > 0) totals.set(key, (totals.get(key) || 0) + count);
    }
    const dotOf = key => byKey.get(key) || {};
    // Same fallback as _fitRecipeToDailyBudget's, and for the same reason: a dot the formulary
    // does not describe stays where the CALLER put it. Defaulting to the morning would collapse a
    // whole recipe into one capsule the moment a SELECT omits `timing`.
    const slotOf = (key) => {
        const timing = dotOf(key).timing;
        if (timing === 'Evening') return 'evening';
        if (timing === 'Morning') return 'morning';
        return (inEvening[key] || 0) > (inMorning[key] || 0) ? 'evening' : 'morning';
    };

    // Stage 1, plus each flexible dot's own default slot, which is where it starts.
    const morning = {}, evening = {};
    const flexible = [];
    for (const [key, total] of totals) {
        const own = slotOf(key) === 'evening' ? evening : morning;
        own[key] = total;
        if (dotOf(key).timing_flexible) flexible.push(key);
    }
    const sum = obj => Object.values(obj).reduce((a, b) => a + b, 0);
    if (flexible.length === 0) return asResult(morning, evening);

    // Stage 2. Only a dot sitting in the HEAVIER capsule can help; moving one narrows the gap by
    // two, so half the gap is the whole budget.
    const heavyIsMorning = sum(morning) > sum(evening);
    const from = heavyIsMorning ? morning : evening;
    const to = heavyIsMorning ? evening : morning;
    const heavySlot = heavyIsMorning ? 'morning' : 'evening';
    let budget = Math.floor((sum(from) - sum(to)) / 2);
    const movable = flexible
        .filter(key => slotOf(key) === heavySlot)
        .sort((a, b) => (totals.get(b) - totals.get(a)) || (a < b ? -1 : 1));
    for (const key of movable) {
        if (budget <= 0) break;
        const move = Math.min(from[key], budget);
        if (move <= 0) continue;
        from[key] -= move;
        to[key] = (to[key] || 0) + move;
        if (from[key] === 0) delete from[key];
        budget -= move;
    }
    return asResult(morning, evening);
}

// Fixed reference point for pulse-cycle math (migration_dots_dosing_protocol.sql) — arbitrary,
// just needs to never change once dots start relying on it, so a pulse dot's active window is a
// pure function of the calendar date, never of when a plan happens to be (re)generated. Without
// this, reformulating mid-cycle could shift or duplicate a dot's "2 consecutive days" window.
const PULSE_CYCLE_EPOCH = DateTime.fromISO('2026-01-01');

// True if `dateISO` falls inside a pulse-protocol dot's active window. Non-pulse dots ('daily',
// the default) are always active — this is the single gate _expandPlanDay uses to decide
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
// taken ON an active day), the expansion just no longer copies that count into every day
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

// Expands a steady-state proposal into the canonical 56-capsule array the rest of the product
// speaks: [{day:1..28, slot:'AM'|'PM', dots:{KEY:count}}]. Identical shape to what the external
// Viva AG agent submits, so GCN's processing centre, its printed label QR and nano's own
// validator all read one format regardless of which pipeline produced the formula.
//
// Days are 1-based here and 0-based in _expandPlanDay, matching each side's own convention.
function _expandProposalToCapsules(morningRecipe, eveningRecipe, dotsFormulary) {
    const ctx = _planExpansionContext(morningRecipe, eveningRecipe, dotsFormulary);
    const capsules = [];
    for (let i = 0; i < PLAN_DAYS; i++) {
        const day = _expandPlanDay(i, ctx, null);
        capsules.push({ day: i + 1, slot: 'AM', dots: { ...day.morning.dots } });
        capsules.push({ day: i + 1, slot: 'PM', dots: { ...day.evening.dots } });
    }
    return canonicalizeCapsules(capsules);
}

// ── The weekly dimension ───────────────────────────────────────────────────────────────────────
//
// A purchased package caps how many distinct dots may appear in ONE WEEK, not in the cycle — so
// weeks may legitimately differ, and a formula may rotate other dots in next week up to the same
// per-week limit. That is the whole reason a recipe has a week dimension at all.
//
// It rides on the recipe object as an OPTIONAL `weeks` map, `{ 'DOT-N1': [1, 2] }`, alongside the
// `dots` counts it already carried. A key that names no weeks is in EVERY week, which is what
// makes this backward compatible in both directions: a stored proposal written before this
// existed, a completion from a stale cached prompt, and the deterministic fallback formulator all
// produce four identical weeks — exactly today's behaviour — without a migration or a shape check.

// 1-based week for a 0-based day index. Clamped, so a cycle length that is not a whole number of
// weeks puts the ragged tail in the last week rather than inventing a fifth.
function _weekOfDayIndex(dayIndex) {
    return Math.min(PLAN_WEEKS, Math.floor(dayIndex / DAYS_PER_WEEK) + 1);
}

// Per-dot week membership for a recipe PAIR. Membership is a property of the formula, not of one
// capsule, so both slots are read and merged — callers set the same map on both.
//
// A malformed or empty list is treated as "no constraint", never as "no weeks". The safe direction
// is the one that cannot silently delete a dose the formulator asked for: an over-wide membership
// is then trimmed by _capDistinctDots against the real tier, whereas an empty one would drop the
// dot with nothing to notice it.
function _weekMembership(morningRecipe, eveningRecipe) {
    const out = new Map();
    for (const src of [morningRecipe?.weeks, eveningRecipe?.weeks]) {
        for (const [key, weeks] of Object.entries(src || {})) {
            const valid = [...new Set((Array.isArray(weeks) ? weeks : [])
                .map(w => Math.round(Number(w)))
                .filter(w => Number.isFinite(w) && w >= 1 && w <= PLAN_WEEKS))].sort((a, b) => a - b);
            if (valid.length) out.set(key, valid);
        }
    }
    return out;
}

// The slice of a recipe that is actually taken in `week`.
function _recipeForWeek(recipe, membership, week) {
    const dots = {};
    for (const [key, count] of Object.entries(recipe?.dots || {})) {
        const weeks = membership.get(key);
        if (weeks && !weeks.includes(week)) continue;
        dots[key] = count;
    }
    return { dots };
}

// The distinct non-N7 dots active in `week`.
function _keysInWeek(morningRecipe, eveningRecipe, membership, week) {
    const keys = new Set();
    for (const recipe of [morningRecipe, eveningRecipe]) {
        for (const [key, count] of Object.entries(recipe?.dots || {})) {
            if (key === N7_KEY || !(count > 0)) continue;
            const weeks = membership.get(key);
            if (weeks && !weeks.includes(week)) continue;
            keys.add(key);
        }
    }
    return keys;
}

// Where in its own min..max range the formulator placed a dot — 0 at its floor, 1 at its ceiling.
//
// This is how emphasis is read back out of a finished allocation: the formulator expresses "this
// one matters" by where in the range it put the count (see _fallbackCountForDot's 25/50/75%), so
// a dot sitting at its floor is the one it cared least about. Both droppers below rank on it, and
// they must rank the same way — a dot dropped for the capsule budget and a dot dropped for the
// purchased tier are the same judgement about the same recipe.
//
// SubAges key (bioage_profile) -> the dots.sub_age_target string. CLAUDE.md §11 lists both halves
// as canonical and cross-cutting; this is the join between them.
const SUB_AGE_TARGET_BY_KEY = {
    CellularAge: 'Cellular Age',
    MetabolicAge: 'Metabolic Age',
    MicroVascularAge: 'Micro-Vascular Age',
    ResilienceAge: 'Resilience Age',
};

// ── Ranking-driven formulation ──────────────────────────────────────────────────────────────
//
// The model returns an ORDERED list of the dots most relevant to this user, and the server works
// out every number from there. This inverts what came before, where the model dosed all 18 and
// the server reverse-engineered an ordering out of those doses to decide which six made the core.
//
// Why the inversion. The ordering is the thing _capDistinctDots actually needs; the doses were
// only ever a proxy for it, and a distorted one (a dot with a 1-2 range reaches "maximum
// emphasis" by moving a single pill, outranking one deliberately dosed at 30 of 9-37). Asking for
// the ordering directly also makes errors in the tail free — ranks past the widest tier are
// discarded — where a bad dose anywhere in the 18 used to skew the core.
//
// Measured 2026-09-07: across ~20 runs no model ever produced a dose between a dot's floor and
// its ceiling until levels were introduced, and none ever used the `weeks` rotation the contract
// offered (428 of 428 entries came back "all four weeks").

// Rank carries most of the weight because it is the only channel that can express a reason the
// biomarkers do not contain. DOT-N3 (静心夜) targets Resilience Age, which for a user sleeping
// 5.3h a night can sit comfortably BELOW their chronological age — severity alone would floor it,
// discarding exactly the digital-twin signal the ranking exists to carry. Severity is the
// corrective that lifts biomarker-driven dots, not the primary term.
const RANK_WEIGHT = 0.6;
const SEVERITY_WEIGHT = 0.4;
// Nothing is dosed to its absolute ceiling by this path: the capsule budget is shared, and a
// formula that maxes its first pick starves everything after it. Same position 'high' maps to.
const MAX_AUTO_POSITION = 0.9;

// How far each sub-age dimension is above chronological age, normalised so the worst dimension
// scores 1 and anything at or below chronological age scores 0. Returns null when there is no
// usable bioage at all (a user with no Kino scan), which makes dosing fall back to rank alone.
function _severityShares(bioage) {
    const chrono = Number(bioage?.ChronoAge);
    const subAges = bioage?.SubAges || {};
    if (!Number.isFinite(chrono)) return null;
    const raw = {};
    let worst = 0;
    for (const [dimKey, target] of Object.entries(SUB_AGE_TARGET_BY_KEY)) {
        const v = Number(subAges[dimKey]);
        if (!Number.isFinite(v)) continue;
        const over = Math.max(0, v - chrono);
        raw[target] = over;
        if (over > worst) worst = over;
    }
    if (Object.keys(raw).length === 0) return null;
    const out = {};
    for (const [target, over] of Object.entries(raw)) out[target] = worst > 0 ? over / worst : 0;
    return out;
}

// The daily count for one dot, given where the formulator ranked it and how elevated the
// dimension it targets is. A dot with no sub_age_target (DOT-N8, DOT-N12) has no severity to
// read, so its rank decides alone.
function _doseFromRank(dot, rankIndex, rankCount, severityShares) {
    const min = dot?.target_dots_min ?? 1;
    const max = dot?.target_dots_max ?? 10;
    if (max === min) return min;
    const n = Math.max(1, rankCount);
    const rankShare = (n - rankIndex) / n;
    const sev = severityShares && dot?.sub_age_target ? severityShares[dot.sub_age_target] : undefined;
    const blended = sev === undefined
        ? rankShare
        : (RANK_WEIGHT * rankShare) + (SEVERITY_WEIGHT * sev);
    const pos = Math.min(MAX_AUTO_POSITION, Math.max(0, blended));
    return Math.min(max, Math.max(min, Math.round(min + (max - min) * pos)));
}

// The whole formulation, from an ordered list of keys. Unknown keys are dropped rather than
// guessed at, and DOT-N7 is removed wherever it appears — its dosing is system-controlled
// (isolation days), so a rank for it would be read and then ignored.
function _doseFromRanking(rankedKeys, dotsFormulary, bioage) {
    const byKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));
    const seen = new Set();
    const ordered = [];
    for (const raw of rankedKeys || []) {
        const key = String(raw || '').replace(/^D-/, 'DOT-');
        if (key === N7_KEY || seen.has(key) || !byKey.has(key)) continue;
        seen.add(key);
        ordered.push(key);
    }
    const shares = _severityShares(bioage);
    const out = new Map();
    ordered.forEach((key, i) => {
        out.set(key, _doseFromRank(byKey.get(key), i, ordered.length, shares));
    });
    return out;
}

// The same ordering computed with no model at all: most-elevated dimension first, then whichever
// dots an active health-plan focus recommends, then by key so it is deterministic. This is what
// makes a fully offline fallback possible, and it doubles as the baseline the model's own
// ranking is logged against — a disagreement nobody can defend is visible immediately.
function _rankDotsBySeverity(dotsFormulary, bioage, recommendedKeySet) {
    const shares = _severityShares(bioage) || {};
    const score = (dot) => {
        const sev = dot.sub_age_target ? (shares[dot.sub_age_target] ?? 0) : 0;
        const focus = recommendedKeySet && recommendedKeySet.has(dot.key_name) ? 0.15 : 0;
        return sev + focus;
    };
    return (dotsFormulary || [])
        .filter(d => d.key_name !== N7_KEY)
        .map(d => ({ d, s: score(d) }))
        .sort((a, b) => (b.s - a.s) || (a.d.key_name < b.d.key_name ? -1 : 1))
        .map(({ d }) => d.key_name);
}

// How the formulator states dose: a level, not a number.
//
// Asking for a raw count inside each dot's own range made the model do 17 range lookups across
// ranges spanning two orders of magnitude (1-2 for DOT-N1, 28-87 for DOT-N17), and measured
// 2026-09-07 it simply did not: every variable-range dose landed on the floor or the ceiling and
// never in between (qwen-plus 11/4/0, qwen-max 15/0/0 across two runs each). A level removes the
// arithmetic, cannot be out of range, and — because every level maps to the SAME position in
// every dot's range — makes emphasis comparable between a dot with a 2-value range and one with
// a 60-value range, which a raw count never was.
//
// 'low' is included-but-not-a-focus, NOT absent: the formulation rules have always kept dots
// unrelated to a user's abnormal markers at their floor, and the tier cap and daily budget are
// what remove them later. 'none' is the explicit exclusion.
const DOSE_LEVELS = ['none', 'low', 'moderate', 'high'];
const LEVEL_POSITION = { none: 0, low: 0, moderate: 0.5, high: 0.9 };

function _countForLevel(dot, level) {
    if (level === 'none') return 0;
    const min = dot?.target_dots_min ?? 1;
    const max = dot?.target_dots_max ?? 10;
    const pos = LEVEL_POSITION[level];
    if (pos === undefined) return null; // unknown level — caller falls back to a raw count
    return Math.min(max, Math.max(min, Math.round(min + (max - min) * pos)));
}

// The formulator's own ordering, best first, when the recipe was built from a ranking.
//
// This has to travel with the recipe rather than being re-derived from the counts, and that is
// not a refinement — it is the difference between the ranking deciding the core and it not.
// Measured 2026-09-07: DOT-N3 ranked THIRD came back as a count of 2 in a 2-3 range, whose
// derived position is 0.0 — dead last — while DOT-N14 ranked ninth landed at 8 in a 7-17 range,
// position 0.1. The core six that reached the card had dropped the third-ranked dot and kept the
// ninth. Rounding erases rank on any narrow range, so the rank is carried, not recomputed.
function _orderOf(morningRecipe, eveningRecipe) {
    const o = (morningRecipe && morningRecipe.order) || (eveningRecipe && eveningRecipe.order);
    return Array.isArray(o) && o.length ? o : null;
}

// Reads a recipe's declared levels, whichever half carries them. Levels ride on the recipe next
// to `weeks` so the signal survives every transform between the model's reply and the ranking
// that consumes it, without a parallel argument threaded through four call sites.
function _levelsOf(morningRecipe, eveningRecipe) {
    return (morningRecipe && morningRecipe.levels) || (eveningRecipe && eveningRecipe.levels) || null;
}

// A fixed-range dot (min === max) has NO emphasis to read — its count was never a choice — so it
// scores neutral. It used to score 1 (fully emphasised, dropped last), which was wrong in the one
// place it matters: DOT-N8 (明眸) and DOT-N10 (肌光焕采) both have min = max = 1, so they
// outranked every genuinely prioritised dot and took slots in the essential six. Measured live
// 2026-09-07 against a real profile: 明眸 displaced a cellular dot from the base while the
// formulator had pushed DOT-N6/DOT-N9 to their ceilings. Neutral puts a fixed-dose dot below
// anything actually emphasised and above anything left at its floor, which is what "no signal"
// should mean.
const NEUTRAL_EMPHASIS = 0.5;
function _emphasisPosition(dot, requestedTotal, level) {
    // A declared level IS the emphasis, and is preferred over re-deriving one from the count:
    // the derivation is distorted by range width (DOT-N1 at 2 of 1-2 reads as maximum emphasis
    // for one extra pill, outranking DOT-N9 dosed at 30 of 9-37), which a level is immune to.
    if (level && LEVEL_POSITION[level] !== undefined) return LEVEL_POSITION[level];
    const min = dot?.target_dots_min ?? 1;
    const max = dot?.target_dots_max ?? 10;
    return max === min ? NEUTRAL_EMPHASIS : (requestedTotal - min) / (max - min);
}

// Trims a recipe to the number of distinct dots the user's purchased package allows — PER WEEK.
//
// The 28-day packages (GCN's migration_0085) differ only in this number — 6 / 8 / 10 种原粒 — so
// it is the entire thing the buyer is choosing between, and honouring it is not optional.
//
// IT IS A WEEKLY LIMIT, NOT A CYCLE LIMIT. A 6种 buyer may take six dots this week and a partly
// different six next week; what they bought is the width of any one week, not the size of the
// whole formulation. So this caps each week independently and, when a week is over its limit,
// removes dots FROM THAT WEEK rather than from the formula — a dot dropped from week 3 keeps its
// weeks 1 and 2. Only a dot left with no weeks at all disappears entirely.
//
// WHERE IT RUNS MATTERS. The cap is applied ONCE, to the recipe, before it is stored as
// nutrition_plans.proposed_recipe. Everything downstream — the chat card, the box scan writing
// schedules, the fast-track submission — expands that stored recipe through the one shared rule
// set (_expandPlanDay), so they cannot disagree about what the user is taking. Applying it inside
// the expansion instead would mean the box scan, which knows nothing about the order, would expand
// a different recipe than the card the user was shown.
//
// DOT-N7 IS NOT COUNTED. It is a system-controlled reset component, dosed alone on 2 of the 28
// days in every plan regardless of tier (see _planExpansionContext, which lifts it out of the
// everyday recipe entirely). Counting it would silently cost a 6种 buyer one of the six dots they
// chose to pay for. This is a product judgement, and it is the reason the tier is described to the
// user as the width of their weekly formula rather than as the number of labels on the box.
//
// Dropping is whole-dot-within-a-week and both-slots, for the same reason _fitRecipeToDailyBudget's
// stage 3 is: half a daily dose is an underdose, which is worse than an absent dot. Ranking is the
// shared _emphasisPosition — lowest emphasis goes first — with ties broken toward the smaller daily
// total and then the key name, so the outcome is deterministic. (_fitRecipeToDailyBudget breaks
// ties on the larger floor because there a drop has to free capsule capacity; here every drop
// relieves the constraint by exactly one dot, so floor size is irrelevant.)
function _capDistinctDots(morningRecipe, eveningRecipe, dotsFormulary, maxDistinctDots, tierByKey) {
    const morning = { ...(morningRecipe?.dots || {}) };
    const evening = { ...(eveningRecipe?.dots || {}) };
    const membership = _weekMembership(morningRecipe, eveningRecipe);
    const levels = _levelsOf(morningRecipe, eveningRecipe);
    const order = _orderOf(morningRecipe, eveningRecipe);
    const orderIndex = order ? new Map(order.map((k, i) => [k, i])) : null;
    const asRecipes = (weeks) => {
        // The map is only materialized onto the result when it says something: an untouched
        // formula keeps whatever `weeks` it arrived with (usually none), so a recipe that needed
        // no trimming is returned in exactly the shape it came in. `levels` rides along untouched
        // so the emphasis signal survives every trim between here and the daily budget.
        const out = weeks ? { weeks } : (membership.size ? { weeks: Object.fromEntries(membership) } : {});
        if (levels) out.levels = levels;
        if (order) out.order = order;
        return { morning: { dots: morning, ...out }, evening: { dots: evening, ...out } };
    };

    const max = Number(maxDistinctDots);
    if (!Number.isFinite(max) || max <= 0) return asRecipes(null);

    const byKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));
    const totals = new Map();
    for (const [key, count] of [...Object.entries(morning), ...Object.entries(evening)]) {
        if (key === N7_KEY || !(count > 0)) continue;
        totals.set(key, (totals.get(key) || 0) + count);
    }
    if (totals.size === 0) return asRecipes(null);

    // `tierByKey`, when present, is the formulator's own statement of which dots are core and
    // which are optional additions (the ladder — see _buildTierLadder). It outranks emphasis
    // because it is a clinical judgement about necessity, where emphasis is only a dose position;
    // an untagged dot sorts as the most optional thing there is. Absent, this is exactly the
    // emphasis-only ordering it always was.
    const tagOf = k => {
        const t = tierByKey ? Math.round(Number(tierByKey.get(k))) : NaN;
        return Number.isFinite(t) && t >= 1 ? t : 99;
    };
    // Lowest first — the front of this list is what gets dropped. A declared order wins outright
    // over emphasis: it IS the formulator's answer, where emphasis is only ever a proxy for it.
    const orderRank = k => (orderIndex && orderIndex.has(k) ? orderIndex.get(k) : Number.MAX_SAFE_INTEGER);
    const rank = (a, b) =>
        (tagOf(b) - tagOf(a))
        || (orderIndex ? (orderRank(b) - orderRank(a)) : 0)
        || (_emphasisPosition(byKey.get(a), totals.get(a), levels && levels[a]) - _emphasisPosition(byKey.get(b), totals.get(b), levels && levels[b]))
        || (totals.get(a) - totals.get(b))
        || (a < b ? -1 : 1);

    // Start from the effective membership (a dot naming no weeks is in all of them), then take
    // dots out of the weeks that are over the limit. Weeks are independent: a dot may survive one
    // and be cut from the next.
    const effective = new Map([...totals.keys()].map(k => [k, new Set(membership.get(k) || allWeeks())]));
    let trimmed = false;
    for (let week = 1; week <= PLAN_WEEKS; week++) {
        const active = [...totals.keys()].filter(k => effective.get(k).has(week));
        if (active.length <= max) continue;
        for (const key of active.sort(rank).slice(0, active.length - max)) {
            effective.get(key).delete(week);
            trimmed = true;
        }
    }
    if (!trimmed) return asRecipes(null);

    const weeks = {};
    for (const [key, set] of effective) {
        if (set.size === 0) {
            // Left in no week at all — gone from the formula, and from BOTH capsules.
            delete morning[key];
            delete evening[key];
            continue;
        }
        weeks[key] = [...set].sort((a, b) => a - b);
    }
    return asRecipes(weeks);
}

function allWeeks() {
    return Array.from({ length: PLAN_WEEKS }, (_, i) => i + 1);
}

// The widest week: the number a purchased tier is actually compared against. Counted by the same
// rule _capDistinctDots enforces, so a tier check anywhere else (handlePostFormulationSubmit) can
// never count differently than the place that did the trimming.
//
// Deliberately NOT the distinct dots in the whole cycle. A 6种 package permits six per week, so a
// formula rotating twelve dots through four weeks — never more than six at once — is inside it.
function _countDistinctDots(morningRecipe, eveningRecipe) {
    const membership = _weekMembership(morningRecipe, eveningRecipe);
    let widest = 0;
    for (let week = 1; week <= PLAN_WEEKS; week++) {
        widest = Math.max(widest, _keysInWeek(morningRecipe, eveningRecipe, membership, week).size);
    }
    return widest;
}

// ── The tier ladder ────────────────────────────────────────────────────────────────────────────
//
// A user with nothing waiting is choosing between three purchasable widths (6 / 8 / 10 种原粒),
// and before this they never met that choice: the tool formulated against no ceiling at all and
// offered one undifferentiated "order this", which routinely produced a proposal wider than any
// package sold — unpurchasable the moment a code was spent on it.
//
// So one allocation becomes three NESTED formulas: the essential core, then +2, then +2. The
// narrowest is what gets stored as the plan's base (see _commitProposedPlan), which is why a
// proposal can no longer be born unpurchasable — every existing reader of proposed_recipe
// (the box scan, the printed label, the checkout snapshot, the fast-track submit) sees a recipe
// that fits ANY tier. The wider ones ride alongside in `tiers` and are selected at submission,
// once the redeemed code says which one the user actually bought.
//
// A WIDTH IS PER WEEK, NOT PER CYCLE. A 6种 formula may run six dots this week and a partly
// different six next week, so its four weeks together can contain well more than six distinct
// dots — that is the product, and it is why every variant carries its own `weeks` rotation rather
// than being a flat set. Each variant is produced by _capDistinctDots, the same cap that already
// binds a purchased package, so a width means exactly the same thing here as it does at
// submission, and _countDistinctDots (the widest week) is what either is compared against.
//
// NESTING FOLLOWS FROM THAT, not from a separate mechanism: _capDistinctDots ranks the SAME full
// allocation on every call and keeps the top `width` of each week, and a week's top 6 are always
// inside its top 8. Do not "optimise" this into per-variant re-ranking — ranking each variant's
// own set independently can drop from the wide variant a dot the narrow one kept, i.e. an upgrade
// that silently takes something away.
//
// Ranking is the model's own `tier` tag first — which dot is the better next addition is a
// clinical judgement, and the model is the one holding the biomarkers — then emphasis. Untagged
// dots sort as the most optional, so a completion from a stale cached prompt (no tags at all)
// still ladders, purely on emphasis, and so does a server-padded dot.
//
// Returns null when there is no ladder to build — no tiers from GCN, or nothing allocated — and
// every caller then behaves exactly as it did before this existed.
function _buildTierLadder({ morningRecipe, eveningRecipe, dotsFormulary, tiers, tierByKey, padCandidates }) {
    const widths = [...new Set((tiers || [])
        .map(t => Math.round(Number(t?.max_distinct_dots)))
        .filter(w => Number.isFinite(w) && w > 0))].sort((a, b) => a - b);
    if (widths.length === 0) return null;
    const labelByWidth = new Map();
    for (const t of tiers || []) {
        const w = Math.round(Number(t?.max_distinct_dots));
        if (Number.isFinite(w) && !labelByWidth.has(w)) labelByWidth.set(w, t.tier_label || t.package_name || null);
    }

    const byKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));
    const morning = { ...(morningRecipe?.dots || {}) };
    const evening = { ...(eveningRecipe?.dots || {}) };
    const distinct = new Set([...Object.keys(morning), ...Object.keys(evening)]
        .filter(k => k !== N7_KEY && ((morning[k] || 0) + (evening[k] || 0)) > 0));
    if (distinct.size === 0) return null;

    // Fill the upgrade slots the formulation itself did not.
    //
    // GENERATE reliably doses the whole formulary when asked in isolation, but inside the agentic
    // loop it curates — live dev runs (2026-09-07) came back with six dots where a single-shot
    // completion of the same prompt gave seventeen. Six is the narrowest tier, so without this the
    // wider variants are identical to the base, collapse as duplicates, and the ladder the user was
    // supposed to be choosing from never appears at all.
    //
    // Padding is legitimate here precisely because of what a rung IS: the prompt defines a tier-2/3
    // dot as one that makes the formula more complete rather than one it cannot do without. It is
    // never allowed to reach the CORE, though — padding runs only once the model has filled the
    // narrowest tier itself, and a padded dot is untagged, so the tier-aware ranking below sorts it
    // behind every dot the model actually chose.
    const widest = widths[widths.length - 1];
    if (distinct.size >= widths[0] && distinct.size < widest) {
        for (const cand of padCandidates || []) {
            if (distinct.size >= widest) break;
            const dot = byKey.get(cand?.key_name);
            const count = Math.round(Number(cand?.count));
            // N7 is never a candidate: it belongs to every tier already and is counted toward
            // none, so padding a slot with it would silently cost the buyer one of the dots they
            // are choosing between.
            if (!dot || dot.key_name === N7_KEY || distinct.has(dot.key_name) || !(count > 0)) continue;
            const split = _splitDotTiming(dot, count);
            if (split.morning > 0) morning[dot.key_name] = split.morning;
            if (split.evening > 0) evening[dot.key_name] = split.evening;
            distinct.add(dot.key_name);
        }
    }

    // One variant per purchasable width, each produced by the SAME cap that already binds a
    // purchased package — which is what makes the widths mean the same thing here as they do at
    // submission, and what gives the ladder rotation for free.
    // `levels` and `order` have to be carried onto the reconstructed recipe, not just `weeks`.
    // Dropping them silently returned _capDistinctDots to ranking on dose position, which is the
    // proxy the ranking exists to replace — and it showed: a dot ranked THIRD was cut from the
    // core while one ranked ninth survived, because rounding had flattened its narrow range to
    // position 0. Padded dots go on the END of the order: a slot the formulator did not fill is
    // by definition less important than every one it did.
    const paddedOrder = _orderOf(morningRecipe, eveningRecipe)
        ? [..._orderOf(morningRecipe, eveningRecipe),
           ...[...distinct].filter(k => !_orderOf(morningRecipe, eveningRecipe).includes(k))]
        : undefined;
    const carry = {
        weeks: morningRecipe?.weeks || eveningRecipe?.weeks || undefined,
        levels: _levelsOf(morningRecipe, eveningRecipe) || undefined,
        order: paddedOrder,
    };
    const full = {
        morning: { dots: morning, ...carry },
        evening: { dots: evening, ...carry },
    };
    const variants = [];
    let previous = null;
    for (const width of widths) {
        const capped = _capDistinctDots(full.morning, full.evening, dotsFormulary, width, tierByKey);
        // NESTING comes from _capDistinctDots ranking the SAME full allocation every time and
        // keeping the top `width` of each week: the top 6 of a week are always inside its top 8.
        // A width the formula cannot fill adds nothing over the one below it, and an "upgrade"
        // that changes nothing reads as a broken promise — so it is not a rung.
        const added = previous ? _ladderAdditions(previous, capped, dotsFormulary) : [];
        if (previous && added.length === 0) continue;
        variants.push({
            max_distinct_dots: width,
            tier_label: labelByWidth.get(width) || null,
            morning: capped.morning,
            evening: capped.evening,
            added,
        });
        previous = capped;
    }
    if (variants.length === 0) return null;
    return { base: variants[0], variants };
}

// The distinct non-N7 dots a variant contains anywhere in the cycle — the union across weeks, not
// the widest week. A dot that runs only in weeks 3-4 is still part of the formula, and is still
// something a wider tier can be said to have added.
function _ladderKeys(morningRecipe, eveningRecipe) {
    const keys = new Set();
    for (const recipe of [morningRecipe, eveningRecipe]) {
        for (const [key, count] of Object.entries(recipe?.dots || {})) {
            if (key !== N7_KEY && count > 0) keys.add(key);
        }
    }
    return keys;
}

// What a wider tier adds over the one below it, WEEK BY WEEK.
//
// Under rotation this is not simply "dots the narrow formula does not contain": a dot can be in
// both formulas and still run in more weeks on the wider one, which is a real upgrade and the
// reason the comparison is per week rather than cycle-wide. The result is one entry per dot that
// gains any week, carrying the weeks it gains.
//
// The dose is read out of a real day's expansion rather than the requested totals — a wider week
// has less capsule room and _fitRecipeToDailyBudget may have trimmed it. The day chosen is the
// first day of the first week the dot actually gains, because day 0 is week 1 and a dot rotated
// into weeks 3-4 would read there as absent.
function _ladderAdditions(narrow, wide, dotsFormulary) {
    const activeIn = (recipes, week) => {
        const membership = _weekMembership(recipes.morning, recipes.evening);
        const out = new Set();
        for (const key of _ladderKeys(recipes.morning, recipes.evening)) {
            const weeks = membership.get(key);
            if (!weeks || weeks.includes(week)) out.add(key);
        }
        return out;
    };
    const gained = new Map();
    for (let week = 1; week <= PLAN_WEEKS; week++) {
        const before = activeIn(narrow, week);
        for (const key of activeIn(wide, week)) {
            if (before.has(key)) continue;
            if (!gained.has(key)) gained.set(key, []);
            gained.get(key).push(week);
        }
    }
    if (gained.size === 0) return [];
    const ctx = _planExpansionContext(wide.morning, wide.evening, dotsFormulary);
    const byWeek = new Map();
    const out = [];
    for (const [key, weeks] of gained) {
        const week = weeks[0];
        if (!byWeek.has(week)) byWeek.set(week, _expandPlanDay((week - 1) * DAYS_PER_WEEK, ctx, null));
        const day = byWeek.get(week);
        const am = day.morning.dots[key] || 0;
        const pm = day.evening.dots[key] || 0;
        if (am === 0 && pm === 0) continue; // squeezed out by the daily budget — not an upgrade
        out.push({ key, am, pm, weeks });
    }
    return out;
}


// Which of a laddered proposal's formulas the user actually bought.
//
// The stored `morning`/`evening` are the NARROWEST variant, so this is only ever an upgrade away
// from what every other reader sees — which is what makes `tiers` safe to ignore everywhere else.
// The widest variant that fits wins; a package with no tier at all takes the base, because an
// unstated limit is not a purchase of the widest thing on the menu.
//
// Falls back to the base for a plan with no `tiers` (proposed before the ladder existed, or with
// a package already waiting, where there was one tier to aim at and no choice to offer). Those
// still meet the over-tier refusal at the call site, which is the right answer for a formula the
// user was never shown at that width.
// The one place a finished allocation is narrowed before it is stored, for BOTH paths that store
// one (the agentic delivery and the deterministic fallback). Two mutually exclusive narrowings,
// and which applies is decided by whether the user has already bought a package:
//
//   ladder   nothing waiting — the allocation becomes the nested 6 / +2 / +2 formulas, and the
//            plan is stored around the narrowest so it fits whatever code eventually pays for it.
//   cap      a package waiting — there is one tier to hit and no choice to offer, so the existing
//            _capDistinctDots trim to that tier is exactly right, unchanged.
//
// With no ladder from GCN and no package waiting, both are no-ops and the result is byte-for-byte
// what this produced before tiers existed.
// The dots offered for the upgrade slots a formulation left unfilled, best first.
//
// Only ever consulted for slots ABOVE the narrowest tier (see _buildTierLadder), so this never
// decides what is in someone's core formula — it decides what a wider package would add on top of
// it, which is the question the rungs exist to answer.
//
// Ordered by how defensible the addition is: a dot targeting one of this user's own elevated
// dimensions first, then one their active health-plan focus recommends, then by key so the result
// is deterministic. The dose is the same per-dot fallback every other server-side allocation uses,
// with the same focus bias — never a flat number, since the ranges differ by two orders of
// magnitude across the formulary.
function _padCandidatesFor({ dotsFormulary, bioage, recommendedKeySet }) {
    const chrono = Number(bioage?.ChronoAge);
    const elevated = new Set(Object.entries(bioage?.SubAges || {})
        .filter(([, age]) => Number.isFinite(chrono) && Number(age) > chrono)
        .map(([key]) => SUB_AGE_TARGET_BY_KEY[key])
        .filter(Boolean));
    const score = (dot) => {
        const isRecommended = recommendedKeySet ? recommendedKeySet.has(dot.key_name) : false;
        return (elevated.has(dot.sub_age_target) ? 0 : 2) + (isRecommended ? 0 : 1);
    };
    return (dotsFormulary || [])
        .filter(d => d.key_name !== N7_KEY)
        .map(d => ({ dot: d, rank: score(d) }))
        .sort((a, b) => (a.rank - b.rank) || (a.dot.key_name < b.dot.key_name ? -1 : 1))
        .map(({ dot }) => ({
            key_name: dot.key_name,
            count: _fallbackCountForDot(dot, recommendedKeySet ? recommendedKeySet.has(dot.key_name) : undefined),
        }));
}

function _applyTierLadder({ morningRecipe, eveningRecipe, dotsFormulary, orderContext, tiers, tierByKey, padCandidates }) {
    const ladder = orderContext.mode === 'buy'
        ? _buildTierLadder({ morningRecipe, eveningRecipe, dotsFormulary, tiers, tierByKey, padCandidates })
        : null;
    if (!ladder) {
        const capped = _capDistinctDots(morningRecipe, eveningRecipe, dotsFormulary, orderContext.maxDistinctDots);
        return { morningRecipe: capped.morning, eveningRecipe: capped.evening, tierVariants: null, rungs: [] };
    }
    return {
        morningRecipe: ladder.base.morning,
        eveningRecipe: ladder.base.evening,
        tierVariants: ladder.variants,
        // Rungs are the variants ABOVE the base — the base is the chart itself. They ship with
        // no copy: which dots a rung holds is settled here, and the sentence describing them is
        // written afterwards by lib/rungCopy.js, which is handed these exact contents. A rung
        // left without a pitch renders as its dot names alone, which is a supported state.
        rungs: ladder.variants.slice(1).map(v => ({
            tier_label: v.tier_label,
            max_distinct_dots: v.max_distinct_dots,
            pitch: '',
            added: v.added,
        })),
    };
}

function _selectTierVariant(proposedRecipe, maxDistinctDots) {
    const recipe = proposedRecipe || {};
    const base = {
        morning: { dots: recipe.morning || {}, weeks: recipe.weeks || undefined },
        evening: { dots: recipe.evening || {}, weeks: recipe.weeks || undefined },
        variant: null,
    };
    const tiers = Array.isArray(recipe.tiers) ? recipe.tiers : null;
    if (!tiers || tiers.length === 0) return base;
    const max = Number(maxDistinctDots);
    if (!Number.isFinite(max) || max <= 0) return base;
    let chosen = null;
    for (const t of tiers) {
        const w = Number(t?.max_distinct_dots);
        if (!Number.isFinite(w) || w > max) continue;
        if (!chosen || w > Number(chosen.max_distinct_dots)) chosen = t;
    }
    if (!chosen) return base;
    // The chosen tier's OWN rotation, not the base's: each width caps a week independently, so the
    // 8-dot formula's weeks are not the 6-dot formula's. A variant stored before per-tier weeks
    // existed simply has none and falls back to the base's, which is what it was written with.
    const weeks = chosen.weeks || recipe.weeks || undefined;
    return {
        morning: { dots: chosen.morning || {}, weeks },
        evening: { dots: chosen.evening || {}, weeks },
        variant: chosen,
    };
}

// Fits a requested daily allocation into the two capsules a day physically holds.
//
// The two constraints genuinely cannot both hold for a full formulary: every dot has its own
// target_dots_min, those floors sum to more than the 2 x MAX_DOTS_PER_CAPSULE a day holds, so
// SOMETHING has to give. _capRecipeTotal's answer was to scale everything down proportionally,
// which silently lands most dots below their own minimum — a dose low enough that the product's
// own rules call it invalid (lib/agFormulation.js's `dose_below_min`, checked on the DAILY total).
// A sub-therapeutic dot is worse than an absent one: it occupies capsule space that a dot at a
// real dose could have used, and it tells the user they are taking something they are effectively
// not.
//
// So the budget is settled here, on daily totals, before anything is split into capsules.
// _capRecipeTotal still runs afterwards inside _expandPlanDay, but on a recipe that already fits
// it is a no-op safety net rather than the thing deciding the doses.
//
// It gives in three stages, in this order — cheapest sacrifice first:
//
//   1. REBALANCE. A flexible dot in an over-full capsule moves to the other one before anything
//      is reduced or removed. Costs nothing at all: the daily dose is unchanged, it is simply
//      taken at the other end of the day.
//   2. REDUCE toward each dot's own floor. A dot asked for at 58 with a minimum of 28 can give
//      back 30 and still be a real dose. This is the stage the original rule was missing: it
//      dropped whole dots while every survivor sat well above its floor, so it destroyed
//      interventions to buy room that was already lying unused inside the survivors.
//   3. DROP whole dots, and only once even the floors of everything don't fit. Never a partial
//      dot: half a daily dose is exactly the underdose this function exists to prevent, so a
//      dropped dot leaves BOTH slots.
//
// WHICH dot goes is a product judgement, and this is the rule: lowest relative position in its own
// range first. The formulator expresses emphasis by where in a dot's min..max it placed the count
// (see _fallbackCountForDot's 25/50/75%), so a dot sitting at its floor is the one it cared least
// about, and a dot near its ceiling is the one it cared most about. Ties break toward the larger
// FLOOR, because at the point a drop is being considered every survivor is at its floor and the
// floor is what actually relieves the constraint.
//
// Stage 2's give-back is proportional to how much each dot asked for above its floor, so a dot
// the formulator pushed to its ceiling keeps more of that emphasis than one left near its floor.
// It never raises a dot above what was asked for — this function only ever takes away.
function _fitRecipeToDailyBudget(morningRecipe, eveningRecipe, dotsFormulary) {
    const CAP = MAX_DOTS_PER_CAPSULE;
    const byKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));
    const inMorning = { ...(morningRecipe?.dots || {}) };
    const inEvening = { ...(eveningRecipe?.dots || {}) };
    const levels = _levelsOf(morningRecipe, eveningRecipe);
    const order = _orderOf(morningRecipe, eveningRecipe);
    const orderIndex = order ? new Map(order.map((k, i) => [k, i])) : null;
    const sum = obj => Object.values(obj).reduce((a, b) => a + b, 0);

    // A recipe that already fits is returned exactly as it came in, rather than re-derived. The
    // caller's own AM/PM split is a real decision (an AG formula's, or _splitDotTiming's) and
    // there is nothing to fix.
    if (sum(inMorning) <= CAP && sum(inEvening) <= CAP) {
        return { morning: { dots: inMorning }, evening: { dots: inEvening } };
    }

    const requested = new Map();
    for (const [key, count] of [...Object.entries(inMorning), ...Object.entries(inEvening)]) {
        if (count > 0) requested.set(key, (requested.get(key) || 0) + count);
    }

    const dotOf = key => byKey.get(key) || {};
    const isFlexible = key => !!dotOf(key).timing_flexible;
    // A dot the formulary doesn't describe falls back to where the CALLER put it, not to the
    // morning. Defaulting to morning would quietly collapse a whole two-capsule recipe into one
    // capsule the moment a caller's SELECT omits `timing` — a failure that reads as a plausible
    // formulation rather than as an error.
    const slotOf = key => {
        const timing = dotOf(key).timing;
        if (timing === 'Evening') return 'evening';
        if (timing === 'Morning') return 'morning';
        return (inEvening[key] || 0) > (inMorning[key] || 0) ? 'evening' : 'morning';
    };
    // A floor above what was asked for would be this function adding dose, which it must never do.
    const floorOf = key => Math.min(requested.get(key), dotOf(key).target_dots_min ?? 1);
    // A declared order is the formulator's ranking and outranks the dose-derived proxy, exactly
    // as in _capDistinctDots — the two droppers must agree about what matters least.
    const position = (key) => (orderIndex
        ? (orderIndex.has(key) ? 1 - (orderIndex.get(key) / Math.max(1, orderIndex.size)) : 0)
        : _emphasisPosition(dotOf(key), requested.get(key), levels && levels[key]));

    // Stage 3, hoisted: a non-flexible dot cannot leave its own capsule, so its slot's floors have
    // to fit that one capsule on their own. Everything else only has to fit the day.
    let keys = [...requested.keys()];
    const floorsIn = ks => ks.reduce((a, k) => a + floorOf(k), 0);
    const lockedIn = slot => keys.filter(k => !isFlexible(k) && slotOf(k) === slot);
    while (keys.length > 1) {
        let pool = null;
        if (floorsIn(lockedIn('morning')) > CAP) pool = lockedIn('morning');
        else if (floorsIn(lockedIn('evening')) > CAP) pool = lockedIn('evening');
        else if (floorsIn(keys) > 2 * CAP) pool = keys;
        if (!pool || pool.length <= 1) break; // nothing left to give; _capRecipeTotal takes it from here
        const drop = [...pool].sort((a, b) => (position(a) - position(b)) || (floorOf(b) - floorOf(a)))[0];
        keys = keys.filter(k => k !== drop);
    }

    // Stage 2: start every survivor at its floor, then hand the remaining daily capacity back out
    // one dot at a time, always to whichever dot is proportionally furthest from what was asked
    // for. Bounded by the budget, so at most 2 x CAP iterations.
    const counts = new Map(keys.map(k => [k, floorOf(k)]));
    const wanted = new Map(keys.map(k => [k, requested.get(k)]));
    let allocated = [...counts.values()].reduce((a, b) => a + b, 0);
    // A locked dot's growth is bounded by its own capsule as well as by the day.
    const lockedTotal = slot => lockedIn(slot).reduce((a, k) => a + counts.get(k), 0);
    while (allocated < 2 * CAP) {
        let best = null, bestRatio = -1;
        for (const key of keys) {
            const room = wanted.get(key) - counts.get(key);
            if (room <= 0) continue;
            if (!isFlexible(key) && lockedTotal(slotOf(key)) >= CAP) continue;
            const demand = wanted.get(key) - floorOf(key);
            const ratio = demand > 0 ? room / demand : 0;
            if (ratio > bestRatio || (ratio === bestRatio && best !== null && key < best)) {
                best = key; bestRatio = ratio;
            }
        }
        if (best === null) break; // everyone has what they asked for
        counts.set(best, counts.get(best) + 1);
        allocated += 1;
    }

    // Stage 1: lay the daily totals into the two capsules and even them out. _splitDotTiming is
    // the baseline (a locked dot wholly in its own slot, a flexible one 70/30), then flexible dots
    // move across until both capsules fit. Feasible by construction — each slot's locked floors
    // fit that capsule and the day's total fits both — so the moves below always converge.
    const morning = {}, evening = {};
    for (const key of keys) {
        // slotOf, not dot.timing directly, so the caller-derived fallback above is what
        // _splitDotTiming sees for a dot the formulary doesn't describe.
        const timing = slotOf(key) === 'evening' ? 'Evening' : 'Morning';
        const split = _splitDotTiming({ ...dotOf(key), timing, key_name: key }, counts.get(key));
        if (split.morning > 0) morning[key] = split.morning;
        if (split.evening > 0) evening[key] = split.evening;
    }
    // Two passes: the first keeps the majority of a dot's daily count in the slot it belongs to
    // (the rule systemFormulaGenerate.js and the AG contract both state), the second drops that
    // preference because a capsule that does not physically close is not a trade-off.
    for (const keepMajority of [true, false]) {
        for (const [from, to] of [[morning, evening], [evening, morning]]) {
            while (sum(from) > CAP && sum(to) < CAP) {
                const movable = keys
                    .filter(k => isFlexible(k) && (from[k] || 0) > 0)
                    .filter(k => !keepMajority || (from[k] - Math.ceil(counts.get(k) / 2)) > 0)
                    .sort((a, b) => (from[b] - from[a]) || (a < b ? -1 : 1));
                if (!movable.length) break;
                const key = movable[0];
                const ceiling = keepMajority ? from[key] - Math.ceil(counts.get(key) / 2) : from[key];
                const amount = Math.min(sum(from) - CAP, CAP - sum(to), ceiling);
                if (amount <= 0) break;
                from[key] -= amount;
                to[key] = (to[key] || 0) + amount;
                if (from[key] === 0) delete from[key];
            }
        }
    }
    return { morning: { dots: morning }, evening: { dots: evening } };
}

// Everything a 28-day expansion needs, derived once from an AM/PM recipe.
//
// ONE FITTED RECIPE PER WEEK, not one for the cycle. A recipe may carry per-dot week membership
// (see _weekMembership), so weeks can differ — and the daily budget therefore has to be settled
// per week: a week where only five of a formula's twelve dots are active has room the others do
// not. A recipe with no membership yields PLAN_WEEKS identical weeks, which is exactly the
// steady-state behaviour this function had before weeks existed.
//
// DOT-N7 is lifted out of the everyday recipe entirely here rather than day by day: its dosing is
// fully system-controlled (both capsules, alone, at its own target_dots_max, on exactly the two
// isolation days), so leaving it in the base recipe would dose it twice by two different
// mechanisms. Any *other* pulse-protocol dot — none exist today — still follows the generic
// epoch-based window and is gated per day instead.
function _planExpansionContext(morningRecipe, eveningRecipe, dotsFormulary) {
    const dotsByKey = new Map((dotsFormulary || []).map(d => [d.key_name, d]));
    const n7MaxCount = dotsByKey.get(N7_KEY)?.target_dots_max ?? 50;
    const membership = _weekMembership(morningRecipe, eveningRecipe);
    // N7 is stripped first so it is never a drop candidate in the budget fit below: its dosing is
    // system-controlled and it does not occupy an everyday capsule at all.
    const bareMorning = _omitDotKey(morningRecipe, N7_KEY);
    const bareEvening = _omitDotKey(eveningRecipe, N7_KEY);
    const weekly = [];
    for (let week = 1; week <= PLAN_WEEKS; week++) {
        // Settle the budget by dropping whole dots BEFORE anything is split into capsules, so no
        // dot survives below its own minimum.
        const fitted = _fitRecipeToDailyBudget(
            _recipeForWeek(bareMorning, membership, week),
            _recipeForWeek(bareEvening, membership, week),
            dotsFormulary);
        // Then even the two capsules out, per week rather than once for the cycle: a week that
        // rotates an evening dot out is lopsided in a way the stored recipe cannot anticipate,
        // and _fitRecipeToDailyBudget will not touch it because it fits. Balancing here is what
        // makes the card, the checkout snapshot, the fast-track submission and the schedules the
        // box scan writes all agree about which capsule a dot is taken in.
        weekly.push(_balanceCapsules(fitted.morning, fitted.evening, dotsFormulary));
    }
    return {
        weekly,
        n7IsolationRecipe: { dots: { [N7_KEY]: n7MaxCount } },
        pulseDotsByKey: new Map((dotsFormulary || [])
            .filter(d => d.dosing_protocol === 'pulse' && d.key_name !== N7_KEY)
            .map(d => [d.key_name, d])),
    };
}

// The two capsules for day `dayIndex` (0-based) of a cycle. The single expansion rule set, shared
// by everything that turns a steady-state recipe into real days: _activateProposedPlan (the box
// scan, writing schedules) and _planDayGroups (the chat card). Two consumers that must never
// disagree about what a user is actually taking.
//
// `dateISO` may be null, which is what a dateless proposal passes. The generic pulse window
// (_isPulseActiveDate) is anchored to a fixed calendar epoch, so it cannot be evaluated without a
// real date — with no date, pulse dots are simply left in every day. That is exact today (N7 is
// the only pulse dot and it is routed through isolation instead, never through that gate), but if
// a second pulse dot is ever configured, a proposal will over-state the days it appears on until
// the box scan anchors the cycle. Fix that by resolving the window at scan time, not by inventing
// a start date here: a proposal genuinely does not have one.
function _expandPlanDay(dayIndex, ctx, dateISO) {
    if (N7_ISOLATION_DAY_INDEXES.includes(dayIndex)) {
        return { morning: ctx.n7IsolationRecipe, evening: ctx.n7IsolationRecipe, isN7: true };
    }
    // Which week this day belongs to is the only thing that varies between ordinary days. Every
    // week's recipe was already budget-fitted in _planExpansionContext, so this stays a lookup.
    const base = ctx.weekly[_weekOfDayIndex(dayIndex) - 1] || ctx.weekly[0];
    const gate = recipe => (dateISO ? _applyPulseSchedule(recipe, ctx.pulseDotsByKey, dateISO) : recipe);
    return {
        morning: _capRecipeTotal(gate(base.morning), MAX_DOTS_PER_CAPSULE),
        evening: _capRecipeTotal(gate(base.evening), MAX_DOTS_PER_CAPSULE),
        isN7: false,
    };
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

    // Locked dots into their own capsule, flexible ones dealt out to level the two — the same
    // rule the agentic path applies to its own allocation, so the fallback formula is no harder
    // to take than the one it stands in for.
    const balanced = _balanceCapsules(morningRecipe, eveningRecipe, dotsFormulary);

    return { analysis, finalContent, morningRecipe: balanced.morning, eveningRecipe: balanced.evening, dotCounts };
}

// Writes the PLAN_DAYS x 2 schedule rows for a plan, expanding a steady-state recipe through
// _expandPlanDay so the day-by-day rules live in exactly one place. Shared by the two paths that
// turn a recipe into a running schedule. Only _activateProposedPlan (the box scan for a
// chat-tool proposal) uses it today; _commitAgFormulation writes its own pre-expanded capsules.
async function _writeExpandedSchedules(client, { planId, userId, startDateObj, morningRecipe, eveningRecipe, dotsFormulary }) {
    const ctx = _planExpansionContext(morningRecipe, eveningRecipe, dotsFormulary);
    for (let i = 0; i < PLAN_DAYS; i++) {
        const currentDate = startDateObj.plus({ days: i }).toISODate();
        const day = _expandPlanDay(i, ctx, currentDate);
        await client.query(
            'INSERT INTO nutrition_schedules (plan_id, user_id, scheduled_date, slot_name, recipe) VALUES ($1, $2, $3, $4, $5)',
            [planId, userId, currentDate, 'morning_cup', day.morning]
        );
        await client.query(
            'INSERT INTO nutrition_schedules (plan_id, user_id, scheduled_date, slot_name, recipe) VALUES ($1, $2, $3, $4, $5)',
            [planId, userId, currentDate, 'evening_cup', day.evening]
        );
    }
}

// _commitNutritionPlan lived here until 2026-08-28: it superseded whatever plan a user was on
// and inserted a fresh ACTIVE one with a full cycle of schedules, from a steady-state recipe. Its
// only caller was the nutrition top-up job (removed — see the note further down), so it went with
// it. The two functions that may still put a user on a plan both require a scanned box:
// _activateProposedPlan (a chat-tool proposal) and _commitAgFormulation (a Viva AG formula). Both
// write their schedules through _writeExpandedSchedules, which is what _commitNutritionPlan's day
// expansion was factored into.

// The rotation a tier variant actually has, or nothing at all when it runs every dot every week.
function _tierWeeks(variant) {
    const merged = { ...(variant?.evening?.weeks || {}), ...(variant?.morning?.weeks || {}) };
    const weeks = {};
    for (const [key, list] of Object.entries(merged)) {
        if (Array.isArray(list) && list.length > 0 && list.length < PLAN_WEEKS) weeks[key] = list;
    }
    return Object.keys(weeks).length ? { weeks } : {};
}

// Records what the Formulate-Dots chat tool just worked out as a 'proposed' plan.
//
// A proposal is a real, purchasable 28-day recipe that the user does not yet physically have, so
// two things it does NOT do are as important as what it does:
//
//   * No schedules. The 56 capsules are generated at box-scan time (_activateProposedPlan), when
//     start_date becomes a real date. The dates written here are provisional placeholders for
//     NOT NULL columns, exactly as the AG approval path does for 'approved'.
//   * It never touches the user's 'active' plan. Someone mid-cycle on a box they already have
//     keeps taking it; asking the chat tool a question must not silently end that cycle. Only a
//     previous proposal is superseded, so there is at most one live proposal to price.
//
// Returns the new plan id.
async function _commitProposedPlan(client, { userId, analysis, morningRecipe, eveningRecipe, activeHealthPlans, tierVariants }) {
    const primaryHealthPlanId = (activeHealthPlans || []).find(p => p.plan_type === 'primary')?.id ?? null;
    const secondaryHealthPlanId = (activeHealthPlans || []).find(p => p.plan_type === 'secondary')?.id ?? null;

    await client.query(
        `UPDATE nutrition_plans SET status = 'superseded' WHERE user_id = $1 AND status = 'proposed'`,
        [userId]
    );
    // Minted here, at generation time, because the QR is part of the deliverable: the user can
    // view it as soon as the formula exists, it is what gets printed on the box compounded from
    // it, and it is what the Mini Program scans to activate the plan. See lib/labelCode.js.
    const labelCode = await generateLabelCode();
    const { rows: [plan] } = await client.query(
        `INSERT INTO nutrition_plans (user_id, start_date, end_date, goal, status, source,
                                      proposed_recipe, label_code, primary_health_plan_id, secondary_health_plan_id)
         VALUES ($1, CURRENT_DATE, CURRENT_DATE + $2::int, $3, 'proposed', 'nano', $4, $5, $6, $7)
         RETURNING id`,
        [userId, PLAN_DAYS - 1, (analysis || 'Proposed Formulation').slice(0, 2000),
         // `weeks` is written only when the formula actually varies across the cycle, so a
         // steady-state proposal is stored in exactly the shape it always was. Absent means every
         // dot is in every week — see _weekMembership.
         JSON.stringify({
             morning: morningRecipe?.dots || {},
             evening: eveningRecipe?.dots || {},
             ...(morningRecipe?.weeks || eveningRecipe?.weeks
                 ? { weeks: { ...(eveningRecipe?.weeks || {}), ...(morningRecipe?.weeks || {}) } }
                 : {}),
             // The wider tiers of the same formula, when the user was offered a ladder
             // (_buildTierLadder). `morning`/`evening` above are the NARROWEST of them, so every
             // reader that predates this key — the box scan, the printed label, the checkout
             // snapshot — keeps working untouched and sees a recipe that fits any package sold.
             // handlePostFormulationSubmit picks the widest that fits the code actually redeemed
             // and collapses the row back to a single recipe.
             ...(Array.isArray(tierVariants) && tierVariants.length > 1
                 ? { tiers: tierVariants.map(v => ({
                     max_distinct_dots: v.max_distinct_dots,
                     tier_label: v.tier_label || null,
                     morning: v.morning?.dots || {},
                     evening: v.evening?.dots || {},
                     // Each tier has its OWN rotation: a width caps a week, so a wider tier both
                     // runs more dots per week and generally rotates differently. Reusing the
                     // top-level `weeks` for all of them would describe a schedule none of them
                     // actually has.
                     //
                     // Entries naming all four weeks are dropped: _capDistinctDots materialises
                     // the full membership whenever it trims anything, and "every week" already
                     // means the same as absent — storing it makes a steady formula read as a
                     // rotating one to anything inspecting the row.
                     ..._tierWeeks(v),
                 })) }
                 : {}),
         }),
         labelCode, primaryHealthPlanId, secondaryHealthPlanId]
    );
    return plan.id;
}

// The box-scan half of a chat-tool proposal: the sibling of _commitAgFormulation, for a plan that
// came from nano's own formulator rather than the external agent.
//
// This is where "Day 1" stops being relative. The proposal was authored with no start date
// because the capsules had to be compounded and shipped first; scanning the delivered box is the
// first moment a real calendar day exists, so start_date is rewritten to today and the 56 capsules
// are generated from there.
//
// Returns the plan id, or null if the row was not a live proposal (already activated by an
// earlier scan of another box from the same batch, or superseded by a newer proposal before the
// box arrived) — callers treat null as "nothing to activate", not as an error.
async function _activateProposedPlan(client, { userId, planId }) {
    const { rows: [plan] } = await client.query(
        `SELECT id, status, goal, proposed_recipe FROM nutrition_plans
          WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [planId, userId]
    );
    if (!plan) return null;
    // A second box from the same batch: the first scan already started the cycle, so join it
    // rather than regenerating a schedule the user is part-way through.
    if (plan.status === 'active') return plan.id;
    if (plan.status !== 'proposed') {
        console.log(JSON.stringify({ level: 'WARN', msg: 'activate_proposed_plan_not_proposed', userId, planId, status: plan.status }));
        return null;
    }
    const recipe = plan.proposed_recipe || {};
    // `weeks` carries the rotation the proposal was authored with; a row written before weeks
    // existed simply has none, and expands to four identical weeks exactly as it used to.
    const morningRecipe = { dots: recipe.morning || {}, weeks: recipe.weeks || undefined };
    const eveningRecipe = { dots: recipe.evening || {}, weeks: recipe.weeks || undefined };

    const startDateObj = getNowShanghai();
    const endDateObj = startDateObj.plus({ days: PLAN_DAYS - 1 });
    await client.query(
        `UPDATE nutrition_plans SET status = 'active', start_date = $1, end_date = $2 WHERE id = $3`,
        [startDateObj.toISODate(), endDateObj.toISODate(), plan.id]
    );
    await client.query(
        `UPDATE nutrition_plans SET status = 'superseded' WHERE user_id = $1 AND status = 'active' AND id != $2`,
        [userId, plan.id]
    );

    // proposed_recipe fixes the counts, but not how they land in the two capsules: the expansion
    // still re-fits an over-budget recipe, which needs each dot's slot, whether it may be split,
    // and its floor. Selecting only the pulse/isolation columns silently expands every dot into
    // the morning capsule at doses under their own minimums — and these are the schedules the
    // user physically takes.
    const { rows: formulary } = await client.query(
        `SELECT key_name, timing, timing_flexible, target_dots_min, target_dots_max,
                dosing_protocol, pulse_days_per_cycle, pulse_cycle_days FROM dots`
    );
    await _writeExpandedSchedules(client, {
        planId: plan.id, userId, startDateObj, morningRecipe, eveningRecipe, dotsFormulary: formulary,
    });
    return plan.id;
}

// Commits a Viva AG formula — the box-scan half of the AG ordering flow.
//
// A DELIBERATE SIBLING of _activateProposedPlan, not a reuse of it. That function takes a
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

// The dispatcher's nutrition.topup handler lived here until 2026-08-28. It generated a
// formulation and committed it as the user's ACTIVE plan, on a timer, for anyone with fewer than
// 7 upcoming scheduled days — which included every user who had never ordered a box. Removed
// along with the scan that triggered it (dispatcher/index.js) and the route that delivered it
// (worker/index.js), so nothing creates a nutrition plan except a box scan.

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
// PROPOSES a plan; it does not put the user on one. The result is committed as a 'proposed'
// nutrition_plans row (no schedules, never supersedes the active plan) plus a chat message
// carrying a :::formula chart of the whole 28-day cycle. That row is what GCN's checkout prices,
// and it becomes the user's live plan only when the delivered box is scanned. No 'pending' row is
// inserted here — the write happens in the finalizer, once there is a validated recipe to write.
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

    // Never throws (see fetchFormulationOrders): not knowing whether a package is waiting, or
    // what the ladder looks like, costs the prompt a hint — never the user their formulation.
    // Fetched together because the ladder is only used when nothing is waiting, and which of the
    // two applies is not known until the order lookup answers.
    const [orderContext, formulationTiers] = await Promise.all([
        _resolveOrderContext(user.user_id),
        fetchFormulationTiers(),
    ]);
    // Mutually exclusive by design: formulation_package is the tier already bought,
    // formulation_tiers the menu of tiers on offer. A user holding a package is not shopping.
    const tierLadder = orderContext.mode === 'buy' ? formulationTiers : [];

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
        // The package this user has already paid for, if any. Carried into the prompt so the model
        // AIMS at the tier rather than being trimmed down to it afterwards — a formula built for 6
        // dots is a better formula than the best 10-dot one with 4 dots deleted.
        //
        // Best-effort only, and deliberately not the enforcement point: this turn runs
        // asynchronously and may be delivered minutes later, by which time a checkout could have
        // completed. finalizeFormulaDotsGenerate re-resolves the order at delivery and narrows the
        // recipe there (_applyTierLadder), which is what actually binds.
        formulation_package: orderContext.maxDistinctDots
            ? { max_distinct_dots: orderContext.maxDistinctDots, name: orderContext.packageName }
            : null,
        // The purchasable widths, narrowest first, when the user has bought nothing yet. Carried
        // in llmContext rather than re-fetched at delivery — unlike the order lookup, which IS
        // re-resolved there for freshness — because the variants have to be built against the same
        // ladder the model was told to aim at. A catalog that changed mid-turn would otherwise
        // produce rungs the prose beside them never describes.
        formulation_tiers: tierLadder.length > 0 ? tierLadder : null,
    };
    const formulaGenerateTemplate = personaType === 'viva' ? vivaSystemFormulaGenerateTemplate : systemFormulaGenerateTemplate;
    const systemPrompt = formulaGenerateTemplate(llmContext);
    const triggerMsg = lang === 'zh'
        ? `请根据我的完整健康数据，为我配置一个 ${PLAN_DAYS} 天周期的 Dots 方案。`
        : `Please formulate a ${PLAN_DAYS}-day Dots plan based on my complete health data.`;

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
        // deliver the same proposal the async path would have.
        const deterministic = await _runDeterministicFormulation({
            biomarkers, bioageProfile, dotsFormulary, personaType, lang, currentSolarTerm, essentialKnowledge, userFacts,
            activeHealthPlans: llmContext.active_health_plans,
        });
        const { analysis, finalContent } = deterministic;
        // Narrowed before it is stored, so the card, the box scan and the fast-track submission
        // all expand the same recipe. The fallback has no model output to read tier tags or a
        // pitch from, so its rungs are ranked on emphasis alone and carry no copy — but it must
        // still ladder: a proposal with no `tiers` and no cap is one a wider code cannot be spent
        // on, which is the exact failure this whole change exists to remove.
        const { morningRecipe, eveningRecipe, tierVariants, rungs } = _applyTierLadder({
            morningRecipe: deterministic.morningRecipe,
            eveningRecipe: deterministic.eveningRecipe,
            dotsFormulary, orderContext, tiers: tierLadder,
            padCandidates: _padCandidatesFor({ dotsFormulary, bioage: bioageProfile,
                recommendedKeySet: _resolveCandidateDotKeys(llmContext.active_health_plans, dotsFormulary) }),
        });
        const client = await pool.connect();
        let planId = null;
        try {
            await client.query('BEGIN');
            planId = await _commitProposedPlan(client, {
                userId: user.user_id, analysis, morningRecipe, eveningRecipe, tierVariants,
                activeHealthPlans: llmContext.active_health_plans,
            });
            await client.query('COMMIT');
        } catch (commitErr) {
            await client.query('ROLLBACK');
            // The proposal is a nice-to-have here; the user still gets the numbers in chat, just
            // without a store CTA to order them.
            console.error(JSON.stringify({ level: 'ERROR', msg: 'commit_proposed_plan_failed', user_id: user.user_id, error: commitErr.message }));
        } finally {
            client.release();
        }
        const labelCode = planId ? (await pool.query('SELECT label_code FROM nutrition_plans WHERE id = $1', [planId])).rows[0]?.label_code : null;
        const message = finalContent + _buildFormulaChartBlock(morningRecipe, eveningRecipe, dotsFormulary, lang, { planId, orderMode: orderContext.mode, labelCode, rungs });
        await pool.query(
            'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
            [user.user_id, 'formulation_proposal', message, 'pending']
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
    handleGetFormulationOrders,
    handleGetFormulationCheckoutSnapshot,
    handlePostFormulationSubmit,
    handlePostFormulationRedeem,
    handleGetFormulationLabelByCode,
    handleGetFormulationReviewSnapshot,
    _buildReviewTwinContext,
    _getCommittedPlanDay0Breakdown,
    handlePostFormulaDots,
    handlePostDots,
    handlePutDot,
    handleDeleteDot,
    _runDeterministicFormulation,
    _commitProposedPlan,
    _activateProposedPlan,
    _commitAgFormulation,
    _fallbackCountForDot,
    _countForLevel,
    DOSE_LEVELS,
    _doseFromRanking,
    _doseFromRank,
    _rankDotsBySeverity,
    _severityShares,
    _resolveCandidateDotKeys,
    _splitDotTiming,
    _balanceCapsules,
    _planDayGroups,
    _resolveOrderContext,
    _mergeFormulationPackages,
    _awaitingOrders,
    _capDistinctDots,
    _countDistinctDots,
    _weekMembership,
    _tierWeeks,
    _buildTierLadder,
    _selectTierVariant,
    _applyTierLadder,
    _padCandidatesFor,
    _formulationLabelUrl,
    _expandProposalToCapsules,
    _formatDayRanges,
    _expandPlanDay,
    _planExpansionContext,
    _fitRecipeToDailyBudget,
    _buildFormulaChartBlock,
    _rungPitch,
    _buildProductCardBlock,
    _isPulseActiveDate,
    _applyPulseSchedule,
};
