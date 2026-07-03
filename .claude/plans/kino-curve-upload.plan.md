# Plan: Kino Curve Upload API

**Source PRD**: `.claude/prds/kino-curve-upload.prd.md`
**Selected Milestone**: All 4 — DB migration → parser module → endpoint wired → dev deploy
**Complexity**: Medium

## Summary

Add `POST /kino-curve` to the kino FC function. Authenticated Kino devices send `multipart/form-data` with a `qrcode` text field and a `curve_file` binary field. The handler decodes the FC 3.0 base64 body, parses the multipart manually (no external lib, simple 2-field payload), validates the 10-byte binary header + 13-bit ADC samples, and inserts one row into new table `kino_curve`. Follows the existing protected-device-route pattern exactly.

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| Handler file | `src/functions/kino/lib/deviceHandlers.js:365` | Each endpoint = one `async function handlePost*({ pool, body, machine })`, exported, registered in dispatch table |
| Route registration | `src/functions/kino/index.js:88` | Add to `isProtectedDeviceRoute()`, add `if` branch in `handleDeviceBusinessRequest()` |
| Error return | `src/functions/kino/lib/deviceHandlers.js:296` | `return { statusCode: 400, success: false, error: '...' }` — no throw across handler boundary |
| DB insert | `src/functions/kino/lib/deviceHandlers.js:462` | Raw `pool.query()` with `$1`-style params, `RETURNING id` |
| Migration style | `src/schemas/migration_kino_chips.sql:1` | `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` |
| Test structure | `tests/kino-device-handlers.test.js:1` | `node:test` + `node:assert`, mock pool with `async query(sql, params)` |
| Test location | `tests/kino-*.test.js` | Flat `tests/` directory, file name `kino-{feature}.test.js` |

## Files to Change

| File | Action | Why |
|---|---|---|
| `src/schemas/migration_kino_curve.sql` | CREATE | New `kino_curve` table definition |
| `src/functions/kino/lib/curveParser.js` | CREATE | Pure binary parser — `parseBinCurve(buffer)` |
| `src/functions/kino/lib/curveHandler.js` | CREATE | `handlePostKinoCurve({ pool, rawBody, contentType, machine })` |
| `src/functions/kino/index.js` | UPDATE | Add route to `isProtectedDeviceRoute()` + dispatch in `handleDeviceBusinessRequest()` |
| `src/functions/kino/lib/deviceHandlers.js` | UPDATE | Add `handlePostKinoCurve` import + `if` branch (or keep in curveHandler, just wire index) |
| `tests/kino-curve-parser.test.js` | CREATE | Unit tests for `parseBinCurve` — valid bins, bad magic bytes, length mismatch, out-of-range ADC |
| `tests/kino-curve-handler.test.js` | CREATE | Integration-style tests for `handlePostKinoCurve` with mock pool |

## Tasks

### Task 1: DB Migration

- **Action**: Create `src/schemas/migration_kino_curve.sql`

```sql
CREATE TABLE IF NOT EXISTS kino_curve (
    id            SERIAL PRIMARY KEY,
    kino_device_id INTEGER REFERENCES kino_devices(id) ON DELETE SET NULL,
    chip_code      TEXT NOT NULL,
    curve          INTEGER[] NOT NULL,
    reference_values JSONB NOT NULL DEFAULT '{}',
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kino_curve_chip_code      ON kino_curve(chip_code);
CREATE INDEX IF NOT EXISTS idx_kino_curve_kino_device_id ON kino_curve(kino_device_id);
CREATE INDEX IF NOT EXISTS idx_kino_curve_created_at     ON kino_curve(created_at);
```

- **Mirror**: `src/schemas/migration_kino_chips.sql` — same `IF NOT EXISTS` + index pattern
- **Validate**: `npm run migrate:dev` exits 0; `kino_curve` visible in dev DB

### Task 2: Binary Parser Module

- **Action**: Create `src/functions/kino/lib/curveParser.js`

```js
'use strict';

const MAGIC_5A = 0x5a;
const MAGIC_A5 = 0xa5;
const HEADER_BYTES = 10;
const ADC_MAX = 0x1fff;

function parseBinCurve(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < HEADER_BYTES) {
    throw Object.assign(new Error('binary too short'), { code: 'HEADER_TOO_SHORT' });
  }

  const dataLen        = buffer.readUInt16LE(0);
  const laserCurr      = buffer.readUInt16LE(2);
  const fixed5a        = buffer.readUInt8(4);
  const dataBias       = buffer.readUInt16LE(5);
  const laserCurrBias  = buffer.readUInt16LE(7);
  const fixedA5        = buffer.readUInt8(9);

  if (fixed5a !== MAGIC_5A) {
    throw Object.assign(new Error(`invalid magic byte at offset 4: 0x${fixed5a.toString(16)}`), { code: 'BAD_MAGIC_5A' });
  }
  if (fixedA5 !== MAGIC_A5) {
    throw Object.assign(new Error(`invalid magic byte at offset 9: 0x${fixedA5.toString(16)}`), { code: 'BAD_MAGIC_A5' });
  }

  const dataBytes = buffer.length - HEADER_BYTES;
  if (dataBytes !== dataLen * 2) {
    throw Object.assign(
      new Error(`data length mismatch: header says ${dataLen} samples (${dataLen * 2} bytes), got ${dataBytes} bytes`),
      { code: 'LENGTH_MISMATCH' }
    );
  }

  const curve = new Array(dataLen);
  for (let i = 0; i < dataLen; i++) {
    const value = buffer.readUInt16LE(HEADER_BYTES + i * 2);
    if (value > ADC_MAX) {
      throw Object.assign(
        new Error(`invalid 13-bit ADC value at sample ${i}: 0x${value.toString(16)}`),
        { code: 'ADC_OUT_OF_RANGE' }
      );
    }
    curve[i] = value;
  }

  return {
    curve,
    referenceValues: { dataLen, laserCurr, dataBias, laserCurrBias },
  };
}

module.exports = { parseBinCurve };
```

