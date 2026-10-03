'use strict';

const { pool } = require('./db');
const { mergeUsers } = require('../handlers/user-merge');

function miniappCredentials(appId) {
    const credentials = new Map();
    for (const [id, secret] of [
        [process.env.WX_APPID, process.env.WX_SECRET],
        [process.env.WX_APPID_WAVEN, process.env.WX_SECRET_WAVEN],
        [process.env.WX_APPID_AEVIVA, process.env.WX_SECRET_AEVIVA],
    ]) {
        if (id && secret) credentials.set(id, secret);
    }
    const selectedId = appId || process.env.WX_APPID; // older clients did not send app_id
    if (!selectedId || !credentials.has(selectedId)) return null;
    return { appId: selectedId, secret: credentials.get(selectedId) };
}

async function exchangeMiniappCode(code, appId) {
    const credential = miniappCredentials(appId);
    if (!credential) return { error: 'unknown_app_id' };
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', credential.appId);
    url.searchParams.set('secret', credential.secret);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');
    const response = await fetch(url);
    const data = await response.json();
    if (data.errcode || !data.openid) return { error: `WeChat: ${data.errmsg || 'missing openid'} (${data.errcode || 'unknown'})` };
    return { appId: credential.appId, openid: data.openid, unionid: data.unionid || null };
}

async function identityOwner(appId, openid) {
    const { rows } = await pool.query(
        'SELECT user_id FROM wechat_miniapp_identities WHERE app_id = $1 AND openid = $2',
        [appId, openid]
    );
    return rows[0]?.user_id || null;
}

async function canonicalUser(userId) {
    let id = userId;
    const seen = new Set();
    while (id && !seen.has(id)) {
        seen.add(id);
        const { rows } = await pool.query(
            'SELECT user_id, merged_into_user_id, created_at, channel_id, coach_id, phone, wx_unionid FROM users WHERE user_id = $1',
            [id]
        );
        if (!rows[0]) return null;
        if (!rows[0].merged_into_user_id) return rows[0];
        id = rows[0].merged_into_user_id;
    }
    throw new Error('invalid_user_merge_chain');
}

async function unionOwners(unionid) {
    if (!unionid) return [];
    const { rows } = await pool.query(
        `SELECT DISTINCT u.user_id
           FROM users u
           LEFT JOIN wechat_miniapp_identities w ON w.user_id = u.user_id
          WHERE u.wx_unionid = $1 OR w.unionid = $1`,
        [unionid]
    );
    const owners = new Map();
    for (const row of rows) {
        const owner = await canonicalUser(row.user_id);
        if (owner) owners.set(owner.user_id, owner);
    }
    return [...owners.values()];
}

// A WeChat UnionID is proof of one WeChat user. Only two phone-less accounts are
// merged without a second factor; an existing verified phone takes the OTP path.
async function mergePhoneLessUnionOwners(a, b) {
    if (a.user_id === b.user_id) return a;
    if (a.phone || b.phone) throw new Error('wechat_identity_conflict_requires_verified_login');
    const older = new Date(a.created_at) <= new Date(b.created_at) ? a : b;
    const newer = older.user_id === a.user_id ? b : a;
    await mergeUsers(older.user_id, newer.user_id, 'wx_unionid', {
        strict: true,
        channelId: newer.channel_id,
        coachId: newer.coach_id,
    });
    return canonicalUser(older.user_id);
}

async function findMiniappUser(appId, openid, unionid) {
    let exact = await identityOwner(appId, openid);
    // Only the original AppID may claim legacy external_id rows without a stored
    // AppID. Other AppIDs need UnionID or a verified phone login to establish ownership.
    if (!exact && appId === process.env.WX_APPID) {
        const legacy = await pool.query('SELECT user_id FROM users WHERE external_id = $1', [openid]);
        exact = legacy.rows[0]?.user_id || null;
    }
    let owner = exact ? await canonicalUser(exact) : null;
    if (owner?.wx_unionid && unionid && owner.wx_unionid !== unionid) {
        throw new Error('wechat_unionid_mismatch');
    }
    const unionMatches = await unionOwners(unionid);
    for (const match of unionMatches) {
        const current = await canonicalUser(match.user_id);
        owner = owner ? await mergePhoneLessUnionOwners(owner, current) : current;
    }
    return owner;
}

