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
 *
 * Environment scoping (added 2026-08-01 after a real incident): dev and prod share one Aliyun
 * account/EventBridge bus, and nano-worker-dev's and nano-worker's (prod) eb-triggers both
 * filtered on the bare `source: acs.chat` — with no per-environment distinction. A dev test
 * that went through this async path was picked up by BOTH functions; prod's (unmodified, older)
 * code ran the LLM completion against the systemPrompt carried inside the event payload (built
 * by dev's newer code) but had no matching handling for a newer action tail in that prompt, so
 * the raw unstripped tail landed directly in a real user's live chat history. `EVENT_SOURCE_SUFFIX`
 * (env var, set to '.dev' in s.yaml, left unset in s-prod.yaml) makes dev publish under
 * `acs.chat.dev` instead of the shared `acs.chat` — prod's default (unset) behavior is
 * unchanged, so this is a dev-only opt-in, not a coordinated dual-deploy requirement. The same
 * suffix is reused by dispatcher/index.js and lab/index.js for their own published sources
 * (`acs.dispatcher`/`acs.lab`), which had the identical shared-bus exposure.
 */
'use strict';

const EventBridge = require('@alicloud/eventbridge');
const OpenApi = require('@alicloud/openapi-client');

const CHAT_EVENT_SOURCE = 'acs.chat' + (process.env.EVENT_SOURCE_SUFFIX || '');

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
        source: CHAT_EVENT_SOURCE,
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

module.exports = { publishChatGenerateEvent, CHAT_EVENT_SOURCE };
