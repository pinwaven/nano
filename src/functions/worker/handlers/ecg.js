'use strict';

// 心电节律记录 — single-lead ECG strips recorded from the V8 band (CLAUDE.md §18) by the
// miniapp's <ecg-record> component. Twin layer 2, Daily Monitoring (§34): the SUMMARY (rate,
// R–R statistics, beat counts, sample rate) is a health_events row with category 'ecg' — what
// the twin, chat and the AG bundle may consume — and the WAVEFORM (24-bit packed samples,
// ~23 KB for 30 s) lives in OSS under a server-minted key that is never returned to a client.
//
// Security header, same shape as health_documents.js: openid is a client-supplied string and
// every handler resolves the owner server-side through _resolveOwner; a coach reads a client's
// strips through the same coarse users.coach_id check as user facts and never writes one.
//
// What this is NOT: a diagnosis. The band gives dimensionless counts with no voltage scale and
// ships no analysis; lib/ecgAnalysis.js derives rhythm only. Copy in every surface says so.

const { pool } = require('../lib/db');
const ossLib = require('../lib/oss');
const { analyzeEcg, packSamples, unpackSamples, ECG_MIN_ACCEPTED_BEATS } = require('../lib/ecgAnalysis');

const SUPPORTED_BRANDS = new Set(['v8']);
const MAX_PACKETS = 2000;              // ~10 minutes at 3 packets/s; a 30 s strip is ~90
const MAX_SAMPLES_PER_PACKET = 200;    // the band sends 80
const LIST_LIMIT = 30;
const SOURCE = 'v8';
const CATEGORY = 'ecg';

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
    return { success: false, reason: 'coach_cannot_write', error: 'A coach cannot record a client\'s ECG', statusCode: 403 };
}

function _keyFor(userId, startedAtMs) {
    return `ecg/${userId}/${startedAtMs}.ecg24`;
}

// The row a client sees: the summary — never the OSS key, and not the peak index list, which
// only means something next to the waveform (handleGetEcgWaveform returns it beside the samples).
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

// POST /api/ecg — body: { openid, brand, device_name?, duration_seconds?, started_at (ms),
// packets: [{ packetId, samples: number[], receivedAt: ms }] }.
// Refuses (200, success:false) a strip with too few clean beats — that is a contact miss the
// UI explains, not a server error — and never stores it.
async function handlePostEcg(body) {
    try {
        const refusal = _refuseCoach(body?.coach_id);
        if (refusal) return refusal;
        const owner = await _resolveOwner(body?.openid, null);
        if (!owner.ok) return owner.error;

        const brand = String(body?.brand || '').toLowerCase();
        if (!SUPPORTED_BRANDS.has(brand)) {
            return { success: false, reason: 'unsupported_brand', error: 'ECG is only supported on the V8 band', statusCode: 400 };
        }
        const packets = Array.isArray(body?.packets) ? body.packets : [];
        if (!packets.length || packets.length > MAX_PACKETS ||
            packets.some((p) => !p || !Array.isArray(p.samples) || p.samples.length > MAX_SAMPLES_PER_PACKET)) {
            return { success: false, reason: 'bad_packets', error: 'packets must be a non-empty list of { packetId, samples, receivedAt }', statusCode: 400 };
        }
        const startedAt = Number(body?.started_at) || Number(packets[0].receivedAt) || Date.now();

        const result = analyzeEcg(packets);
        if (!result.ok) {
            return {
                success: false,
                reason: result.reason,
                min_accepted_beats: ECG_MIN_ACCEPTED_BEATS,
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
            [owner.userId, SOURCE, CATEGORY, recordedAt.toISOString(), JSON.stringify(data), `ecg_${startedAt}`, body?.device_name || null]
        );
        if (!rows[0]) {
            // Same started_at twice — the first write stands.
            const { rows: existing } = await pool.query(
                `SELECT id, recorded_at, data_date::text AS data_date, data, wearable_name FROM health_events
                 WHERE user_id = $1 AND source = $2 AND external_id = $3`, [owner.userId, SOURCE, `ecg_${startedAt}`]
            );
            return { success: true, duplicate: true, ecg: existing[0] ? _publicRow(existing[0]) : null };
        }
        console.log(JSON.stringify({ level: 'INFO', msg: 'ecg_recorded', userId: owner.userId, id: rows[0].id, bpm: result.summary.bpm, beats: result.summary.accepted_beats, seconds: result.summary.duration_seconds }));
        return { success: true, ecg: _publicRow(rows[0]) };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostEcg failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// GET /api/ecg?openid=[&coach_id=][&limit=] — newest first, summaries only.
async function handleGetEcgList(query) {
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
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetEcgList failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// GET /api/ecg/{id}/waveform?openid=[&coach_id=] — the samples inline (a 30 s strip is a few
// tens of KB; a presigned URL would only add a download the miniapp then has to parse).
async function handleGetEcgWaveform(eventId, query) {
    try {
        const owner = await _resolveOwner(query?.openid, query?.coach_id);
        if (!owner.ok) return owner.error;
        const { rows: [row] } = await pool.query(
            `SELECT id, recorded_at, data_date::text AS data_date, data, wearable_name FROM health_events
             WHERE id = $1 AND user_id = $2 AND category = $3`, [eventId, owner.userId, CATEGORY]
        );
        if (!row) return { success: false, error: 'ECG not found', statusCode: 404 };
        const key = row.data?.oss_key;
        if (!key) return { success: false, error: 'Waveform not stored', statusCode: 404 };
        const buf = await ossLib.getObjectBuffer(key);
        return { success: true, ecg: _publicRow(row), samples: unpackSamples(buf), peaks: row.data?.peaks || [] };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetEcgWaveform failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// DELETE /api/ecg/{id}?openid= — the owner's alone. Hard delete of the row; the object is left
// for a future purge like health documents.
async function handleDeleteEcg(eventId, query) {
    try {
        const refusal = _refuseCoach(query?.coach_id);
        if (refusal) return refusal;
        const owner = await _resolveOwner(query?.openid, null);
        if (!owner.ok) return owner.error;
        const { rowCount } = await pool.query(
            'DELETE FROM health_events WHERE id = $1 AND user_id = $2 AND category = $3', [eventId, owner.userId, CATEGORY]
        );
        if (!rowCount) return { success: false, error: 'ECG not found', statusCode: 404 };
        return { success: true };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleDeleteEcg failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

module.exports = { handlePostEcg, handleGetEcgList, handleGetEcgWaveform, handleDeleteEcg, _publicRow };
