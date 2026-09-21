// Custom avatars — a user's own photo turned into a 4-mood set in the gallery's art style.
// Record: docs/architecture/avatar-gallery.md §6. The pipeline itself is lib/avatarGen.js; this
// file is the I/O around it.
//
// Security shape (the health-documents pattern, CLAUDE.md §38): the upload key is minted HERE
// under 'avatar-uploads/<user_id>/' and re-checked on submit, so a caller can never hand the
// generator another user's object. /api/oss/presign is deliberately not used — it authorizes
// nothing. The source photo is deleted by the pipeline on every outcome, `source_oss_key` is
// never returned, and the outputs the client sees are 10-year presigned URLs (the gallery's own
// convention), never keys.
//
// Concurrency and cost: `uniq_avatar_generations_active` (one in-flight row per user) and a
// per-day cap (`AVATAR_GEN_MAX_PER_DAY`, default 3) — each successful attempt is 4 billed image
// calls. The slow work runs off-request as `kind:'avatar_generate'` on the existing chat.generate
// CloudEvent (§22); on publish failure it fails open and runs inline, like chat does.

const crypto = require('crypto');
const axios = require('axios');
const OpenAI = require('openai');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../lib/db');
const ossLib = require('../lib/oss');
const { publishChatGenerateEvent } = require('../lib/chatEventBridge');
const avatarGen = require('../lib/avatarGen');

const TEN_YEARS = 315360000;
const MAX_UPLOAD_BYTES = avatarGen.MAX_SOURCE_BYTES;
const PUT_CONTENT_TYPE = 'image/jpeg';   // the miniapp always sends a compressed JPEG
const MAX_PER_DAY = () => Math.max(1, parseInt(process.env.AVATAR_GEN_MAX_PER_DAY, 10) || 3);

const _keyPrefix = (userId) => `avatar-uploads/${userId}/`;

async function _resolveUser(openid) {
    if (!openid) return { ok: false, error: { success: false, error: 'openid is required', statusCode: 400 } };
    const { rows } = await pool.query(
        'SELECT user_id, language FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]
    );
    if (!rows.length) return { ok: false, error: { success: false, error: 'User not found', statusCode: 404 } };
    return { ok: true, userId: rows[0].user_id, language: rows[0].language || 'zh' };
}

// What a client may see of a row. `moods` only once done; never the source key, never raw keys.
function _publicRow(row) {
    if (!row) return null;
    const out = {
        gen_id: Number(row.id),
        status: row.status,
        error_code: row.error_code || null,
        created_at: row.created_at,
        finished_at: row.finished_at || null,
    };
    if (row.status === 'done' && row.mood_keys) out.moods = _moodUrls(row.mood_keys);
    return out;
}

function _moodUrls(moodKeys) {
    const urls = {};
    for (const [name, key] of Object.entries(moodKeys || {})) {
        if (typeof key === 'string' && key) urls[name] = ossLib.generatePresignedGetUrl(key, TEN_YEARS);
    }
    return urls;
}

