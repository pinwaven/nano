# Kino FC3.0 Device Auth Plan

## Capability

Add a dedicated FC3.0 function at `src/functions/kino` as the device-side entry point for Kino hardware. This function owns machine registration, activation, root-token management, 7-day communication-token exchange, and authenticated device access to Kino chip/result/upgrade APIs.

After this ships:

- Admin Panel can batch-create inactive machine numbers.
- Admin Panel can update machine name, active state, channel assignment, coach assignment, and machine notes.
- A device can activate with a fixed activation token, bind its mainboard ID and firmware ID, and receive both a long-lived root token and a short-lived communication token.
- A device can exchange its root token for a new communication token when the communication token expires.
- Device-facing Kino APIs require a valid communication token.

## Fixed Rules

- New FC3.0 function directory: `src/functions/kino`.
- Communication token lifetime defaults to 7 days and must be configurable, not hardcoded.
- Machine-number batch quantity must be between 1 and 899.
- Machine-number generation uses China Shanghai time.
- Machine-number format: `{MODEL}-{YEAR_LETTER}{MM}{SEQ}`.
- Example: `KNA1-F05103`.
- `MODEL` is uppercased.
- `2021 = A`, `2026 = F`, `2046 = Z`.
- Month is two digits, e.g. `05`.
- Sequence starts at `101`.
- Root token is stored by the device and is used only to exchange for a communication token.
- Communication token is used for normal device API calls.

## Suggested Configuration

Add environment variables/config entries for the new Kino function:

- `KINO_COMM_TOKEN_TTL_DAYS=7`
- `KINO_ACTIVATION_TOKEN`
- `KINO_ROOT_TOKEN_ENCRYPTION_KEY`
- `KINO_TOKEN_BYTES=32` if token length should be configurable

The existing FC deployment config should be updated in both `s.yaml` and `s-prod.yaml` when implementation begins.

## Data Model

Extend the existing `kino_devices` table instead of adding a new machine table. The existing `serial_number` column stores the external machine number, and the existing `name` column stores the editable machine name.

Table: `kino_devices`

Existing columns used:

- `id`
- `serial_number` unique, exposed by API as `machine_no`, e.g. `KNA1-F05103`
- `name`, exposed by API as `machine_name`
- `status`
- `channel_id`
- `coach_id`
- `notes`
- `registered_at`
- `created_at`

Columns to add:

- `model`
- `production_year`
- `production_month`
- `sequence_no`
- `year_letter`
- `mainboard_id` unique nullable
- `firmware_id` unique nullable
- `software_version`
- `firmware_version`
- `root_token_hash`
- `root_token_ciphertext`
- `comm_token_hash`
- `comm_token_expires_at`
- `activated_at`
- `last_seen_at`
- `created_at`
- `updated_at`

Suggested constraints:

- `serial_number` unique
- `mainboard_id` unique where not null
- `firmware_id` unique where not null
- `(model, production_year, production_month, sequence_no)` unique
- `channel_id` references `channels(id)` with `ON DELETE SET NULL`
- `coach_id` references `coaches(id)` with `ON DELETE SET NULL`

Communication tokens should be stored as hashes, not plaintext. Root tokens should be stored as both a hash for verification and encrypted ciphertext for activation responses that need to return the existing root token without reissuing it.

## API Contract

### Batch Create Machine Numbers

Admin-facing endpoint:

```http
POST /kino-machines/batch
```

Request:

```json
{
  "model": "KNA1",
  "quantity": 3
}
```

Rules:

- `model` is required and uppercased.
- `quantity` must be an integer from 1 to 899.
- Use Shanghai time to compute year letter and month.
- For the same model/year/month, continue from the current maximum `sequence_no`.
- If no existing rows exist for that model/year/month, start at `101`.
- Create rows with `status = inactive`.
- Run inside a database transaction.
- Use uniqueness constraints and retry/locking to avoid duplicate machine numbers under concurrent requests.

Response:

