'use strict';

// 脉搏波记录 — raw PPG pulse-wave strips recorded from the V8 band or the Halo ring by the
// miniapp's <strip-record kind="ppg"> component. Same architecture as ecg.js (read its header):
// twin layer 2 (§34), the SUMMARY (rate, beat-interval statistics, quality) is a health_events
// row with category 'ppg', the WAVEFORM (24-bit packed, ~9 KB for 60 s at 50 Hz) lives in OSS
// under a server-minted key never returned to a client. Ownership is the health-documents
// pattern: openid resolved server-side, a coach reads through users.coach_id and never writes.
//
// The stream is the vendor SDK's "blood glucose" collection (0x78/0x3a) — a plain optical tap
// the vendor meant to feed a grading server nano does not have and does not want. Nothing here
// is glucose, SpO2 or a diagnosis: lib/ppgAnalysis.js derives heart rate and beat regularity.

const { pool } = require('../lib/db');
const ossLib = require('../lib/oss');
const { analyzePpg, packSamples, unpackSamples, PPG_MIN_ACCEPTED_BEATS } = require('../lib/ppgAnalysis');

const SUPPORTED_BRANDS = new Set(['v8', 'halo']);
const MAX_PACKETS = 600;               // 10 minutes at one 50-sample frame per second; a 60 s strip is ~60
const MAX_SAMPLES_PER_PACKET = 100;    // both devices send 50
const LIST_LIMIT = 30;
const CATEGORY = 'ppg';

async function _resolveOwner(openid, coachId) {
    if (!openid) {
        return { ok: false, error: { success: false, reason: 'missing_openid', error: 'openid is required', statusCode: 400 } };
    }
    const { rows } = await pool.query(
        'SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]
    );
    const userId = rows[0]?.user_id;
    if (!userId) {
        return { ok: false, error: { success: false, reason: 'user_not_found', error: 'User not found', statusCode: 404 } };
    }
    if (coachId) {
        const check = await pool.query('SELECT 1 FROM users WHERE user_id = $1 AND coach_id = $2', [userId, coachId]);
        if (check.rows.length === 0) {
            return { ok: false, error: { success: false, reason: 'access_denied', error: 'Access denied', statusCode: 403 } };
        }
    }
    return { ok: true, userId };
}

// A coach never records or deletes a strip. Intent, not enforcement — see health_documents.js.
function _refuseCoach(coachId) {
    if (!coachId) return null;
    return { success: false, reason: 'coach_cannot_write', error: 'A coach cannot record a client\'s pulse wave', statusCode: 403 };
}

function _keyFor(userId, startedAtMs) {
    return `ppg/${userId}/${startedAtMs}.ppg24`;
}

// The row a client sees: the summary — never the OSS key, and not the peak index list, which
// only means something next to the waveform (handleGetPpgWaveform returns it beside the samples).
function _publicRow(row) {
    const d = row.data || {};
    const { oss_key, peaks, ...summary } = d;
    return {
        id: Number(row.id),
        recorded_at: row.recorded_at,
        data_date: row.data_date,
        wearable_name: row.wearable_name || null,
        ...summary,
    };
}

