---
name: fc3-handler-reference
description: Aliyun Function Compute 3.0 (FC 3.0) handler invocation model, event object shape, and response format — confirmed by live debugging against the deployed function. Load when writing or modifying an FC 3.0 HTTP-trigger handler (dispatcher or worker).
---

When writing or modifying FC handler code, use these facts. They were confirmed by live debugging against the deployed function.

### Handler invocation model

FC 3.0 invokes HTTP trigger functions as **event functions**, not as Node.js HTTP server functions. The handler receives:

```
exports.handler = async (req, resp, context) => { ... }
```

- `req` — a plain JS object (already parsed from the raw event Buffer). It is **not** a Node.js `http.IncomingMessage`.
- `resp` — the FC context object. It does **not** have `.send()`, `.setStatusCode()`, or `.setHeader()`. Do not test for `resp.send` to detect HTTP mode.
- Response is sent by **returning** a payload object (see below), not by calling `resp`.

### Event object shape (FC 3.0 HTTP trigger)

```js
{
  version: "v1",
  rawPath: "/notifications",          // ← URL path. NOT event.path
  headers: { "Host": "...", ... },
  queryParameters: { openid: "xxx" }, // ← query string. NOT queryStringParameters
  body: "",                           // base64-encoded if isBase64Encoded: true
  isBase64Encoded: true,
  requestContext: {
    accountId: "...",
    domainName: "...",
    http: {
      method: "GET",                  // ← HTTP method lives here
      ...
    },
    ...
  }
}
```

Key differences from AWS Lambda / FC 2.0 / Express conventions:

| Correct (FC 3.0)                     | Wrong (will be undefined)                                       |
| ------------------------------------ | --------------------------------------------------------------- |
| `event.rawPath`                    | `event.path`, `req.path`, `req.url`                       |
| `event.queryParameters`            | `event.queryStringParameters`, `req.queries`, `req.query` |
| `event.requestContext.http.method` | `event.httpMethod`, `event.method`, `req.method`          |
| `event.headers`                    | `req.headers`                                                 |

### Canonical way to extract path, method, query in a handler

```js
exports.handler = async (req, resp, context) => {
    const event = req; // req IS the event object in FC 3.0
 
    const path    = event.rawPath || '';
    const method  = event.requestContext?.http?.method || 'POST';
    const query   = event.queryParameters || {};
 
    let body = event.body || '';
    if (event.isBase64Encoded && body) {
        body = Buffer.from(body, 'base64').toString('utf8');
    }
    let parsedBody = {};
    if (body) {
        try { parsedBody = JSON.parse(body); } catch (e) {}
    }
 
    // ... routing logic ...
 
    // Send response by returning a payload object
    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
        isBase64Encoded: false,
    };
};
```

### Response format

Return a plain object — do NOT call `resp.send()`:

```js
return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
    isBase64Encoded: false,
};
```

### Deployment

- **Always source `.env` before deploying** — `s.yaml` uses `${env(VAR)}` references for all secrets (DB_PASS, DASHSCOPE_API_KEY, WX_SECRET, API_BEARER_TOKEN, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET). Without sourcing, those vars resolve to empty strings and the deployed function breaks.
- Preferred commands (handle sourcing automatically):
  - `npm run deploy:worker` — deploys only the worker
  - `npm run deploy:dispatcher` — deploys only the dispatcher
- Manual equivalent: `source .env && s worker deploy -y`
- `s deploy` — deploys all functions; prefix with `source .env &&` if used directly
- FC 3.0 does not hot-reload; each deploy takes ~15 s before changes are live

### Local dev vs FC 3.0 parity

`scripts/local-dev.js` bridges Express → FC handler format by wrapping `req.body` in a Buffer and providing a minimal `resp` shim (`setStatusCode`, `setHeader`, `send`). Keep this shim in sync with any response API changes in the worker handler.

### `context` is empty for HTTP-triggered invocations — use env vars for credentials

Confirmed by live probe (2026-07-28) against the deployed HTTP-triggered worker: the third handler argument (`context` in `(req, resp, context)`) is an **empty object** — no `.credentials`, no `.region`, nothing. This differs from a Cron-triggered function (e.g. `dispatcher/index.js`, signature `(event, context)`), which reportedly reads `context.credentials.accessKeyId/accessKeySecret/securityToken` and `context.region` successfully — don't assume that pattern carries over to an HTTP trigger without checking.

If a handler needs Aliyun credentials (e.g. to call another Aliyun SDK like EventBridge's `putEvents`) from an HTTP-triggered function, use the runtime role's temporary STS credentials injected as plain env vars instead — confirmed present on every invocation regardless of trigger type:

```js
const ebConfig = new OpenApi.Config({
    accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    securityToken: process.env.ALIBABA_CLOUD_SECURITY_TOKEN,
    endpoint: `eventbridge.${process.env.FC_REGION}.aliyuncs.com`,
});
```

If in doubt for a new use case, don't guess — add a one-line temporary debug log (`console.log(JSON.stringify({keys: Object.keys(context||{})}))`), deploy, hit the endpoint once, check the log, then remove the probe. That's how this was confirmed.
