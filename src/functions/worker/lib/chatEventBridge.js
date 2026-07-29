/**
 * Publishes a `chat.generate` CloudEvent so Viva's agentic-loop chat turns can run on the
 * worker's existing EventBridge-triggered invocation path instead of inline within the HTTP
 * request/response cycle. Mirrors dispatcher/index.js's publish pattern exactly (same SDKs,
 * same CloudEvent shape) rather than inventing a new mechanism.
 *
 * Why this exists: Aliyun FC cancels the function invocation the moment the HTTP client
 * disconnects (confirmed via live logs, 2026-07-28 — "Invocation canceled by client"), so a
 * slow agentic-loop turn synchronously awaited inside the HTTP handler is destroyed, not just
 * delayed, if the miniapp's request times out. Publishing this event and returning an
 * immediate ack means the client disconnecting can no longer cancel real work in progress.
 *
 * Credentials: dispatcher/index.js (a Cron-triggered function) reads these off its handler's
 * `context.credentials`/`context.region`, but a live probe against this (HTTP-triggered)
 * function found `context` is an empty object for HTTP invocations — no credentials or region
 * on it at all (confirmed 2026-07-28). The function's own runtime role credentials are instead
 * available as plain env vars (`ALIBABA_CLOUD_ACCESS_KEY_ID`/`_SECRET`/`ALIBABA_CLOUD_SECURITY_TOKEN`,
 * `FC_REGION`), which FC injects regardless of trigger type — use those instead of `context`.
 */
'use strict';

const EventBridge = require('@alicloud/eventbridge');
const OpenApi = require('@alicloud/openapi-client');

async function publishChatGenerateEvent(payload) {
    const ebConfig = new OpenApi.Config({
        accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
        accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
        securityToken: process.env.ALIBABA_CLOUD_SECURITY_TOKEN,
        endpoint: `eventbridge.${process.env.FC_REGION}.aliyuncs.com`,
    });
    const ebClient = new EventBridge.default(ebConfig);
    const cloudEvent = new EventBridge.CloudEvent({
        id: payload.event_id,
        source: 'acs.chat',
        specversion: '1.0',
        type: 'chat.generate',
        subject: 'chat_generate',
        datacontenttype: 'application/json',
        data: Buffer.from(JSON.stringify(payload)),
        time: new Date().toISOString(),
        extensions: {
            aliyuneventbusname: 'default',
        },
    });
    await ebClient.putEvents([cloudEvent]);
}

module.exports = { publishChatGenerateEvent };