```json
{
  "success": true,
  "machines": [
    { "machine_no": "KNA1-F05101", "status": "inactive" },
    { "machine_no": "KNA1-F05102", "status": "inactive" }
  ]
}
```

### Update Machine Management Fields

Admin-facing endpoint:

```http
PUT /kino-machines/:id
```

or, if the Admin Panel prefers machine numbers as stable external IDs:

```http
PUT /kino-machines/:machine_no
```

Request:

```json
{
  "machine_name": "Clinic Reader A",
  "status": "active",
  "channel_id": 12,
  "coach_id": 34,
  "notes": "Assigned to Shanghai clinic front desk"
}
```

Rules:

- All fields are optional, but at least one update field is required.
- `machine_name` is editable after activation.
- `status` supports `inactive`, `active`, and `disabled`.
- `disabled` machines cannot authenticate with communication tokens or exchange root tokens.
- `active` means the machine is allowed to authenticate if its token is valid.
- `inactive` is the default for pre-generated unactivated machines.
- `channel_id` must reference an existing channel when provided.
- `coach_id` must reference an existing coach when provided.
- `notes` is free-form operator text.
- Updating `channel_id` or `coach_id` should not modify historical biomarker records.

Response:

```json
{
  "success": true,
  "machine": {
    "id": 1,
    "machine_no": "KNA1-F05103",
    "machine_name": "Clinic Reader A",
    "status": "active",
    "channel_id": 12,
    "coach_id": 34,
    "notes": "Assigned to Shanghai clinic front desk"
  }
}
```

Suggested listing endpoint for Admin Panel:

```http
GET /kino-machines
```

Suggested filters:

- `model`
- `status`
- `channel_id`
- `coach_id`
- `q` for machine number/name search

Suggested response fields:

- machine identity fields
- activation state
- channel and coach display names
- `last_seen_at`
- token expiry status
- notes

### Activate Machine

Device-facing endpoint:

```http
POST /activate
```

Authentication:

```http
Authorization: Bearer ${KINO_ACTIVATION_TOKEN}
```

Request:

```json
{
  "mainboard_id": "mainboard-001",
  "firmware_id": "firmware-001",
  "model": "KNA1"
}
```

Behavior:

- If a machine is found where both `mainboard_id` and `firmware_id` match, return that machine and issue or refresh the communication token.
- If only `mainboard_id` matches, return an explicit `firmware_id_mismatch` error.
- If only `firmware_id` matches, return an explicit `mainboard_id_mismatch` error.
- If neither ID matches:
  - Find an inactive machine number for the requested model.
  - Bind `mainboard_id` and `firmware_id`.
  - Generate a root token.
  - Generate a communication token.
  - Mark the machine `active`.
  - Return machine info and tokens.

Success response:

```json
{
  "success": true,
  "machine": {
    "machine_no": "KNA1-F05103",
    "machine_name": "KNA1-F05103",
    "model": "KNA1"
  },
  "root_token": "...",
  "comm_token": "...",
  "comm_token_expires_at": "2026-06-09T00:00:00.000Z"
}
```

Mismatch response examples:

```json
{
  "success": false,
  "error": "firmware_id_mismatch"
}
```

```json
{
  "success": false,
  "error": "mainboard_id_mismatch"
}
```

If there is no inactive machine number available for the requested model, return:

```json
{
  "success": false,
  "error": "no_available_machine_no"
}
```

This behavior should be confirmed before implementation.

### Exchange Communication Token

Device-facing endpoint:

```http
POST /token/exchange
```

Authentication:

```http
Authorization: Bearer ${root_token}
```

Behavior:

- Validate the root token by hashing the Bearer token and matching `kino_devices.root_token_hash`.
- Reject missing or invalid root tokens with `invalid_root_token`.
- Reject machines whose `status` is not `active` with `machine_not_active`.
- Generate a new communication token.
- Hash and store the new communication token.
- Set `comm_token_expires_at = now + KINO_COMM_TOKEN_TTL_DAYS`.
- Update `last_seen_at` and `updated_at`.
- Return the machine info, new token, and expiry.

Response:

