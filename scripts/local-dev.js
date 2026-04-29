require('dotenv').config();
const crypto = require('crypto');
const generateUserId = () => crypto.randomBytes(4).toString('hex');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

let workerHandler = null;
try {
    workerHandler = require('../src/functions/worker/index').handler;
    console.log('[Local Dev] Worker handler loaded.');
} catch (err) {
    console.warn(`[Local Dev] Worker handler unavailable (${err.message}). Running in echo mode.`);
}

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: 'application/json' }));

// Bridge Aliyun FC 3.0 handler to Express
app.post('/chat', async (req, res) => {
    console.log(`[Local Dev] Received request on /chat`);

    if (!workerHandler) {
        const { message = '' } = req.body;
        return res.json({ success: true, reply: `[Echo] ${message}` });
    }

    const fcRequest = {
        body: Buffer.from(JSON.stringify(req.body)),
        headers: req.headers,
        method: req.method,
        query: req.query,
        path: req.path
    };
    const fcResponse = {
        setStatusCode: (code) => res.status(code),
        setHeader: (name, value) => res.setHeader(name, value),
        send: (data) => res.send(data)
    };

    try {
        await workerHandler(fcRequest, fcResponse, {});
    } catch (err) {
        console.error('Worker Handler Error:', err);
        res.status(500).send({ error: 'Internal Server Error' });
    }
});

// Biomarker history for a user
app.get('/biomarkers', async (req, res) => {
    const { openid } = req.query;
    const { pool } = require('../src/lib/db');
    try {
        const result = await pool.query(
            `SELECT id, test_type, data, bio_age, tested_at
             FROM biomarkers WHERE user_id = $1 ORDER BY tested_at ASC`,
            [openid]
        );
        res.json({ success: true, records: result.rows });
    } catch (err) {
        console.error('Biomarker Fetch Error:', err);
        res.status(500).send({ error: 'Internal Server Error' });
    }
});

// Polling endpoint for Chat Simulator
app.get('/notifications', async (req, res) => {
    const { openid } = req.query;
    const { pool } = require('../src/lib/db');

    try {
        const query = `
            SELECT n.id, n.content, n.notification_type
            FROM notifications n
            JOIN users u ON n.user_id = u.user_id
            WHERE u.user_id = $1 AND n.status = 'pending'
            ORDER BY n.sent_at ASC;
        `;
        const result = await pool.query(query, [openid]);
        
        // Mark as sent so we don't fetch them again
        if (result.rows.length > 0) {
            const ids = result.rows.map(r => r.id);
            await pool.query('UPDATE notifications SET status = $1 WHERE id = ANY($2)', ['sent', ids]);
        }

        res.json({ success: true, notifications: result.rows });
    } catch (err) {
        console.error('Notification Fetch Error:', err);
        res.status(500).send({ error: 'Internal Server Error' });
    }
});

// Coach Dashboard: Fetch all users with latest data
app.get('/users', async (req, res) => {
    const { pool } = require('../src/lib/db');
    const { calculateAge } = require('../src/lib/time-utils');
    try {
        console.log(`[Local Dev] Fetching users from ${process.env.DATABASE_URL.includes('localhost') ? 'Local' : 'PolarDB'}`);
        const query = `
            SELECT u.user_id, u.external_id, u.external_app, u.nickname, u.birth_date, u.language, u.gender,
                   u.coach_id, u.created_at,
                   b.bio_age, b.data as bio_data,
                   p.name as coach_name,
                   (SELECT content FROM notifications WHERE user_id = u.user_id AND notification_type = 'nutrition_plan' ORDER BY sent_at DESC LIMIT 1) as latest_plan,
                   (SELECT content FROM notifications WHERE user_id = u.user_id AND notification_type = 'biological_report' ORDER BY sent_at DESC LIMIT 1) as latest_report
            FROM users u
            LEFT JOIN coaches p ON u.coach_id = p.id
            LEFT JOIN (
                SELECT DISTINCT ON (user_id) user_id, bio_age, data
                FROM biomarkers
                ORDER BY user_id, tested_at DESC
            ) b ON u.user_id = b.user_id;
        `;
        const result = await pool.query(query);
        const users = result.rows.map(u => ({
            ...u,
            chrono_age: calculateAge(u.birth_date)
        }));
        res.json({ success: true, users });
    } catch (err) {
        console.error('Fetch Users Error:', err.message);
        if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
            console.error('Database connection failed. Check your network or PolarDB whitelist.');
        }
        res.status(500).send({ error: 'Internal Server Error', details: err.message });
    }
});

