'use strict';

const { pool } = require('../lib/db');
const { generateUserId, generateReferralCode, getWxAccessToken } = require('../lib/auth');

async function handleResolvePhone(code, app_id = null) {
    try {
        if (!code) return { success: false, error: 'code is required' };
        const credMap = {};
        if (process.env.WX_APPID && process.env.WX_SECRET)
            credMap[process.env.WX_APPID] = process.env.WX_SECRET;
        if (process.env.WX_APPID_WAVEN && process.env.WX_SECRET_WAVEN)
            credMap[process.env.WX_APPID_WAVEN] = process.env.WX_SECRET_WAVEN;
        const appid = (app_id && credMap[app_id]) ? app_id : process.env.WX_APPID;
        const token = await getWxAccessToken(appid, credMap[appid]);
        const wxRes = await fetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });
        const wxData = await wxRes.json();
        if (wxData.errcode) return { success: false, error: `WeChat: ${wxData.errmsg} (${wxData.errcode})` };
        const phone = wxData.phone_info?.purePhoneNumber;
        if (!phone) return { success: false, error: 'No phone number returned' };
        return { success: true, phone };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleBindPhone(user_id, code, app_id = null, rawPhone = null) {
    try {
        // Raw-phone mode: Flutter app sends phone directly (no WeChat phone code available)
        if (!code && rawPhone) {
            if (!/^1\d{10}$/.test(rawPhone)) return { success: false, error: 'Invalid phone number' };
            if (!user_id) return { success: false, error: 'user_id is required' };
            await pool.query('UPDATE users SET phone = $1 WHERE user_id = $2', [rawPhone, user_id]);
            return { success: true, phone: rawPhone };
        }
        if (!code) return { success: false, error: 'code is required' };
        const credMap = {};
        if (process.env.WX_APPID && process.env.WX_SECRET)
            credMap[process.env.WX_APPID] = process.env.WX_SECRET;
        if (process.env.WX_APPID_WAVEN && process.env.WX_SECRET_WAVEN)
            credMap[process.env.WX_APPID_WAVEN] = process.env.WX_SECRET_WAVEN;
        const appid = (app_id && credMap[app_id]) ? app_id : process.env.WX_APPID;
        const token = await getWxAccessToken(appid, credMap[appid]);
        const wxRes = await fetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });
        const wxData = await wxRes.json();
        if (wxData.errcode) return { success: false, error: `WeChat: ${wxData.errmsg} (${wxData.errcode})` };
        const phone = wxData.phone_info?.purePhoneNumber;
        if (!phone) return { success: false, error: 'No phone number returned' };
        await pool.query('UPDATE users SET phone = $1 WHERE user_id = $2', [phone, user_id]);
        return { success: true, phone };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleWxLogin(body) {
    console.log(JSON.stringify({ level: 'INFO', msg: 'wx-login-body', body_keys: Object.keys(body || {}), phone: body?.phone, phone_code: body?.phone_code }));
    const { code, coach_id, invite_code, ref, app_id, phone_code, phone, channel_slug } = body;
    if (!code) return { success: false, error: 'code is required' };

    const credMap = {};
    if (process.env.WX_APPID && process.env.WX_SECRET)
        credMap[process.env.WX_APPID] = process.env.WX_SECRET;
    if (process.env.WX_APPID_WAVEN && process.env.WX_SECRET_WAVEN)
        credMap[process.env.WX_APPID_WAVEN] = process.env.WX_SECRET_WAVEN;
    if (process.env.WX_APPID_AEVIVA && process.env.WX_SECRET_AEVIVA)
        credMap[process.env.WX_APPID_AEVIVA] = process.env.WX_SECRET_AEVIVA;

    const appid  = (app_id && credMap[app_id]) ? app_id : process.env.WX_APPID;
    const secret = credMap[appid];
    if (!appid || !secret) return { success: false, error: 'WX_APPID / WX_SECRET not configured' };

    const wxRes = await fetch(
        `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${secret}&js_code=${code}&grant_type=authorization_code`
    );
    const wxData = await wxRes.json();
    if (wxData.errcode) return { success: false, error: `WeChat: ${wxData.errmsg} (${wxData.errcode})` };

    const openid = wxData.openid;
    // unionid is present when the miniapp is bound to the WeChat Open Platform
    // account — it bridges miniapp and mobile-app identities (see /wx-app-login).
    const unionid = wxData.unionid || null;

    // Use pre-resolved phone (already verified by /resolve-phone), or resolve from code if provided
    console.log(JSON.stringify({ level: 'INFO', msg: 'wx-login-phone', phone_present: !!phone, phone_code_present: !!phone_code, phone_val: phone }));
    let resolvedPhone = phone || null;
    if (!resolvedPhone && phone_code) {
        const token = await getWxAccessToken(appid, credMap[appid]);
        const phoneRes = await fetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: phone_code }),
        });
        const phoneData = await phoneRes.json();
        if (phoneData.errcode || !phoneData.phone_info?.purePhoneNumber) {
            return { success: false, phone_error: true, error: `手机号获取失败: ${phoneData.errmsg || 'no number returned'} (${phoneData.errcode})` };
        }
        resolvedPhone = phoneData.phone_info.purePhoneNumber;
    }

    // Look up existing user — return with channel info and roles
    const existing = await pool.query(
        `SELECT u.user_id, u.nickname, u.birth_date, u.gender, u.language, u.phone, u.email,
                u.avatar_url, u.coach_id, u.channel_id, u.roles, u.created_at, u.bio_data, u.referral_code,
                u.referred_by_user_id, b.bio_age,
                cu.nickname AS coach_name,
                c.name AS channel_name, effective_channel_logo(c.id) AS channel_logo_url,
                c.config->'sub_age_display_names' AS channel_sub_age_names,
                c.config->>'locale' AS channel_locale
         FROM users u
         LEFT JOIN coaches p ON u.coach_id = p.id
         LEFT JOIN users cu ON p.user_id = cu.user_id
         LEFT JOIN channels c ON u.channel_id = c.id
         LEFT JOIN (
             SELECT DISTINCT ON (user_id) user_id, bio_age
             FROM biomarkers ORDER BY user_id, tested_at DESC
         ) b ON u.user_id = b.user_id
         WHERE u.external_id = $1 OR u.user_id = $1
         LIMIT 1`,
        [openid]
    );

    if (existing.rows.length > 0) {
        let existingRow = existing.rows[0];

        // Backfill unionid so the mobile app can match this account later
        if (unionid) {
            await pool.query('UPDATE users SET wx_unionid = COALESCE(wx_unionid, $1) WHERE user_id = $2', [unionid, existingRow.user_id]);
        }

        // Existing user with no channel + invite code → assign channel from invite or referral
        if (!existingRow.channel_id && invite_code) {
            const invRes = await pool.query(
                `SELECT id, channel_id, created_by, max_uses, use_count FROM invitations
                 WHERE code = $1 AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
                [invite_code.toUpperCase()]
            );
            if (invRes.rows.length > 0) {
                const inviteRecord = invRes.rows[0];
                let newChannelId = inviteRecord.channel_id;
                if (!newChannelId && inviteRecord.created_by) {
                    const coachByUser = await pool.query('SELECT u.channel_id FROM coaches c JOIN users u ON c.user_id = u.user_id WHERE c.user_id = $1 LIMIT 1', [inviteRecord.created_by]);
                    if (coachByUser.rows.length > 0) newChannelId = coachByUser.rows[0].channel_id;
                }
                if (newChannelId) {
                    await pool.query(
                        `UPDATE users SET channel_id = $1, invited_by_invitation_id = COALESCE(invited_by_invitation_id, $2) WHERE user_id = $3`,
                        [newChannelId, inviteRecord.id, existingRow.user_id]
                    );
                    await pool.query(
                        `UPDATE invitations SET use_count = use_count + 1 WHERE id = $1 AND (max_uses IS NULL OR use_count < max_uses)`,
                        [inviteRecord.id]
                    );
                    await pool.query(
                        'INSERT INTO invitation_uses (invitation_id, user_id, user_id_snapshot) VALUES ($1, $2, $2) ON CONFLICT (invitation_id, user_id_snapshot) DO NOTHING',
                        [inviteRecord.id, existingRow.user_id]
                    );
                    // Re-fetch with updated channel info
                    const refreshed = await pool.query(
                        `SELECT u.user_id, u.nickname, u.birth_date, u.gender, u.language, u.phone, u.email,
                                u.avatar_url, u.coach_id, u.channel_id, u.roles, u.created_at, u.bio_data,
                                u.referral_code, u.referred_by_user_id, b.bio_age,
                                cu.nickname AS coach_name,
                                c.name AS channel_name, effective_channel_logo(c.id) AS channel_logo_url,
                                c.config->'sub_age_display_names' AS channel_sub_age_names,
                c.config->>'locale' AS channel_locale
                         FROM users u
                         LEFT JOIN coaches p ON u.coach_id = p.id
                         LEFT JOIN users cu ON p.user_id = cu.user_id
                         LEFT JOIN channels c ON u.channel_id = c.id
                         LEFT JOIN (
                             SELECT DISTINCT ON (user_id) user_id, bio_age
                             FROM biomarkers ORDER BY user_id, tested_at DESC
                         ) b ON u.user_id = b.user_id
                         WHERE u.user_id = $1 LIMIT 1`,
                        [existingRow.user_id]
                    );
                    if (refreshed.rows.length > 0) existingRow = refreshed.rows[0];
                }
            } else {
                // invite_code not a coach invite — try as user referral_code
                const refByCode = await pool.query(
                    'SELECT user_id, channel_id FROM users WHERE referral_code = $1 LIMIT 1',
                    [invite_code]
                );
                if (refByCode.rows.length > 0) {
                    const referrer = refByCode.rows[0];
                    if (!existingRow.referred_by_user_id) {
                        await pool.query(
                            'UPDATE users SET referred_by_user_id = $1 WHERE user_id = $2 AND referred_by_user_id IS NULL',
                            [referrer.user_id, existingRow.user_id]
                        );
                        existingRow.referred_by_user_id = referrer.user_id;
                    }
                    if (referrer.channel_id) {
                        await pool.query('UPDATE users SET channel_id = $1 WHERE user_id = $2', [referrer.channel_id, existingRow.user_id]);
                        existingRow.channel_id = referrer.channel_id;
                    }
                }
            }
        }

        // channel_slug fallback: brand-level default when no invite/referral resolved a channel
        if (!existingRow.channel_id && channel_slug) {
            const slugRes = await pool.query(
                `SELECT id, name, effective_channel_logo(id) AS logo_url, config->'sub_age_display_names' AS sub_age_names, config->>'locale' AS locale FROM channels WHERE LOWER(name) = LOWER($1) LIMIT 1`,
                [channel_slug]
            );
            if (slugRes.rows.length > 0) {
                const ch = slugRes.rows[0];
                await pool.query('UPDATE users SET channel_id = $1 WHERE user_id = $2', [ch.id, existingRow.user_id]);
                existingRow.channel_id = ch.id;
                existingRow.channel_name = ch.name;
                existingRow.channel_logo_url = ch.logo_url;
                existingRow.channel_sub_age_names = ch.sub_age_names;
                existingRow.channel_locale = ch.locale;
            }
        }

        if (resolvedPhone && !existingRow.phone) {
            await pool.query('UPDATE users SET phone = $1 WHERE user_id = $2', [resolvedPhone, existingRow.user_id]);
            existingRow.phone = resolvedPhone;
        }
        const { channel_name, channel_logo_url, channel_sub_age_names, channel_locale, ...user } = existingRow;
        const channel = channel_name
            ? { name: channel_name, logo_url: channel_logo_url, sub_age_display_names: channel_sub_age_names || null, locale: channel_locale || 'zh' }
            : null;
        // If user is a coach, fetch their coach record
        let coach = null;
        if (user.roles && user.roles.includes('coach')) {
            const coachRes = await pool.query(
                `SELECT c.id, u2.channel_id, c.user_id FROM coaches c JOIN users u2 ON c.user_id = u2.user_id WHERE c.user_id = $1 LIMIT 1`,
                [user.user_id]
            );
            if (coachRes.rows.length > 0) coach = coachRes.rows[0];
        }
        // Profile incomplete — phone not bound yet; re-show the signup screen
        if (!user.phone) {
            return { success: true, new_user: true, user, channel, coach };
        }
        return { success: true, user, channel, coach };
    }

    // New user — if phone already exists on another account, re-link that account to this openid
    if (resolvedPhone) {
        const phoneMatch = await pool.query(
            `SELECT u.user_id, u.nickname, u.birth_date, u.gender, u.language, u.phone, u.email,
                    u.avatar_url, u.coach_id, u.channel_id, u.roles, u.created_at, u.bio_data, b.bio_age,
                    cu.nickname AS coach_name,
                    c.name AS channel_name, effective_channel_logo(c.id) AS channel_logo_url,
                    c.config->'sub_age_display_names' AS channel_sub_age_names,
                c.config->>'locale' AS channel_locale
             FROM users u
             LEFT JOIN coaches p ON u.coach_id = p.id
             LEFT JOIN users cu ON p.user_id = cu.user_id
             LEFT JOIN channels c ON u.channel_id = c.id
             LEFT JOIN (
                 SELECT DISTINCT ON (user_id) user_id, bio_age
                 FROM biomarkers ORDER BY user_id, tested_at DESC
             ) b ON u.user_id = b.user_id
             WHERE u.phone = $1 LIMIT 1`,
            [resolvedPhone]
        );
        if (phoneMatch.rows.length > 0) {
            const row = phoneMatch.rows[0];
            await pool.query('UPDATE users SET external_id = $1, wx_unionid = COALESCE(wx_unionid, $2) WHERE user_id = $3', [openid, unionid, row.user_id]);
            const { channel_name, channel_logo_url, channel_sub_age_names, channel_locale, ...user } = row;
            const channel = channel_name
                ? { name: channel_name, logo_url: channel_logo_url, sub_age_display_names: channel_sub_age_names || null, locale: channel_locale || 'zh' }
                : null;
            let coach = null;
            if (user.roles && user.roles.includes('coach')) {
                const coachRes = await pool.query('SELECT c.id, u2.channel_id, c.user_id FROM coaches c JOIN users u2 ON c.user_id = u2.user_id WHERE c.user_id = $1 LIMIT 1', [user.user_id]);
                if (coachRes.rows.length > 0) coach = coachRes.rows[0];
            }
            return { success: true, user, channel, coach };
        }
    }

    // New user — no invite code, coach, referral, or branded channel → allow guest browsing
    if (!invite_code && !coach_id && !ref && !channel_slug) {
        return { success: true, guest: true, openid };
    }

    // New user — determine channel from invite code, coach invite, referral, or default to waven
    let channelId = null;
    let resolvedCoachId = coach_id ? parseInt(coach_id) : null;
    let inviteRecord = null;
    let referralUserId = null;

    // Resolve referral — validate the referring user and inherit their channel if no other source
    if (ref) {
        const refRes = await pool.query('SELECT user_id, channel_id FROM users WHERE user_id = $1 LIMIT 1', [ref]);
        if (refRes.rows.length > 0) {
            referralUserId = ref;
            if (!invite_code && !coach_id) channelId = refRes.rows[0].channel_id;
        }
    }

    if (invite_code) {
        const invRes = await pool.query(
            `SELECT id, channel_id, created_by, max_uses, use_count FROM invitations
             WHERE code = $1 AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
            [invite_code.toUpperCase()]
        );
        if (invRes.rows.length > 0) {
            inviteRecord = invRes.rows[0];
            channelId = inviteRecord.channel_id;
            // If invite was created by a coach, assign that coach
            if (inviteRecord.created_by && !resolvedCoachId) {
                const coachByUser = await pool.query('SELECT id FROM coaches WHERE user_id = $1 LIMIT 1', [inviteRecord.created_by]);
                if (coachByUser.rows.length > 0) resolvedCoachId = coachByUser.rows[0].id;
            }
            // Fallback: if channel has exactly one coach, auto-assign them
            if (!resolvedCoachId && channelId) {
                const channelCoaches = await pool.query('SELECT c.id FROM coaches c JOIN users u ON c.user_id = u.user_id WHERE u.channel_id = $1', [channelId]);
                if (channelCoaches.rows.length === 1) resolvedCoachId = channelCoaches.rows[0].id;
            }
        } else {
            // Not a coach invite — try as user referral_code
            const refByCode = await pool.query(
                'SELECT user_id, channel_id FROM users WHERE referral_code = $1 LIMIT 1',
                [invite_code]
            );
            if (refByCode.rows.length > 0) {
                referralUserId = refByCode.rows[0].user_id;
                if (!channelId) channelId = refByCode.rows[0].channel_id;
            } else {
                return { success: false, invalid_code: true, error: 'Invalid or expired invitation code' };
            }
        }
    }

    if (!channelId && resolvedCoachId) {
        const coachRes = await pool.query('SELECT u.channel_id FROM coaches c JOIN users u ON c.user_id = u.user_id WHERE c.id = $1', [resolvedCoachId]);
        if (coachRes.rows.length > 0) channelId = coachRes.rows[0].channel_id;
    }
    if (!channelId) {
        if (channel_slug) {
            const slugRes = await pool.query(
                `SELECT id FROM channels WHERE LOWER(name) = LOWER($1) LIMIT 1`,
                [channel_slug]
            );
            if (slugRes.rows.length > 0) channelId = slugRes.rows[0].id;
        } else {
            const defaultCh = await pool.query("SELECT id FROM channels WHERE key_name = 'waven' LIMIT 1");
            channelId = defaultCh.rows[0]?.id || null;
        }
    }

    const newUserId = generateUserId();
    const newReferralCode = await generateReferralCode();
    const created = await pool.query(
        `INSERT INTO users (user_id, external_id, external_app, language, coach_id, channel_id, invited_by_invitation_id, referred_by_user_id, referral_code, phone, wx_unionid)
         VALUES ($1, $2, 'wechat', 'zh', $3, $4, $5, $6, $7, $8, $9)
         RETURNING user_id, nickname, birth_date, gender, language, phone, email, avatar_url, coach_id, channel_id, roles, created_at, bio_data, referral_code`,
        [newUserId, openid, resolvedCoachId, channelId, inviteRecord?.id || null, referralUserId, newReferralCode, resolvedPhone, unionid]
    );

    if (inviteRecord) {
        await pool.query(
            `UPDATE invitations SET use_count = use_count + 1 WHERE id = $1
             AND (max_uses IS NULL OR use_count < max_uses)`,
            [inviteRecord.id]
        );
        await pool.query(
            'INSERT INTO invitation_uses (invitation_id, user_id, user_id_snapshot) VALUES ($1, $2, $2) ON CONFLICT (invitation_id, user_id_snapshot) DO NOTHING',
            [inviteRecord.id, newUserId]
        );
    }

    let channel = null;
    if (channelId) {
        const chanRes = await pool.query(
            `SELECT name, effective_channel_logo(id) AS logo_url, config->'sub_age_display_names' AS sub_age_display_names FROM channels WHERE id = $1`,
            [channelId]
        );
        if (chanRes.rows.length > 0) channel = {
            name: chanRes.rows[0].name,
            logo_url: chanRes.rows[0].logo_url,
            sub_age_display_names: chanRes.rows[0].sub_age_display_names || null,
        };
    }

    return { success: true, new_user: true, user: { ...created.rows[0], bio_age: null, coach_name: null }, channel };
}