```json
{
  "success": true,
  "machine": {
    "machine_no": "KNA1-F05103",
    "machine_name": "KNA1-F05103",
    "model": "KNA1",
    "status": "active"
  },
  "comm_token": "...",
  "comm_token_expires_at": "2026-06-09T00:00:00.000Z"
}
```

### Communication-Token Protected APIs

Move these device-facing endpoints into `src/functions/kino` and require a valid communication token:

- `GET /kino-chip?chip_id=__ping__`
- `GET /kino-chip?chip_id={chipId}`
- `POST /biomarkers`
- `POST /kino-result`
- `POST /kino-machines/info`
- `POST /kino-curve`
- `GET /kino-upgrade`

Authentication:

```http
Authorization: Bearer ${comm_token}
```

Validation:

- Token hash must match an active machine.
- Machine `status` must be `active`.
- `comm_token_expires_at` must be greater than the current time.
- Update `last_seen_at` on successful authenticated requests.

Expired-token response:

```json
{
  "success": false,
  "error": "comm_token_expired"
}
```

### Upload Raw ADC Curve Data

Device-facing endpoint:

```http
POST /kino-curve
```

Authentication:

```http
Authorization: Bearer ${comm_token}
```

Request: `multipart/form-data` with three fields:

| Field | Type | Description |
|---|---|---|
| `qrcode` | text | Chip code (e.g. `KNC12345678-0001`) — the QR code value scanned from the chip |
| `reference_values` | text (JSON) | Calibration and metadata JSON string provided by the device (e.g. `{"laserCurr":100,"dataBias":200}`) |
| `curve_file` | binary | Raw `.bin` file read from the chip sensor |

**Binary format** (little-endian):

| Offset | Length | Field | Notes |
|---|---|---|---|
| 0 | 2 bytes | `dataLen` | uint16 — number of 13-bit ADC samples |
| 2 | 2 bytes | `laserCurr` | uint16 — laser current |
| 4 | 1 byte | fixed `0x5A` | validation marker |
| 5 | 2 bytes | `dataBias` | uint16 — data bias |
| 7 | 2 bytes | `laserCurrBias` | uint16 — laser current bias |
| 9 | 1 byte | fixed `0xA5` | validation marker |
| 10+ | `dataLen × 2` bytes | ADC samples | uint16 LE each, must be ≤ `0x1FFF` (13-bit) |

Validation rules:

- Byte 4 must equal `0x5A`; byte 9 must equal `0xA5` — reject with 422 if either fails.
- Remaining bytes after header must equal `dataLen × 2` — reject with 422 on mismatch.
- Each uint16 sample must be ≤ `0x1FFF` — reject with 422 if any sample exceeds 13-bit range.

Stored in table `kino_curve`:

- `kino_device_id` — from authenticated comm token
- `chip_code` — from `qrcode` field
- `curve` — `integer[]` of parsed ADC values (from binary)
- `reference_values` — JSON stored as-is from `reference_values` field (device-supplied, not derived from binary header)

Success response:

```json
{
  "success": true,
  "id": 42
}
```

Parse error response (422):

```json
{
  "success": false,
  "error": "invalid magic byte at offset 4: 0xff",
  "code": "BAD_MAGIC_5A"
}
```

Validation error response (400):

```json
{
  "success": false,
  "error": "reference_values_required"
}
```

```json
{
  "success": false,
  "error": "reference_values_invalid_json"
}
```

Binary parse error codes: `HEADER_TOO_SHORT`, `BAD_MAGIC_5A`, `BAD_MAGIC_A5`, `LENGTH_MISMATCH`, `ADC_OUT_OF_RANGE`.

Implementation: `src/functions/kino/lib/curveParser.js` (binary parser), `src/functions/kino/lib/curveHandler.js` (handler + multipart parser).
Migration: `src/schemas/migration_kino_curve.sql`.

### Upload Machine Software/Firmware Versions

Device-facing endpoint:

```http
POST /kino-machines/info
```

Authentication:

```http
Authorization: Bearer ${comm_token}
```

