# Waven Nano AI Backend

# Project Rules
## 1. Project Context
- **Name:** Waven Nano AI (Precision Health Ecosystem)
- **Tech Stack:** Node.js (Latest LTS), PostgreSQL 14 (Aliyun PolarDB Serverless)
- **Architecture:** Serverless Event-Driven (Aliyun FC 3.0 + EventBridge)
- **Infrastructure:** All production code must respect Aliyun FC 3.0 constraints (max 24h runtime, stateless execution).

## 2. Core Technical Constraints
- **Database:** Use the `pg` library for raw SQL. **STRICTLY PROHIBITED:** No ORMs (like Prisma or TypeORM) to minimize cold-start latency and overhead.
- **SQL Standards:** PostgreSQL 14 compatible syntax. Use `ON CONFLICT` for upserts.
- **Messaging:** Follow **CloudEvents 1.0** standards for all event payloads.
- **AI Logic:** The AI Worker must decouple prompt engineering from execution. Prompts should be stored in `/prompts` as template files.

## 3. Directory Structure & Naming
- `/src/functions/dispatcher/`: FC 3.0 code for user scanning (Cron-triggered).
- `/src/functions/worker/`: FC 3.0 code for AI processing and WeChat notifications.
- `/src/lib/`: Shared logic (Database clients, WeChat API helpers).
- `/src/schemas/`: JSON Schema files for event validation.
- `/src/mini/nano-miniapp/`: WeChat Mini Program frontend (WXML/WXSS/JS, no build pipeline).
- `/tests/mocks/`: Local EventBridge and MNS simulation scripts.
- `/src/web/admin-panel`: Control Panel for Admin
- **File Naming:** kebab-case (e.g., `user-repository.js`).

## 4. Coding Standards (Node.js)
- **Style:** Modern ES Modules (`import/export`).
- **Error Handling:** Every async operation MUST be wrapped in a `try/catch` block.
- **Logging:** Use `console.log` for Aliyun CloudWatch integration, but format as JSON: `console.log(JSON.stringify({level: 'INFO', msg: '...', data: {}}))`.
- **Latency:** Keep the `lib/db.js` client outside the handler to leverage Aliyun container reuse.

## 5. Local Development & Testing
- Use `.env` for local variables. Never hardcode the PolarDB endpoint.
- **Command:** Run `npm run test:local` to trigger the `local-bus.js` harness.
- **Git:** Commit after every successful modular feature build. Do not bundle multiple components into one commit.

## 6. AI Interaction Rules
- Before suggesting a change, check `src/schemas/` to ensure you aren't breaking the event contract.
- If writing a new Aliyun FC handler, always provide the `s.yaml` (Serverless Devs) configuration snippet.
- Prioritize **token efficiency**: Don't rewrite entire files if only one function needs a fix.


## 8. Changelog for code changes
- CHANGELOG.md


## Aliyun Function Compute 3.0 (FC 3.0) Runtime Behavior
 
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
 
| Correct (FC 3.0)              | Wrong (will be undefined)                              |
|-------------------------------|--------------------------------------------------------|
| `event.rawPath`               | `event.path`, `req.path`, `req.url`                    |
| `event.queryParameters`       | `event.queryStringParameters`, `req.queries`, `req.query` |
| `event.requestContext.http.method` | `event.httpMethod`, `event.method`, `req.method`  |
| `event.headers`               | `req.headers`                                          |
 
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
 
- `s worker deploy` — deploys only the worker function, the syntax is 's worker deploy', not 's deploy worker' 
- `s deploy` — deploys all functions (dispatcher + worker)  
- Confirm trigger changes with `Y` when prompted, or use `-y` flag  
- FC 3.0 does not hot-reload; each deploy takes ~15 s before changes are live
 
### Local dev vs FC 3.0 parity
 
`scripts/local-dev.js` bridges Express → FC handler format by wrapping `req.body` in a Buffer and providing a minimal `resp` shim (`setStatusCode`, `setHeader`, `send`). Keep this shim in sync with any response API changes in the worker handler.