// Coach Dashboard: Send instruction to user
app.post('/coach-instruction', async (req, res) => {
    const { openid, instruction } = req.body;
    const { pool } = require('../src/lib/db');
    try {
        const user = await pool.query('SELECT user_id FROM users WHERE user_id = $1', [openid]);
        if (user.rows.length === 0) return res.status(404).send({ error: 'User not found' });

        const coachMessage = `### 👨‍⚕️ Coach Instruction\n\n${instruction}`;

        await pool.query(
            'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
            [user.rows[0].user_id, 'coach_instruction', coachMessage, 'pending']
        );

        console.log(`[Local Dev] Coach instruction sent to ${openid}`);
        res.json({ success: true });
    } catch (err) {
        console.error('Coach Instruction Error:', err);
        res.status(500).send({ error: 'Internal Server Error' });
    }
});

// Questionnaire endpoint
app.post('/ingest', async (req, res) => {
    console.log(`[Local Dev] Received user data on /ingest`);
    if (!workerHandler) {
        return res.json({ success: true, reply: '[Echo] ingest received' });
    }
    const fcRequest = { body: Buffer.from(JSON.stringify(req.body)) };
    const fcResponse = {
        setStatusCode: (code) => res.status(code),
        setHeader: (name, value) => res.setHeader(name, value),
        send: (data) => res.send(data)
    };
    await workerHandler(fcRequest, fcResponse, {});
});

// Admin: Fetch all Dots Cartridges
app.get('/dots-inventory', async (req, res) => {
    const { pool } = require('../src/lib/db');
    try {
        const result = await pool.query('SELECT * FROM dots ORDER BY id ASC');
        res.json({ success: true, dots: result.rows });
    } catch (err) {
        res.status(500).send({ error: 'Internal Server Error' });
    }
});

// Admin: Fetch all Coaches with user counts
app.get('/coach-list', async (req, res) => {
    const { pool } = require('../src/lib/db');
    try {
        const query = `
            SELECT p.id, p.name, p.email, p.phone, p.language, p.created_at, COUNT(u.user_id) as user_count
            FROM coaches p
            LEFT JOIN users u ON p.id = u.coach_id
            GROUP BY p.id;
        `;
        const result = await pool.query(query);
        res.json({ success: true, coaches: result.rows });
    } catch (err) {
        res.status(500).send({ error: 'Internal Server Error' });
    }
});

