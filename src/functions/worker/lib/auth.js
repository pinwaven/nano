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

function signChannelAdminToken({ sub, username, cid, tabs, perms, cms, cmw, auto }) {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 86400;
    const payload = Buffer.from(JSON.stringify({ sub, username, cid, tabs, perms: perms ?? tabs, cms: cms ?? false, cmw: cmw ?? false, auto: auto ?? false, iat, exp })).toString('base64url');
    const sig = crypto.createHmac('sha256', process.env.API_BEARER_TOKEN)
                      .update(`ch.${payload}`).digest('hex');
    return `ch.${payload}.${sig}`;
}

function verifyChannelAdminToken(token) {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'ch') return null;
    const [prefix, payload, sig] = parts;
    const expected = crypto.createHmac('sha256', process.env.API_BEARER_TOKEN)
                           .update(`${prefix}.${payload}`).digest('hex');
    try {
        if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
    } catch { return null; }
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
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
    signChannelAdminToken,
    verifyChannelAdminToken,
    CHANNEL_ADMIN_FULL_PERMS,
    LEGACY_TAB_EXPANSION,
    expandPermissions,
    requirePermission,
    requireAdminTab,
    getWxAccessToken,
    verifySubchannelOwnership,
};
