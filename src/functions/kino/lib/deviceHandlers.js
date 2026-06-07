'use strict';

const crypto = require('crypto');
const { BiomarkerEstimator } = require('./estimator/BiomarkerEstimator');
const { BioAgeCalculator } = require('./bioage/BioAgeCalculator');
const { deriveTags } = require('./estimator/tagDerivation');

function calculateAge(birthDate) {
  if (!birthDate) return 30;
  const dob = new Date(birthDate);
  if (Number.isNaN(dob.getTime())) return 30;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDelta = now.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) age -= 1;
  return Math.max(0, age);
}

function generateUserId() {
  return `u_${crypto.randomBytes(8).toString('hex')}`;
}

async function resolveOrUpsertUser(pool, body) {
  const {
    openid,
    nickname,
    gender,
    birth_date,
    language,
    phone,
    email,
    test_type,
    test_data,
    tested_at,
    message,
    kino_device_id,
    ...rest
  } = body;

  if (!openid) throw new Error('openid is required');

  const byUserId = await pool.query(
    'SELECT user_id, birth_date, bio_data, nickname, language, phone, email, channel_id FROM users WHERE user_id = $1',
    [openid]
  );
  if (byUserId.rows.length > 0) return byUserId.rows[0];

  const userResult = await pool.query(
    `INSERT INTO users (user_id, external_id, external_app, nickname, phone, email, gender, birth_date, language, bio_data, channel_id)
     VALUES ($1, $2, 'wechat', $3, $4, $5, $6, $7, $8, $9, (SELECT id FROM channels WHERE key_name = 'nanovate' LIMIT 1))
     ON CONFLICT (external_id)
     DO UPDATE SET
       nickname = COALESCE(EXCLUDED.nickname, users.nickname),
       phone = COALESCE(EXCLUDED.phone, users.phone),
       email = COALESCE(EXCLUDED.email, users.email),
       gender = COALESCE(EXCLUDED.gender, users.gender),
       birth_date = COALESCE(EXCLUDED.birth_date, users.birth_date),
       language = COALESCE(EXCLUDED.language, users.language),
       bio_data = users.bio_data || EXCLUDED.bio_data,
       updated_at = CURRENT_TIMESTAMP
     RETURNING user_id, birth_date, bio_data, nickname, language, phone, email, channel_id`,
    [
      generateUserId(),
      openid,
      nickname || null,
      phone || null,
      email || null,
      gender || null,
      birth_date || null,
      language || 'zh',
      JSON.stringify(rest || {}),
    ]
  );
  return userResult.rows[0];
}

async function fetchTagDerivationContext(pool, userId) {
  const pathMap = {
    'Cellular Age': 'CellularAge',
    'Metabolic Age': 'MetabolicAge',
    'Micro-Vascular Age': 'MicroVascularAge',
    'Resilience Age': 'ResilienceAge',
  };
  const ctx = { history: [], weightHistory: [], compliance: {}, selfReported: [] };

  try {
    const r = await pool.query(
      `SELECT data, tested_at FROM biomarkers
       WHERE user_id = $1 AND test_type = 'kino_chip'
       ORDER BY tested_at DESC LIMIT 5`,
      [userId]
    );
    ctx.history = r.rows.map((row) => {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      return { tested_at: row.tested_at, biomarkers: (data && (data.estimated || data.actual)) || {} };
    });
  } catch (_) {}

  try {
    const r = await pool.query(
      `SELECT data, tested_at FROM biomarkers
       WHERE user_id = $1 AND test_type = 'body_composition'
       ORDER BY tested_at DESC LIMIT 10`,
      [userId]
    );
    ctx.weightHistory = r.rows
      .map((row) => {
        const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
        const weight = data?.actual && typeof data.actual.weight === 'number' ? data.actual.weight : null;
        return weight === null ? null : { tested_at: row.tested_at, weight };
      })
      .filter(Boolean);
  } catch (_) {}

  try {
    const r = await pool.query(
      `SELECT d.sub_age_target AS pathway,
              SUM(CASE WHEN ns.is_taken THEN (kv.value)::int ELSE 0 END)::float AS taken_count,
              SUM((kv.value)::int)::float AS total_count
       FROM nutrition_schedules ns
       CROSS JOIN LATERAL jsonb_each_text(ns.recipe -> 'dots') AS kv(key, value)
       JOIN dots d ON d.key_name = kv.key
       WHERE ns.user_id = $1
         AND ns.scheduled_date >= CURRENT_DATE - INTERVAL '14 days'
         AND ns.scheduled_date <= CURRENT_DATE
         AND d.sub_age_target IS NOT NULL
       GROUP BY d.sub_age_target`,
      [userId]
    );
    for (const row of r.rows) {
      const codeKey = pathMap[row.pathway];
      if (!codeKey || !row.total_count) continue;
      ctx.compliance[codeKey] = row.taken_count / row.total_count;
    }
  } catch (_) {}

  return ctx;
}

