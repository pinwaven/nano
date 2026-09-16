#!/usr/bin/env node
/**
 * Dump everything the platform knows about one user into <outdir>/data/*.json.
 *
 *   set -a && source .env && set +a
 *   node extract.js <user_id|nickname> <outdir> [--prod]
 *
 * Reads DATABASE_URL (or DATABASE_URL_PROD with --prod). Never writes to the database.
 * One file per table that carries a user_id, plus joined dumps that need more than one table
 * (questionnaire answers with their prompts, cartridges with dot names) and the two reference
 * tables every report needs (the Dots formulary, biomarker_catalog). Prints a row-count inventory.
 */
const fs = require('fs');
const path = require('path');
const { Pool, types } = require(path.join(__dirname, '..', '..', '..', '..', 'src', 'functions', 'worker', 'node_modules', 'pg'));
// DATE columns (oid 1082) come back as plain 'YYYY-MM-DD'. node-postgres otherwise parses them at
// local midnight and JSON serialises a UTC instant — 2026-04-30 becomes "2026-04-29T16:00:00Z" —
// the same trap CLAUDE.md §35 records for twinBundle. Every downstream chart slices [:10].
types.setTypeParser(1082, v => v);

const [who, outdir] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!who || !outdir) { console.error('usage: node extract.js <user_id|nickname> <outdir> [--prod]'); process.exit(1); }
const url = process.argv.includes('--prod') ? process.env.DATABASE_URL_PROD : process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set — `set -a && source .env && set +a` first'); process.exit(1); }

(async () => {
  const pool = new Pool({ connectionString: url, max: 1 });
  const dataDir = path.join(outdir, 'data'); fs.mkdirSync(dataDir, { recursive: true });
  const save = (name, rows) => fs.writeFileSync(path.join(dataDir, name + '.json'), JSON.stringify(rows, null, 1));

  // Resolve the user: exact user_id first, then nickname (must be unique).
  let { rows: users } = await pool.query('SELECT * FROM users WHERE user_id = $1', [who]);
  if (!users.length) ({ rows: users } = await pool.query('SELECT * FROM users WHERE nickname ILIKE $1 ORDER BY created_at', [who]));
  if (users.length !== 1) { console.error(`expected exactly one user for "${who}", found ${users.length}:`, users.map(u => `${u.user_id} ${u.nickname}`)); process.exit(1); }
  const u = users[0]; const uid = u.user_id;
  const { rows: [ch] } = await pool.query('SELECT id, key_name, name, config FROM channels WHERE id = $1', [u.channel_id]);
  save('user', { ...u, channel: ch });
  console.log(`user ${uid} ${u.nickname} · ${u.gender} · born ${u.birth_date} · channel ${ch?.key_name} · wearable ${u.wearable_brand || '-'}`);

  // Every table with a user_id column.
  const { rows: tabs } = await pool.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='user_id' AND table_name <> 'users' ORDER BY 1`);
  const inventory = [];
  for (const { table_name: t } of tabs) {
    try {
      const { rows } = await pool.query(`SELECT * FROM "${t}" WHERE user_id = $1 ORDER BY 1`, [uid]);
      if (rows.length) { save(t, rows); inventory.push([t, rows.length]); }
    } catch (e) { console.error(`  skip ${t}: ${e.message}`); }
  }
  // Joined views the flat dumps cannot express.
  const joined = {
    questionnaire_answers: `SELECT r.*, qa.questionnaire_id, qa.status AS assignment_status, q.name_zh AS questionnaire, qq.key, qq.prompt_zh, qq.prompt_en, qq.input_type
                              FROM questionnaire_responses r JOIN questionnaire_assignments qa ON qa.id = r.assignment_id
                              LEFT JOIN questionnaires q ON q.id = qa.questionnaire_id LEFT JOIN questionnaire_questions qq ON qq.id = r.question_id
                             WHERE qa.user_id = $1 ORDER BY r.answered_at`,
    cartridges_named: `SELECT c.*, d.key_name, d.name_zh FROM user_cartridges c JOIN dots d ON d.id = c.dot_id WHERE c.user_id = $1 ORDER BY c.dot_id`,
  };
  for (const [name, sql] of Object.entries(joined)) {
    try { const { rows } = await pool.query(sql, [uid]); if (rows.length) { save(name, rows); inventory.push([name, rows.length]); } }
    catch (e) { console.error(`  skip ${name}: ${e.message}`); }
  }
  // Reference tables every report needs.
  const { rows: dots } = await pool.query(`SELECT id, key_name, name, name_zh, key_name_zh, description, ingredients_zh, ingredients, ingredients_summary, sub_age_target, sub_age_target_zh, timing, timing_flexible, target_dots_min, target_dots_max, is_isolate, group_name_zh, color_hex, dosing_protocol, pulse_days_per_cycle, pulse_cycle_days FROM dots ORDER BY id`);
  save('dots', dots);
  try { const { rows } = await pool.query('SELECT * FROM biomarker_catalog ORDER BY 1'); save('biomarker_catalog', rows); } catch (_) {}
  try { const { rows } = await pool.query('SELECT * FROM health_plan_templates ORDER BY id'); save('health_plan_templates', rows); } catch (_) {}

  console.log('\ninventory (table: rows)');
  for (const [t, n] of inventory.sort((a, b) => b[1] - a[1])) console.log(`  ${t}: ${n}`);
  console.log(`\nwritten to ${dataDir}`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