// WeChat Open Platform (mobile app / fluwx) login. Unlike the miniapp's
// jscode2session, the OAuth code is exchanged via sns/oauth2/access_token and
// yields a DIFFERENT openid (stored in users.wx_app_openid). Cross-client
// account matching: wx_app_openid → wx_unionid → phone.
async function handleWxAppLogin(body) {
    const { code, coach_id, invite_code, ref, phone, channel_slug } = body;
    if (!code) return { success: false, error: 'code is required' };

    const appid  = process.env.WX_APP_APPID;
    const secret = process.env.WX_APP_SECRET;
    if (!appid || !secret) return { success: false, error: 'WX_APP_APPID / WX_APP_SECRET not configured' };

    const wxRes = await fetch(
        `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${appid}&secret=${secret}&code=${code}&grant_type=authorization_code`
    );
    const wxData = await wxRes.json();
    if (wxData.errcode) return { success: false, error: `WeChat: ${wxData.errmsg} (${wxData.errcode})` };

    const appOpenid = wxData.openid;
    const unionid   = wxData.unionid || null;

    const bundleSelect = `
        SELECT u.user_id, u.nickname, u.birth_date, u.gender, u.language, u.phone, u.email,
               u.avatar_url, u.coach_id, u.channel_id, u.roles, u.created_at, u.bio_data, u.referral_code,
               u.referred_by_user_id, b.bio_age,
               cu.nickname AS coach_name,
               c.name AS channel_name, effective_channel_logo(c.id) AS channel_logo_url,
               c.config->'sub_age_display_names' AS channel_sub_age_names
        FROM users u
        LEFT JOIN coaches p ON u.coach_id = p.id
        LEFT JOIN users cu ON p.user_id = cu.user_id
        LEFT JOIN channels c ON u.channel_id = c.id
        LEFT JOIN (
            SELECT DISTINCT ON (user_id) user_id, bio_age
            FROM biomarkers ORDER BY user_id, tested_at DESC
        ) b ON u.user_id = b.user_id`;

    const shapeResult = async (row) => {
        const { channel_name, channel_logo_url, channel_sub_age_names, channel_locale, ...user } = row;
        const channel = channel_name
            ? { name: channel_name, logo_url: channel_logo_url, sub_age_display_names: channel_sub_age_names || null, locale: channel_locale || 'zh' }
            : null;
        let coach = null;
        if (user.roles && user.roles.includes('coach')) {
            const coachRes = await pool.query(
                'SELECT c.id, u2.channel_id, c.user_id FROM coaches c JOIN users u2 ON c.user_id = u2.user_id WHERE c.user_id = $1 LIMIT 1',
                [user.user_id]
            );
            if (coachRes.rows.length > 0) coach = coachRes.rows[0];
        }
        // Profile incomplete — phone not bound yet; the app shows the phone form
        if (!user.phone) return { success: true, new_user: true, user, channel, coach };
        return { success: true, user, channel, coach };
    };

    // Match precedence: app openid → unionid → phone (mirrors the miniapp's
    // phone-relink pattern in handleWxLogin)
    let existing = await pool.query(`${bundleSelect} WHERE u.wx_app_openid = $1 LIMIT 1`, [appOpenid]);
    if (existing.rows.length === 0 && unionid) {
        existing = await pool.query(`${bundleSelect} WHERE u.wx_unionid = $1 LIMIT 1`, [unionid]);
    }
    if (existing.rows.length === 0 && phone) {
        existing = await pool.query(`${bundleSelect} WHERE u.phone = $1 LIMIT 1`, [phone]);
    }
    if (existing.rows.length > 0) {
        const row = existing.rows[0];
        await pool.query(
            'UPDATE users SET wx_app_openid = $1, wx_unionid = COALESCE(wx_unionid, $2) WHERE user_id = $3',
            [appOpenid, unionid, row.user_id]
        );
        return shapeResult(row);
    }

    // New user — no invite code, coach, referral, or branded channel → allow guest browsing
    if (!invite_code && !coach_id && !ref && !channel_slug) {
        return { success: true, guest: true, openid: appOpenid };
    }

    // New user — resolve channel/coach/referral the same way as handleWxLogin
    let channelId = null;
    let resolvedCoachId = coach_id ? parseInt(coach_id) : null;
    let inviteRecord = null;
    let referralUserId = null;

    if (ref) {
        const refRes = await pool.query('SELECT user_id, channel_id FROM users WHERE user_id = $1 LIMIT 1', [ref]);
        if (refRes.rows.length > 0) {
            referralUserId = ref;
            if (!invite_code && !coach_id) channelId = refRes.rows[0].channel_id;
        }
    }

    if (invite_code) {
        const invRes = await pool.query(
            `SELECT id, channel_id, created_by, max_uses, use_count FROM invitations
             WHERE code = $1 AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
            [invite_code.toUpperCase()]
        );
        if (invRes.rows.length > 0) {
            inviteRecord = invRes.rows[0];
            channelId = inviteRecord.channel_id;
            if (inviteRecord.created_by && !resolvedCoachId) {
                const coachByUser = await pool.query('SELECT id FROM coaches WHERE user_id = $1 LIMIT 1', [inviteRecord.created_by]);
                if (coachByUser.rows.length > 0) resolvedCoachId = coachByUser.rows[0].id;
            }
            if (!resolvedCoachId && channelId) {
                const channelCoaches = await pool.query('SELECT c.id FROM coaches c JOIN users u ON c.user_id = u.user_id WHERE u.channel_id = $1', [channelId]);
                if (channelCoaches.rows.length === 1) resolvedCoachId = channelCoaches.rows[0].id;
            }
        } else {
            const refByCode = await pool.query(
                'SELECT user_id, channel_id FROM users WHERE referral_code = $1 LIMIT 1',
                [invite_code]
            );
            if (refByCode.rows.length > 0) {
                referralUserId = refByCode.rows[0].user_id;
                if (!channelId) channelId = refByCode.rows[0].channel_id;
            } else {
                return { success: false, invalid_code: true, error: 'Invalid or expired invitation code' };
            }
        }
    }

    if (!channelId && resolvedCoachId) {
        const coachRes = await pool.query('SELECT u.channel_id FROM coaches c JOIN users u ON c.user_id = u.user_id WHERE c.id = $1', [resolvedCoachId]);
        if (coachRes.rows.length > 0) channelId = coachRes.rows[0].channel_id;
    }
    if (!channelId) {
        if (channel_slug) {
            const slugRes = await pool.query('SELECT id FROM channels WHERE LOWER(name) = LOWER($1) LIMIT 1', [channel_slug]);
            if (slugRes.rows.length > 0) channelId = slugRes.rows[0].id;
        } else {
            const defaultCh = await pool.query("SELECT id FROM channels WHERE key_name = 'waven' LIMIT 1");
            channelId = defaultCh.rows[0]?.id || null;
        }
    }

    const newUserId = generateUserId();
    const newReferralCode = await generateReferralCode();
    const created = await pool.query(
        `INSERT INTO users (user_id, external_id, external_app, language, coach_id, channel_id, invited_by_invitation_id, referred_by_user_id, referral_code, phone, wx_app_openid, wx_unionid)
         VALUES ($1, NULL, 'wechat_app', 'zh', $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING user_id, nickname, birth_date, gender, language, phone, email, avatar_url, coach_id, channel_id, roles, created_at, bio_data, referral_code`,
        [newUserId, resolvedCoachId, channelId, inviteRecord?.id || null, referralUserId, newReferralCode, phone || null, appOpenid, unionid]
    );

    if (inviteRecord) {
        await pool.query(
            `UPDATE invitations SET use_count = use_count + 1 WHERE id = $1
             AND (max_uses IS NULL OR use_count < max_uses)`,
            [inviteRecord.id]
        );
        await pool.query(
            'INSERT INTO invitation_uses (invitation_id, user_id, user_id_snapshot) VALUES ($1, $2, $2) ON CONFLICT (invitation_id, user_id_snapshot) DO NOTHING',
            [inviteRecord.id, newUserId]
        );
    }

    let channel = null;
    if (channelId) {
        const chanRes = await pool.query(
            `SELECT name, effective_channel_logo(id) AS logo_url, config->'sub_age_display_names' AS sub_age_display_names FROM channels WHERE id = $1`,
            [channelId]
        );
        if (chanRes.rows.length > 0) channel = {
            name: chanRes.rows[0].name,
            logo_url: chanRes.rows[0].logo_url,
            sub_age_display_names: chanRes.rows[0].sub_age_display_names || null,
        };
    }

    return { success: true, new_user: true, user: { ...created.rows[0], bio_age: null, coach_name: null }, channel };
}

async function handleValidateInvite(body) {
    const { invite_code } = body;
    if (!invite_code) return { success: false, error: 'invite_code is required' };

    // Try coach/admin invitation code first
    const invRes = await pool.query(
        `SELECT id, channel_id FROM invitations
         WHERE code = $1 AND is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
        [invite_code.toUpperCase()]
    );
    if (invRes.rows.length > 0) {
        const channelId = invRes.rows[0].channel_id;
        let channel = null;
        if (channelId) {
            const chanRes = await pool.query('SELECT name, effective_channel_logo(id) AS logo_url FROM channels WHERE id = $1', [channelId]);
            if (chanRes.rows.length > 0) channel = { name: chanRes.rows[0].name, logo_url: chanRes.rows[0].logo_url };
        }
        return { success: true, channel };
    }

    // Fall back to user referral code
    const refRes = await pool.query(
        `SELECT u.user_id, u.channel_id, c.name AS channel_name, effective_channel_logo(c.id) AS channel_logo_url
         FROM users u
         LEFT JOIN channels c ON c.id = u.channel_id
         WHERE u.referral_code = $1 LIMIT 1`,
        [invite_code]
    );
    if (refRes.rows.length > 0) {
        const row = refRes.rows[0];
        const channel = row.channel_name ? { name: row.channel_name, logo_url: row.channel_logo_url } : null;
        return { success: true, channel };
    }

    return { success: false, invalid_code: true, error: 'Invalid or expired invitation code' };
}

async function handleGetMyReferrals(query) {
    const { user_id } = query;
    if (!user_id) return { success: false, error: 'user_id is required' };
    try {
        const userRes = await pool.query('SELECT referral_code FROM users WHERE user_id = $1', [user_id]);
        let referral_code = userRes.rows[0]?.referral_code;
        if (!referral_code) {
            referral_code = await generateReferralCode();
            await pool.query('UPDATE users SET referral_code = $1 WHERE user_id = $2', [referral_code, user_id]);
        }

        const { rows } = await pool.query(`
            SELECT u.user_id, u.nickname, u.avatar_url, u.created_at AS joined_at,
                   COALESCE(SUM(rc.amount_cny), 0) AS commission_earned
            FROM users u
            LEFT JOIN referral_commissions rc
                   ON rc.referee_user_id = u.user_id AND rc.referrer_user_id = $1
            WHERE u.referred_by_user_id = $1
            GROUP BY u.user_id, u.nickname, u.avatar_url, u.created_at
            ORDER BY u.created_at DESC
        `, [user_id]);

        const totalCommission = rows.reduce((sum, r) => sum + parseFloat(r.commission_earned), 0);
        return {
            success: true,
            referral_code,
            total_referred: rows.length,
            total_commission_earned: Number(totalCommission.toFixed(2)),
            referrals: rows.map(r => ({
                user_id: r.user_id,
                nickname: r.nickname || null,
                avatar_url: r.avatar_url || null,
                joined_at: r.joined_at,
                commission_earned: Number(parseFloat(r.commission_earned).toFixed(2)),
            })),
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Generates a short-lived one-time token so the miniapp can open the user web
// app with the user pre-authenticated (no phone login required in the webview).
async function handlePostWebviewToken(body) {
    try {
        const { openid } = body || {};
        if (!openid) return { success: false, error: 'openid is required' };

        const token = require('crypto').randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 60_000); // 60 seconds

        await pool.query(
            `INSERT INTO webview_tokens (token, openid, expires_at) VALUES ($1, $2, $3)`,
            [token, openid, expiresAt]
        );

        return { success: true, wvt: token, expires_in: 60 };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Exchanges a one-time webview token for the user's profile.
// Called by the web app immediately on load when ?wvt= is present in the URL.
async function handleExchangeWebviewToken(body) {
    try {
        const { wvt } = body || {};
        if (!wvt) return { success: false, error: 'wvt is required' };

        const { rows } = await pool.query(
            `UPDATE webview_tokens
             SET used = TRUE
             WHERE token = $1 AND used = FALSE AND expires_at > NOW()
             RETURNING openid`,
            [wvt]
        );
        if (rows.length === 0) return { success: false, error: 'Invalid or expired token' };

        const openid = rows[0].openid;
        const userRes = await pool.query(
            `SELECT u.user_id, u.nickname, u.birth_date, u.gender, u.language, u.phone, u.email,
                    u.avatar_url, u.coach_id, u.channel_id, u.roles, u.created_at, u.bio_data, b.bio_age,
                    cu.nickname AS coach_name,
                    c.name AS channel_name, effective_channel_logo(c.id) AS channel_logo_url,
                    c.config->'sub_age_display_names' AS channel_sub_age_names,
                    c.config->>'locale' AS channel_locale
             FROM users u
             LEFT JOIN coaches p ON u.coach_id = p.id
             LEFT JOIN users cu ON p.user_id = cu.user_id
             LEFT JOIN channels c ON u.channel_id = c.id
             LEFT JOIN (
                 SELECT DISTINCT ON (user_id) user_id, bio_age
                 FROM biomarkers ORDER BY user_id, tested_at DESC
             ) b ON u.user_id = b.user_id
             WHERE u.external_id = $1 OR u.user_id = $1
             LIMIT 1`,
            [openid]
        );

        if (userRes.rows.length === 0) return { success: false, error: 'User not found' };

        const { channel_name, channel_logo_url, channel_sub_age_names, channel_locale, ...user } = userRes.rows[0];
        const channel = channel_name
            ? { name: channel_name, logo_url: channel_logo_url, sub_age_display_names: channel_sub_age_names || null, locale: channel_locale || 'zh' }
            : null;

        return { success: true, user, channel };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── QR Login (web app QR → miniapp scan → auto-login) ────────────────────────
//
// Flow:
//   1. Web app calls POST /qr-login/init  → gets session_id + QR image (base64 PNG)
//   2. User scans QR with WeChat → miniapp opens pages/qrlogin/qrlogin
//   3. Miniapp calls POST /qr-login/confirm with { session_id, openid }
//   4. Web app polls GET /qr-login/status?session_id=  → detects "confirmed" → logs in

async function handlePostQrLoginInit(body) {
    try {
        const { app_id } = body || {};
        const credMap = {};
        if (process.env.WX_APPID && process.env.WX_SECRET)
            credMap[process.env.WX_APPID] = process.env.WX_SECRET;
        if (process.env.WX_APPID_WAVEN && process.env.WX_SECRET_WAVEN)
            credMap[process.env.WX_APPID_WAVEN] = process.env.WX_SECRET_WAVEN;
        if (process.env.WX_APPID_AEVIVA && process.env.WX_SECRET_AEVIVA)
            credMap[process.env.WX_APPID_AEVIVA] = process.env.WX_SECRET_AEVIVA;

        const appid  = (app_id && credMap[app_id]) ? app_id
            : (process.env.WX_APPID_WAVEN || process.env.WX_APPID);
        const secret = credMap[appid];
        if (!appid || !secret) return { success: false, error: 'WX_APPID_WAVEN / WX_SECRET_WAVEN not configured' };

        // session_id = 32 hex chars, matches wxacode.getunlimited scene max (32 UTF-8 chars)
        const sessionId = require('crypto').randomBytes(14).toString('hex'); // 28 hex chars, stored in DB
        const isdev = process.env.NODE_ENV !== 'production';
        // scene encodes the backend env so the miniapp routes confirm to the right host.
        // DB always stores the bare sessionId; the 'd:' prefix is only in the QR scene.
        const scene = isdev ? `d:${sessionId}` : sessionId;
        await pool.query(
            `INSERT INTO qr_login_sessions (session_id, status, expires_at)
             VALUES ($1, 'pending', NOW() + INTERVAL '5 minutes')`,
            [sessionId]
        );

        const token = await getWxAccessToken(appid, secret);
        const wxRes = await fetch(
            `https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${token}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scene: scene,
                    page: 'pages/qrlogin/qrlogin',
                    width: 280,
                    check_path: false,
                    env_version: process.env.NODE_ENV === 'production' ? 'release' : 'trial',
                }),
            }
        );
        const contentType = wxRes.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const errData = await wxRes.json();
            console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostQrLoginInit wx error', errData }));
            return { statusCode: 500, success: false, error: `WeChat: ${errData.errmsg} (${errData.errcode})` };
        }
        const imgBuf = await wxRes.arrayBuffer();
        const base64 = Buffer.from(imgBuf).toString('base64');
        console.log(JSON.stringify({ level: 'INFO', msg: 'handlePostQrLoginInit', sessionId, appid }));
        return { success: true, session_id: sessionId, qr_image: `data:image/png;base64,${base64}`, expires_in: 300 };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostQrLoginInit', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleGetQrLoginStatus(sessionId) {
    if (!sessionId) return { statusCode: 400, success: false, error: 'session_id required' };
    try {
        const r = await pool.query(
            `SELECT session_id, status, openid, expires_at FROM qr_login_sessions WHERE session_id = $1`,
            [sessionId]
        );
        if (!r.rows.length) return { statusCode: 404, success: false, error: 'Session not found' };
        const sess = r.rows[0];
        if (new Date(sess.expires_at) < new Date()) {
            return { success: true, status: 'expired' };
        }
        if (sess.status === 'confirmed' && sess.openid) {
            const uRes = await pool.query(
                `SELECT u.*,
                        ch.name AS channel_name, ch.logo_url AS channel_logo_url,
                        co_u.nickname AS coach_name
                 FROM users u
                 LEFT JOIN channels ch ON ch.id = u.channel_id
                 LEFT JOIN coaches co ON co.user_id = u.user_id
                 LEFT JOIN users co_u ON co_u.user_id = co.user_id
                 WHERE u.user_id = $1`,
                [sess.openid]
            );
            if (uRes.rows.length) {
                return { success: true, status: 'confirmed', user: uRes.rows[0] };
            }
        }
        return { success: true, status: sess.status };
    } catch (err) {
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostQrLoginConfirm(body) {
    const { session_id, openid } = body || {};
    if (!session_id || !openid) return { statusCode: 400, success: false, error: 'session_id and openid required' };
    try {
        const r = await pool.query(
            `UPDATE qr_login_sessions
             SET status = 'confirmed', openid = $2, confirmed_at = NOW()
             WHERE session_id = $1 AND status = 'pending' AND expires_at > NOW()
             RETURNING session_id`,
            [session_id, openid]
        );
        if (!r.rows.length) return { statusCode: 409, success: false, error: 'Session expired or already confirmed' };
        console.log(JSON.stringify({ level: 'INFO', msg: 'handlePostQrLoginConfirm', session_id, openid }));
        return { success: true };
    } catch (err) {
        return { statusCode: 500, success: false, error: err.message };
    }
}

module.exports = {
    handleResolvePhone,
    handleBindPhone,
    handleWxLogin,
    handleWxAppLogin,
    handleValidateInvite,
    handleGetMyReferrals,
    handlePostWebviewToken,
    handleExchangeWebviewToken,
    handlePostQrLoginInit,
    handleGetQrLoginStatus,
    handlePostQrLoginConfirm,
};