- **Mirror**: pure-function module style like `BiomarkerEstimator` — no side effects, throws on bad input
- **Validate**: `node --test tests/kino-curve-parser.test.js`

### Task 3: Multipart Parser Utility (inline in curveHandler)

- **Action**: Inside `curveHandler.js`, implement `parseMultipart(buffer, boundary)` without external deps

FC 3.0 delivers body as base64. Extract qrcode text + curve binary this way:

```js
function parseMultipart(buffer, boundary) {
  const sep = Buffer.from(`--${boundary}`);
  const crlf = Buffer.from('\r\n');
  const parts = {};
  let pos = 0;

  while (pos < buffer.length) {
    const sepIdx = buffer.indexOf(sep, pos);
    if (sepIdx === -1) break;
    pos = sepIdx + sep.length;
    if (buffer[pos] === 0x2d && buffer[pos + 1] === 0x2d) break; // --boundary--
    pos += 2; // skip \r\n after boundary

    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), pos);
    if (headerEnd === -1) break;
    const headerStr = buffer.slice(pos, headerEnd).toString('utf8');
    pos = headerEnd + 4;

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    const nextSep = buffer.indexOf(sep, pos);
    const bodyEnd = nextSep === -1 ? buffer.length : nextSep - 2; // strip trailing \r\n
    parts[name] = buffer.slice(pos, bodyEnd);
    pos = bodyEnd;
  }
  return parts;
}
```

- **Mirror**: no external deps — kino `package.json` only has `pg`; adding busboy would require `npm install` and redeploy cold-start cost
- **Validate**: handler unit test passes with synthetic multipart buffer

### Task 4: Curve Handler

- **Action**: Create `src/functions/kino/lib/curveHandler.js`

```js
'use strict';

const { parseBinCurve } = require('./curveParser');

// [parseMultipart implementation here — see Task 3]

async function handlePostKinoCurve({ pool, rawBody, contentType, machine }) {
  const boundaryMatch = (contentType || '').match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) {
    return { statusCode: 400, success: false, error: 'missing_multipart_boundary' };
  }
  const boundary = boundaryMatch[1];

  const buffer = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody || ''), 'base64');

  const parts = parseMultipart(buffer, boundary);

  const qrcode = parts.qrcode ? parts.qrcode.toString('utf8').trim() : null;
  if (!qrcode) {
    return { statusCode: 400, success: false, error: 'qrcode_required' };
  }

  const curveFile = parts.curve_file;
  if (!curveFile || curveFile.length === 0) {
    return { statusCode: 400, success: false, error: 'curve_file_required' };
  }

  let parsed;
  try {
    parsed = parseBinCurve(curveFile);
  } catch (err) {
    return { statusCode: 422, success: false, error: err.message, code: err.code };
  }

  const result = await pool.query(
    `INSERT INTO kino_curve (kino_device_id, chip_code, curve, reference_values)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [machine.id, qrcode, parsed.curve, JSON.stringify(parsed.referenceValues)]
  );

  console.log(JSON.stringify({
    level: 'INFO',
    msg: 'kino_curve stored',
    data: { id: result.rows[0].id, chip_code: qrcode, samples: parsed.curve.length, device_id: machine.id },
  }));

  return { success: true, id: result.rows[0].id };
}

module.exports = { handlePostKinoCurve };
```

- **Mirror**: `handlePostKinoResult` — same param shape `{ pool, body/rawBody, machine }`, same log format
- **Validate**: `node --test tests/kino-curve-handler.test.js`

### Task 5: Wire into index.js

- **Action**: Two edits to `src/functions/kino/index.js`

**Edit 1** — add import at top:
```js
const { handlePostKinoCurve } = require('./lib/curveHandler');
```

**Edit 2** — extend `isProtectedDeviceRoute`:
```js
(method === 'POST' && path === '/kino-curve') ||
```

**Edit 3** — add to `handleDeviceBusinessRequest` in `deviceHandlers.js` call-through, OR add directly in `index.js` before the `isProtectedDeviceRoute` block:

In `index.js`, inside the `try` block, before the `isProtectedDeviceRoute` check:

```js
} else if (method === 'POST' && path === '/kino-curve') {
  result = await handleProtectedDeviceRequest({
    pool,
    commToken: getBearerToken(event),
    event,
    handler: ({ machine }) => handlePostKinoCurve({
      pool,
      rawBody: event.body,
      contentType: getHeader(event.headers || {}, 'content-type'),
      machine,
    }),
  });
}
```

Note: Wire as separate `else if` in `index.js` rather than routing through `handleDeviceBusinessRequest` — the handler needs raw `event.body` (not `parseBody(event.body)`) and `content-type` header directly.

- **Mirror**: `handleExchangeToken` call-style in `index.js:145` — inline auth + handler call
- **Validate**: `node --test tests/kino-curve-handler.test.js` + manual `curl` test against local dev

### Task 6: Tests

**`tests/kino-curve-parser.test.js`** — unit test `parseBinCurve`:

```js
const assert = require('node:assert');
const { describe, test } = require('node:test');
const { parseBinCurve } = require('../src/functions/kino/lib/curveParser');