async function saveChatMessage(pool, userId, role, content) {
  try {
    await pool.query(
      'INSERT INTO chat_messages (user_id, role, content, persona_type) VALUES ($1, $2, $3, $4)',
      [userId, role, content, 'nano']
    );
  } catch (_) {}
}

async function refreshGoalProgress(pool, userId) {
  try {
    const twin = await pool.query(
      'SELECT latest_bio_age, latest_sub_ages FROM health_twin WHERE user_id = $1',
      [userId]
    );
    if (!twin.rows.length) return;

    const goals = await pool.query(
      `SELECT id, coach_id, goal_type, target_sub_age, target_value
       FROM client_goals WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );

    for (const goal of goals.rows) {
      let currentValue = null;
      if (goal.goal_type === 'bio_age') currentValue = twin.rows[0].latest_bio_age;
      else if (goal.goal_type === 'sub_age' && goal.target_sub_age && twin.rows[0].latest_sub_ages) {
        currentValue = twin.rows[0].latest_sub_ages[goal.target_sub_age] || null;
      }
      if (currentValue === null) continue;

      const achieved = goal.target_value !== null && currentValue <= parseFloat(goal.target_value);
      await pool.query(
        `UPDATE client_goals SET current_value = $2, status = $3, achieved_at = $4, updated_at = NOW() WHERE id = $1`,
        [goal.id, currentValue, achieved ? 'achieved' : 'active', achieved ? new Date().toISOString() : null]
      );
    }
  } catch (_) {}
}

async function handleGetKinoUpgrade({ pool }) {
  try {
    const result = await pool.query(
      'SELECT version, download_url FROM kone_apk_releases WHERE is_active = true LIMIT 1'
    );
    if (result.rows.length === 0) return { version: '', url: '' };
    return { version: result.rows[0].version, url: result.rows[0].download_url };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleGetDeviceMe({ machine }) {
  return {
    statusCode: 200,
    success: true,
    machine: {
      id: machine.id,
      machine_no: machine.machine_no,
      machine_name: machine.machine_name,
      model: machine.model,
      status: machine.status,
      channel_id: machine.channel_id ?? null,
      coach_id: machine.coach_id ?? null,
      notes: machine.notes ?? null,
      mainboard_id: machine.mainboard_id,
      firmware_id: machine.firmware_id,
      software_version: machine.software_version ?? null,
      firmware_version: machine.firmware_version ?? null,
      comm_token_expires_at: machine.comm_token_expires_at,
    },
  };
}

function normalizeVersion(value) {
  if (value === undefined || value === null) return null;
  const version = String(value).trim();
  if (!version) return null;
  if (version.length > 128) {
    return { error: 'version_too_long' };
  }
  return version;
}

async function handlePostMachineInfo({ pool, body = {}, machine }) {
  const softwareVersion = normalizeVersion(body.software_version ?? body.softwareVersion ?? body.app_version);
  const firmwareVersion = normalizeVersion(body.firmware_version ?? body.firmwareVersion);

  if (softwareVersion?.error || firmwareVersion?.error) {
    return { statusCode: 400, success: false, error: 'version_too_long' };
  }

  if (!softwareVersion && !firmwareVersion) {
    return { statusCode: 400, success: false, error: 'version_required' };
  }

  const result = await pool.query(
    `UPDATE kino_devices
     SET software_version = COALESCE($1, software_version),
         firmware_version = COALESCE($2, firmware_version),
         last_seen_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $3
     RETURNING id,
               serial_number AS machine_no,
               name AS machine_name,
               model,
               status,
               channel_id,
               coach_id,
               notes,
               mainboard_id,
               firmware_id,
               software_version,
               firmware_version,
               comm_token_expires_at`,
    [softwareVersion, firmwareVersion, machine.id]
  );

  if (result.rows.length === 0) {
    return { statusCode: 404, success: false, error: 'machine_not_found' };
  }

  return handleGetDeviceMe({ machine: result.rows[0] });
}

async function handleGetKinoChip({ pool, query = {} }) {
  const chipId = query.chip_id;
  if (!chipId) throw new Error('chip_id is required');

  const batchCheck = await pool.query(
    `SELECT kb.status AS batch_status, kc.status AS chip_status
     FROM kino_chips kc
     JOIN kino_chip_batches kb ON kb.id = kc.batch_id
     WHERE kc.chip_code = $1`,
    [chipId]
  );
  if (batchCheck.rows.length === 0 || batchCheck.rows[0].batch_status !== 'active') {
    return { found: false };
  }

  const chipStatus = batchCheck.rows[0].chip_status;
  const result = await pool.query(
    `SELECT s.id, s.user_id, s.scan_status, u.nickname, u.birth_date, u.gender,
            cb.model,
            m.biomarker_keys, m.config AS chip_config, m.guide_video, m.guide_text
     FROM scans s
     JOIN users u ON u.user_id = s.user_id
     LEFT JOIN kino_chips        c  ON c.chip_code = s.chip_id
     LEFT JOIN kino_chip_batches cb ON cb.id       = c.batch_id
     LEFT JOIN kino_chip_models  m  ON m.code      = cb.model
     WHERE s.chip_id = $1 LIMIT 1`,
    [chipId]
  );

  if (result.rows.length === 0) {
    if (chipStatus === 'used') return { found: true, used: true };
    return { found: false };
  }

  const row = result.rows[0];
  return {
    found: true,
    used: row.scan_status === 'completed' || chipStatus === 'used',
    scan_id: row.id,
    user_id: row.user_id,
    scan_status: row.scan_status,
    nickname: row.nickname,
    birth_date: row.birth_date || null,
    chrono_age: row.birth_date ? calculateAge(row.birth_date) : null,
    gender: row.gender || null,
    model: row.model || null,
    biomarker_keys: row.biomarker_keys || null,
    chip_config: row.chip_config || null,
    guide_video: row.guide_video || null,
    guide_text: row.guide_text || null,
  };
}

async function handleGetBiomarkers({ pool, query = {} }) {
  try {
    const openid = query.openid;
    if (!openid) return { success: true, records: [] };
    const result = await pool.query(
      `SELECT id, test_type, data, bio_age, tested_at
       FROM biomarkers
       WHERE user_id = $1
       ORDER BY tested_at ASC`,
      [openid]
    );
    return { success: true, records: result.rows };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handlePostKinoResult({ pool, body = {}, machine }) {
  const { chip_id: chipId, data, bio_age: bioAge } = body;
  if (!chipId) throw new Error('chip_id is required');
  if (!data) throw new Error('data is required');

  const scanResult = await pool.query(
    'SELECT id, user_id FROM scans WHERE chip_id = $1 LIMIT 1',
    [chipId]
  );
  if (scanResult.rows.length === 0) throw new Error('No registered scan found for this chip');

  const { id: scanId, user_id: userId } = scanResult.rows[0];

  await pool.query(
    'UPDATE scans SET scan_status = $1, scan_results = $2 WHERE id = $3',
    ['completed', JSON.stringify({ chip_id: chipId, ...data }), scanId]
  );
  await pool.query('UPDATE kino_chips SET status = $1 WHERE chip_code = $2', ['used', chipId]);

  const bmResult = await pool.query(
    `INSERT INTO biomarkers (user_id, test_type, data, bio_age, tested_at, kino_device_id)
     VALUES ($1, 'kino_chip', $2, $3, NOW(), $4)
     RETURNING id`,
    [userId, JSON.stringify(data), bioAge ?? null, machine.id]
  );

  return {
    success: true,
    scan_id: scanId,
    biomarker_id: bmResult.rows[0].id,
    user_id: userId,
    machine_no: machine.machine_no,
  };
}

async function handlePostBiomarkers({ pool, body = {}, machine }) {
  const { test_type: testType = 'kino_chip', test_data: testData, tested_at: testedAt } = body;
  if (!testData) throw new Error('test_data is required');

  const user = await resolveOrUpsertUser(pool, body);
  const userId = user.user_id;
  const deviceId = machine.id;

  if (testType === 'kino_chip') {
    const age = calculateAge(user.birth_date);
    const bioData = user.bio_data || {};
    const tagContext = await fetchTagDerivationContext(pool, userId);
    const tags = deriveTags(tagContext);
    const scanTimestamp = testedAt || new Date().toISOString();
    const scanDate = scanTimestamp.slice(0, 10);
    const weekBucket = Math.floor(new Date(scanDate).getTime() / (7 * 24 * 60 * 60 * 1000));
    const seed = `${userId}:${scanTimestamp}`;
    const persistentSeed = `${userId}:w${weekBucket}`;

    const estimator = new BiomarkerEstimator(
      age,
      testData,
      { Weight: bioData.weight, Height: bioData.height },
      tags,
      { seed, persistentSeed }
    );
    const estimationReport = estimator.generateReport();
    const bioAgeCalc = new BioAgeCalculator();
    const bioAgeReport = bioAgeCalc.calculateBioAge(age, estimationReport.BiomarkerValues);
    const finalData = {
      actual: testData,
      estimated: estimationReport.BiomarkerValues,
      context: estimationReport.ClinicalContext,
      bioage_profile: bioAgeReport,
      tags,
    };

    const biomarkerResult = await pool.query(
      `INSERT INTO biomarkers (user_id, test_type, data, bio_age, tested_at, kino_device_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [userId, testType, JSON.stringify(finalData), bioAgeReport.BioAge, scanTimestamp, deviceId]
    );

    const lang = user.language || 'zh';
    const content = lang === 'zh'
      ? `已完成生物标志物检测分析。您的生理年龄为 **${bioAgeReport.BioAge.toFixed(1)} 岁**。请用健康管理小工具查看详细分析！`
      : `I've analyzed your biomarker test. Your biological age is **${bioAgeReport.BioAge.toFixed(1)} years**. Check your health advice tool for details!`;
    await pool.query(
      'INSERT INTO notifications (user_id, biomarker_id, notification_type, content, status) VALUES ($1, $2, $3, $4, $5)',
      [userId, biomarkerResult.rows[0].id, 'biological_report', content, 'pending']
    );
    await saveChatMessage(pool, userId, 'ai', content);
    refreshGoalProgress(pool, userId);

    return {
      success: true,
      user_id: userId,
      biomarkers: estimationReport.BiomarkerValues,
      bioage_profile: bioAgeReport,
      machine_no: machine.machine_no,
    };
  }

  await pool.query(
    `INSERT INTO biomarkers (user_id, test_type, data, tested_at, kino_device_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, testType, JSON.stringify({ actual: testData }), testedAt || new Date().toISOString(), deviceId]
  );

  return { success: true, user_id: userId, machine_no: machine.machine_no };
}

async function handleDeviceBusinessRequest({ pool, method, path, event, machine, body, query }) {
  if (method === 'GET' && path === '/device/me') return handleGetDeviceMe({ machine });
  if (method === 'POST' && path === '/kino-machines/info') return handlePostMachineInfo({ pool, body, machine, event });
  if (method === 'GET' && path === '/kino-upgrade') return handleGetKinoUpgrade({ pool, machine });
  if (method === 'GET' && path === '/kino-chip') return handleGetKinoChip({ pool, query, machine });
  if (method === 'GET' && path === '/biomarkers') return handleGetBiomarkers({ pool, query, machine });
  if (method === 'POST' && path === '/biomarkers') return handlePostBiomarkers({ pool, body, machine, event });
  if (method === 'POST' && path === '/kino-result') return handlePostKinoResult({ pool, body, machine, event });
  return { statusCode: 404, success: false, error: `Unknown device route: ${method} ${path}` };
}

module.exports = {
  calculateAge,
  handleDeviceBusinessRequest,
  handleGetDeviceMe,
  handleGetBiomarkers,
  handleGetKinoChip,
  handleGetKinoUpgrade,
  handlePostBiomarkers,
  handlePostMachineInfo,
  handlePostKinoResult,
};