// Admin: Assign a Coach to a user
app.post('/assign-coach', async (req, res) => {
    const { user_id, coach_id } = req.body;
    const { pool } = require('../src/lib/db');
    try {
        await pool.query('UPDATE users SET coach_id = $1 WHERE user_id = $2', [coach_id || null, user_id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Assign Coach Error:', err);
        res.status(500).send({ error: 'Internal Server Error' });
    }
});

// Admin: Create user
app.post('/users', async (req, res) => {
    const { external_id, external_app, nickname, phone, email, gender, birth_date, language, coach_id } = req.body;
    const { pool } = require('../src/lib/db');
    if (!external_id) return res.status(400).json({ error: 'external_id is required' });
    try {
        const result = await pool.query(
            `INSERT INTO users (user_id, external_id, external_app, nickname, phone, email, gender, birth_date, language, coach_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING user_id`,
            [generateUserId(), external_id, external_app || null, nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null]
        );
        res.json({ success: true, user_id: result.rows[0].user_id });
    } catch (err) {
        console.error('Create User Error:', err);
        res.status(500).json({ error: err.detail || 'Internal Server Error' });
    }
});

// Admin: Update user
app.put('/users/:id', async (req, res) => {
    const { nickname, phone, email, gender, birth_date, language, coach_id } = req.body;
    const { pool } = require('../src/lib/db');
    try {
        await pool.query(
            `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, coach_id=$7 WHERE user_id=$8`,
            [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', coach_id || null, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Update User Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Admin: Delete user
app.delete('/users/:id', async (req, res) => {
    const { pool } = require('../src/lib/db');
    try {
        await pool.query('DELETE FROM users WHERE user_id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete User Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Admin: Create Coach
app.post('/coaches', async (req, res) => {
    const { name, email, phone, language } = req.body;
    const { pool } = require('../src/lib/db');
    try {
        const result = await pool.query(
            'INSERT INTO coaches (name, email, phone, language) VALUES ($1, $2, $3, $4) RETURNING id',
            [name, email || null, phone || null, language || 'zh']
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin: Update Coach
app.put('/coaches/:id', async (req, res) => {
    const { name, email, phone, language } = req.body;
    const { pool } = require('../src/lib/db');
    try {
        await pool.query(
            'UPDATE coaches SET name=$1, email=$2, phone=$3, language=$4 WHERE id=$5',
            [name, email || null, phone || null, language || 'zh', req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin: Delete Coach
app.delete('/coaches/:id', async (req, res) => {
    const { pool } = require('../src/lib/db');
    try {
        await pool.query('DELETE FROM coaches WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin: Kino device registry
app.get('/kino-devices', async (req, res) => {
    const { pool } = require('../src/lib/db');
    try {
        const result = await pool.query(`
            SELECT kd.id, kd.serial_number, kd.name, kd.status, kd.notes, kd.registered_at, kd.created_at,
                   kd.coach_id, c.name AS coach_name,
                   kd.channel_id, ch.name AS channel_name,
                   COUNT(b.id)::int AS test_count,
                   MAX(b.tested_at) AS last_used_at
            FROM kino_devices kd
            LEFT JOIN coaches c ON c.id = kd.coach_id
            LEFT JOIN channels ch ON ch.id = kd.channel_id
            LEFT JOIN biomarkers b ON b.kino_device_id = kd.id
            GROUP BY kd.id, c.name, ch.name
            ORDER BY kd.id ASC
        `);
        res.json({ success: true, devices: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/kino-devices', async (req, res) => {
    const { serial_number, name, coach_id, channel_id, status, notes } = req.body;
    const { pool } = require('../src/lib/db');
    if (!serial_number?.trim()) return res.status(400).json({ error: 'serial_number is required' });
    try {
        const result = await pool.query(
            `INSERT INTO kino_devices (serial_number, name, coach_id, channel_id, status, notes)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [serial_number.trim().toUpperCase(), name || null, coach_id || null, channel_id || null, status || 'active', notes || null]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.detail || err.message });
    }
});

app.put('/kino-devices/:id', async (req, res) => {
    const { name, coach_id, channel_id, status, notes } = req.body;
    const { pool } = require('../src/lib/db');
    try {
        await pool.query(
            `UPDATE kino_devices SET name=$1, coach_id=$2, channel_id=$3, status=$4, notes=$5 WHERE id=$6`,
            [name || null, coach_id || null, channel_id || null, status || 'active', notes || null, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/kino-devices/:id', async (req, res) => {
    const { pool } = require('../src/lib/db');
    try {
        await pool.query('DELETE FROM kino_devices WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Kino chip batches
app.get('/kino-chip-batches', async (req, res) => {
    const { pool } = require('../src/lib/db');
    try {
        const result = await pool.query(`
            SELECT b.id, b.prefix, b.model, b.quantity, b.notes, b.created_at,
                   COUNT(c.id)                                          AS total_chips,
                   COUNT(CASE WHEN c.status = 'available' THEN 1 END)  AS available,
                   COUNT(CASE WHEN c.status = 'used'      THEN 1 END)  AS used,
                   COUNT(CASE WHEN c.status = 'damaged'   THEN 1 END)  AS damaged
            FROM kino_chip_batches b
            LEFT JOIN kino_chips c ON c.batch_id = b.id
            GROUP BY b.id
            ORDER BY b.created_at DESC
        `);
        res.json({ success: true, batches: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/kino-chip-batches/:id/chips', async (req, res) => {
    const { pool } = require('../src/lib/db');
    try {
        const page  = Math.max(1, parseInt(req.query.page  || '1'));
        const limit = Math.min(100, parseInt(req.query.limit || '50'));
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
            [req.params.id, limit, offset]
        );
        const cnt = await pool.query('SELECT COUNT(*) FROM kino_chips WHERE batch_id = $1', [req.params.id]);
        res.json({ success: true, chips: rows.rows, total: parseInt(cnt.rows[0].count), page, limit });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/kino-chip-batches', async (req, res) => {
    const { pool } = require('../src/lib/db');
    const { prefix, model, quantity, notes } = req.body;
    if (!prefix) return res.status(400).json({ success: false, error: 'prefix is required' });
    if (!model)  return res.status(400).json({ success: false, error: 'model is required' });
    const qty = parseInt(quantity);
    if (!qty || qty < 1 || qty > 9999) return res.status(400).json({ success: false, error: 'quantity must be 1–9999' });
    const cleanPrefix = prefix.trim().toUpperCase();
    if (!/^KNC\d{8}$/.test(cleanPrefix)) return res.status(400).json({ success: false, error: 'prefix must be KNC followed by 8 digits' });
    const pad = 4;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const batchRes = await client.query(
            `INSERT INTO kino_chip_batches (prefix, model, quantity, notes) VALUES ($1,$2,$3,$4) RETURNING id`,
            [cleanPrefix, model.trim(), qty, notes || null]
        );
        const batchId = batchRes.rows[0].id;
        const CHUNK = 500;
        for (let start = 1; start <= qty; start += CHUNK) {
            const end = Math.min(start + CHUNK - 1, qty);
            const vals = [], params = [];
            for (let i = start; i <= end; i++) {
                vals.push(`($${params.length + 1}, $${params.length + 2})`);
                params.push(batchId, `${cleanPrefix}-${String(i).padStart(pad, '0')}`);
            }
            await client.query(`INSERT INTO kino_chips (batch_id, chip_code) VALUES ${vals.join(', ')}`, params);
        }
        await client.query('COMMIT');
        res.json({ success: true, id: batchId, prefix: cleanPrefix, quantity: qty });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    } finally { client.release(); }
});

app.put('/kino-chip-batches/:id', async (req, res) => {
    const { pool } = require('../src/lib/db');
    const { model, notes } = req.body;
    try {
        await pool.query(
            `UPDATE kino_chip_batches SET model = COALESCE($1, model), notes = $2 WHERE id = $3`,
            [model || null, notes ?? null, req.params.id]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/kino-chip-batches/:id', async (req, res) => {
    const { pool } = require('../src/lib/db');
    try {
        const check = await pool.query(
            `SELECT COUNT(*) FROM kino_chips WHERE batch_id = $1 AND status = 'used'`,
            [req.params.id]
        );
        if (parseInt(check.rows[0].count) > 0) {
            return res.status(400).json({ success: false, error: 'Cannot delete a batch with used chips' });
        }
        await pool.query('DELETE FROM kino_chip_batches WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Kino chip models
app.get('/kino-chip-models', async (req, res) => {
    const { pool } = require('../src/lib/db');
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
        res.json({ success: true, models: result.rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

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
            out.config = JSON.parse(body.config);
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

app.post('/kino-chip-models', async (req, res) => {
    const { pool } = require('../src/lib/db');
    try {
        const m = normalizeChipModelInput(req.body || {});
        if (!m.code) return res.status(400).json({ success: false, error: 'code is required' });
        if (!/^[A-Z0-9]{1,16}$/.test(m.code)) return res.status(400).json({ success: false, error: 'code must be 1–16 uppercase letters/digits' });
        if (!Array.isArray(m.biomarker_keys) || m.biomarker_keys.length === 0) {
            return res.status(400).json({ success: false, error: 'biomarker_keys must be a non-empty array' });
        }
        if (!m.config || typeof m.config !== 'object') {
            return res.status(400).json({ success: false, error: 'config (JSON object) is required' });
        }
        const result = await pool.query(
            `INSERT INTO kino_chip_models
                (code, name, biomarker_keys, config, guide_video, guide_text, status, notes)
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'active'), $8)
             RETURNING code`,
            [m.code, m.name || null, m.biomarker_keys, m.config,
             m.guide_video || null, m.guide_text || null, m.status, m.notes || null]
        );
        res.json({ success: true, code: result.rows[0].code });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ success: false, error: 'A model with this code already exists' });
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/kino-chip-models/:code', async (req, res) => {
    const { pool } = require('../src/lib/db');
    try {
        const m = normalizeChipModelInput(req.body || {});
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

        if (sets.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });
        sets.push('updated_at = CURRENT_TIMESTAMP');
        params.push(String(req.params.code).toUpperCase());

        const result = await pool.query(
            `UPDATE kino_chip_models SET ${sets.join(', ')} WHERE code = $${params.length} RETURNING code`,
            params
        );
        if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Model not found' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/kino-chip-models/:code', async (req, res) => {
    const { pool } = require('../src/lib/db');
    try {
        const upper = String(req.params.code).toUpperCase();
        const ref = await pool.query(
            'SELECT COUNT(*)::int AS n FROM kino_chip_batches WHERE model = $1',
            [upper]
        );
        if (ref.rows[0].n > 0) {
            return res.status(409).json({ success: false, error: `Cannot delete: ${ref.rows[0].n} batch(es) reference this model` });
        }
        const result = await pool.query(
            'DELETE FROM kino_chip_models WHERE code = $1 RETURNING code',
            [upper]
        );
        if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Model not found' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Admin: Create Dot
app.post('/dots', async (req, res) => {
    const { key_name, name, name_zh, color, color_zh, description, is_isolate } = req.body;
    const { pool } = require('../src/lib/db');
    try {
        const maxIdResult = await pool.query('SELECT MAX(id) as max_id FROM dots');
        const nextId = (maxIdResult.rows[0].max_id || 0) + 1;
        const result = await pool.query(
            `INSERT INTO dots (id, key_name, name, name_zh, color, color_zh, description, is_isolate)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [nextId, key_name, name, name_zh || null, color || null, color_zh || null, description || null, !!is_isolate]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin: Update Dot
app.put('/dots/:id', async (req, res) => {
    const { name, name_zh, color, color_zh, description, is_isolate } = req.body;
    const { pool } = require('../src/lib/db');
    try {
        await pool.query(
            `UPDATE dots SET name=$1, name_zh=$2, color=$3, color_zh=$4, description=$5, is_isolate=$6 WHERE id=$7`,
            [name, name_zh || null, color || null, color_zh || null, description || null, !!is_isolate, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin: Delete Dot
app.delete('/dots/:id', async (req, res) => {
    const { pool } = require('../src/lib/db');
    try {
        await pool.query('DELETE FROM dots WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Catch-all: forward any route not handled above to the worker handler
app.all('*', async (req, res) => {
    if (!workerHandler) {
        return res.status(404).json({ error: `No handler for ${req.method} ${req.path}` });
    }
    const bodyBuf = req.body ? Buffer.from(JSON.stringify(req.body)) : Buffer.from('{}');
    const fcRequest = {
        rawPath: req.path,
        path: req.path,
        method: req.method,
        queryParameters: req.query,
        body: bodyBuf,
        headers: req.headers,
        requestContext: { http: { method: req.method } },
        isBase64Encoded: false,
    };
    const fcResponse = {
        setStatusCode: (code) => res.status(code),
        setHeader: (name, value) => res.setHeader(name, value),
        send: (data) => res.send(data),
    };
    try {
        await workerHandler(fcRequest, fcResponse, {});
    } catch (err) {
        console.error(`[Local Dev] Worker error on ${req.method} ${req.path}:`, err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(port, () => {
    console.log(`\x1b[32m[Nano Backend] Running locally at http://localhost:${port}\x1b[0m`);
    console.log(`[Nano Backend] Database: ${process.env.DATABASE_URL ? 'Connected' : 'Disconnected'}`);
});