// POST /api/ppg — body: { openid, brand ('v8' | 'halo'; 'x3' accepted as halo), device_name?,
// duration_seconds?, started_at (ms), packets: [{ packetId, samples: number[], receivedAt: ms }] }.
// Refuses (200, success:false) a strip whose beats are too few or too irregular to trust — a
// loose strap or a moving hand, which the UI explains — and never stores it.
async function handlePostPpg(body) {
    try {
        const refusal = _refuseCoach(body?.coach_id);
        if (refusal) return refusal;
        const owner = await _resolveOwner(body?.openid, null);
        if (!owner.ok) return owner.error;

        let brand = String(body?.brand || '').toLowerCase();
        if (brand === 'x3') brand = 'halo';   // legacy binding value from before the rename (§18)
        if (!SUPPORTED_BRANDS.has(brand)) {
            return { success: false, reason: 'unsupported_brand', error: 'Pulse-wave recording is only supported on the V8 band and the Halo ring', statusCode: 400 };
        }
        const packets = Array.isArray(body?.packets) ? body.packets : [];
        if (!packets.length || packets.length > MAX_PACKETS ||
            packets.some((p) => !p || !Array.isArray(p.samples) || p.samples.length > MAX_SAMPLES_PER_PACKET)) {
            return { success: false, reason: 'bad_packets', error: 'packets must be a non-empty list of { packetId, samples, receivedAt }', statusCode: 400 };
        }
        const startedAt = Number(body?.started_at) || Number(packets[0].receivedAt) || Date.now();

        const result = analyzePpg(packets);
        if (!result.ok) {
            return {
                success: false,
                reason: result.reason,
                min_accepted_beats: PPG_MIN_ACCEPTED_BEATS,
                summary: result.summary,
            };
        }

        const ossKey = _keyFor(owner.userId, startedAt);
        await ossLib.putObjectBuffer(ossKey, packSamples(result.live.samples), 'application/octet-stream');

        const recordedAt = new Date(startedAt);
        const data = {
            ...result.summary,
            brand,
            peaks: result.live.peaks,          // sample indexes into the stored waveform
            requested_seconds: Number(body?.duration_seconds) || null,
            oss_key: ossKey,
        };
        const { rows } = await pool.query(
            `INSERT INTO health_events (user_id, source, category, data_date, recorded_at, data, external_id, wearable_name)
             VALUES ($1, $2, $3, ($4::timestamptz AT TIME ZONE 'Asia/Shanghai')::date, $4, $5, $6, $7)
             ON CONFLICT (user_id, source, external_id) WHERE external_id IS NOT NULL DO NOTHING
             RETURNING id, recorded_at, data_date::text AS data_date, data, wearable_name`,
            [owner.userId, brand, CATEGORY, recordedAt.toISOString(), JSON.stringify(data), `ppg_${startedAt}`, body?.device_name || null]
        );
        if (!rows[0]) {
            // Same started_at twice — the first write stands.
            const { rows: existing } = await pool.query(
                `SELECT id, recorded_at, data_date::text AS data_date, data, wearable_name FROM health_events
                 WHERE user_id = $1 AND source = $2 AND external_id = $3`, [owner.userId, brand, `ppg_${startedAt}`]
            );
            return { success: true, duplicate: true, ppg: existing[0] ? _publicRow(existing[0]) : null };
        }
        console.log(JSON.stringify({ level: 'INFO', msg: 'ppg_recorded', userId: owner.userId, id: rows[0].id, brand, bpm: result.summary.bpm, beats: result.summary.accepted_beats, seconds: result.summary.duration_seconds }));
        return { success: true, ppg: _publicRow(rows[0]) };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostPpg failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// GET /api/ppg?openid=[&coach_id=][&limit=] — newest first, summaries only.
async function handleGetPpgList(query) {
    try {
        const owner = await _resolveOwner(query?.openid, query?.coach_id);
        if (!owner.ok) return owner.error;
        const limit = Math.max(1, Math.min(LIST_LIMIT, parseInt(query?.limit, 10) || LIST_LIMIT));
        const { rows } = await pool.query(
            `SELECT id, recorded_at, data_date::text AS data_date, data, wearable_name FROM health_events
             WHERE user_id = $1 AND category = $2 ORDER BY recorded_at DESC LIMIT $3`,
            [owner.userId, CATEGORY, limit]
        );
        return { success: true, items: rows.map(_publicRow) };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetPpgList failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// GET /api/ppg/{id}/waveform?openid=[&coach_id=] — the samples inline (a 60 s strip at 50 Hz is
// ~3000 numbers).
async function handleGetPpgWaveform(eventId, query) {
    try {
        const owner = await _resolveOwner(query?.openid, query?.coach_id);
        if (!owner.ok) return owner.error;
        const { rows: [row] } = await pool.query(
            `SELECT id, recorded_at, data_date::text AS data_date, data, wearable_name FROM health_events
             WHERE id = $1 AND user_id = $2 AND category = $3`, [eventId, owner.userId, CATEGORY]
        );
        if (!row) return { success: false, error: 'Pulse wave not found', statusCode: 404 };
        const key = row.data?.oss_key;
        if (!key) return { success: false, error: 'Waveform not stored', statusCode: 404 };
        const buf = await ossLib.getObjectBuffer(key);
        return { success: true, ppg: _publicRow(row), samples: unpackSamples(buf), peaks: row.data?.peaks || [] };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetPpgWaveform failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// DELETE /api/ppg/{id}?openid= — the owner's alone. Hard delete of the row; the object is left
// for a future purge like health documents.
async function handleDeletePpg(eventId, query) {
    try {
        const refusal = _refuseCoach(query?.coach_id);
        if (refusal) return refusal;
        const owner = await _resolveOwner(query?.openid, null);
        if (!owner.ok) return owner.error;
        const { rowCount } = await pool.query(
            'DELETE FROM health_events WHERE id = $1 AND user_id = $2 AND category = $3', [eventId, owner.userId, CATEGORY]
        );
        if (!rowCount) return { success: false, error: 'Pulse wave not found', statusCode: 404 };
        return { success: true };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleDeletePpg failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

module.exports = { handlePostPpg, handleGetPpgList, handleGetPpgWaveform, handleDeletePpg, _publicRow };
