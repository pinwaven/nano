'use strict';

// Transactional email via Aliyun DirectMail (dm, SingleSendMail) — the email counterpart of
// lib/sms.js. Unlike PNVS, DirectMail has no managed-OTP API: it only delivers, so the code
// itself is generated/stored/verified by lib/email-otp.js and this module just puts it in a
// mailbox. Sender is a verified DirectMail address on a DirectMail-owned subdomain
// (no-reply@mail.gcn.net — gcn.net's apex is a CNAME to FC and cannot carry the TXT/MX records
// DirectMail verification needs). Same Aliyun account/AK as OSS+PNVS; DM_ACCESS_KEY_* exist
// only so the sender can be moved to a scoped RAM user later without touching the SMS creds.

const DM_ENDPOINT = 'dm.aliyuncs.com';
const DM_REGION = process.env.DM_REGION || 'cn-hangzhou';

function client() {
    const OpenApi = require('@alicloud/openapi-client');
    const Dm = require('@alicloud/dm20151123');
    const config = new OpenApi.Config({
        accessKeyId: process.env.DM_ACCESS_KEY_ID || process.env.SMS_ACCESS_KEY_ID,
        accessKeySecret: process.env.DM_ACCESS_KEY_SECRET || process.env.SMS_ACCESS_KEY_SECRET,
        endpoint: DM_ENDPOINT,
        regionId: DM_REGION,
    });
    return new Dm.default(config);
}

// The dev bypass keys on DM_ACCOUNT_NAME (the verified sender address), NOT on the access key:
// dev already carries the shared AK for OSS/PNVS, so keying on credentials would make every dev
// deploy attempt a real send through an unverified sender and fail loudly.
function isConfigured() {
    return !!process.env.DM_ACCOUNT_NAME;
}

async function sendMail({ to, subject, text, html }) {
    const Dm = require('@alicloud/dm20151123');
    const TeaUtil = require('@alicloud/tea-util');
    const req = new Dm.SingleSendMailRequest({
        accountName: process.env.DM_ACCOUNT_NAME,
        addressType: 1,          // 1 = sender address (发信地址), 0 = random per-domain address
        replyToAddress: false,
        fromAlias: process.env.DM_FROM_ALIAS || 'Waven Nano',
        toAddress: to,
        subject,
        textBody: text,
        htmlBody: html,
    });
    const resp = await client().singleSendMailWithOptions(req, new TeaUtil.RuntimeOptions({}));
    return resp.body?.envId || null;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// OTP mail: plain text + a minimal HTML twin, no links and no images — DirectMail classifies
// mail by content and the sender is registered as 触发邮件 (transactional); a marketing-looking
// body is the fastest way to land in qq.com/163.com's junk folder. Bilingual in one message
// rather than per-language, because `language` is a hint from a login form the user has not
// authenticated yet.
async function sendEmailOtp(email, code, lang = 'zh') {
    const zhFirst = lang !== 'en';
    const subject = zhFirst ? `【Waven Nano】验证码 ${code}` : `Your Waven Nano code: ${code}`;
    const zh = `您的 Waven Nano 验证码是：${code}\n验证码 5 分钟内有效。如非本人操作，请忽略此邮件。`;
    const en = `Your Waven Nano verification code is: ${code}\nIt is valid for 5 minutes. If this wasn't you, please ignore this email.`;
    const text = zhFirst ? `${zh}\n\n${en}` : `${en}\n\n${zh}`;
    const block = (lead, tail) =>
        `<p style="margin:0 0 8px">${escapeHtml(lead)}</p>` +
        `<p style="margin:0 0 16px;font-size:28px;font-weight:700;letter-spacing:4px;font-family:Menlo,Consolas,monospace">${escapeHtml(code)}</p>` +
        `<p style="margin:0 0 24px;color:#666">${escapeHtml(tail)}</p>`;
    const zhHtml = block('您的 Waven Nano 验证码是：', '验证码 5 分钟内有效。如非本人操作，请忽略此邮件。');
    const enHtml = block('Your Waven Nano verification code is:', "It is valid for 5 minutes. If this wasn't you, please ignore this email.");
    const html = `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;padding:8px 0">` +
        (zhFirst ? zhHtml + enHtml : enHtml + zhHtml) + `</div>`;

    if (!isConfigured()) {
        // Dev bypass — mirrors sms-otp-dev-bypass: nothing is sent, the code is in the log.
        console.log(JSON.stringify({ level: 'INFO', msg: 'email-otp-dev-bypass', data: { email, code } }));
        return null;
    }
    try {
        const envId = await sendMail({ to: email, subject, text, html });
        console.log(JSON.stringify({ level: 'INFO', msg: 'email-otp-sent', data: { email, envId } }));
        return envId;
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'email-otp-send-failed', data: { email, err: err.message, code: err.code || null } }));
        throw err;
    }
}

module.exports = { sendMail, sendEmailOtp, isConfigured };
