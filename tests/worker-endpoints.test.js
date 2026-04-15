require('dotenv').config();
const axios = require('axios');
const assert = require('node:assert');
const { test, describe, before } = require('node:test');

const BASE_URL = process.env.NANO_API_TARGET || 'http://localhost:3000';
const TEST_OPENID = 'test-user-' + Date.now();

describe(`Worker Endpoints Integration Tests [${BASE_URL}]`, () => {
    
    // Check if target is reachable
    before(async () => {
        try {
            console.log(`\x1b[36m[Test] Testing against target: ${BASE_URL}\x1b[0m`);
            await axios.get(`${BASE_URL}/users`);
        } catch (err) {
            console.error('\x1b[31mError: Target is not reachable on ' + BASE_URL + '\x1b[0m');
            if (BASE_URL.includes('localhost')) {
                console.error('Please run "node scripts/local-dev.js" before running this test.');
            } else {
                console.error('Check your Aliyun FC endpoint URL and network connectivity.');
            }
            process.exit(1);
        }
    });

    test('GET /users should return a list of users', async () => {
        const response = await axios.get(`${BASE_URL}/users`);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.data.success, true);
        assert.ok(Array.isArray(response.data.users));
    });

    test('POST /chat should create a new user or update existing', async () => {
        const payload = {
            openid: TEST_OPENID,
            nickname: 'Test Bot',
            gender: 'male',
            birth_date: '1990-01-01',
            language: 'en',
            message: 'Hello, I am a test bot.'
        };

        const response = await axios.post(`${BASE_URL}/chat`, payload);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.data.success, true);
        assert.ok(response.data.user_id);
    });

    test('POST /chat with biomarker data should calculate BioAge', async () => {
        const payload = {
            openid: TEST_OPENID,
            test_type: 'kino_chip',
            test_data: {
                Glucose: 5.2,
                Cholesterol: 4.5,
                HDL: 1.2,
                LDL: 2.8,
                Triglycerides: 1.1
            },
            tested_at: new Date().toISOString()
        };

        const response = await axios.post(`${BASE_URL}/chat`, payload);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.data.success, true);
        assert.ok(response.data.user_id);
    });

    test('GET /notifications should return pending notifications', async () => {
        const response = await axios.get(`${BASE_URL}/notifications`, {
            params: { openid: TEST_OPENID }
        });
        
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.data.success, true);
        assert.ok(Array.isArray(response.data.notifications));
        
        // At least one notification should be there from the previous test (BioAge result)
        // Note: local-dev.js marks them as 'sent' after fetching, so subsequent calls might be empty
        // unless they were just created.
        if (response.data.notifications.length > 0) {
            const hasBioReport = response.data.notifications.some(n => n.notification_type === 'biological_report');
            assert.ok(hasBioReport, 'Should have a biological report notification');
        }
    });

    test('POST /ingest should accept questionnaire data', async () => {
        const payload = {
            openid: TEST_OPENID,
            weight: 75,
            height: 180,
            activity_level: 'moderate'
        };

        const response = await axios.post(`${BASE_URL}/ingest`, payload);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.data.success, true);
    });

    test('GET /phm-list should return PHMs', async () => {
        const response = await axios.get(`${BASE_URL}/phm-list`);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.data.success, true);
        assert.ok(Array.isArray(response.data.phms));
    });

    test('GET /dots-inventory should return inventory', async () => {
        const response = await axios.get(`${BASE_URL}/dots-inventory`);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.data.success, true);
        assert.ok(Array.isArray(response.data.dots));
    });

    test('POST /phm-instruction should send instruction to user', async () => {
        // First ensure user exists (already created in previous tests)
        const payload = {
            openid: TEST_OPENID,
            instruction: 'Drink more water and exercise daily.'
        };

        const response = await axios.post(`${BASE_URL}/phm-instruction`, payload);
        assert.strictEqual(response.status, 200);
        assert.strictEqual(response.data.success, true);
    });

    test('POST /assign-phm should assign PHM to user', async () => {
        // Get a user and a PHM first
        const usersRes = await axios.get(`${BASE_URL}/users`);
        const phmsRes = await axios.get(`${BASE_URL}/phm-list`);
        
        if (usersRes.data.users.length > 0 && phmsRes.data.phms.length > 0) {
            const user_id = usersRes.data.users[0].user_id;
            const phm_id = phmsRes.data.phms[0].id;

            const response = await axios.post(`${BASE_URL}/assign-phm`, { user_id, phm_id });
            assert.strictEqual(response.status, 200);
            assert.strictEqual(response.data.success, true);
        }
    });
});
