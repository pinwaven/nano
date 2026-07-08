const { pool } = require('../lib/db');
const { calculateAge } = require('../lib/time-utils');

async function handleGetKinoDevices() {
    const result = await pool.query(`
        SELECT kd.id, kd.serial_number, kd.name, kd.status, kd.notes, kd.registered_at, kd.created_at,
               kd.coach_id, u.nickname AS coach_name,
               kd.channel_id, ch.name AS channel_name,
               COUNT(b.id)::int AS test_count,
               MAX(b.tested_at) AS last_used_at
        FROM kino_devices kd
        LEFT JOIN coaches c ON c.id = kd.coach_id
        LEFT JOIN users u ON u.user_id = c.user_id
        LEFT JOIN channels ch ON ch.id = kd.channel_id
        LEFT JOIN biomarkers b ON b.kino_device_id = kd.id
        GROUP BY kd.id, u.nickname, ch.name
        ORDER BY kd.id ASC
    `);
    return { success: true, devices: result.rows };
}

async function handlePostKinoDevice(body) {
    const { serial_number, name, coach_id, channel_id, status, notes } = body;
    if (!serial_number?.trim()) return { success: false, error: 'serial_number is required', statusCode: 400 };
    const normalizedSerialNumber = serial_number.trim().toUpperCase();
    try {
        const result = await pool.query(
            `INSERT INTO kino_devices (serial_number, name, coach_id, channel_id, status, notes)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [normalizedSerialNumber, name || null, coach_id || null, channel_id || null, status || 'active', notes || null]
        );
        return { success: true, id: result.rows[0].id };
    } catch (err) {
        if (err.code === '23505' && err.constraint === 'kino_devices_serial_number_key') {
            return {
                success: false,
                error: 'serial_number already exists',
                code: 'duplicate_serial_number',
                statusCode: 409,
            };
        }
        return { success: false, error: err.detail || err.message };
    }
}

async function handlePutKinoDevice(id, body) {
    const { name, coach_id, channel_id, status, notes } = body;
    try {
        await pool.query(
            `UPDATE kino_devices SET name=$1, coach_id=$2, channel_id=$3, status=$4, notes=$5 WHERE id=$6`,
            [name || null, coach_id || null, channel_id || null, status || 'active', notes || null, parseInt(id)]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteKinoDevice(id) {
    try {
        await pool.query('DELETE FROM kino_devices WHERE id = $1', [parseInt(id)]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetKinoChipBatches() {
    try {
        const result = await pool.query(`
            SELECT b.id, b.prefix, b.model, b.quantity, b.status, b.notes, b.created_at,
                   COUNT(c.id)                                          AS total_chips,
                   COUNT(CASE WHEN c.status = 'available' THEN 1 END)  AS available,
                   COUNT(CASE WHEN c.status = 'used'      THEN 1 END)  AS used,
                   COUNT(CASE WHEN c.status = 'damaged'   THEN 1 END)  AS damaged
            FROM kino_chip_batches b
            LEFT JOIN kino_chips c ON c.batch_id = b.id
            GROUP BY b.id
            ORDER BY b.created_at DESC
        `);
        return { success: true, batches: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetKinoChipBatchChips(batchId, query) {
    try {
        const page  = Math.max(1, parseInt(query.page  || '1'));
        const limit = Math.min(100, parseInt(query.limit || '50'));
        const offset = (page - 1) * limit;
        const rows = await pool.query(
            `SELECT c.id, c.chip_code, c.status, c.created_at,
                    s.scan_status, s.user_id, u.nickname
             FROM kino_chips c
             LEFT JOIN scans  s ON s.chip_id  = c.chip_code
             LEFT JOIN users  u ON u.user_id  = s.user_id
             WHERE c.batch_id = $1
             ORDER BY c.chip_code
             LIMIT $2 OFFSET $3`,
            [parseInt(batchId), limit, offset]
        );
        const cnt = await pool.query(
            'SELECT COUNT(*) FROM kino_chips WHERE batch_id = $1',
            [parseInt(batchId)]
        );
        return { success: true, chips: rows.rows, total: parseInt(cnt.rows[0].count), page, limit };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostKinoChipBatch(body) {
    const { prefix, model, quantity, notes } = body;
    if (!prefix || !prefix.trim()) return { success: false, error: 'prefix is required' };
    if (!model  || !model.trim())  return { success: false, error: 'model is required' };
    const qty = parseInt(quantity);
    if (!qty || qty < 1 || qty > 9999) return { success: false, error: 'quantity must be 1–9999' };

    const cleanPrefix = prefix.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(cleanPrefix)) return { success: false, error: 'prefix must be 3–20 uppercase letters/digits' };
    const pad = 4;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const batchRes = await client.query(
            `INSERT INTO kino_chip_batches (prefix, model, quantity, notes)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [cleanPrefix, model.trim(), qty, notes || null]
        );
        const batchId = batchRes.rows[0].id;

        // Insert chips in chunks of 500 rows to avoid huge single queries
        const CHUNK = 500;
        for (let start = 1; start <= qty; start += CHUNK) {
            const end = Math.min(start + CHUNK - 1, qty);
            const vals = [], params = [];
            for (let i = start; i <= end; i++) {
                vals.push(`($${params.length + 1}, $${params.length + 2})`);
                params.push(batchId, `${cleanPrefix}-${String(i).padStart(pad, '0')}`);
            }
            await client.query(
                `INSERT INTO kino_chips (batch_id, chip_code) VALUES ${vals.join(', ')}`,
                params
            );
        }
        await client.query('COMMIT');
        return { success: true, id: batchId, prefix: cleanPrefix, quantity: qty };
    } catch (err) {
        await client.query('ROLLBACK');
        return { success: false, error: err.message };
    } finally {
        client.release();
    }
}

