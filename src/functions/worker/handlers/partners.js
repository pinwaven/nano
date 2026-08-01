const { pool } = require('../lib/db');
const { requirePermission, verifySubchannelOwnership, generatePartnerInviteCode } = require('../lib/auth');
const { recordReferralCommission, recordSalesCommission, generatePartnerPayouts, getCommissionRules, resolveRate } = require('../lib/partnerCommissions');
const { gcnFetch } = require('../lib/gcnClient');

// Channels whose commerce (store creation, sales, shipping) is delegated to GCN — mirrors
// GCN_LINKED_CHANNEL_KEYS in handlers/login.js (kept separate/duplicated intentionally,
// same pattern GCN itself uses for its nanoClient.js copies — not worth a shared-module
// coupling for one small constant).
const GCN_LINKED_CHANNEL_KEYS = new Set(['aeviva', 'aeviva-china']);

// Nano's partner.status enum ('pending'|'active'|'inactive') has no 1:1 match in GCN's
// ('pending'|'active'|'suspended'|'exited') — 'inactive' maps to 'suspended' rather than
// 'exited' since a nano-side deactivation is meant to block store/login access, not permanently
// sever the record (see handlePutPartner's re-sync below).
const NANO_TO_GCN_STATUS = { pending: 'pending', active: 'active', inactive: 'suspended' };

// ── Partner system handlers ──────────────────────────────────────────────────

