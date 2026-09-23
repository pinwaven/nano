const crypto = require('crypto');
const { pool } = require('./db');

const generateUserId = () => crypto.randomBytes(4).toString('hex');

async function generateReferralCode() {
    for (let i = 0; i < 10; i++) {
        const code = String(100000 + (parseInt(crypto.randomBytes(3).toString('hex'), 16) % 900000));
        const { rows } = await pool.query('SELECT 1 FROM users WHERE referral_code = $1', [code]);
        if (rows.length === 0) return code;
    }
    throw new Error('Failed to generate unique referral code');
}

// 6-digit numeric SMS OTP code — no DB uniqueness check needed (unlike referral/invite
// codes), since it's scoped per-phone within a short expiry window, not a permanent key.
const generatePhoneOtpCode = () => String(100000 + (parseInt(crypto.randomBytes(3).toString('hex'), 16) % 900000));

// Same scheme as generateReferralCode, scoped to partners.invite_code instead of
// users.referral_code — used by the partner self-service invite-link feature.
async function generatePartnerInviteCode() {
    for (let i = 0; i < 10; i++) {
        const code = String(100000 + (parseInt(crypto.randomBytes(3).toString('hex'), 16) % 900000));
        const { rows } = await pool.query('SELECT 1 FROM partners WHERE invite_code = $1', [code]);
        if (rows.length === 0) return code;
    }
    throw new Error('Failed to generate unique partner invite code');
}

// Every token nano mints itself — `ch.` (channel admin), `sa.` (superadmin) — is
// `<prefix>.<base64url payload>.<hex HMAC>`, keyed by TOKEN_SIGNING_SECRET. Never by
// API_BEARER_TOKEN: that value ships inside the miniapp and is public, so signing with it let
// anyone forge an admin session (TODO.md "Security"). With the secret unset, signing throws and
// verifying returns null — a missing env var fails closed rather than falling back.
const SESSION_TTL_SECONDS = 86400;

function signToken(prefix, data, ttlSeconds = SESSION_TTL_SECONDS) {
    const secret = process.env.TOKEN_SIGNING_SECRET;
    if (!secret) throw new Error('TOKEN_SIGNING_SECRET not configured');
    const iat = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ ...data, iat, exp: iat + ttlSeconds })).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(`${prefix}.${payload}`).digest('hex');
    return `${prefix}.${payload}.${sig}`;
}

function verifyToken(token, prefix) {
    const secret = process.env.TOKEN_SIGNING_SECRET;
    if (!secret || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== prefix) return null;
    const [, payload, sig] = parts;
    const expected = crypto.createHmac('sha256', secret).update(`${prefix}.${payload}`).digest('hex');
    try {
        if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (!(data.exp > Math.floor(Date.now() / 1000))) return null;
        return data;
    } catch { return null; }
}

function signChannelAdminToken({ sub, username, cid, tabs, perms, cms, cmw, auto }) {
    return signToken('ch', { sub, username, cid, tabs, perms: perms ?? tabs, cms: cms ?? false, cmw: cmw ?? false, auto: auto ?? false });
}

function verifyChannelAdminToken(token) {
    return verifyToken(token, 'ch');
}

// Superadmin web-panel session. /admin/login used to hand back API_BEARER_TOKEN itself.
function signSuperadminToken({ sub, username }) {
    return signToken('sa', { sub, username });
}

function verifySuperadminToken(token) {
    return verifyToken(token, 'sa');
}

// Per-user session for the miniapp and the web user-app, issued by every login path. Carries
// only the user id — roles and coach identity are read from the DB on each request
// (lib/userAccess.js), so a revoked coach or admin role takes effect immediately. 30 days,
// refreshed by the clients via POST /session/refresh.
const USER_SESSION_TTL_SECONDS = 30 * 86400;

function signUserToken(userId) {
    return signToken('u', { sub: userId }, USER_SESSION_TTL_SECONDS);
}

function verifyUserToken(token) {
    const data = verifyToken(token, 'u');
    return data && typeof data.sub === 'string' ? data : null;
}

// All permissions a root channel admin holds (hardcoded — no manual config needed).
// Does not include superadmin-only features (global channels, dots, chips hardware, etc.).
const CHANNEL_ADMIN_FULL_PERMS = [
    'users:read','users:write','users:delete',
    'coaches:read','coaches:write','coaches:delete',
    'store:read','store:write','store:delete',
    'orders:read','orders:write',
    'invites:read','invites:write','invites:delete',
    'inventory:read','inventory:write',
    'rewards:read','rewards:write','rewards:delete',
    'partners:read','partners:write','partners:delete',
    'finance:read','finance:write',
    'content:read',
    'academy:read','academy:write',
    'questionnaires:read',
    'health-plans:read',
    'reports:read',
    'tickets:read',
    'events:read','events:write','events:delete',
    'admin-accounts:read','admin-accounts:write',
    'digital-assets:read','digital-assets:write','digital-assets:delete',
];

