/**
 * Local test for the Coach Agent function.
 *
 * Usage:
 *   node tests/agent-test.js <user_id> [trigger_reason] [--dry-run]
 *
 * --dry-run: generates the coaching message but skips all DB writes.
 *
 * Requires a .env file with DB_* and DASHSCOPE_API_KEY set.
 */
require('dotenv').config();

const agentHandler = require('../src/functions/agent/index');

const args = process.argv.slice(2).filter(a => a !== '--dry-run');
const dryRun = process.argv.includes('--dry-run');

const user_id = args[0] || process.env.TEST_USER_ID;
if (!user_id) {
    console.error('Usage: node tests/agent-test.js <user_id> [trigger_reason] [--dry-run]');
    process.exit(1);
}

const trigger_reason = args[1] || 'user_online';

const fakeReq = {
    rawPath: '/',
    requestContext: { http: { method: 'POST' } },
    headers: {},
    queryParameters: {},
    body: Buffer.from(JSON.stringify({ user_id, trigger_reason, dry_run: dryRun })).toString('base64'),
    isBase64Encoded: true,
};

(async () => {
    console.log(`[agent-test] user_id=${user_id} trigger=${trigger_reason} dry_run=${dryRun}`);
    const result = await agentHandler.handler(fakeReq, {}, { region: 'cn-shanghai', credentials: {} });
    console.log('[agent-test] Response:', JSON.stringify(result, null, 2));
    process.exit(result.statusCode === 200 ? 0 : 1);
})();