async function handleGetPartners(query, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const conditions = [];
        const params = [];
        const channelId = adminCtx?.channelId || query.channel_id;
        if (channelId) { params.push(channelId); conditions.push(`p.channel_id=$${params.length}`); }
        if (query.status) { params.push(query.status); conditions.push(`p.status=$${params.length}`); }
        if (query.tier)   { params.push(query.tier);   conditions.push(`p.tier=$${params.length}`); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const { rows } = await pool.query(`
            SELECT p.*,
                   ch.name AS channel_name, ch.key_name AS channel_key,
                   up.real_name AS upline_name, up.tier AS upline_tier,
                   COALESCE(comm.total_commissions, 0) AS total_commissions_cny
            FROM partners p
            LEFT JOIN channels ch ON ch.id = p.channel_id
            LEFT JOIN partners up ON up.id = p.referred_by_partner_id
            LEFT JOIN (
                SELECT partner_id, SUM(amount_cny) AS total_commissions
                FROM partner_commissions
                GROUP BY partner_id
            ) comm ON comm.partner_id = p.id
            ${where}
            ORDER BY p.created_at DESC
            LIMIT 1000
        `, params);
        return { success: true, partners: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetPartner(partnerId) {
    if (!partnerId) return { success: false, error: 'partner id required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const [partnerRes, commRes, payoutRes] = await Promise.all([
            pool.query(`
                SELECT p.*, ch.name AS channel_name,
                       up.real_name AS upline_name, up.tier AS upline_tier
                FROM partners p
                LEFT JOIN channels ch ON ch.id = p.channel_id
                LEFT JOIN partners up ON up.id = p.referred_by_partner_id
                WHERE p.id = $1
            `, [partnerId]),
            pool.query(`
                SELECT pc.*, sp.real_name AS source_partner_name
                FROM partner_commissions pc
                LEFT JOIN partners sp ON sp.id = pc.source_partner_id
                WHERE pc.partner_id = $1
                ORDER BY pc.created_at DESC LIMIT 100
            `, [partnerId]),
            pool.query(
                `SELECT * FROM partner_payouts WHERE partner_id=$1 ORDER BY period DESC LIMIT 24`,
                [partnerId]
            ),
        ]);
        if (!partnerRes.rows[0]) return { success: false, error: 'Partner not found', statusCode: 404 };
        return { success: true, partner: partnerRes.rows[0], commissions: commRes.rows, payouts: payoutRes.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// GET /api/partners/by-phone/:phone?channel=<key_name>
// Resolves a partner by phone number, scoped to a channel (by key_name) and its
// sub-channels (recursive — e.g. channel=aeviva also matches partners enrolled under
// aeviva-china). Used by GCN's aeviva-sector integration to verify partner identity/tier
// before granting a GCN login — see docs/architecture/partner-system.md.
async function handleGetPartnerByPhone(phone, channelKey) {
    if (!phone) return { success: false, error: 'phone required', statusCode: 400 };
    if (!channelKey) return { success: false, error: 'channel query param required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query(`
            WITH RECURSIVE subtree AS (
                SELECT id FROM channels WHERE key_name = $2
                UNION ALL
                SELECT c.id FROM channels c JOIN subtree s ON c.parent_channel_id = s.id
            )
            SELECT p.id, p.tier, p.status, p.real_name, p.phone, p.channel_id,
                   p.referred_by_partner_id
            FROM partners p
            WHERE right(regexp_replace(p.phone, '\D', '', 'g'), 11) = right(regexp_replace($1, '\D', '', 'g'), 11)
              AND p.channel_id IN (SELECT id FROM subtree)
            ORDER BY p.created_at DESC
            LIMIT 1
        `, [phone, channelKey]);
        if (rows.length === 0) return { success: false, error: 'partner not found', statusCode: 404 };
        return { success: true, partner: rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// POST /partner-lookup-gcn  (GCN service-token only, see GCN_ALLOWED_PATHS in index.js)
// Body: { phone, channel }
// Same lookup as GET /api/partners/by-phone/:phone (phone scoped to a channel key_name and
// its sub-channels), exposed as a POST for GCN's service-token caller — GCN's own
// lookupNanoDirectStore/finalizeSectorLogin/handleNanoSSO call this at login/webview-SSO time
// to decide whether an unprovisioned GCN partner row should be auto-created at the caller's
// real nano tier instead of defaulting to plain 'member'. Was missing entirely until
// 2026-07-28 (never implemented, not in GCN_ALLOWED_PATHS), so every such call failed silently
// and every not-yet-provisioned partner landed on GCN as 'member' — see partner-system.md.
async function handleGcnPartnerLookup(body) {
    const { phone, channel } = body || {};
    const result = await handleGetPartnerByPhone(phone, channel);
    if (!result.success) return result;
    return { success: true, partner: result.partner };
}

// POST /api/partner-sales
// Body: { partner_id, sale_amount_cny, description? }
// Reports a completed sale for an existing partner and triggers nano's own commission
// engine (recordSalesCommission — rate lookup from partner_commission_rules + level-1/
// level-2 team-income fan-out off the referral chain). Distinct from the raw ledger-entry
// endpoint POST /api/partner-commissions (which requires a pre-computed amount_cny and does
// no rate calculation) — this is the automated path external systems like GCN should call.
async function handlePostPartnerSale(body) {
    const { partner_id, sale_amount_cny, description } = body;
    if (!partner_id || !sale_amount_cny) {
        return { success: false, error: 'partner_id, sale_amount_cny are required', statusCode: 400 };
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await recordSalesCommission(partner_id, Number(sale_amount_cny), description || null);
        // recordSalesCommission also fans out commissions to upline partners; return just
        // the seller's own new row(s) here (source_type='sales', commission_level=0) as
        // a lightweight confirmation, not the full upline set.
        const { rows } = await pool.query(
            `SELECT * FROM partner_commissions
             WHERE partner_id = $1 AND source_type = 'sales' AND commission_level = 0
             ORDER BY created_at DESC LIMIT 1`,
            [partner_id]
        );
        return { success: true, commission: rows[0] || null };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// POST /api/partners/:id/gcn-provision
// Explicit action (nano admin panel button) that provisions this partner a GCN store —
// replaces the old implicit "GCN creates it on first login" flow, so store creation is an
// intentional admin action rather than a side effect of a partner's first GCN login. Only
// meaningful for partners in a GCN-linked channel. Stores the returned GCN partner_id back
// on partners.gcn_partner_id so the admin UI can show provisioning status.
async function handlePostPartnerGcnProvision(partnerId) {
    if (!partnerId) return { success: false, error: 'partner id required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query(`
            SELECT p.id, p.tier, p.real_name, p.phone, p.status, p.gcn_partner_id, ch.key_name AS channel_key
            FROM partners p
            LEFT JOIN channels ch ON ch.id = p.channel_id
            WHERE p.id = $1
        `, [partnerId]);
        const partner = rows[0];
        if (!partner) return { success: false, error: 'Partner not found', statusCode: 404 };
        if (!GCN_LINKED_CHANNEL_KEYS.has(partner.channel_key)) {
            return { success: false, error: 'Partner is not in a GCN-linked channel', statusCode: 400 };
        }
        if (partner.status !== 'active') {
            return { success: false, error: 'Partner must be active before provisioning a GCN store', statusCode: 400 };
        }

        const result = await gcnFetch('/api/auth/partners/nano/provision', {
            method: 'POST',
            body: {
                nano_partner_id: partner.id,
                phone: partner.phone,
                tier: partner.tier,
                real_name: partner.real_name,
                sector_id: 'aeviva',
            },
        });

        await pool.query(`UPDATE partners SET gcn_partner_id = $1, updated_at = NOW() WHERE id = $2`, [result.partner_id, partnerId]);
        return { success: true, gcn_partner_id: result.partner_id };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// POST /api/partners/:id/invite-code  (nano admin panel — "Invite Link" button)
// Lazily generates and persists this partner's self-service invite code, or returns the
// existing one — idempotent, same shape as handlePostPartnerGcnProvision above. The code
// is shared as https://aeviva(-dev).gcn.net/partner-apply.html?code=<code>, letting a new
// applicant apply pre-linked to this partner as upline (see handleGcnPartnerApply below)
// without an admin manually creating the record.
async function handlePostPartnerInviteCode(partnerId) {
    if (!partnerId) return { success: false, error: 'partner id required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query(`SELECT invite_code FROM partners WHERE id = $1`, [partnerId]);
        if (rows.length === 0) return { success: false, error: 'Partner not found', statusCode: 404 };
        if (rows[0].invite_code) return { success: true, invite_code: rows[0].invite_code };

        const code = await generatePartnerInviteCode();
        await pool.query(`UPDATE partners SET invite_code = $1, updated_at = NOW() WHERE id = $2`, [code, partnerId]);
        return { success: true, invite_code: code };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// POST /partner-invite-code-gcn  (GCN service-token only, see GCN_ALLOWED_PATHS in index.js)
// Body: { nano_partner_id }
// Same lazy-generate-or-return as handlePostPartnerInviteCode above, keyed by body field
// instead of a URL param so GCN's dashboard-channel.html can let a logged-in partner see
// their own invite link (GET /api/auth/partners/me/invite-code on GCN's side, resolving
// its own local partners.nano_partner_id and relaying here).
async function handleGcnPartnerInviteCode(body) {
    const { nano_partner_id } = body || {};
    if (!nano_partner_id) return { success: false, error: 'nano_partner_id required', statusCode: 400 };
    return handlePostPartnerInviteCode(nano_partner_id);
}

// POST /partner-applications  (GCN service-token only, see GCN_ALLOWED_PATHS in index.js)
// Body: { invite_code, tier, real_name, phone }
// Public self-service application, relayed here by GCN's POST /api/auth/partners/aeviva/apply
// (GCN itself has no auth requirement on that endpoint — anyone with a shared invite link can
// apply). Resolves invite_code to the inviting partner (must be active) and creates the new
// partner as 'pending', pre-linked via referred_by_partner_id — mirroring the manual
// admin-panel flow's upline linkage, but without requiring an admin to search/select it.
// Deliberately does NOT call recordReferralCommission() here (unlike handlePostPartner) —
// a spam or fraudulent application must never mint a real commission ledger entry. The
// commission fires later, when an admin actually activates this partner (see the
// pending->active transition logic in handlePutPartner below), after they've verified the
// real entry fee was paid.
async function handleGcnPartnerApply(body) {
    const { invite_code, tier, real_name, phone } = body || {};
    if (!invite_code || !tier || !real_name || !phone) {
        return { success: false, error: 'invite_code, tier, real_name, phone are required', statusCode: 400 };
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        const typeCheck = await pool.query(`SELECT key FROM partner_types WHERE key=$1 AND is_active=TRUE`, [tier]);
        if (typeCheck.rows.length === 0) return { success: false, error: `Invalid partner tier: ${tier}`, statusCode: 400 };

        const inviterRes = await pool.query(
            `SELECT id, channel_id FROM partners WHERE invite_code = $1 AND status = 'active'`,
            [invite_code]
        );
        if (inviterRes.rows.length === 0) return { success: false, error: 'Invalid or inactive invite code', statusCode: 404 };
        const inviter = inviterRes.rows[0];

        const { rows } = await pool.query(`
            INSERT INTO partners (tier, real_name, phone, entry_fee_paid, channel_id,
                                  referred_by_partner_id, status)
            VALUES ($1,$2,$3,0,$4,$5,'pending')
            RETURNING id, status
        `, [tier, real_name, phone, inviter.channel_id, inviter.id]);

        return { success: true, partner_id: rows[0].id, status: rows[0].status };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostPartner(body, adminCtx) {
    const { tier, real_name, phone, entry_fee_paid, channel_id, user_id, referred_by_partner_id, contracted_at, notes, status } = body;
    if (!tier || !real_name || !phone || entry_fee_paid === undefined || entry_fee_paid === null) {
        return { success: false, error: 'tier, real_name, phone, entry_fee_paid are required', statusCode: 400 };
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const typeCheck = await pool.query(`SELECT key FROM partner_types WHERE key=$1 AND is_active=TRUE`, [tier]);
        if (typeCheck.rows.length === 0) return { success: false, error: `Invalid partner tier: ${tier}`, statusCode: 400 };

        // Channel-scoped admins never submit channel_id (the Add Partner form has no such field) —
        // default to their own channel so the new partner actually shows up in handleGetPartners'
        // channel-filtered list. Superadmins may still pass an explicit channel_id, or none.
        const resolvedChannelId = adminCtx?.channelId || channel_id || null;

        const { rows } = await pool.query(`
            INSERT INTO partners (tier, real_name, phone, entry_fee_paid, channel_id, user_id,
                                  referred_by_partner_id, contracted_at, notes, status)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            RETURNING *
        `, [tier, real_name, phone, entry_fee_paid, resolvedChannelId, user_id || null,
            referred_by_partner_id || null, contracted_at || null, notes || null, status || 'active']);
        const newPartner = rows[0];

        if (referred_by_partner_id) {
            await recordReferralCommission(newPartner);
        }

        return { success: true, partner: newPartner };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Re-sync a partner's tier/status/name to GCN once a store already exists there for them
// (gcn_partner_id set) — otherwise a change made via handlePutPartner or handleDeletePartner
// never reaches GCN, since the "Provision GCN Store" button is a one-time initial action,
// hidden from the admin UI the moment gcn_partner_id is set (see PartnersTab.jsx). Best-effort:
// GCN being unreachable must not fail the nano-side write that already committed. Returns an
// error message string on failure, or null on success/skip.
async function syncGcnPartnerStatus(partner) {
    if (!partner.gcn_partner_id) return null;
    try {
        const chRes = await pool.query(`SELECT key_name FROM channels WHERE id = $1`, [partner.channel_id]);
        const channelKey = chRes.rows[0]?.key_name;
        if (!GCN_LINKED_CHANNEL_KEYS.has(channelKey)) return null;
        await gcnFetch('/api/auth/partners/nano/provision', {
            method: 'POST',
            body: {
                nano_partner_id: partner.id,
                phone: partner.phone,
                tier: partner.tier,
                real_name: partner.real_name,
                status: NANO_TO_GCN_STATUS[partner.status] || 'active',
                sector_id: 'aeviva',
            },
        });
        return null;
    } catch (err) {
        return err.message;
    }
}

async function handlePutPartner(partnerId, body) {
    if (!partnerId) return { success: false, error: 'partner id required', statusCode: 400 };
    const { tier, real_name, phone, entry_fee_paid, channel_id, user_id,
            referred_by_partner_id, contracted_at, notes, status } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        if (tier) {
            const typeCheck = await pool.query(`SELECT key FROM partner_types WHERE key=$1 AND is_active=TRUE`, [tier]);
            if (typeCheck.rows.length === 0) return { success: false, error: `Invalid partner tier: ${tier}`, statusCode: 400 };
        }

        // Capture prior status to detect a pending->active activation below — self-applied
        // invite partners (handleGcnPartnerApply) land as 'pending' with no commission fired
        // yet; this is where that deferred referral commission actually gets recorded, once
        // an admin has verified the real entry fee and approves them through this same
        // Edit Partner save (no separate "approve" endpoint needed).
        const priorRes = await pool.query(`SELECT status FROM partners WHERE id = $1`, [partnerId]);
        if (priorRes.rows.length === 0) return { success: false, error: 'Partner not found', statusCode: 404 };
        const priorStatus = priorRes.rows[0].status;

        const { rows } = await pool.query(`
            UPDATE partners SET
                tier=$1, real_name=$2, phone=$3, entry_fee_paid=$4,
                channel_id=$5, user_id=$6, referred_by_partner_id=$7,
                contracted_at=$8, notes=$9, status=$10, updated_at=NOW()
            WHERE id=$11
            RETURNING *
        `, [tier, real_name, phone, entry_fee_paid, channel_id || null, user_id || null,
            referred_by_partner_id || null, contracted_at || null, notes || null,
            status || 'active', partnerId]);
        const updatedPartner = rows[0];

        if (priorStatus === 'pending' && updatedPartner.status === 'active' && updatedPartner.referred_by_partner_id) {
            const existing = await pool.query(
                `SELECT 1 FROM partner_commissions WHERE source_partner_id = $1 AND source_type = 'referral'`,
                [updatedPartner.id]
            );
            if (existing.rows.length === 0) {
                await recordReferralCommission(updatedPartner);
            }
        }

        const gcnSyncError = await syncGcnPartnerStatus(updatedPartner);

        return gcnSyncError ? { success: true, gcnSyncError } : { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeletePartner(partnerId) {
    if (!partnerId) return { success: false, error: 'partner id required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query(
            `UPDATE partners SET status='inactive', updated_at=NOW() WHERE id=$1 RETURNING *`,
            [partnerId]
        );
        if (rows.length === 0) return { success: false, error: 'Partner not found', statusCode: 404 };

        const gcnSyncError = await syncGcnPartnerStatus(rows[0]);

        return gcnSyncError ? { success: true, gcnSyncError } : { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetPartnerCommissions(query) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const conditions = [];
        const params = [];
        if (query.partner_id)   { params.push(query.partner_id);   conditions.push(`pc.partner_id=$${params.length}`); }
        if (query.source_type)  { params.push(query.source_type);  conditions.push(`pc.source_type=$${params.length}`); }
        if (query.status)       { params.push(query.status);       conditions.push(`pc.status=$${params.length}`); }
        if (query.channel_id)   { params.push(query.channel_id);   conditions.push(`p.channel_id=$${params.length}`); }
        if (query.from)         { params.push(query.from);         conditions.push(`pc.created_at>=$${params.length}`); }
        if (query.to)           { params.push(query.to);           conditions.push(`pc.created_at<=$${params.length}`); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const { rows } = await pool.query(`
            SELECT pc.*, p.real_name AS partner_name, p.tier AS partner_tier,
                   sp.real_name AS source_partner_name
            FROM partner_commissions pc
            JOIN partners p ON p.id = pc.partner_id
            LEFT JOIN partners sp ON sp.id = pc.source_partner_id
            ${where}
            ORDER BY pc.created_at DESC
            LIMIT 500
        `, params);
        return { success: true, commissions: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostPartnerCommission(body) {
    const { partner_id, source_type, source_partner_id, amount_cny, rate, base_amount, description } = body;
    if (!partner_id || !source_type || !amount_cny) {
        return { success: false, error: 'partner_id, source_type, amount_cny are required', statusCode: 400 };
    }
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query(`
            INSERT INTO partner_commissions
                (partner_id, source_type, source_partner_id, amount_cny, rate, base_amount, description)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING *
        `, [partner_id, source_type, source_partner_id || null, amount_cny,
            rate || null, base_amount || null, description || null]);
        return { success: true, commission: rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetPartnerPayouts(query) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const conditions = [];
        const params = [];
        if (query.partner_id) { params.push(query.partner_id); conditions.push(`pp.partner_id=$${params.length}`); }
        if (query.status)     { params.push(query.status);     conditions.push(`pp.status=$${params.length}`); }
        if (query.channel_id) { params.push(query.channel_id); conditions.push(`p.channel_id=$${params.length}`); }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const { rows } = await pool.query(`
            SELECT pp.*, p.real_name AS partner_name, p.tier AS partner_tier,
                   ch.name AS channel_name
            FROM partner_payouts pp
            JOIN partners p ON p.id = pp.partner_id
            LEFT JOIN channels ch ON ch.id = p.channel_id
            ${where}
            ORDER BY pp.period DESC, pp.created_at DESC
        `, params);
        return { success: true, payouts: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostGeneratePartnerPayouts(body) {
    const { period, channel_id } = body;
    if (!period) return { success: false, error: 'period required (YYYY-MM)', statusCode: 400 };
    try {
        const result = await generatePartnerPayouts(period, channel_id || null);
        return { success: true, ...result };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutPartnerPayout(payoutId, body) {
    const { status, notes } = body;
    if (!status) return { success: false, error: 'status required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const now = new Date().toISOString();
        await pool.query(`
            UPDATE partner_payouts SET
                status=$1,
                approved_at=CASE WHEN $1='approved' THEN $2 ELSE approved_at END,
                transferred_at=CASE WHEN $1='transferred' THEN $2 ELSE transferred_at END,
                notes=COALESCE($3, notes)
            WHERE id=$4
        `, [status, now, notes || null, payoutId]);
        if (status === 'approved' || status === 'transferred') {
            await pool.query(
                `UPDATE partner_commissions SET status=$1 WHERE payout_id=$2`,
                [status, payoutId]
            );
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// POST /partner-children-gcn  (GCN service-token only, see GCN_ALLOWED_PATHS in index.js)
// Body: { requesting_partner_id, target_partner_id? }
// Returns ONE level of direct downline (`referred_by_partner_id = target_partner_id`), each
// row flagged with `has_children` so GCN's dashboard-channel.html can render a lazy,
// expand-on-demand tree instead of eagerly fetching a whole (unbounded-depth) subtree.
// `target_partner_id` defaults to `requesting_partner_id` for the initial root-level call;
// deeper calls pass the id of whichever row the store owner just expanded. `target_partner_id`
// must be `requesting_partner_id` itself or a genuine descendant of it — verified by walking
// the `referred_by_partner_id` chain up from the target — so a store owner can't page into an
// unrelated branch of the network by guessing another partner's id.
async function handleGcnPartnerChildren(body) {
    const { requesting_partner_id, target_partner_id } = body || {};
    if (!requesting_partner_id) return { success: false, error: 'requesting_partner_id required', statusCode: 400 };
    const targetId = target_partner_id || requesting_partner_id;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        if (String(targetId) !== String(requesting_partner_id)) {
            const { rows: ancestry } = await pool.query(
                `WITH RECURSIVE ancestors AS (
                    SELECT id, referred_by_partner_id FROM partners WHERE id = $1
                    UNION ALL
                    SELECT p.id, p.referred_by_partner_id
                    FROM partners p JOIN ancestors a ON p.id = a.referred_by_partner_id
                 )
                 SELECT 1 FROM ancestors WHERE id = $2 LIMIT 1`,
                [targetId, requesting_partner_id]
            );
            if (ancestry.length === 0) return { success: false, error: 'Forbidden', statusCode: 403 };
        }

        const { rows: children } = await pool.query(
            `SELECT id, real_name, tier, status, invite_code,
                    EXISTS (SELECT 1 FROM partners c2 WHERE c2.referred_by_partner_id = c.id) AS has_children
             FROM partners c
             WHERE c.referred_by_partner_id = $1
             ORDER BY c.created_at ASC`,
            [targetId]
        );

        return { success: true, target_partner_id: targetId, children };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// POST /partner-descendants-gcn  (GCN service-token only, see GCN_ALLOWED_PATHS in index.js)
// Body: { requesting_partner_id }
// Returns the FULL flat downline (every descendant, any depth) of requesting_partner_id —
// unlike handleGcnPartnerChildren above (one level, lazy-expand, for rendering the tree UI),
// this backs a stock-rollup aggregate query on GCN's side where GCN needs the complete set of
// partner ids up front to run one grouped SQL query, not a per-node fetch. Always rooted at the
// caller's own id, so (unlike handleGcnPartnerChildren) no ancestry check is needed — a partner
// can only ever ask for their own subtree, never an arbitrary target.
async function handleGcnPartnerDescendants(body) {
    const { requesting_partner_id } = body || {};
    if (!requesting_partner_id) return { success: false, error: 'requesting_partner_id required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        const { rows: descendants } = await pool.query(
            `WITH RECURSIVE descendants AS (
                SELECT id FROM partners WHERE referred_by_partner_id = $1
                UNION ALL
                SELECT p.id FROM partners p JOIN descendants d ON p.referred_by_partner_id = d.id
             )
             SELECT id FROM descendants`,
            [requesting_partner_id]
        );

        return { success: true, partner_ids: descendants.map((r) => r.id) };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetChannelReferralNetwork(channelId) {
    if (!channelId) return { success: false, error: 'channel_id is required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query(
            `WITH RECURSIVE subtree AS (
                SELECT id FROM channels WHERE id = $1
                UNION ALL
                SELECT c.id FROM channels c JOIN subtree s ON c.parent_channel_id = s.id
            )
            SELECT u.user_id, u.nickname, u.avatar_url, u.referral_code,
                    u.referred_by_user_id,
                    inv.created_by        AS invited_by_user_id,
                    inv_u.nickname        AS inviter_nickname,
                    inv_u.avatar_url      AS inviter_avatar_url,
                    co.user_id            AS coach_user_id,
                    co_u.nickname         AS coach_nickname,
                    co_u.avatar_url       AS coach_avatar_url
             FROM users u
             LEFT JOIN invitations inv  ON inv.id  = u.invited_by_invitation_id
             LEFT JOIN users inv_u      ON inv_u.user_id = inv.created_by
             LEFT JOIN coaches co       ON co.id   = u.coach_id
             LEFT JOIN users co_u       ON co_u.user_id = co.user_id
             WHERE u.channel_id IN (SELECT id FROM subtree)`,
            [channelId]
        );
        const channelUserIds = new Set(rows.map(r => r.user_id));
        const nodesMap = new Map();
        for (const r of rows) {
            nodesMap.set(r.user_id, {
                id: r.user_id,
                nickname: r.nickname || null,
                avatar_url: r.avatar_url || null,
                referral_code: r.referral_code || null,
                _isExternal: false,
            });
        }

        const addExternalNode = (userId, nickname, avatarUrl) => {
            if (!nodesMap.has(userId)) {
                nodesMap.set(userId, {
                    id: userId,
                    nickname: nickname || null,
                    avatar_url: avatarUrl || null,
                    referral_code: null,
                    _isExternal: true,
                });
            }
        };

        const linkKey = (src, tgt, type) => `${src}→${tgt}:${type}`;
        const linksSeen = new Set();
        const links = [];
        const addLink = (src, tgt, type) => {
            const k = linkKey(src, tgt, type);
            if (!linksSeen.has(k)) { linksSeen.add(k); links.push({ source: src, target: tgt, type }); }
        };

        for (const r of rows) {
            if (r.referred_by_user_id && channelUserIds.has(r.referred_by_user_id)) {
                addLink(r.referred_by_user_id, r.user_id, 'referral');
            }
            if (r.invited_by_user_id && r.invited_by_user_id !== r.referred_by_user_id) {
                addExternalNode(r.invited_by_user_id, r.inviter_nickname, r.inviter_avatar_url);
                addLink(r.invited_by_user_id, r.user_id, 'invitation');
            }
            if (r.coach_user_id && r.coach_user_id !== r.invited_by_user_id && r.coach_user_id !== r.referred_by_user_id) {
                addExternalNode(r.coach_user_id, r.coach_nickname, r.coach_avatar_url);
                addLink(r.coach_user_id, r.user_id, 'coach');
            }
        }
        return { success: true, nodes: [...nodesMap.values()], links };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Shim: synthesise old JSON format from partner_commission_rules ────────────
async function handleGetPartnerCommissionConfig() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows } = await pool.query(
            `SELECT * FROM partner_commission_rules WHERE is_active = TRUE ORDER BY sort_order, id`
        );
        const referral_rates = {};
        const product_discount_rates = {};
        const training_discount_rates = {};
        let team_primary_rate = 0.02;
        let team_secondary_rate = 0.02;
        for (const rule of rows) {
            if (rule.event_type === 'referral' && rule.earner_type && rule.subject_type) {
                if (!referral_rates[rule.earner_type]) referral_rates[rule.earner_type] = {};
                referral_rates[rule.earner_type][rule.subject_type] = Number(rule.rate);
            } else if (rule.event_type === 'product_discount' && rule.earner_type) {
                product_discount_rates[rule.earner_type] = Number(rule.rate);
            } else if (rule.event_type === 'training_discount' && rule.earner_type) {
                training_discount_rates[rule.earner_type] = Number(rule.rate);
            } else if (rule.event_type === 'team_income') {
                if (rule.upline_level === 1) team_primary_rate = Number(rule.rate);
                if (rule.upline_level === 2) team_secondary_rate = Number(rule.rate);
            }
        }
        return { success: true, config: { referral_rates, product_discount_rates, training_discount_rates, team_primary_rate, team_secondary_rate } };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Shim: translate old JSON format into upserts on partner_commission_rules ──
async function handlePutPartnerCommissionConfig(body) {
    const { referral_rates, product_discount_rates, training_discount_rates, team_primary_rate, team_secondary_rate } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const toUpsert = [];
        let order = 0;
        if (referral_rates) {
            for (const [earner, subjects] of Object.entries(referral_rates)) {
                for (const [subject, rate] of Object.entries(subjects)) {
                    toUpsert.push({ event_type: 'referral', upline_level: 1, earner_type: earner, subject_type: subject, rate: Number(rate), description: `Referral: ${earner} → ${subject}`, sort_order: order++ });
                }
            }
        }
        if (product_discount_rates) {
            for (const [tier, rate] of Object.entries(product_discount_rates)) {
                toUpsert.push({ event_type: 'product_discount', upline_level: null, earner_type: tier, subject_type: null, rate: Number(rate), description: `Product discount: ${tier}`, sort_order: order++ });
            }
        }
        if (training_discount_rates) {
            for (const [tier, rate] of Object.entries(training_discount_rates)) {
                toUpsert.push({ event_type: 'training_discount', upline_level: null, earner_type: tier, subject_type: null, rate: Number(rate), description: `Training discount: ${tier}`, sort_order: order++ });
            }
        }
        if (team_primary_rate != null) toUpsert.push({ event_type: 'team_income', upline_level: 1, earner_type: null, subject_type: null, rate: Number(team_primary_rate), description: 'Team income level 1', sort_order: order++ });
        if (team_secondary_rate != null) toUpsert.push({ event_type: 'team_income', upline_level: 2, earner_type: null, subject_type: null, rate: Number(team_secondary_rate), description: 'Team income level 2', sort_order: order++ });

        for (const rule of toUpsert) {
            await pool.query(
                `DELETE FROM partner_commission_rules WHERE event_type=$1 AND (upline_level IS NOT DISTINCT FROM $2) AND (earner_type IS NOT DISTINCT FROM $3) AND (subject_type IS NOT DISTINCT FROM $4)`,
                [rule.event_type, rule.upline_level, rule.earner_type, rule.subject_type]
            );
            await pool.query(
                `INSERT INTO partner_commission_rules (event_type, upline_level, earner_type, subject_type, rate, description, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [rule.event_type, rule.upline_level, rule.earner_type, rule.subject_type, rule.rate, rule.description, rule.sort_order]
            );
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Partner Types CRUD ────────────────────────────────────────────────────────
// GET /api/partner-types
// - No channel_id param → effective types for caller:
//     superadmin gets all global types; channel admin gets their channel's types
//     if they have can_customize_partner_system AND have created some, else global.
// - ?channel_id=X → returns ONLY channel-specific types stored for channel X
//     (used by channel config modal for CRUD).
async function handleGetPartnerTypes(query, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const requestedChannelId = query?.channel_id ? parseInt(query.channel_id) : null;

        if (adminCtx?.role === 'channel') {
            const myChannelId = adminCtx.channelId;
            if (requestedChannelId) {
                // Scope check: must be own channel or owned subchannel
                if (requestedChannelId !== myChannelId) {
                    const owns = await verifySubchannelOwnership(requestedChannelId, adminCtx);
                    if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
                }
                const { rows } = await pool.query(
                    `SELECT * FROM partner_types WHERE channel_id = $1 ORDER BY sort_order, id`,
                    [requestedChannelId]
                );
                return { success: true, types: rows };
            }
            // No explicit channel_id: return effective types for dropdowns
            const { rows: permRows } = await pool.query(
                `SELECT can_customize_partner_system FROM channels WHERE id = $1`, [myChannelId]
            );
            if (permRows[0]?.can_customize_partner_system) {
                const { rows: channelTypes } = await pool.query(
                    `SELECT * FROM partner_types WHERE channel_id = $1 AND is_active = TRUE ORDER BY sort_order, id`,
                    [myChannelId]
                );
                if (channelTypes.length > 0) return { success: true, types: channelTypes };
            }
            // Fall through: return global types
            const { rows } = await pool.query(
                `SELECT * FROM partner_types WHERE channel_id IS NULL ORDER BY sort_order, id`
            );
            return { success: true, types: rows };
        }

        // Superadmin
        if (requestedChannelId) {
            const { rows } = await pool.query(
                `SELECT * FROM partner_types WHERE channel_id = $1 ORDER BY sort_order, id`,
                [requestedChannelId]
            );
            return { success: true, types: rows };
        }
        const { rows } = await pool.query(
            `SELECT * FROM partner_types ORDER BY COALESCE(channel_id, 0), sort_order, id`
        );
        return { success: true, types: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostPartnerType(body, adminCtx) {
    const { key, label, label_zh, color, entry_fee, sort_order, description, channel_id: bodyChannelId } = body;
    if (!key || !label) return { success: false, error: 'key and label are required', statusCode: 400 };
    if (!/^[a-z][a-z0-9_]*$/.test(key)) return { success: false, error: 'key must be snake_case (lowercase letters, digits, underscores)', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let channelId = null;
        if (adminCtx?.role === 'channel') {
            const { rows: permRows } = await pool.query(
                `SELECT can_customize_partner_system FROM channels WHERE id = $1`, [adminCtx.channelId]
            );
            if (!permRows[0]?.can_customize_partner_system)
                return { statusCode: 403, success: false, error: 'Channel does not have partner system customization permission' };
            channelId = adminCtx.channelId;
        } else {
            channelId = bodyChannelId ? parseInt(bodyChannelId) : null;
        }
        const { rows } = await pool.query(
            `INSERT INTO partner_types (key, label, label_zh, color, entry_fee, sort_order, description, channel_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [key, label, label_zh || null, color || '#64748b', entry_fee || 0, sort_order || 0, description || null, channelId]
        );
        return { success: true, type: rows[0] };
    } catch (err) {
        if (err.code === '23505') return { success: false, error: `Partner type key '${key}' already exists in this channel`, statusCode: 409 };
        return { success: false, error: err.message };
    }
}

async function handlePutPartnerType(typeKey, body, adminCtx) {
    if (!typeKey) return { success: false, error: 'type key required', statusCode: 400 };
    let { label, label_zh, color, entry_fee, sort_order, description, is_active } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        // Identity fields (label/label_zh) are owned by GCN for GCN-managed tiers — silently
        // drop any attempt to change them here rather than trusting the frontend to withhold
        // them. Only entry_fee/color/sort_order/description/is_active (nano-only concerns) may
        // still be edited locally for these rows.
        const { rows: managedRows } = await pool.query(
            `SELECT managed_by_gcn FROM partner_types WHERE key = $1`, [typeKey]
        );
        if (managedRows[0]?.managed_by_gcn) {
            label = null;
            label_zh = null;
        }
        let channelFilter, params;
        if (adminCtx?.role === 'channel') {
            const { rows: permRows } = await pool.query(
                `SELECT can_customize_partner_system FROM channels WHERE id = $1`, [adminCtx.channelId]
            );
            if (!permRows[0]?.can_customize_partner_system)
                return { statusCode: 403, success: false, error: 'Forbidden' };
            channelFilter = 'channel_id = $9';
            params = [label, label_zh, color, entry_fee, sort_order, description, is_active, typeKey, adminCtx.channelId];
        } else {
            // Superadmin: can pass channel_id in body to edit channel-specific types, else global
            const targetChannelId = body.channel_id ? parseInt(body.channel_id) : null;
            channelFilter = targetChannelId ? `channel_id = $9` : `channel_id IS NULL`;
            params = targetChannelId
                ? [label, label_zh, color, entry_fee, sort_order, description, is_active, typeKey, targetChannelId]
                : [label, label_zh, color, entry_fee, sort_order, description, is_active, typeKey];
        }
        const { rows } = await pool.query(
            `UPDATE partner_types SET
                label=COALESCE($1,label), label_zh=COALESCE($2,label_zh), color=COALESCE($3,color),
                entry_fee=COALESCE($4,entry_fee), sort_order=COALESCE($5,sort_order),
                description=COALESCE($6,description), is_active=COALESCE($7,is_active), updated_at=NOW()
             WHERE key=$8 AND ${channelFilter} RETURNING *`,
            params
        );
        if (rows.length === 0) return { success: false, error: 'Partner type not found', statusCode: 404 };
        return { success: true, type: rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeletePartnerType(typeKey, adminCtx) {
    if (!typeKey) return { success: false, error: 'type key required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const { rows: managedRows } = await pool.query(
            `SELECT managed_by_gcn FROM partner_types WHERE key = $1`, [typeKey]
        );
        if (managedRows[0]?.managed_by_gcn) {
            return { success: false, error: "tier is managed in GCN — delete it from GCN's Wholesale Rules panel", statusCode: 409 };
        }
        let channelFilter, params;
        if (adminCtx?.role === 'channel') {
            const { rows: permRows } = await pool.query(
                `SELECT can_customize_partner_system FROM channels WHERE id = $1`, [adminCtx.channelId]
            );
            if (!permRows[0]?.can_customize_partner_system)
                return { statusCode: 403, success: false, error: 'Forbidden' };
            channelFilter = 'channel_id = $2';
            params = [typeKey, adminCtx.channelId];
        } else {
            const targetChannelId = null; // superadmin delete always targets global types by key
            channelFilter = 'channel_id IS NULL';
            params = [typeKey];
        }
        const { rows: active } = await pool.query(
            `SELECT COUNT(*) AS cnt FROM partners WHERE tier=$1 AND status='active'`, [typeKey]
        );
        if (Number(active[0].cnt) > 0) {
            return { success: false, error: `Cannot deactivate: ${active[0].cnt} active partner(s) use this type`, statusCode: 409 };
        }
        await pool.query(
            `UPDATE partner_types SET is_active=FALSE, updated_at=NOW() WHERE key=$1 AND ${channelFilter}`,
            params
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// POST /partner-types-gcn-sync  (GCN service token only, see worker/index.js GCN_ALLOWED_PATHS)
// Push target for GCN's Wholesale Rules panel (handlePostPartnerType/handlePutPartnerType/
// handleDeletePartnerType in gcn/src/functions/mall/index.js) — GCN owns a GCN-linked tier's
// identity (key/label/label_zh), nano keeps local ownership of entry_fee/color/sort_order/
// description/is_active, which have no GCN-side equivalent. Body: { type_id, label_zh, label_en,
// tier_rank, action }, action: 'upsert' | 'deactivate'.
async function handleGcnSyncPartnerType(body) {
    const { type_id, label_zh, label_en, tier_rank, action } = body || {};
    if (!type_id) return { success: false, error: 'type_id required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };

        if (action === 'deactivate') {
            await pool.query(
                `UPDATE partner_types SET is_active = FALSE, updated_at = NOW() WHERE key = $1`,
                [type_id]
            );
            return { success: true };
        }

        // Only label/label_zh/managed_by_gcn are overwritten on conflict — entry_fee/color/
        // sort_order/description are nano-owned and must survive repeated syncs from GCN.
        // sort_order is seeded from tier_rank on first insert only, as a starting default nano
        // admins remain free to reorder locally afterward.
        const { rows } = await pool.query(
            `INSERT INTO partner_types (key, label, label_zh, sort_order, managed_by_gcn)
             VALUES ($1, $2, $3, $4, TRUE)
             ON CONFLICT (COALESCE(channel_id, 0), key) DO UPDATE SET
                 label = EXCLUDED.label, label_zh = EXCLUDED.label_zh,
                 managed_by_gcn = TRUE, updated_at = NOW()
             RETURNING *`,
            [type_id, label_en || type_id, label_zh || null, Number.isFinite(Number(tier_rank)) ? Number(tier_rank) : 0]
        );
        return { success: true, type: rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Partner Commission Rules CRUD ─────────────────────────────────────────────
// GET /api/partner-commission-rules
// - No channel_id → all global rules (superadmin) or channel admin's channel rules
// - ?channel_id=X → rules scoped to channel X
async function handleGetPartnerCommissionRules(query, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const requestedChannelId = query?.channel_id ? parseInt(query.channel_id) : null;

        if (adminCtx?.role === 'channel') {
            const myChannelId = adminCtx.channelId;
            const targetId = requestedChannelId || myChannelId;
            if (targetId !== myChannelId) {
                const owns = await verifySubchannelOwnership(targetId, adminCtx);
                if (!owns) return { statusCode: 403, success: false, error: 'Forbidden' };
            }
            const { rows } = await pool.query(
                `SELECT * FROM partner_commission_rules WHERE channel_id = $1 ORDER BY event_type, sort_order, id`,
                [targetId]
            );
            return { success: true, rules: rows };
        }

        // Superadmin
        if (requestedChannelId) {
            const { rows } = await pool.query(
                `SELECT * FROM partner_commission_rules WHERE channel_id = $1 ORDER BY event_type, sort_order, id`,
                [requestedChannelId]
            );
            return { success: true, rules: rows };
        }
        const { rows } = await pool.query(
            `SELECT * FROM partner_commission_rules WHERE channel_id IS NULL ORDER BY event_type, sort_order, id`
        );
        return { success: true, rules: rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostPartnerCommissionRule(body, adminCtx) {
    const { event_type, upline_level, earner_type, subject_type, rate, description, sort_order, channel_id: bodyChannelId } = body;
    if (!event_type || rate == null) return { success: false, error: 'event_type and rate are required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let channelId = null;
        if (adminCtx?.role === 'channel') {
            const { rows: permRows } = await pool.query(
                `SELECT can_customize_partner_system FROM channels WHERE id = $1`, [adminCtx.channelId]
            );
            if (!permRows[0]?.can_customize_partner_system)
                return { statusCode: 403, success: false, error: 'Channel does not have partner system customization permission' };
            channelId = adminCtx.channelId;
        } else {
            channelId = bodyChannelId ? parseInt(bodyChannelId) : null;
        }
        const { rows } = await pool.query(
            `INSERT INTO partner_commission_rules (event_type, upline_level, earner_type, subject_type, rate, description, sort_order, channel_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [event_type, upline_level ?? null, earner_type || null, subject_type || null, rate, description || null, sort_order || 0, channelId]
        );
        return { success: true, rule: rows[0] };
    } catch (err) {
        if (err.code === '23505') return { success: false, error: 'A rule with this exact combination already exists in this channel', statusCode: 409 };
        return { success: false, error: err.message };
    }
}

async function handlePutPartnerCommissionRule(ruleId, body, adminCtx) {
    if (!ruleId) return { success: false, error: 'rule id required', statusCode: 400 };
    const { rate, description, is_active, sort_order } = body;
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let channelFilter = '';
        let params = [rate, description, is_active, sort_order, ruleId];
        if (adminCtx?.role === 'channel') {
            const { rows: permRows } = await pool.query(
                `SELECT can_customize_partner_system FROM channels WHERE id = $1`, [adminCtx.channelId]
            );
            if (!permRows[0]?.can_customize_partner_system)
                return { statusCode: 403, success: false, error: 'Forbidden' };
            channelFilter = ` AND channel_id = $${params.length + 1}`;
            params.push(adminCtx.channelId);
        }
        const { rows } = await pool.query(
            `UPDATE partner_commission_rules SET
                rate=COALESCE($1,rate), description=COALESCE($2,description),
                is_active=COALESCE($3,is_active), sort_order=COALESCE($4,sort_order), updated_at=NOW()
             WHERE id=$5${channelFilter} RETURNING *`,
            params
        );
        if (rows.length === 0) return { success: false, error: 'Rule not found', statusCode: 404 };
        return { success: true, rule: rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeletePartnerCommissionRule(ruleId, adminCtx) {
    if (!ruleId) return { success: false, error: 'rule id required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        let channelFilter = '';
        let params = [ruleId];
        if (adminCtx?.role === 'channel') {
            const { rows: permRows } = await pool.query(
                `SELECT can_customize_partner_system FROM channels WHERE id = $1`, [adminCtx.channelId]
            );
            if (!permRows[0]?.can_customize_partner_system)
                return { statusCode: 403, success: false, error: 'Forbidden' };
            channelFilter = ' AND channel_id = $2';
            params.push(adminCtx.channelId);
        }
        await pool.query(`DELETE FROM partner_commission_rules WHERE id=$1${channelFilter}`, params);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Superadmin or parent channel admin can grant/revoke can_customize_partner_system on a channel.
async function handlePutChannelPartnerSystemPermission(channelId, body, adminCtx) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const cid = parseInt(channelId);
        if (adminCtx?.role === 'channel') {
            if (!adminCtx.canManageSubchannels) return { statusCode: 403, success: false, error: 'Forbidden' };
            const { rows } = await pool.query('SELECT parent_channel_id FROM channels WHERE id = $1', [cid]);
            const parentId = rows[0]?.parent_channel_id;
            if (!parentId) return { statusCode: 403, success: false, error: 'Cannot grant partner system permission to a root channel' };
            const owns = await verifySubchannelOwnership(parentId, adminCtx);
            if (!owns && parentId !== adminCtx.channelId) return { statusCode: 403, success: false, error: 'Forbidden' };
        }
        const { can_customize_partner_system } = body || {};
        if (typeof can_customize_partner_system !== 'boolean')
            return { statusCode: 400, success: false, error: 'can_customize_partner_system must be a boolean' };
        await pool.query('UPDATE channels SET can_customize_partner_system = $1 WHERE id = $2', [can_customize_partner_system, cid]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetChannelRewardsSummary(channelId) {
    if (!channelId) return { success: false, error: 'channel_id required', statusCode: 400 };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const now = new Date();
        const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const [chMonth, coachBreakdown, pendingPayouts] = await Promise.all([
            pool.query(
                `SELECT COALESCE(SUM(amount_cny),0) AS total FROM channel_commissions
                 WHERE channel_id=$1 AND to_char(created_at,'YYYY-MM')=$2`,
                [channelId, period]
            ),
            pool.query(
                `SELECT cc.coach_id, u.nickname AS coach_name,
                        COALESCE(SUM(CASE WHEN to_char(cc.created_at,'YYYY-MM')=$2 THEN cc.amount_cny ELSE 0 END),0) AS this_month,
                        COALESCE(SUM(CASE WHEN cc.status='pending' THEN cc.amount_cny ELSE 0 END),0) AS pending_total
                 FROM coach_commissions cc
                 LEFT JOIN users u ON u.user_id = cc.coach_id
                 WHERE cc.channel_id=$1
                 GROUP BY cc.coach_id, u.nickname
                 ORDER BY pending_total DESC`,
                [channelId, period]
            ),
            pool.query(
                `SELECT id, coach_id, period, total_cny, status, u.nickname AS coach_name
                 FROM coach_payouts cp
                 LEFT JOIN users u ON u.user_id = cp.coach_id
                 WHERE cp.channel_id=$1 AND cp.status='draft'
                 ORDER BY cp.period DESC`,
                [channelId]
            ),
        ]);
        return {
            success: true,
            this_month_cny: Number(chMonth.rows[0].total),
            coach_breakdown: coachBreakdown.rows,
            pending_payouts: pendingPayouts.rows,
            period,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── End partner system handlers ──────────────────────────────────────────────

module.exports = {
    handleGetPartners,
    handleGetPartner,
    handleGetPartnerByPhone,
    handleGcnPartnerLookup,
    handlePostPartner,
    handlePostPartnerGcnProvision,
    handlePostPartnerInviteCode,
    handleGcnPartnerInviteCode,
    handleGcnPartnerApply,
    handlePostPartnerSale,
    handlePutPartner,
    handleDeletePartner,
    handleGetPartnerCommissions,
    handlePostPartnerCommission,
    handleGetPartnerPayouts,
    handlePostGeneratePartnerPayouts,
    handlePutPartnerPayout,
    handleGcnPartnerChildren,
    handleGcnPartnerDescendants,
    handleGetChannelReferralNetwork,
    handleGetPartnerCommissionConfig,
    handlePutPartnerCommissionConfig,
    handleGetPartnerTypes,
    handlePostPartnerType,
    handlePutPartnerType,
    handleDeletePartnerType,
    handleGcnSyncPartnerType,
    handleGetPartnerCommissionRules,
    handlePostPartnerCommissionRule,
    handlePutPartnerCommissionRule,
    handleDeletePartnerCommissionRule,
    handlePutChannelPartnerSystemPermission,
    handleGetChannelRewardsSummary,
};