async function handlePutKinoChipBatch(id, body) {
    const { model, notes, status } = body;
    const validStatuses = ['active', 'inactive', 'recalled'];
    if (status !== undefined && !validStatuses.includes(status)) {
        return { success: false, error: `status must be one of: ${validStatuses.join(', ')}` };
    }
    try {
        await pool.query(
            `UPDATE kino_chip_batches
             SET model  = COALESCE($1, model),
                 notes  = $2,
                 status = COALESCE($3, status)
             WHERE id = $4`,
            [model || null, notes ?? null, status || null, parseInt(id)]
        );
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteKinoChipBatch(id) {
    try {
        const check = await pool.query(
            `SELECT COUNT(*) FROM kino_chips WHERE batch_id = $1 AND status = 'used'`,
            [parseInt(id)]
        );
        if (parseInt(check.rows[0].count) > 0) {
            return { success: false, error: 'Cannot delete a batch with used chips' };
        }
        await pool.query('DELETE FROM kino_chip_batches WHERE id = $1', [parseInt(id)]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetKinoChipModels() {
    try {
        const result = await pool.query(`
            SELECT m.code, m.name, m.biomarker_keys, m.config,
                   m.guide_video, m.guide_text, m.status, m.notes,
                   m.created_at, m.updated_at,
                   COALESCE(b.batch_count, 0)::int  AS batch_count,
                   COALESCE(b.chip_count, 0)::int   AS chip_count
            FROM kino_chip_models m
            LEFT JOIN (
                SELECT cb.model AS code,
                       COUNT(DISTINCT cb.id)::int AS batch_count,
                       COALESCE(SUM(cb.quantity), 0)::int AS chip_count
                FROM kino_chip_batches cb
                GROUP BY cb.model
            ) b ON b.code = m.code
            ORDER BY m.code
        `);
        return { success: true, models: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function normalizeChipModelInput(body) {
    const out = {};
    if (typeof body.code === 'string') out.code = body.code.trim().toUpperCase();
    if (typeof body.name === 'string') out.name = body.name.trim() || null;
    if (Array.isArray(body.biomarker_keys)) {
        out.biomarker_keys = body.biomarker_keys
            .map(k => typeof k === 'string' ? k.trim() : '')
            .filter(Boolean);
    }
    if (body.config !== undefined) {
        if (typeof body.config === 'string') {
            try { out.config = JSON.parse(body.config); }
            catch (e) { throw new Error('config is not valid JSON: ' + e.message); }
        } else if (typeof body.config === 'object' && body.config !== null) {
            out.config = body.config;
        } else {
            throw new Error('config must be a JSON object');
        }
    }
    if (typeof body.guide_video === 'string') out.guide_video = body.guide_video.trim() || null;
    if (typeof body.guide_text  === 'string') out.guide_text  = body.guide_text.trim()  || null;
    if (typeof body.status      === 'string') out.status      = body.status.trim() || 'active';
    if (typeof body.notes       === 'string') out.notes       = body.notes.trim() || null;
    return out;
}

async function handlePostKinoChipModel(body) {
    try {
        const m = normalizeChipModelInput(body || {});
        if (!m.code) return { success: false, error: 'code is required' };
        if (!/^[A-Z0-9]{1,16}$/.test(m.code)) return { success: false, error: 'code must be 1–16 uppercase letters/digits' };
        if (!Array.isArray(m.biomarker_keys) || m.biomarker_keys.length === 0) {
            return { success: false, error: 'biomarker_keys must be a non-empty array' };
        }
        if (!m.config || typeof m.config !== 'object') {
            return { success: false, error: 'config (JSON object) is required' };
        }
        const result = await pool.query(
            `INSERT INTO kino_chip_models
                (code, name, biomarker_keys, config, guide_video, guide_text, status, notes)
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'active'), $8)
             RETURNING code`,
            [m.code, m.name || null, m.biomarker_keys, m.config,
             m.guide_video || null, m.guide_text || null, m.status, m.notes || null]
        );
        return { success: true, code: result.rows[0].code };
    } catch (err) {
        if (err.code === '23505') return { success: false, error: 'A model with this code already exists' };
        return { success: false, error: err.message };
    }
}

async function handlePutKinoChipModel(code, body) {
    try {
        const m = normalizeChipModelInput(body || {});
        const sets = [];
        const params = [];
        const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

        if ('name'           in m) push('name',           m.name);
        if ('biomarker_keys' in m) push('biomarker_keys', m.biomarker_keys);
        if ('config'         in m) push('config',         m.config);
        if ('guide_video'    in m) push('guide_video',    m.guide_video);
        if ('guide_text'     in m) push('guide_text',     m.guide_text);
        if ('status'         in m) push('status',         m.status);
        if ('notes'          in m) push('notes',          m.notes);

        if (sets.length === 0) return { success: false, error: 'No fields to update' };
        sets.push('updated_at = CURRENT_TIMESTAMP');
        params.push(String(code).toUpperCase());

        const result = await pool.query(
            `UPDATE kino_chip_models SET ${sets.join(', ')} WHERE code = $${params.length} RETURNING code`,
            params
        );
        if (result.rowCount === 0) return { success: false, error: 'Model not found' };
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteKinoChipModel(code) {
    try {
        const upper = String(code).toUpperCase();
        const ref = await pool.query(
            'SELECT COUNT(*)::int AS n FROM kino_chip_batches WHERE model = $1',
            [upper]
        );
        if (ref.rows[0].n > 0) {
            return { success: false, error: `Cannot delete: ${ref.rows[0].n} batch(es) reference this model` };
        }
        const result = await pool.query(
            'DELETE FROM kino_chip_models WHERE code = $1 RETURNING code',
            [upper]
        );
        if (result.rowCount === 0) return { success: false, error: 'Model not found' };
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetKinoChip(chip_id) {
    if (!chip_id) throw new Error('chip_id is required');

    const batchCheck = await pool.query(
        `SELECT kb.status AS batch_status, kc.status AS chip_status
         FROM kino_chips kc
         JOIN kino_chip_batches kb ON kb.id = kc.batch_id
         WHERE kc.chip_code = $1`,
        [chip_id]
    );
    if (batchCheck.rows.length === 0 || batchCheck.rows[0].batch_status !== 'active') {
        return { found: false };
    }
    const chip_status = batchCheck.rows[0].chip_status;

    const result = await pool.query(
        `SELECT s.id, s.user_id, s.scan_status, u.nickname, u.birth_date, u.gender,
                cb.model,
                m.biomarker_keys, m.config AS chip_config, m.guide_video, m.guide_text
         FROM scans s
         JOIN users u ON u.user_id = s.user_id
         LEFT JOIN kino_chips        c  ON c.chip_code = s.chip_id
         LEFT JOIN kino_chip_batches cb ON cb.id       = c.batch_id
         LEFT JOIN kino_chip_models  m  ON m.code      = cb.model
         WHERE s.chip_id = $1 LIMIT 1`,
        [chip_id]
    );
    if (result.rows.length === 0) {
        // If chip is used but no scan record exists (e.g. manual sync), return used: true
        if (chip_status === 'used') return { found: true, used: true };
        return { found: false };
    }
    const row = result.rows[0];
    return {
        found: true,
        used: row.scan_status === 'completed' || chip_status === 'used',
        scan_id: row.id,
        user_id: row.user_id,
        scan_status: row.scan_status,
        nickname: row.nickname,
        birth_date: row.birth_date || null,
        chrono_age: row.birth_date ? calculateAge(row.birth_date) : null,
        gender: row.gender || null,
        model: row.model || null,
        biomarker_keys: row.biomarker_keys || null,
        chip_config: row.chip_config || null,
        guide_video: row.guide_video || null,
        guide_text: row.guide_text || null,
    };
}

async function handlePostKinoScan(body) {
    const { openid, chip_id } = body;
    if (!openid) throw new Error('openid is required');
    if (!chip_id) throw new Error('chip_id is required');

    const batchCheck = await pool.query(
        `SELECT kb.status AS batch_status, kc.status AS chip_status
         FROM kino_chips kc
         JOIN kino_chip_batches kb ON kb.id = kc.batch_id
         WHERE kc.chip_code = $1`,
        [chip_id]
    );
    if (batchCheck.rows.length === 0 || batchCheck.rows[0].batch_status !== 'active') {
        return { success: false, status: 'invalid_chip' };
    }
    if (batchCheck.rows[0].chip_status === 'used') {
        return { success: false, status: 'used' };
    }

    const userResult = await pool.query(
        'SELECT user_id FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1',
        [openid]
    );
    if (userResult.rows.length === 0) throw new Error('User not found');
    const user_id = userResult.rows[0].user_id;

    const existing = await pool.query(
        'SELECT id, user_id, scan_status FROM scans WHERE chip_id = $1 LIMIT 1',
        [chip_id]
    );

    if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (row.scan_status === 'completed') {
            return { success: true, status: 'used', scan_id: row.id };
        }
        if (row.user_id === user_id) {
            return { success: true, status: 'already_linked', scan_id: row.id };
        }
    }

    const result = await pool.query(
        `INSERT INTO scans (user_id, chip_id, scan_status, scan_results)
         VALUES ($1, $2, 'pending', $3)
         ON CONFLICT (chip_id) WHERE chip_id IS NOT NULL DO UPDATE SET user_id = EXCLUDED.user_id, scan_status = 'pending', updated_at = NOW()
         RETURNING id`,
        [user_id, chip_id, JSON.stringify({ chip_id })]
    );
    return { success: true, status: 'registered', scan_id: result.rows[0].id };
}

function asPlainObject(value) {
    if (!value) return {};
    if (typeof value === 'string') {
        try {
            return asPlainObject(JSON.parse(value));
        } catch (_) {
            return {};
        }
    }
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    return {};
}

function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function mergePlainObjects(base, patch) {
    const result = { ...asPlainObject(base) };
    for (const [key, value] of Object.entries(asPlainObject(patch))) {
        const current = result[key];
        result[key] = isPlainObject(current) && isPlainObject(value)
            ? mergePlainObjects(current, value)
            : value;
    }
    return result;
}

async function handlePostKinoResult(body) {
    const { chip_id, data, bio_age, kino_device_id, biomarker_id } = body;
    if (!chip_id) throw new Error('chip_id is required');
    if (!data) throw new Error('data is required');

    const scanResult = await pool.query(
        'SELECT id, user_id FROM scans WHERE chip_id = $1 LIMIT 1',
        [chip_id]
    );
    if (scanResult.rows.length === 0) throw new Error('No registered scan found for this chip');

    const { id: scan_id, user_id } = scanResult.rows[0];

    await pool.query(
        `UPDATE scans SET scan_status = 'completed', scan_results = $1 WHERE id = $2`,
        [JSON.stringify({ chip_id, ...data }), scan_id]
    );

    await pool.query(
        `UPDATE kino_chips SET status = 'used' WHERE chip_code = $1`,
        [chip_id]
    );

    const deviceId = kino_device_id || null;
    let finalBiomarkerId = biomarker_id || null;

    if (!finalBiomarkerId) {
        if (deviceId !== null) {
            const biomarkerResult = await pool.query(
                `SELECT id, data FROM biomarkers
                 WHERE user_id = $1
                   AND test_type = 'kino_chip'
                   AND kino_device_id = $2
                   AND tested_at >= NOW() - INTERVAL '10 minutes'
                 ORDER BY tested_at DESC
                 LIMIT 1`,
                [user_id, deviceId]
            );
            if (biomarkerResult.rows.length === 1) {
                finalBiomarkerId = biomarkerResult.rows[0].id;
                const mergedData = mergePlainObjects(biomarkerResult.rows[0].data, data);
                await pool.query(
                    `UPDATE biomarkers SET data = $1, bio_age = $2, tested_at = NOW() WHERE id = $3`,
                    [JSON.stringify(mergedData), bio_age ?? null, finalBiomarkerId]
                );
            }
        }

        if (!finalBiomarkerId) {
            const bmResult = await pool.query(
                `INSERT INTO biomarkers (user_id, test_type, data, bio_age, tested_at, kino_device_id)
                 VALUES ($1, 'kino_chip', $2, $3, NOW(), $4) RETURNING id`,
                [user_id, JSON.stringify(data), bio_age ?? null, deviceId]
            );
            finalBiomarkerId = bmResult.rows[0].id;
        }
    }

    if (finalBiomarkerId) {
        await pool.query(
            `UPDATE scans SET biomarker_id = $1 WHERE id = $2`,
            [finalBiomarkerId, scan_id]
        );
    }

    return { success: true, scan_id, biomarker_id: finalBiomarkerId, user_id };
}

async function handleGetKinoTestedChips(query) {
    try {
        const page  = Math.max(1, parseInt(query.page  || '1'));
        const limit = Math.min(100, parseInt(query.limit || '20'));
        const offset = (page - 1) * limit;
        const search = (query.search || '').trim();

        const params = [];
        let searchClause = '';
        if (search) {
            params.push(`%${search}%`);
            searchClause = `AND (s.chip_id ILIKE $${params.length} OR u.nickname ILIKE $${params.length})`;
        }

        const rows = await pool.query(
            `SELECT s.id AS scan_id, s.chip_id AS chip_code, s.scan_status,
                    s.created_at AS scanned_at, s.updated_at,
                    cb.id AS batch_id, cb.prefix AS batch_prefix, cb.model,
                    u.user_id, u.nickname,
                    b.id AS biomarker_id, b.bio_age, b.tested_at,
                    kd.id AS kino_device_id, kd.name AS device_name, kd.serial_number AS device_serial
             FROM scans s
             JOIN kino_chips c ON c.chip_code = s.chip_id
             JOIN kino_chip_batches cb ON cb.id = c.batch_id
             JOIN users u ON u.user_id = s.user_id
             LEFT JOIN biomarkers b ON b.id = COALESCE(s.biomarker_id, (
                 SELECT b2.id FROM biomarkers b2
                 WHERE b2.user_id = s.user_id AND b2.test_type = 'kino_chip'
                 ORDER BY ABS(EXTRACT(EPOCH FROM (b2.tested_at - s.updated_at))) ASC
                 LIMIT 1
             ))
             LEFT JOIN kino_devices kd ON kd.id = b.kino_device_id
             WHERE s.scan_status = 'completed' ${searchClause}
             ORDER BY COALESCE(b.tested_at, s.updated_at) DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );

        const cnt = await pool.query(
            `SELECT COUNT(*)
             FROM scans s
             JOIN kino_chips c ON c.chip_code = s.chip_id
             JOIN users u ON u.user_id = s.user_id
             WHERE s.scan_status = 'completed' ${searchClause}`,
            params
        );

        return { success: true, chips: rows.rows, total: parseInt(cnt.rows[0].count), page, limit };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostKinoChipReset(scanId) {
    try {
        const scanResult = await pool.query(
            'SELECT id, chip_id FROM scans WHERE id = $1',
            [parseInt(scanId)]
        );
        if (scanResult.rows.length === 0) return { success: false, error: 'Scan not found' };
        const { chip_id } = scanResult.rows[0];
        if (!chip_id) return { success: false, error: 'Scan has no linked chip' };

        await pool.query(
            `UPDATE kino_chips SET status = 'available' WHERE chip_code = $1`,
            [chip_id]
        );
        // Deleting (rather than un-linking) frees the chip_id unique index so the
        // chip can be scanned and registered again exactly like a fresh chip.
        await pool.query('DELETE FROM scans WHERE id = $1', [parseInt(scanId)]);

        return { success: true, chip_code: chip_id };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetKinoTestedChipDetail(scanId) {
    try {
        const result = await pool.query(
            `SELECT s.id AS scan_id, s.chip_id AS chip_code, s.scan_status, s.scan_results, s.error_message,
                    s.created_at AS scan_created_at, s.updated_at AS scan_updated_at,
                    cb.id AS batch_id, cb.prefix AS batch_prefix, cb.model, cb.status AS batch_status,
                    cm.name AS model_name, cm.biomarker_keys, cm.config AS chip_config,
                    u.user_id, u.nickname, u.gender, u.birth_date, u.phone, u.email,
                    b.id AS biomarker_id, b.data AS biomarker_data, b.bio_age, b.tested_at,
                    b.created_at AS biomarker_created_at,
                    kd.id AS kino_device_id, kd.name AS device_name, kd.serial_number AS device_serial
             FROM scans s
             JOIN kino_chips c ON c.chip_code = s.chip_id
             JOIN kino_chip_batches cb ON cb.id = c.batch_id
             LEFT JOIN kino_chip_models cm ON cm.code = cb.model
             JOIN users u ON u.user_id = s.user_id
             LEFT JOIN biomarkers b ON b.id = COALESCE(s.biomarker_id, (
                 SELECT b2.id FROM biomarkers b2
                 WHERE b2.user_id = s.user_id AND b2.test_type = 'kino_chip'
                 ORDER BY ABS(EXTRACT(EPOCH FROM (b2.tested_at - s.updated_at))) ASC
                 LIMIT 1
             ))
             LEFT JOIN kino_devices kd ON kd.id = b.kino_device_id
             WHERE s.id = $1`,
            [parseInt(scanId)]
        );
        if (result.rows.length === 0) return { success: false, error: 'Not found' };
        const row = result.rows[0];
        return {
            success: true,
            chip: {
                ...row,
                chrono_age: row.birth_date ? calculateAge(row.birth_date) : null,
            },
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    handleGetKinoDevices,
    handlePostKinoDevice,
    handlePutKinoDevice,
    handleDeleteKinoDevice,
    handleGetKinoChipBatches,
    handleGetKinoChipBatchChips,
    handlePostKinoChipBatch,
    handlePutKinoChipBatch,
    handleDeleteKinoChipBatch,
    handleGetKinoChipModels,
    handlePostKinoChipModel,
    handlePutKinoChipModel,
    handleDeleteKinoChipModel,
    handleGetKinoChip,
    handlePostKinoScan,
    handlePostKinoResult,
    handleGetKinoTestedChips,
    handleGetKinoTestedChipDetail,
    handlePostKinoChipReset,
};
