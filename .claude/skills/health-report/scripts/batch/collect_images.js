#!/usr/bin/env node
// Download every uploaded image that carries clinical content for one extracted user into <workdir>/docs/.
//   set -a && source .env && set +a && node collect_images.js <workdir> [--all]
// Default: health_checkup_report, lab_import, bp_reading biomarker photos + health_reports images. --all adds health_photo/food_photo.
const fs = require('fs'), path = require('path');
const ROOT = '/Users/pin/waven/nano';
const OSS = require(path.join(ROOT, 'src/functions/worker/node_modules/ali-oss'));
const W = process.argv[2]; const ALL = process.argv.includes('--all');
const load = n => { const p = path.join(W, 'data', n + '.json'); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : []; };
(async () => {
  const client = new OSS({ region: process.env.OSS_REGION || 'oss-cn-shanghai', accessKeyId: process.env.OSS_ACCESS_KEY_ID, accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET, bucket: process.env.OSS_BUCKET, secure: true });
  const dir = path.join(W, 'docs'); fs.mkdirSync(dir, { recursive: true });
  const items = [];
  for (const b of load('biomarkers')) {
    const t = b.test_type; const k = b.data && b.data.oss_key;
    if (!k) continue;
    if (['health_checkup_report', 'lab_import', 'bp_reading'].includes(t) || (ALL && ['health_photo', 'food_photo'].includes(t))) items.push({ key: k, tag: `bm${b.id}_${t}_${(b.data.report_date || b.tested_at || '').slice(0, 10)}` });
  }
  for (const r of load('health_reports')) {
    const u = r.raw_data && r.raw_data.image_url; const k = r.oss_key || (u && decodeURIComponent(new URL(u).pathname.slice(1)));
    if (k) items.push({ key: k, tag: `hr${r.id}_${(r.institution || 'x').replace(/[\/\s]/g, '_')}_${r.report_date}` });
  }
  const seen = new Set();
  for (const it of items) {
    if (seen.has(it.key)) continue; seen.add(it.key);
    const out = path.join(dir, it.tag + path.extname(it.key || '.jpg'));
    try { await client.get(it.key, out); console.log(out, fs.statSync(out).size); } catch (e) { console.log('FAIL', it.key, e.message); }
  }
  console.log(seen.size, 'images');
})();
