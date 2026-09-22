#!/usr/bin/env node
/**
 * Download every active health_documents PDF for the extracted user from OSS and run
 * `pdftotext -layout` on each, so the report can be written from the ORIGINAL files rather
 * than from the platform's extraction summaries (which map only ~25 standard blood markers and
 * see nothing in a genome, microbiome, IgG, glycan or telomere report).
 *
 *   set -a && source .env && set +a
 *   node download-docs.js <outdir>       # <outdir>/data/health_documents.json must exist (extract.js)
 *
 * Writes <outdir>/docs/docNN_<filename>.pdf and <outdir>/txt/docNN_<filename>.txt, then prints
 * a size/page/char inventory. A .txt with very few chars for its page count is a scanned PDF:
 * render those pages with `pdftoppm -r 60 -png` and read the images instead. Result pages that
 * are pure graphics (e.g. 糖组 tumour-risk "低风险" badges) also need rendering — the text layer
 * says nothing about them.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..', '..', '..');
const OSS = require(path.join(ROOT, 'src', 'functions', 'worker', 'node_modules', 'ali-oss'));

const outdir = process.argv[2];
if (!outdir) { console.error('usage: node download-docs.js <outdir>'); process.exit(1); }
const docsJson = path.join(outdir, 'data', 'health_documents.json');
if (!fs.existsSync(docsJson)) { console.error(`no ${docsJson} — run extract.js first (or the user has no documents)`); process.exit(1); }
for (const k of ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_BUCKET']) if (!process.env[k]) { console.error(`${k} not set — \`set -a && source .env && set +a\``); process.exit(1); }

(async () => {
  const client = new OSS({ region: process.env.OSS_REGION || 'oss-cn-shanghai', accessKeyId: process.env.OSS_ACCESS_KEY_ID, accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET, bucket: process.env.OSS_BUCKET, secure: true, timeout: 600000 });   // large scanned PDFs exceed the 60 s default
  const docs = JSON.parse(fs.readFileSync(docsJson, 'utf8')).filter(d => d.status === 'active');
  const docDir = path.join(outdir, 'docs'), txtDir = path.join(outdir, 'txt');
  fs.mkdirSync(docDir, { recursive: true }); fs.mkdirSync(txtDir, { recursive: true });
  const seen = new Map(); // etag -> first doc id, to flag duplicate uploads
  for (const d of docs) {
    const safe = String(d.filename || `doc${d.id}`).replace(/[\/\s]/g, '_');
    const base = `doc${String(d.id).padStart(2, '0')}_${safe}`;
    const ext = (path.extname(d.oss_key) || '.pdf').toLowerCase();
    const isPdf = ext === '.pdf';
    const pdf = path.join(docDir, base.toLowerCase().endsWith(ext) ? base : base + ext);
    try {
      await client.get(d.oss_key, pdf, { timeout: 600000 });
      if (!isPdf) {   // photos: keep the real extension, no text layer — Read them as images
        const dup = d.etag && seen.has(d.etag) ? ` DUPLICATE of doc${seen.get(d.etag)}` : '';
        if (d.etag && !seen.has(d.etag)) seen.set(d.etag, d.id);
        console.log(`doc${d.id}\t${d.doc_type || '-'}\t${d.doc_date ? String(d.doc_date).slice(0, 10) : '-'}\timage\t${fs.statSync(pdf).size} bytes\t${d.filename}${dup} (photo — open it)`);
        continue;
      }
      let pages = '?', chars = 0;
      try { pages = execSync(`pdfinfo "${pdf}" 2>/dev/null | awk '/^Pages:/{print $2}'`).toString().trim(); } catch (_) {}
      const txt = path.join(txtDir, path.basename(pdf, '.pdf') + '.txt');
      try { execSync(`pdftotext -layout "${pdf}" "${txt}" 2>/dev/null`); chars = fs.statSync(txt).size; } catch (_) {}
      const dup = d.etag && seen.has(d.etag) ? ` DUPLICATE of doc${seen.get(d.etag)}` : '';
      if (d.etag && !seen.has(d.etag)) seen.set(d.etag, d.id);
      const scanned = pages !== '?' && chars / Math.max(1, Number(pages)) < 200 ? ' (little text — likely scanned, render pages)' : '';
      console.log(`doc${d.id}\t${d.doc_type || '-'}\t${d.doc_date ? String(d.doc_date).slice(0, 10) : '-'}\t${pages}p\t${chars} chars\t${d.filename}${dup}${scanned}`);
    } catch (e) { console.log(`doc${d.id}\tFAILED ${e.message}`); }
  }
  console.log(`\n${docs.length} documents → ${docDir} / ${txtDir}`);
})().catch(e => { console.error(e); process.exit(1); });
