'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const worker = path.resolve(__dirname, '../src/functions/worker');
const stub = (file, exports) => {
    const filename = path.join(worker, file);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const writes = [];
stub('lib/db.js', { pool: { query: async sql => {
    if (/INSERT|UPDATE|DELETE/.test(sql)) writes.push(sql);
    return { rows: [] };
} } });
stub('lib/auth.js', { generateUserId: () => 'new', generateReferralCode: async () => 'code' });
stub('lib/sms.js', { verifyOTP: async () => true });
stub('handlers/user-merge.js', { mergeUsers: async () => {}, resolveMergedUser: async (_, row) => row });
stub('lib/personaOverride.js', { grantSignupTrial: async () => {} });
stub('handlers/partners.js', { syncPartnerPhoneFromUser: async () => {} });
stub('handlers/login.js', { resolveCoachSession: async () => null });
stub('lib/channels.js', { resolveRootChannelKey: async () => null });
stub('lib/signup-invite.js', { resolveSignupInvite: async () => null, recordInvitationUse: async () => {} });
stub('lib/wechatIdentity.js', { linkVerifiedMiniappLogin: async () => 'old' });

const { handlePhoneOtpVerify } = require(path.join(worker, 'handlers/phone-otp.js'));

test('existing-account phone login never creates another user when the number is unknown', async () => {
    const response = await handlePhoneOtpVerify({ phone: '13800000000', code: '123456', existing_only: true });
    assert.equal(response.success, false);
    assert.equal(response.error, 'account_not_found');
    assert.equal(writes.length, 0);
});