// POST /api/avatar-generation/presign {openid}
async function handlePostAvatarGenerationPresign(body) {
    try {
        const owner = await _resolveUser(body?.openid);
        if (!owner.ok) return owner.error;
        const key = `${_keyPrefix(owner.userId)}${crypto.randomBytes(12).toString('hex')}.jpg`;
        return {
            success: true,
            key,
            put_url: ossLib.generatePresignedPutUrl(key, 600, null, PUT_CONTENT_TYPE),
            // Part of the signature — the PUT must send exactly this Content-Type.
            put_content_type: PUT_CONTENT_TYPE,
            max_bytes: MAX_UPLOAD_BYTES,
        };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostAvatarGenerationPresign failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// POST /api/avatar-generation {openid, oss_key} → {gen_id, status:'pending'}
async function handlePostAvatarGeneration(body) {
    try {
        const owner = await _resolveUser(body?.openid);
        if (!owner.ok) return owner.error;
        const userId = owner.userId;

        const ossKey = String(body?.oss_key || '').trim();
        if (!ossKey) return { success: false, error: 'oss_key is required', statusCode: 400 };
        if (!ossKey.startsWith(_keyPrefix(userId))) {
            return { success: false, error: 'Invalid oss_key', statusCode: 403 };
        }
        const head = await ossLib.headObject(ossKey);
        if (!head) return { success: false, error: 'Uploaded photo not found in storage', statusCode: 400, reason: 'upload_missing' };
        if (head.size_bytes && head.size_bytes > MAX_UPLOAD_BYTES) {
            await ossLib.deleteObject(ossKey);
            return { success: false, error: 'Photo too large', statusCode: 400, reason: 'too_large' };
        }

        const { rows: [{ n }] } = await pool.query(
            `SELECT COUNT(*)::int AS n FROM avatar_generations
              WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours' AND status <> 'rejected'`,
            [userId]
        );
        if (n >= MAX_PER_DAY()) {
            await ossLib.deleteObject(ossKey);
            return { success: false, error: 'Daily limit reached', statusCode: 429, reason: 'daily_limit' };
        }

        // The partial unique index is the lock: a second in-flight row for this user is refused
        // by Postgres, not by a check we could race past.
        let row;
        try {
            const ins = await pool.query(
                `INSERT INTO avatar_generations (user_id, status, source_oss_key)
                 VALUES ($1, 'pending', $2) RETURNING *`,
                [userId, ossKey]
            );
            row = ins.rows[0];
        } catch (e) {
            if (e.code === '23505') {
                await ossLib.deleteObject(ossKey);
                return { success: false, error: 'A generation is already in progress', statusCode: 409, reason: 'in_progress' };
            }
            throw e;
        }

        const eventId = uuidv4();
        await pool.query('UPDATE avatar_generations SET event_id = $2 WHERE id = $1', [row.id, eventId]);
        try {
            await publishChatGenerateEvent({ event_id: eventId, user_id: userId, kind: 'avatar_generate', gen_id: Number(row.id) });
            return { success: true, processing: true, generation: _publicRow(row) };
        } catch (ebErr) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'avatar_generate_publish_failed_fallback_sync', user_id: userId, gen_id: row.id, error: ebErr.message }));
            // Fail open: run inline. The miniapp times out well before this finishes, but FC
            // cancels the invocation on disconnect (§22), so this only helps when the client
            // holds on — the status endpoint is what the client actually watches.
            const result = await runAvatarGeneration(Number(row.id));
            const { rows: [fresh] } = await pool.query('SELECT * FROM avatar_generations WHERE id = $1', [row.id]);
            return { success: result.ok, processing: false, generation: _publicRow(fresh) };
        }
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostAvatarGeneration failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// GET /api/avatar-generation?openid= → the caller's latest generation (or null).
async function handleGetAvatarGeneration(query) {
    try {
        const owner = await _resolveUser(query?.openid);
        if (!owner.ok) return owner.error;
        const { rows } = await pool.query(
            `SELECT * FROM avatar_generations WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
            [owner.userId]
        );
        return { success: true, generation: _publicRow(rows[0]), max_per_day: MAX_PER_DAY() };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetAvatarGeneration failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// POST /api/avatar-generation/apply {openid, gen_id} → sets the custom avatar on the user row.
// `avatar_url` keeps storing the relaxed URL so every other read site is untouched (§20).
async function handlePostAvatarGenerationApply(body) {
    try {
        const owner = await _resolveUser(body?.openid);
        if (!owner.ok) return owner.error;
        const genId = parseInt(body?.gen_id, 10);
        if (!genId) return { success: false, error: 'gen_id is required', statusCode: 400 };

        // Ownership is in the predicate — another user's gen_id is simply not found.
        const { rows } = await pool.query(
            `SELECT * FROM avatar_generations WHERE id = $1 AND user_id = $2`, [genId, owner.userId]
        );
        const row = rows[0];
        if (!row) return { success: false, error: 'Generation not found', statusCode: 404 };
        if (row.status !== 'done' || !row.mood_keys) return { success: false, error: 'Generation is not complete', statusCode: 409 };

        const moods = _moodUrls(row.mood_keys);
        const relaxed = moods[avatarGen.DEFAULT_MOOD];
        if (!relaxed) return { success: false, error: 'Generation has no relaxed variant', statusCode: 409 };

        await pool.query(
            `UPDATE users SET avatar_character = 'custom', avatar_moods = $2, avatar_url = $3 WHERE user_id = $1`,
            [owner.userId, JSON.stringify(moods), relaxed]
        );
        return { success: true, avatar_character: 'custom', avatar_url: relaxed, avatar_moods: moods };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostAvatarGenerationApply failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// The event-side entry point (handleChatGenerateEvent → kind 'avatar_generate'). Builds the real
// clients once per call; the lib itself is pure over what it is handed.
async function runAvatarGeneration(genId) {
    const llmClient = new OpenAI({
        apiKey: process.env.DASHSCOPE_API_KEY,
        baseURL: `${process.env.DASHSCOPE_HOST || 'https://dashscope.aliyuncs.com'}/compatible-mode/v1`,
        timeout: 60_000,
        maxRetries: 1,
    });
    return avatarGen.runAvatarGeneration(genId, {
        pool, ossLib, llmClient, http: axios,
        apiKey: process.env.DASHSCOPE_API_KEY,
        model: process.env.AVATAR_GEN_MODEL || avatarGen.DEFAULT_MODEL,
    });
}

module.exports = {
    handlePostAvatarGenerationPresign,
    handlePostAvatarGeneration,
    handleGetAvatarGeneration,
    handlePostAvatarGenerationApply,
    runAvatarGeneration,
};
