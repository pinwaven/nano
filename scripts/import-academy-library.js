/**
 * Import Knowledge Docs Script
 * Converts .docx and .pdf files to text, uploads to OSS, and adds to academy_library table.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const { v4: uuidv4 } = require('uuid');
const OSS = require('ali-oss');

// Config
const DOCS_DIR = path.join(__dirname, '../temp/knowledge-docs');
const args = process.argv.slice(2);
const envTarget = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'dev';
const DB_URL = envTarget === 'prod' ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL;

if (!DB_URL) {
    console.error(`ERROR: ${envTarget === 'prod' ? 'DATABASE_URL_PROD' : 'DATABASE_URL'} is not set in .env`);
    process.exit(1);
}

console.log(`[import] target: ${envTarget.toUpperCase()}`);

const pool = new Pool({ connectionString: DB_URL });

const ossClient = new OSS({
    region:          process.env.OSS_REGION || 'oss-cn-shanghai',
    accessKeyId:     process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    bucket:          process.env.OSS_BUCKET,
    secure:          true,
});

async function convertDocx(filePath) {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
}

async function convertPdf(filePath) {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    return data.text;
}

async function run() {
    if (!fs.existsSync(DOCS_DIR)) {
        console.error(`ERROR: Directory not found: ${DOCS_DIR}`);
        return;
    }

    const files = fs.readdirSync(DOCS_DIR).filter(f => {
        return !f.startsWith('~$') && !f.startsWith('.') && (f.endsWith('.docx') || f.endsWith('.pdf'));
    });

    console.log(`Found ${files.length} documents to process.`);

    for (const file of files) {
        const filePath = path.join(DOCS_DIR, file);
        const ext = path.extname(file).toLowerCase();
        const title = path.basename(file, ext);
        
        process.stdout.write(`Processing: ${file} ... `);

        try {
            let content = '';
            if (ext === '.docx') {
                content = await convertDocx(filePath);
            } else if (ext === '.pdf') {
                content = await convertPdf(filePath);
            }

            if (!content || content.trim().length === 0) {
                console.log('SKIPPED (no content extracted)');
                continue;
            }

            // Skip if already imported
            const existing = await pool.query('SELECT id FROM academy_library WHERE title = $1', [title]);
            if (existing.rows.length > 0) {
                console.log('SKIPPED (already exists)');
                continue;
            }

            // Upload to OSS
            const ossKey = `academy/library/${uuidv4()}.txt`;
            const contentBuffer = Buffer.from(content, 'utf8');
            await ossClient.put(ossKey, contentBuffer);

            // Insert into DB
            await pool.query(
                'INSERT INTO academy_library (title, oss_key, file_size) VALUES ($1, $2, $3)',
                [title, ossKey, contentBuffer.length]
            );

            console.log('DONE');
        } catch (err) {
            console.log(`FAILED: ${err.message}`);
        }
    }

    console.log('Import completed.');
    await pool.end();
}

run().catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
});