function buildBin({ dataLen = 3, laserCurr = 100, dataBias = 200, laserCurrBias = 50, samples = [10, 20, 30] } = {}) {
  const buf = Buffer.alloc(10 + samples.length * 2);
  buf.writeUInt16LE(dataLen, 0);
  buf.writeUInt16LE(laserCurr, 2);
  buf.writeUInt8(0x5a, 4);
  buf.writeUInt16LE(dataBias, 5);
  buf.writeUInt16LE(laserCurrBias, 7);
  buf.writeUInt8(0xa5, 9);
  samples.forEach((v, i) => buf.writeUInt16LE(v, 10 + i * 2));
  return buf;
}

describe('parseBinCurve', () => {
  test('parses valid binary correctly', () => {
    const result = parseBinCurve(buildBin());
    assert.deepStrictEqual(result.curve, [10, 20, 30]);
    assert.strictEqual(result.referenceValues.laserCurr, 100);
    assert.strictEqual(result.referenceValues.dataBias, 200);
    assert.strictEqual(result.referenceValues.laserCurrBias, 50);
  });

  test('rejects bad 0x5a magic', () => {
    const buf = buildBin();
    buf.writeUInt8(0xff, 4);
    assert.throws(() => parseBinCurve(buf), { code: 'BAD_MAGIC_5A' });
  });

  test('rejects bad 0xa5 magic', () => {
    const buf = buildBin();
    buf.writeUInt8(0xff, 9);
    assert.throws(() => parseBinCurve(buf), { code: 'BAD_MAGIC_A5' });
  });

  test('rejects length mismatch', () => {
    const buf = buildBin({ dataLen: 5, samples: [1, 2, 3] });
    assert.throws(() => parseBinCurve(buf), { code: 'LENGTH_MISMATCH' });
  });

  test('rejects ADC value > 0x1FFF', () => {
    const buf = buildBin({ dataLen: 1, samples: [0x2000] });
    assert.throws(() => parseBinCurve(buf), { code: 'ADC_OUT_OF_RANGE' });
  });

  test('rejects buffer shorter than header', () => {
    assert.throws(() => parseBinCurve(Buffer.alloc(5)), { code: 'HEADER_TOO_SHORT' });
  });
});
```

**`tests/kino-curve-handler.test.js`** — handler tests with mock pool (pattern mirrors `kino-device-handlers.test.js`).

- **Validate**: `node --test tests/kino-curve-parser.test.js tests/kino-curve-handler.test.js`

### Task 7: Apply migration to dev

```bash
npm run migrate:dev
```

- **Validate**: check `npm run migrate:status` shows migration applied

## Validation

```bash
# Run parser unit tests
node --test tests/kino-curve-parser.test.js

# Run handler tests  
node --test tests/kino-curve-handler.test.js

# Apply migration to dev
npm run migrate:dev

# Deploy to dev
npm run deploy:worker  # (only if kino function shares worker deploy; else check s.yaml)
```

> Check `s.yaml` — kino may deploy separately (no `deploy:kino` script exists currently; may need `source .env && s kino deploy -y`).

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| FC 3.0 body is base64 but `isBase64Encoded` could be false for small payloads | Medium | Handler tries both: if `isBase64Encoded` flag is true → base64-decode, else treat as raw binary Buffer |
| Content-Type boundary may be quoted (`boundary="abc"`) | Low | Regex `boundary=["']?([^\s;"']+)` to strip optional quotes |
| `kino-curve` deploy script missing in `package.json` | Medium | Check `s.yaml` for function name; add `deploy:kino` npm script if needed |
| Multipart field order not guaranteed | Low | Parse all parts into map by name — order-independent already |

## Acceptance

- [ ] `kino_curve` table exists in dev after `npm run migrate:dev`
- [ ] `parseBinCurve` passes all 6 unit tests
- [ ] `handlePostKinoCurve` passes handler tests
- [ ] `POST /kino-curve` returns 401 without valid comm_token
- [ ] `POST /kino-curve` with valid comm_token + valid .bin returns `{ success: true, id: <n> }`
- [ ] Row appears in dev DB `kino_curve` with correct `chip_code`, `curve[]`, `reference_values`
- [ ] Invalid magic bytes return 422 with error code
