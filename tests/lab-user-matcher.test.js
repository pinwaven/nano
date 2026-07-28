const assert = require('node:assert/strict');
const { describe, test, beforeEach } = require('node:test');

const db = require('../src/functions/lab/lib/db');
const { matchUser } = require('../src/functions/lab/lib/userMatcher');

// Fake users table. The real phone query strips non-digits from users.phone
// and compares; the mock emulates that DB-side digit-stripping so a test row
// with an E.164 (+86) phone behaves exactly like the database would.
let USERS;
let mappings;

function stripDigits(v) {
  return (v || '').replace(/\D/g, '');
}

beforeEach(() => {
  USERS = [];
  mappings = [];
  db.query = async (sql, params = []) => {
    if (/lab_user_mappings/.test(sql)) {
      const [labName, labPatientId] = params;
      const hit = mappings.find(m => m.lab_name === labName && m.lab_patient_id === labPatientId);
      return { rows: hit ? [{ user_id: hit.user_id }] : [] };
    }
    // users.phone lookup — params[0] is one digit-string, or an array of candidates.
    const candidates = Array.isArray(params[0]) ? params[0] : [params[0]];
    const row = USERS.find(u => candidates.includes(stripDigits(u.phone)));
    return { rows: row ? [{ user_id: row.user_id }] : [] };
  };
});

describe('matchUser phone fallback with +86 country code', () => {
  test('matches a bare 11-digit patient ID against a stored +86 E.164 phone', async () => {
    USERS = [{ user_id: 'u1', phone: '+8613812345678' }];
    assert.equal(await matchUser('qcs', '13812345678'), 'u1');
  });

  test('matches an 86-prefixed patient ID against a stored bare phone', async () => {
    USERS = [{ user_id: 'u2', phone: '13812345678' }];
    assert.equal(await matchUser('qcs', '8613812345678'), 'u2');
  });

  test('does not false-match a different number', async () => {
    USERS = [{ user_id: 'u4', phone: '+8613812345678' }];
    assert.equal(await matchUser('qcs', '13800000000'), null);
  });

  test('matches a bare 11-digit patient ID against a stored 86 phone without the + prefix', async () => {
    USERS = [{ user_id: 'u6', phone: '8613812345678' }];
    assert.equal(await matchUser('qcs', '13812345678'), 'u6');
  });

  test('mapping table still takes precedence over phone fallback', async () => {
    mappings = [{ lab_name: 'qcs', lab_patient_id: '13812345678', user_id: 'mapped' }];
    USERS = [{ user_id: 'u5', phone: '+8613812345678' }];
    assert.equal(await matchUser('qcs', '13812345678'), 'mapped');
  });
});
