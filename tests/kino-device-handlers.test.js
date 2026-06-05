const assert = require('node:assert');
const { describe, test } = require('node:test');

const {
  handleGetDeviceMe,
  handleGetKinoChip,
  handleGetKinoUpgrade,
  handlePostBiomarkers,
  handlePostMachineInfo,
  handlePostKinoResult,
} = require('../src/functions/kino/lib/deviceHandlers');
const { _private } = require('../src/functions/kino');

function createDevicePool() {
  const queries = [];
  const pool = {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });

      if (sql.includes('FROM kone_apk_releases')) {
        return { rows: [{ version: '1.2.3', download_url: 'https://example.test/app.apk' }] };
      }

      if (sql.includes('FROM kino_chips kc')) {
        return { rows: [{ batch_status: 'active', chip_status: 'available' }] };
      }

      if (sql.includes('FROM scans s')) {
        return {
          rows: [{
            id: 5,
            user_id: 'user-1',
            scan_status: 'pending',
            nickname: 'Alice',
            birth_date: '1990-01-01',
            gender: 'female',
            model: 'KNA1',
            biomarker_keys: ['hsCRP'],
            chip_config: { mode: 'standard' },
            guide_video: null,
            guide_text: null,
          }],
        };
      }

      if (sql.includes('SELECT id, user_id FROM scans')) {
        return { rows: [{ id: 5, user_id: 'user-1' }] };
      }

      if (sql.startsWith('UPDATE scans') || sql.startsWith('UPDATE kino_chips')) {
        return { rows: [] };
      }

      if (sql.startsWith('UPDATE kino_devices')) {
        return {
          rows: [{
            ...machine,
            software_version: params[0],
            firmware_version: params[1],
            last_seen_at: '2026-06-03T00:00:00.000Z',
          }],
        };
      }

      if (sql.includes('INSERT INTO biomarkers')) {
        return { rows: [{ id: 77 }] };
      }

      if (sql.includes('FROM users WHERE user_id = $1')) {
        return {
          rows: [{
            user_id: 'user-1',
            birth_date: '1990-01-01',
            bio_data: { weight: 70, height: 175 },
            nickname: 'Alice',
            language: 'en',
          }],
        };
      }

      if (sql.includes('FROM biomarkers') || sql.includes('FROM nutrition_schedules')) {
        return { rows: [] };
      }

      if (sql.startsWith('INSERT INTO notifications') || sql.startsWith('INSERT INTO chat_messages')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  };
  return pool;
}

const machine = {
  id: 42,
  machine_no: 'KNA1-F05142',
  machine_name: 'Clinic Reader',
  model: 'KNA1',
  status: 'active',
  channel_id: 12,
  coach_id: 34,
  notes: 'front desk',
  mainboard_id: 'mb-42',
  firmware_id: 'fw-42',
  comm_token_expires_at: '2026-05-22T00:00:00.000Z',
};

describe('Kino protected device business handlers', () => {
  test('returns authenticated device info from token context', async () => {
    const result = await handleGetDeviceMe({ machine });

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.machine, {
      id: 42,
      machine_no: 'KNA1-F05142',
      machine_name: 'Clinic Reader',
      model: 'KNA1',
      status: 'active',
      channel_id: 12,
      coach_id: 34,
      notes: 'front desk',
      mainboard_id: 'mb-42',
      firmware_id: 'fw-42',
      software_version: null,
      firmware_version: null,
      comm_token_expires_at: '2026-05-22T00:00:00.000Z',
    });
  });

  test('serves upgrade and chip lookup logic from the Kino function', async () => {
    const pool = createDevicePool();

    const upgrade = await handleGetKinoUpgrade({ pool });
    const chip = await handleGetKinoChip({ pool, query: { chip_id: 'chip-001' } });

    assert.deepStrictEqual(upgrade, { version: '1.2.3', url: 'https://example.test/app.apk' });
    assert.strictEqual(chip.found, true);
    assert.strictEqual(chip.scan_id, 5);
    assert.strictEqual(chip.chrono_age > 30, true);
  });

  test('kino-result stores the authenticated machine id and ignores body kino_device_id', async () => {
    const pool = createDevicePool();

    const result = await handlePostKinoResult({
      pool,
      machine,
      body: {
        chip_id: 'chip-001',
        data: { actual: { hsCRP: 1.2 } },
        bio_age: 32.1,
        kino_device_id: 999,
      },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.machine_no, 'KNA1-F05142');

    const insert = pool.queries.find((q) => q.sql.includes('INSERT INTO biomarkers'));
    assert.strictEqual(insert.params[2], 32.1);
    assert.strictEqual(insert.params[3], 42);
    assert.strictEqual(insert.params.includes(999), false);
  });

  test('biomarkers stores the authenticated machine id and ignores body kino_device_id', async () => {
    const pool = createDevicePool();

    const result = await handlePostBiomarkers({
      pool,
      machine,
      body: {
        openid: 'user-1',
        test_type: 'body_composition',
        test_data: { weight: 70 },
        kino_device_id: 999,
      },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.machine_no, 'KNA1-F05142');

    const insert = pool.queries.find((q) => q.sql.includes('INSERT INTO biomarkers'));
    assert.strictEqual(insert.params[4], 42);
    assert.strictEqual(insert.params.includes(999), false);
  });

  test('machine info route is protected by communication token auth', () => {
    assert.strictEqual(_private.isProtectedDeviceRoute('POST', '/kino-machines/info'), true);
  });

  test('machine info stores software and firmware versions for authenticated machine', async () => {
    const pool = createDevicePool();

    const result = await handlePostMachineInfo({
      pool,
      machine,
      body: {
        machine_no: 'KNA1-F99999',
        software_version: '2.4.1',
        firmware_version: '1.8.0',
      },
    });

    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.machine.machine_no, 'KNA1-F05142');
    assert.strictEqual(result.machine.software_version, '2.4.1');
    assert.strictEqual(result.machine.firmware_version, '1.8.0');

    const update = pool.queries.find((q) => q.sql.startsWith('UPDATE kino_devices'));
    assert.strictEqual(update.params[0], '2.4.1');
    assert.strictEqual(update.params[1], '1.8.0');
    assert.strictEqual(update.params[2], 42);
    assert.strictEqual(update.params.includes('KNA1-F99999'), false);
  });
});