// Maps legacy tab names to resource:action strings for backward compat.
const LEGACY_TAB_EXPANSION = {
    users:            ['users:read','users:write','users:delete'],
    coaches:          ['coaches:read','coaches:write','coaches:delete'],
    store:            ['store:read','store:write','store:delete','orders:read','orders:write'],
    invites:          ['invites:read','invites:write','invites:delete'],
    inventory:        ['inventory:read','inventory:write'],
    rewards:          ['rewards:read','rewards:write','rewards:delete'],
    partners:         ['partners:read','partners:write','partners:delete'],
    content:          ['content:read'],
    academy:          ['academy:read','academy:write'],
    questionnaires:   ['questionnaires:read'],
    'health-plans':   ['health-plans:read'],
    reports:          ['reports:read'],
    tickets:          ['tickets:read'],
    lab:              ['lab:read','lab:write'],
    kino:             ['kino:read'],
    chips:            ['chips:read'],
    dots:             ['dots:read'],
    events:           ['events:read','events:write','events:delete'],
    'admin-accounts': ['admin-accounts:read','admin-accounts:write'],
    'digital-assets': ['digital-assets:read','digital-assets:write','digital-assets:delete'],
    subchannels:      [],
};

function expandPermissions(perms) {
    if (!Array.isArray(perms)) return [];
    const result = new Set();
    for (const p of perms) {
        if (p.includes(':')) { result.add(p); }
        else { for (const e of (LEGACY_TAB_EXPANSION[p] || [])) result.add(e); }
    }
    return [...result];
}

function requirePermission(adminCtx, permission) {
    if (adminCtx.role === 'superadmin') return null;
    // A user session only ever reaches a handler through lib/userAccess.js, which admitted this
    // exact route for this caller and the users it names. The permission gates on those routes
    // (a coach editing an invitation, a user cancelling their order) predate user sessions and
    // were always passed by the shared app bearer, which counted as superadmin.
    if (adminCtx.role === 'user' && adminCtx.userRouteAuthorized) return null;
    if (!adminCtx.perms || !adminCtx.perms.includes(permission))
        return { statusCode: 403, success: false, error: `Permission denied: requires '${permission}'` };
    return null;
}

// Shim — all existing requireAdminTab call sites work unchanged.
function requireAdminTab(adminCtx, tab) {
    if (adminCtx.role === 'superadmin') return null;
    return requirePermission(adminCtx, `${tab}:write`);
}

// WeChat access_token cache (module-level, survives container reuse)
const _wxTokenCache = {};
async function getWxAccessToken(appid = null, secret = null) {
    const id = appid || process.env.WX_APPID;
    const sec = secret || process.env.WX_SECRET;
    const cached = _wxTokenCache[id];
    if (cached && Date.now() < cached.expiry) return cached.token;
    const res = await fetch(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${id}&secret=${sec}`);
    const data = await res.json();
    if (data.errcode) throw new Error(`WX token error: ${data.errmsg} (${data.errcode})`);
    _wxTokenCache[id] = { token: data.access_token, expiry: Date.now() + (data.expires_in - 300) * 1000 };
    return data.access_token;
}

async function verifySubchannelOwnership(channelId, adminCtx) {
    if (adminCtx?.role !== 'channel') return true;
    if (!adminCtx.canManageSubchannels) return false;
    const r = await pool.query(`
        WITH RECURSIVE subtree AS (
            SELECT id, 0 AS depth FROM channels WHERE id = $2
            UNION ALL
            SELECT c.id, s.depth + 1 FROM channels c
            JOIN subtree s ON c.parent_channel_id = s.id
            WHERE s.depth < 20
        )
        SELECT 1 FROM subtree WHERE id = $1 AND id != $2
    `, [channelId, adminCtx.channelId]);
    return r.rows.length > 0;
}

module.exports = {
    generateUserId,
    generateReferralCode,
    generatePhoneOtpCode,
    generatePartnerInviteCode,
    signChannelAdminToken,
    verifyChannelAdminToken,
    signSuperadminToken,
    verifySuperadminToken,
    signUserToken,
    verifyUserToken,
    CHANNEL_ADMIN_FULL_PERMS,
    LEGACY_TAB_EXPANSION,
    expandPermissions,
    requirePermission,
    requireAdminTab,
    getWxAccessToken,
    verifySubchannelOwnership,
};
