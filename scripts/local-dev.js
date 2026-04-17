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

// PHM Dashboard: Fetch all users with latest data
app.get('/users', async (req, res) => {
    const { pool } = require('../src/lib/db');
    const { calculateAge } = require('../src/lib/time-utils');
    try {
        console.log(`[Local Dev] Fetching users from ${process.env.DATABASE_URL.includes('localhost') ? 'Local' : 'PolarDB'}`);
        const query = `
            SELECT u.user_id, u.external_id, u.external_app, u.nickname, u.birth_date, u.language, u.gender,
                   u.phm_id, u.created_at,
                   b.bio_age, b.data as bio_data,
                   p.name as coach_name,
                   (SELECT content FROM notifications WHERE user_id = u.user_id AND notification_type = 'nutrition_plan' ORDER BY sent_at DESC LIMIT 1) as latest_plan,
                   (SELECT content FROM notifications WHERE user_id = u.user_id AND notification_type = 'biological_report' ORDER BY sent_at DESC LIMIT 1) as latest_report
            FROM users u
            LEFT JOIN phms p ON u.phm_id = p.id
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

// PHM Dashboard: Send instruction to user
app.post('/phm-instruction', async (req, res) => {
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

        console.log(`[Local Dev] PHM instruction sent to ${openid}`);
        res.json({ success: true });
    } catch (err) {
        console.error('PHM Instruction Error:', err);
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

app.listen(port, () => {
    console.log(`\x1b[32m[Nano Backend] Running locally at http://localhost:${port}\x1b[0m`);
    console.log(`[Nano Backend] Database: ${process.env.DATABASE_URL ? 'Connected' : 'Disconnected'}`);
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

// Admin: Fetch all PHMs with user counts
app.get('/phm-list', async (req, res) => {
    const { pool } = require('../src/lib/db');
    try {
        const query = `
            SELECT p.id, p.name, p.email, p.phone, p.created_at, COUNT(u.user_id) as user_count
            FROM phms p
            LEFT JOIN users u ON p.id = u.phm_id
            GROUP BY p.id;
        `;
        const result = await pool.query(query);
        res.json({ success: true, phms: result.rows });
    } catch (err) {
        res.status(500).send({ error: 'Internal Server Error' });
    }
});

// Admin: Assign a PHM coach to a user
app.post('/assign-phm', async (req, res) => {
    const { user_id, phm_id } = req.body;
    const { pool } = require('../src/lib/db');
    try {
        await pool.query('UPDATE users SET phm_id = $1 WHERE user_id = $2', [phm_id || null, user_id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Assign PHM Error:', err);
        res.status(500).send({ error: 'Internal Server Error' });
    }
});

// Admin: Create user
app.post('/users', async (req, res) => {
    const { external_id, external_app, nickname, phone, email, gender, birth_date, language, phm_id } = req.body;
    const { pool } = require('../src/lib/db');
    if (!external_id) return res.status(400).json({ error: 'external_id is required' });
    try {
        const result = await pool.query(
            `INSERT INTO users (user_id, external_id, external_app, nickname, phone, email, gender, birth_date, language, phm_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING user_id`,
            [generateUserId(), external_id, external_app || null, nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', phm_id || null]
        );
        res.json({ success: true, user_id: result.rows[0].user_id });
    } catch (err) {
        console.error('Create User Error:', err);
        res.status(500).json({ error: err.detail || 'Internal Server Error' });
    }
});

// Admin: Update user
app.put('/users/:id', async (req, res) => {
    const { nickname, phone, email, gender, birth_date, language, phm_id } = req.body;
    const { pool } = require('../src/lib/db');
    try {
        await pool.query(
            `UPDATE users SET nickname=$1, phone=$2, email=$3, gender=$4, birth_date=$5, language=$6, phm_id=$7 WHERE user_id=$8`,
            [nickname || null, phone || null, email || null, gender || null, birth_date || null, language || 'zh', phm_id || null, req.params.id]
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

// Admin: Create PHM
app.post('/phms', async (req, res) => {
    const { name, email, phone } = req.body;
    const { pool } = require('../src/lib/db');
    try {
        const result = await pool.query(
            'INSERT INTO phms (name, email, phone) VALUES ($1, $2, $3) RETURNING id',
            [name, email || null, phone || null]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin: Update PHM
app.put('/phms/:id', async (req, res) => {
    const { name, email, phone } = req.body;
    const { pool } = require('../src/lib/db');
    try {
        await pool.query(
            'UPDATE phms SET name=$1, email=$2, phone=$3 WHERE id=$4',
            [name, email || null, phone || null, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin: Delete PHM
app.delete('/phms/:id', async (req, res) => {
    const { pool } = require('../src/lib/db');
    try {
        await pool.query('DELETE FROM phms WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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

app.listen(port, () => {
