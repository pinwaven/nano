'use strict';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const OpenAI = require('openai');

const CHANGELOG_PATH = path.resolve(__dirname, '../CHANGELOG.md');

if (!process.env.DATABASE_URL_PROD) {
    console.error(JSON.stringify({ level: 'ERROR', msg: 'DATABASE_URL_PROD is not set. Source .env first.' }));
    process.exit(1);
}
if (!process.env.DASHSCOPE_API_KEY) {
    console.error(JSON.stringify({ level: 'ERROR', msg: 'DASHSCOPE_API_KEY is not set.' }));
    process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL_PROD });
const llm = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

function parseChangelog(text) {
    const blocks = text.split(/\n## /);
    const versions = [];
    for (const block of blocks.slice(1)) {
        const lines = block.split('\n');
        const header = lines[0];
        // Match [x.x.x] — YYYY-MM-DD (em-dash or hyphen)
        const match = header.match(/^\[([^\]]+)\](?:\s*[—–-]\s*(\d{4}-\d{2}-\d{2}))?/);
        if (!match || match[1].startsWith('Unreleased')) continue;
        versions.push({
            version: match[1],
            date: match[2] || null,
            content: lines.slice(1).join('\n').trim(),
        });
    }
    return versions;
}

function stripMarkdownFences(text) {
    return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

async function summarize(version, date, content) {
    const response = await llm.chat.completions.create({
        model: process.env.MODEL || 'qwen-plus',
        messages: [
            {
                role: 'system',
                content: `You summarize technical software changelogs into plain-language release notes for health clinic managers who are not developers.
Rules:
- No file paths, SQL, code, or technical terms.
- Each item is one clear sentence a non-technical person understands.
- Group items under: "New Features", "Improvements", or "Bug Fixes".
- Only include sections that have content.
- Return ONLY a JSON object: {"sections": [{"section": "New Features", "items": ["..."]}]}`,
            },
            {
                role: 'user',
                content: `Summarize version ${version} (${date || 'date unknown'}):\n\n${content.slice(0, 6000)}`,
            },
        ],
    });

    const raw = stripMarkdownFences(response.choices[0].message.content || '{}');
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : (parsed.sections || []);
    } catch {
        console.error(JSON.stringify({ level: 'WARN', msg: 'Failed to parse AI response for version', version, raw }));
        return [];
    }
}

async function main() {
    const text = fs.readFileSync(CHANGELOG_PATH, 'utf8');
    const versions = parseChangelog(text);

    if (!versions.length) {
        console.log(JSON.stringify({ level: 'INFO', msg: 'No versioned entries found in CHANGELOG.md' }));
        await pool.end();
        return;
    }

    const { rows: existing } = await pool.query('SELECT version FROM release_notes');
    const existingSet = new Set(existing.map(r => r.version));

    const toProcess = versions.filter(v => !existingSet.has(v.version));
    console.log(JSON.stringify({ level: 'INFO', msg: `Found ${versions.length} versions, ${toProcess.length} new to process` }));

    for (const { version, date, content } of toProcess) {
        console.log(JSON.stringify({ level: 'INFO', msg: `Summarizing v${version}...` }));
        const summary = await summarize(version, date, content);
        const title = `Version ${version}`;
        const publishedAt = date || new Date().toISOString().split('T')[0];

        await pool.query(
            `INSERT INTO release_notes (version, title, summary, published_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (version) DO NOTHING`,
            [version, title, JSON.stringify(summary), publishedAt]
        );
        console.log(JSON.stringify({ level: 'INFO', msg: `Saved v${version}`, sections: summary.length }));
    }

    console.log(JSON.stringify({ level: 'INFO', msg: 'Done' }));
    await pool.end();
}

main().catch(err => {
    console.error(JSON.stringify({ level: 'ERROR', msg: err.message }));
    process.exit(1);
});
