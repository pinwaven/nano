// /heartbeat also returns the account's current channel and own coach identity (index.js adds
// phone-otp.js currentSessionShape), so a client replaces what it stored at sign-in: a user moved to
// SuperiorMed in the admin panel kept showing aeviva-china (dev 2026-10-03).
const assert = require('node:assert');
const test = require('node:test');
const path = require('node:path');

const WORKER = path.join(__dirname, '..', 'src', 'functions', 'worker');
let userRow;
const pool = { query: async (sql) => {
  if (sql.includes('WHERE u.user_id = $1')) return { rows: userRow ? [userRow] : [] };
  if (sql.includes('WITH RECURSIVE up')) return { rows: [{ key_name: 'aeviva' }] };
  return { rows: [] };
} };
const stub = (file, exports) => {
  const filename = path.join(WORKER, file);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
stub('lib/db.js', { pool });
stub('handlers/login.js', { resolveCoachSession: async () => null });
const { currentSessionShape } = require(path.join(WORKER, 'handlers', 'phone-otp.js'));

test('the current channel, shaped as at login, and a null coach identity', async () => {
  userRow = { user_id: 'u1', channel_id: 7, roles: ['user'], channel_name: 'SuperiorMed', channel_key: 'superiormed',
    channel_logo_url: null, channel_sub_age_names: null, channel_locale: null, merged_into_user_id: null };
  const r = await currentSessionShape('u1');
  assert.deepStrictEqual(r, { channel: { name: 'SuperiorMed', key_name: 'superiormed', root_key_name: 'aeviva',
    logo_url: null, sub_age_display_names: null, locale: 'zh' }, coach: null });
});

test('an unknown or merged-away account gets nothing', async () => {
  userRow = null;
  assert.strictEqual(await currentSessionShape('gone'), null);
  userRow = { user_id: 'u2', channel_name: 'X', merged_into_user_id: 'u3' };
  assert.strictEqual(await currentSessionShape('u2'), null);
});
