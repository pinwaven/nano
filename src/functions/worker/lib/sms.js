'use strict';

// OTP delivery/verification via Aliyun's PNVS SMS Authentication Service (dypnsapi) —
// mirrors gcn's src/functions/auth/lib/otp.js (see nano/gcn-integration skill / gcn's
// docs/pnvs.md), which already proved this out for tea/aeviva phone login. PNVS
// generates, stores, and validates the code entirely on Aliyun's side
// (SendSmsVerifyCode/CheckSmsVerifyCode) using a system-provided (赠送) sign/template —
// no custom sign-name/template approval needed, unlike classic Dysmsapi. Same Aliyun
// account as OSS_ACCESS_KEY_ID already has dypnsapi permission (confirmed in gcn's
// docs/pnvs.md), so no separate SMS credential needs provisioning.

const crypto = require('crypto');
const { pool } = require('./db');
const { generatePhoneOtpCode } = require('./auth');

const SIGN_NAME = process.env.PNVS_SIGN_NAME || '恒创联众';
const TEMPLATE_CODE = process.env.PNVS_TEMPLATE_CODE || '100001';

function hashOTP(code) {
    return crypto.createHash('sha256').update(code).digest('hex');
}

function client() {
    const OpenApi = require('@alicloud/openapi-client');
    const Dypnsapi = require('@alicloud/dypnsapi20170525');
    const config = new OpenApi.Config({
        accessKeyId: process.env.SMS_ACCESS_KEY_ID,
        accessKeySecret: process.env.SMS_ACCESS_KEY_SECRET,
        endpoint: 'dypnsapi.aliyuncs.com',
        regionId: 'cn-hangzhou',
    });
    return new Dypnsapi.default(config);
}

// Callers (phone-otp.js) always pass the bare 11-digit national number here —
// PNVS wants it bare, and phone_otp_codes is keyed on it. users.phone itself is
// now stored as E.164 (+86...); the +86 is added only once OTP verification
// succeeds and the phone is about to be written to/looked up in users.phone
// (see lib/phone.js normalizeCnPhone), never passed down to sendOTP/verifyOTP.
async function sendOTP(phone) {
    if (!process.env.SMS_ACCESS_KEY_ID) {
        // Dev bypass: no SMS credentials configured, log instead of paying for a real
        // SMS. Stored locally so verifyOTP's matching dev bypass can check it.
        const code = generatePhoneOtpCode();
        await pool.query(
            'INSERT INTO phone_otp_codes (phone, code_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'5 minutes\')',
            [phone, hashOTP(code)]
        );
        console.log(JSON.stringify({ level: 'INFO', msg: 'sms-otp-dev-bypass', data: { phone, code } }));
        return;
    }

    const Dypnsapi = require('@alicloud/dypnsapi20170525');
    const TeaUtil = require('@alicloud/tea-util');
    const req = new Dypnsapi.SendSmsVerifyCodeRequest({
        phoneNumber: phone,
        countryCode: '86',
        signName: SIGN_NAME,
        templateCode: TEMPLATE_CODE,
        // Template 100001 has two placeholders (code, min) — omitting either is accepted
        // synchronously (Success: true) but the carrier silently drops delivery. min must
        // agree with validTime (seconds) — see gcn's docs/pnvs.md.
        templateParam: JSON.stringify({ code: '##code##', min: '5' }),
        codeLength: 6,
        validTime: 300,
    });
    await client().sendSmsVerifyCodeWithOptions(req, new TeaUtil.RuntimeOptions({}));
}

async function verifyOTP(phone, code) {
    if (!process.env.SMS_ACCESS_KEY_ID) {
        const result = await pool.query(
            `SELECT id FROM phone_otp_codes
             WHERE phone = $1 AND code_hash = $2
               AND expires_at > NOW() AND consumed = FALSE
             ORDER BY created_at DESC LIMIT 1`,
            [phone, hashOTP(code)]
        );
        if (result.rows.length === 0) return false;
        await pool.query('UPDATE phone_otp_codes SET consumed = TRUE WHERE id = $1', [result.rows[0].id]);
        return true;
    }

    const Dypnsapi = require('@alicloud/dypnsapi20170525');
    const TeaUtil = require('@alicloud/tea-util');
    const req = new Dypnsapi.CheckSmsVerifyCodeRequest({
        phoneNumber: phone,
        countryCode: '86',
        verifyCode: code,
    });
    const resp = await client().checkSmsVerifyCodeWithOptions(req, new TeaUtil.RuntimeOptions({}));
    return resp.body?.model?.verifyResult === 'PASS';
}

module.exports = { sendOTP, verifyOTP };
