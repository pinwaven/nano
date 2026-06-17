const { pool } = require('../lib/db');
const OpenAI = require('openai');
const systemAdminReportTemplate = require('../prompts/systemAdminReport');

const getLlmClient = () => new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

// ── Admin: Saved Reports ──────────────────────────────────────────────────────

async function handleGetSavedReports() {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `SELECT id, title, query, sql, chart, insights, columns, data, created_by, updated_by, created_at, updated_at
             FROM saved_reports ORDER BY updated_at DESC`
        );
        return { success: true, reports: result.rows };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleGetSavedReports', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePostSavedReport(body) {
    const { title, query, sql, chart, insights, columns, data, created_by } = body || {};
    if (!title || !query || !sql) return { statusCode: 400, success: false, error: 'title, query, and sql are required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `INSERT INTO saved_reports (title, query, sql, chart, insights, columns, data, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
             RETURNING id, title, query, sql, chart, insights, columns, data, created_by, updated_by, created_at, updated_at`,
            [title, query, sql, JSON.stringify(chart) || null, insights || '', JSON.stringify(columns) || null, JSON.stringify(data) || null, created_by || null]
        );
        console.log(JSON.stringify({ level: 'INFO', msg: 'handlePostSavedReport', id: result.rows[0].id, title }));
        return { success: true, report: result.rows[0] };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostSavedReport', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handlePutSavedReport(id, body) {
    const { title, query, sql, chart, insights, columns, data, updated_by } = body || {};
    if (!title) return { statusCode: 400, success: false, error: 'title is required' };
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        const result = await pool.query(
            `UPDATE saved_reports
             SET title=$1, query=$2, sql=$3, chart=$4, insights=$5, columns=$6, data=$7, updated_by=$8, updated_at=NOW()
             WHERE id=$9
             RETURNING id, title, query, sql, chart, insights, columns, data, created_by, updated_by, created_at, updated_at`,
            [title, query || '', sql || '', JSON.stringify(chart) || null, insights || '', JSON.stringify(columns) || null, JSON.stringify(data) || null, updated_by || null, id]
        );
        if (result.rows.length === 0) return { statusCode: 404, success: false, error: 'Report not found' };
        console.log(JSON.stringify({ level: 'INFO', msg: 'handlePutSavedReport', id, title }));
        return { success: true, report: result.rows[0] };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePutSavedReport', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

async function handleDeleteSavedReport(id) {
    try {
        if (!pool) return { success: false, error: 'Database pool not initialized' };
        await pool.query('DELETE FROM saved_reports WHERE id=$1', [id]);
        console.log(JSON.stringify({ level: 'INFO', msg: 'handleDeleteSavedReport', id }));
        return { success: true };
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handleDeleteSavedReport', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

// ── Admin: AI Report Engine ───────────────────────────────────────────────────

async function handlePostAdminReport(body) {
    const { query, history = [] } = body || {};
    if (!query || !query.trim()) {
        return { statusCode: 400, success: false, error: 'query is required' };
    }

    const BLOCKED = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXECUTE|CALL|MERGE|COPY)\b/i;

    try {
        const llmClient = getLlmClient();
        const model = process.env.MODEL || 'qwen-plus-latest';
        const messages = [
            { role: 'system', content: systemAdminReportTemplate() },
            ...((history || []).slice(-12)),
            { role: 'user', content: query.trim() },
        ];

        let llmText;
        try {
            const completion = await Promise.race([
                llmClient.chat.completions.create({ model, messages }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('LLM timeout')), 8000)),
            ]);
            llmText = (completion.choices[0].message.content || '').trim();
        } catch (e) {
            console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostAdminReport/llm', error: e.message }));
            return { statusCode: 502, success: false, error: `LLM error: ${e.message}` };
        }

        let parsed;
        try {
            const cleaned = llmText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
            parsed = JSON.parse(cleaned);
        } catch (e) {
            console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostAdminReport/parse', raw: llmText.slice(0, 300) }));
            return { statusCode: 502, success: false, error: 'LLM returned invalid JSON', raw: llmText.slice(0, 300) };
        }

        const { title, sql, chart, insights } = parsed;

        if (!sql || !sql.trim()) {
            return { success: true, title: title || 'Report', sql: '', data: [], columns: [], chart: null, insights: insights || '' };
        }

        const sqlTrimmed = sql.trim();
        if (!/^(SELECT|WITH)\s/i.test(sqlTrimmed)) {
            return { statusCode: 400, success: false, error: 'Only SELECT queries are permitted.' };
        }
        if (BLOCKED.test(sqlTrimmed)) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'handlePostAdminReport/blocked', sql: sqlTrimmed.slice(0, 200) }));
            return { statusCode: 400, success: false, error: 'Query contains disallowed SQL operations.' };
        }

        let safeSql = sqlTrimmed.replace(/;?\s*$/, '');
        if (!/LIMIT\s+\d+/i.test(safeSql)) safeSql += ' LIMIT 500';

        let qr;
        try {
            qr = await pool.query(safeSql);
        } catch (e) {
            console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostAdminReport/sql', error: e.message }));
            return { statusCode: 422, success: false, error: `SQL error: ${e.message}`, sql: safeSql };
        }

        const rows = qr.rows;
        const columns = rows.length > 0
            ? Object.keys(rows[0])
            : (qr.fields || []).map(f => f.name);

        const safeRows = rows.map(row => {
            const r = {};
            for (const [k, v] of Object.entries(row)) r[k] = typeof v === 'bigint' ? String(v) : v;
            return r;
        });

        console.log(JSON.stringify({ level: 'INFO', msg: 'handlePostAdminReport', query: query.slice(0, 100), rows: rows.length }));

        return { success: true, title: title || 'Report', sql: safeSql, data: safeRows, columns, chart: chart || null, insights: insights || '' };

    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'handlePostAdminReport', error: err.message }));
        return { statusCode: 500, success: false, error: err.message };
    }
}

module.exports = {
    handleGetSavedReports,
    handlePostSavedReport,
    handlePutSavedReport,
    handleDeleteSavedReport,
    handlePostAdminReport,
};