async function attachMiniappIdentity(userId, appId, openid, unionid) {
    const owner = await canonicalUser(userId);
    if (!owner) throw new Error('user_not_found');
    if (owner.wx_unionid && unionid && owner.wx_unionid !== unionid) throw new Error('wechat_unionid_mismatch');
    const existing = await identityOwner(appId, openid);
    if (existing) {
        const current = await canonicalUser(existing);
        if (current?.user_id !== owner.user_id) throw new Error('wechat_identity_already_bound');
        await pool.query(
            'UPDATE wechat_miniapp_identities SET user_id = $1, unionid = COALESCE(unionid, $2) WHERE app_id = $3 AND openid = $4',
            [owner.user_id, unionid, appId, openid]
        );
    } else {
        await pool.query(
            'INSERT INTO wechat_miniapp_identities (app_id, openid, user_id, unionid) VALUES ($1, $2, $3, $4) ON CONFLICT (app_id, openid) DO NOTHING',
            [appId, openid, owner.user_id, unionid]
        );
        const saved = await identityOwner(appId, openid);
        if (saved && (await canonicalUser(saved))?.user_id !== owner.user_id) throw new Error('wechat_identity_already_bound');
    }
    if (unionid) {
        await pool.query('UPDATE users SET wx_unionid = COALESCE(wx_unionid, $1) WHERE user_id = $2', [unionid, owner.user_id]);
    }
    return owner.user_id;
}

async function linkVerifiedMiniappLogin(userId, code, appId) {
    if (!code) return userId;
    const identity = await exchangeMiniappCode(code, appId);
    if (identity.error) throw new Error(identity.error);
    let target = await canonicalUser(userId);
    if (!target) throw new Error('user_not_found');
    const exactId = await identityOwner(identity.appId, identity.openid);
    const possibleOwners = [
        ...(exactId ? [await canonicalUser(exactId)] : []),
        ...(await unionOwners(identity.unionid)),
    ];
    const others = [];
    for (const originalCandidate of possibleOwners) {
        const candidate = originalCandidate ? await canonicalUser(originalCandidate.user_id) : null;
        if (candidate && candidate.user_id !== target.user_id) others.push(candidate);
    }
    // The phone + code proved the account, not the WeChat. A WeChat that already belongs to
    // another phone account (or an account bound to another WeChat) keeps its owner: the login
    // goes ahead without a link, as phone login did before identities were stored.
    const phoneOwner = others.find(c => c.phone);
    const unionMismatch = target.wx_unionid && identity.unionid && target.wx_unionid !== identity.unionid;
    if (phoneOwner || unionMismatch) {
        console.log(JSON.stringify({ level: 'INFO', msg: 'miniapp-login-link-skipped', data: {
            user_id: target.user_id, owner_user_id: phoneOwner?.user_id || null,
            reason: phoneOwner ? 'bound_to_other_phone_account' : 'unionid_mismatch' } }));
        return target.user_id;
    }
    for (const other of others) {
        const candidate = await canonicalUser(other.user_id);
        if (!candidate || candidate.user_id === target.user_id) continue;
        const older = new Date(target.created_at) <= new Date(candidate.created_at) ? target : candidate;
        const newer = older.user_id === target.user_id ? candidate : target;
        await mergeUsers(older.user_id, newer.user_id, 'phone_otp', {
            strict: true,
            channelId: newer.channel_id,
            coachId: newer.coach_id,
        });
        target = await canonicalUser(older.user_id);
    }
    await attachMiniappIdentity(target.user_id, identity.appId, identity.openid, identity.unionid);
    return target.user_id;
}

module.exports = { miniappCredentials, exchangeMiniappCode, findMiniappUser, attachMiniappIdentity, linkVerifiedMiniappLogin, identityOwner, canonicalUser };
