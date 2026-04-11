require('dotenv').config();
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
        query: req.query
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

// Polling endpoint for Chat Simulator
app.get('/notifications', async (req, res) => {
    const { openid } = req.query;
    const { pool } = require('../src/lib/db');

    try {
        const query = `
            SELECT n.id, n.content, n.notification_type 
            FROM notifications n
            JOIN users u ON n.user_id = u.id
            WHERE u.wechat_openid = $1 AND n.status = 'pending'
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

// PHM Dashboard: Fetch all customers with latest data
app.get('/customers', async (req, res) => {
    const { pool } = require('../src/lib/db');
    const { calculateAge } = require('../src/lib/time-utils');
    try {
        const query = `
            SELECT u.id, u.wechat_openid, u.nickname, u.birth_date, 
                   b.bio_age, b.data as bio_data
            FROM users u
            LEFT JOIN (
                SELECT DISTINCT ON (user_id) user_id, bio_age, data
                FROM biomarkers
                ORDER BY user_id, tested_at DESC
            ) b ON u.id = b.user_id;
        `;
        const result = await pool.query(query);
        const customers = result.rows.map(u => ({
            ...u,
            chrono_age: calculateAge(u.birth_date)
        }));
        res.json({ success: true, customers });
    } catch (err) {
        console.error('Fetch Customers Error:', err);
        res.status(500).send({ error: 'Internal Server Error' });
    }
});

// PHM Dashboard: Send instruction to user
app.post('/coach-instruction', async (req, res) => {
    const { openid, instruction } = req.body;
    const { pool } = require('../src/lib/db');
    try {
        const user = await pool.query('SELECT id FROM users WHERE wechat_openid = $1', [openid]);
        if (user.rows.length === 0) return res.status(404).send({ error: 'User not found' });

        const coachMessage = `### 👨‍⚕️ Coach Instruction\n\n${instruction}`;
        
        await pool.query(
            'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
            [user.rows[0].id, 'coach_instruction', coachMessage, 'pending']
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
        send: (data) => res.send(data)
    };
    await workerHandler(fcRequest, fcResponse, {});
});

app.listen(port, () => {
    console.log(`\x1b[32m[Nano Backend] Running locally at http://localhost:${port}\x1b[0m`);
    console.log(`[Nano Backend] Database: ${process.env.POLARDB_URL ? 'Connected' : 'Disconnected'}`);
});
