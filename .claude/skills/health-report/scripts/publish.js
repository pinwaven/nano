#!/usr/bin/env node
/**
 * Publish a finished report PDF into the app: upload to OSS under viva-ag-results/<job_uid>/ and
 * insert a COMPLETED viva_ag_jobs row, which is what both the 数字孪生 subtab's 综合报告 card
 * (/api/twin-reports) and the Viva AG panel list. No chat message is written — add one with
 * deliverTerminalMessage if the user should be pinged.
 *
 *   set -a && source .env && set +a
 *   node publish.js <outdir> <pdf-path> <summary.txt> [--prod] [--command-key full_analysis]
 *
 * <outdir>/data/user.json (from extract.js) supplies user_id / channel_id / language, and
 * data/health_documents.json supplies document_ids so the job records what it was built from.
 * Writes to the database and OSS: run on dev unless explicitly told otherwise. The upload happens
 * BEFORE the insert, so if the insert fails, delete the printed oss key by hand (an orphan under
 * viva-ag-results/ is otherwise invisible).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..', '..', '..');
const OSS = require(path.join(ROOT, 'src', 'functions', 'worker', 'node_modules', 'ali-oss'));
const { Pool } = require(path.join(ROOT, 'src', 'functions', 'worker', 'node_modules', 'pg'));

const args = process.argv.slice(2);
const pos = args.filter(a => !a.startsWith('--'));
const [outdir, pdfPath, summaryPath] = pos;
if (!outdir || !pdfPath || !summaryPath) { console.error('usage: node publish.js <outdir> <pdf> <summary.txt> [--prod] [--command-key KEY]'); process.exit(1); }
const prod = args.includes('--prod');
const ck = args.includes('--command-key') ? args[args.indexOf('--command-key') + 1] : 'full_analysis';
const url = prod ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }

(async () => {
  const user = JSON.parse(fs.readFileSync(path.join(outdir, 'data', 'user.json'), 'utf8'));
  const docsFile = path.join(outdir, 'data', 'health_documents.json');
  const docIds = fs.existsSync(docsFile) ? JSON.parse(fs.readFileSync(docsFile, 'utf8')).filter(d => d.status === 'active').map(d => d.id).sort((a, b) => b - a) : [];
  const summary = fs.readFileSync(summaryPath, 'utf8').trim();
  const buf = fs.readFileSync(pdfPath);

  const client = new OSS({ region: process.env.OSS_REGION || 'oss-cn-shanghai', accessKeyId: process.env.OSS_ACCESS_KEY_ID, accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET, bucket: process.env.OSS_BUCKET, secure: true });
  const jobUid = crypto.randomUUID();
  const key = `viva-ag-results/${jobUid}/${crypto.randomBytes(8).toString('hex')}.pdf`;
  await client.put(key, buf, { headers: { 'Content-Type': 'application/pdf' } });   // type fixed at upload; the bucket refuses overrides on GET
  const etag = String((await client.head(key)).res.headers.etag || '').replace(/"/g, '');
  console.log('uploaded', key, buf.length, 'bytes');

  const pool = new Pool({ connectionString: url, max: 1 });
  const files = [{ ext: 'pdf', etag, oss_key: key, filename: path.basename(pdfPath), size_bytes: buf.length, content_type: 'application/pdf' }];
  try {
    const { rows: [row] } = await pool.query(`
      INSERT INTO viva_ag_jobs (job_uid, user_id, channel_id, persona_type, language, command_key, command, params, document_ids,
        status, priority, attempts, max_attempts, claimed_by, claimed_at, started_at, completed_at, result_token,
        result_summary, result_oss_key, result_files, result, created_at, updated_at)
      VALUES ($1, $2, $3, 'viva', $4, $5, $6, '{}'::jsonb, $7::bigint[],
        'completed', 0, 1, 3, 'claude-code-analyst', NOW(), NOW(), NOW(), $8,
        $9, $10, $11::jsonb, $12::jsonb, NOW(), NOW())
      RETURNING id, job_uid`,
      [jobUid, user.user_id, user.channel_id, user.language || 'zh', ck, '全维度健康分析报告（逐份通读上传文件 + 平台全部数据）', docIds,
       crypto.randomBytes(24).toString('hex'), summary, key, JSON.stringify(files),
       JSON.stringify({ source: 'claude-code', pdf_pages: null, generated_at: new Date().toISOString().slice(0, 10) })]);
    console.log('inserted viva_ag_jobs', row, prod ? '(PROD)' : '(dev)');
  } catch (e) {
    console.error('INSERT failed — delete the orphan object:', key); throw e;
  } finally { await pool.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