Request:

```json
{
  "software_version": "2.4.1",
  "firmware_version": "1.8.0"
}
```

Rules:

- Identify the machine from the communication token; ignore any machine identifier in the request body.
- `software_version` and `firmware_version` are optional individually, but at least one must be provided.
- Trim version strings and reject version values longer than 128 characters.
- Update `kino_devices.software_version`, `kino_devices.firmware_version`, `last_seen_at`, and `updated_at`.
- Return the authenticated machine info including the stored software and firmware versions.

Response:

```json
{
  "success": true,
  "machine": {
    "id": 1,
    "machine_no": "KNA1-F05103",
    "machine_name": "KNA1-F05103",
    "model": "KNA1",
    "status": "active",
    "software_version": "2.4.1",
    "firmware_version": "1.8.0"
  }
}
```

## Migration Strategy

1. Extend `kino_devices` with FC3.0 activation and token lifecycle columns.
2. Add the new `src/functions/kino` function package and shared DB/token helpers.
3. Add `kino` to `s.yaml` and `s-prod.yaml`.
4. Implement machine-number batch creation.
5. Implement Admin Panel machine listing and update fields.
6. Implement activation.
7. Implement root-token exchange.
8. Move or wrap existing worker handlers for:
   - `kino-chip`
   - `biomarkers`
   - `kino-result`
   - `kino-upgrade`
9. Implement `POST /kino-machines/info` for authenticated software/firmware version uploads.
10. Implement `POST /kino-curve` for raw ADC curve binary upload (`kino_curve` table).
11. Require communication-token authentication in the Kino function.
12. Keep the old worker endpoints temporarily if device backward compatibility is required.
13. Remove or lock down old anonymous worker access after device rollout is complete.

## Tests

Required focused tests:

- Machine number generation:
  - model uppercasing
  - Shanghai-time year/month derivation
  - 2021/A, 2026/F, 2046/Z mapping
  - sequence starts at 101
  - sequence continues from existing max
  - quantity rejects values over 899
- Activation:
  - both IDs match existing active machine
  - only mainboard ID matches
  - only firmware ID matches
  - neither ID matches and inactive machine is available
  - neither ID matches and no inactive machine is available
- Machine management:
  - machine name update
  - status update
  - disabled machine cannot authenticate
  - channel assignment
  - coach assignment
  - notes update
- Token exchange:
  - valid root token returns new communication token
  - invalid root token rejected
  - communication-token expiry uses config value
- Protected endpoints:
  - missing token rejected
  - invalid token rejected
  - expired token rejected
  - valid token allows existing business behavior
  - software/firmware version upload uses the token-authenticated machine id
- Curve upload (`POST /kino-curve`):
  - valid binary parses and inserts to `kino_curve`
  - bad `0x5A` magic byte rejected with `BAD_MAGIC_5A`
  - bad `0xA5` magic byte rejected with `BAD_MAGIC_A5`
  - data length mismatch rejected with `LENGTH_MISMATCH`
  - ADC value > `0x1FFF` rejected with `ADC_OUT_OF_RANGE`
  - missing `qrcode` field returns 400
  - missing `reference_values` field returns 400
  - invalid JSON in `reference_values` returns 400
  - missing `curve_file` field returns 400

## Non-Goals

This capability should not change:

- Kino chip batch code generation.
- `kino_chip_models` schema or config semantics.
- Mini Program `kino-scan` user QR flow.
- BioAge or biomarker estimation logic.
- Admin Panel UI unless a later task explicitly requests it.

## Open Questions

1. If activation receives two unseen IDs and no inactive machine number exists, should the server auto-create a machine number or return `no_available_machine_no`?
2. Should `machine_name` default to `machine_no`, or should Admin Panel set it separately?
3. Should Admin Panel batch creation use the same fixed token as device activation, or a separate admin auth path?
4. Is the root token intended to be permanent, or should there be revocation/reset support in the first version?
5. How long must the old `/api/...` worker endpoints remain compatible after the Kino function ships?
