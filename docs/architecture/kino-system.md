# Kino Hardware System

The Kino hardware ecosystem consists of two distinct physical components — the reusable reader (Kino Device) and the disposable test chip (Kino Chip) — plus a third logical entity: the **Kino Chip Model**, a per-chip-type configuration record that drives scan processing. All three are modelled separately in the database and managed independently from the Admin Panel.

## Components

### Kino Device (Reusable)

A **Kino Device** is the reusable physical reader unit deployed at a clinic, coach studio, or partner location. It reads Kino Chips via NFC and transmits raw biomarker data to the API.

- Has a unique `serial_number` (e.g. `KNO-2024-0001`)
- Can be assigned to a **Coach** and/or a **Channel**
- Tracks a status: `active`, `inactive`, `maintenance`
- Every biomarker record ingested through a device records that device's `id` in `biomarkers.kino_device_id`

**DB table**: `kino_devices`

| Column | Type | Description |
|---|---|---|
| `id` | SERIAL | Primary key |
| `serial_number` | TEXT UNIQUE | Physical label on the unit |
| `name` | TEXT | Display name (e.g. "Clinic Unit A") |
| `coach_id` | INTEGER FK | Assigned coach (nullable) |
| `channel_id` | INTEGER FK | Assigned channel (nullable) |
| `status` | TEXT | `active` / `inactive` / `maintenance` |
| `notes` | TEXT | Free-form notes |
| `registered_at` | TIMESTAMPTZ | When first registered |

---

### Kino Chip (Disposable, Single-Use)

A **Kino Chip** is a disposable NFC test chip loaded with a biochemical reagent layer. Each chip is single-use: once it has been scanned by a user and the result submitted, its status becomes `used` and it cannot be re-analysed.

Chips are manufactured and issued in **batches**. Each batch has a prefix and a model number, and generates a sequential series of uniquely coded chips.

#### Chip Code Format

```
KNC{8-digit-batch-id}-{4-digit-sequence}
```

Example: `KNC12345678-0001` through `KNC12345678-0100`

- `KNC` — fixed prefix for all Kino Nano Chips
- `{8-digit-batch-id}` — random number generated at batch creation; unique per batch
- `{4-digit-sequence}` — sequential chip number within the batch (0001–9999)

The chip code is the value encoded in the chip's **QR code**. When a user scans the QR code with the WeChat Mini Program, the chip code is sent to `POST /kino-scan` to register the scan.

#### Chip Models

A chip's `model` (e.g. `K2`, `S1`) is a foreign key into the `kino_chip_models` table. The model record carries the per-chip-type scan configuration that the Kino Device firmware needs to process a raw NFC read into biomarker values, plus the list of biomarkers the chip is calibrated to produce.

See [Kino Chip Model](#kino-chip-model-configuration--driver) below.

#### Batch Limits

- Maximum chips per batch: **9,999**
- Batches with used chips cannot be deleted

**DB tables**: `kino_chip_batches`, `kino_chips`

**`kino_chip_batches`**

| Column | Type | Description |
|---|---|---|
| `id` | SERIAL | Primary key |
| `prefix` | TEXT UNIQUE | e.g. `KNC12345678` (auto-uppercased) |
| `model` | TEXT | Chip model (`K2`, `S1`) |
| `quantity` | INTEGER | Number of chips in the batch |
| `notes` | TEXT | Optional notes |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

**`kino_chips`**

| Column | Type | Description |
|---|---|---|
| `id` | SERIAL | Primary key |
| `batch_id` | INTEGER FK | Parent batch (`kino_chip_batches.id`) — CASCADE on delete |
| `chip_code` | TEXT UNIQUE | e.g. `KNC12345678-0001` — this IS the QR code value |
| `status` | TEXT | `available` / `used` / `damaged` |
| `created_at` | TIMESTAMPTZ | Generation timestamp |

---

### Kino Chip Model (Configuration / Driver)

A **Kino Chip Model** is the per-chip-type configuration that drives scan processing for every chip of that model. One row per chip type — `K2` is the current production chip, future variants (`K6`, `S1`, …) get their own row. Every `kino_chip_batches.model` is a foreign key into this table, so a batch cannot be created against a model that doesn't exist.

#### What a model row carries

- `biomarker_keys` — the ordered list of biomarkers the chip outputs (e.g. `['hsCRP']` for K2). Used by the API and Mini Program to know what to expect from a scan.
- `config` (JSONB) — the verbatim scan-processing config consumed by the Kino reader: `scan_ppmm`, `top_list` (signal regions), `var_list` (calibration coefficients), `cut_off*` thresholds, noise floors, etc. This is the same `card_config` shape used by the kone reader project, with Supabase row metadata stripped.
- `guide_video`, `guide_text` — optional onboarding assets surfaced when a user scans a chip of this model.
- `status` — `active` (selectable when creating a batch) or `inactive` (hidden from new batch creation but still resolvable for existing batches).

When the Mini Program calls `GET /kino-chip?chip_id=…`, the response joins through `kino_chips → kino_chip_batches → kino_chip_models` and returns `model`, `biomarker_keys`, `chip_config`, `guide_video`, `guide_text` alongside the scan/user fields.

#### `kino_chip_models`

| Column | Type | Description |
|---|---|---|
| `code` | TEXT PK | e.g. `K2`, `S1` (uppercase, 1–16 chars) |
| `name` | TEXT | Display name (e.g. `Kino K2 (hsCRP)`) |
| `biomarker_keys` | TEXT[] | Biomarkers produced by this chip (non-empty) |
| `config` | JSONB | Scan-processing config (see schema below) |
| `guide_video` | TEXT | Optional video URL |
| `guide_text` | TEXT | Optional onboarding text |
| `status` | TEXT | `active` (default) / `inactive` |
| `notes` | TEXT | Free-form internal notes |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | Auto-updated on PUT |

**FK constraint**: `kino_chip_batches.model REFERENCES kino_chip_models(code)` — preventing a model from being deleted while any batch still references it.

#### `config` JSONB schema

Mirrors the kone reader's `card_config`. Required keys:

- `scan_ppmm` — pixels-per-mm of the optical readout
- `top_list[]` — signal regions, one entry per zone: `{ id, index, start, end, ctrl?, name? }`
- `var_list[]` — piecewise-linear calibration: `{ id, index, start, end, x0, x1 }`
- `scope`, `type_score`, `cut_off1..cut_off_max`, `noise1..noise5`, `c_avg`, `c_std`, `c_min`, `c_max`, `ft0`, `xt1`, `ft1` — reader thresholds and noise/saturation parameters

The K2 seed config is committed verbatim to the migration; see `temp/migration_kino_chip_models.sql` for the exact values.

---

## Scan Flow (Nano Flow)

The Nano Flow is a streamlined, device-led sequence that integrates the Kino-One hardware directly with the Nano AI worker. Unlike the clinical flow, it is fully automated and returns biological age assessments in real-time.

```
1. Device Scans QR
   → GET /api/kino-chip?chip_id={id}
   ← Returns user profile + physical scan config (top_list, var_list)

2. Physical Scan
   → Device sampling & local signal processing
   → Concentration calculation (e.g. hsCRP)

3. AI Assessment
   → POST /api/biomarkers { openid, test_type: "kino_chip", test_data: {hsCRP: ...} }
   ← Returns BioAge + Sub-Ages + AI-estimated biomarkers

4. Finalisation
   → POST /api/kino-result { chip_id, bio_age, data }
   → Marks chip "used" and scan "completed"
```

For a detailed breakdown of the device-side implementation, see the [Nano Flow Integration](../../../kone/docs/NANO_FLOW.md) document in the Kone project.

---

## Admin Panel Management

Both components are managed under the **Kino** and **Chips** tabs in the web admin panel (`/admin/`).

### Kino Tab — Device Management

- Register a device with serial number, display name, assigned coach/channel, and status
- Edit assignment and status at any time
- Device deletion preserves historical biomarker links (`kino_device_id` set to NULL on delete)
- Stats: total devices, active devices, total tests performed

### Chips Tab

The Chips tab is split into two sub-tabs: **Batches** and **Models**.

#### Batches Sub-Tab — Batch Management

- **Add Batch**: pick a chip model from the dropdown (populated live from `kino_chip_models` where `status = 'active'`) and a quantity (1–9999); the batch code (`KNC{8-digits}`) is auto-generated; a preview shows the full range (e.g. `KNC12345678-0001 → KNC12345678-0100`)
- **View Chips** (QR icon): shows first 10 + last chip with rendered QR codes, plus a count of hidden chips
- **Download CSV**: downloads all chip codes for the batch as a plain text CSV (one code per line)
- **Print QR**: opens a print-ready A4 page with QR codes for the entire batch
- Batches with used chips cannot be deleted

#### Models Sub-Tab — Chip Model Management

Lists every row in `kino_chip_models` with usage stats (`batch_count`, `chip_count`) joined from `kino_chip_batches`. Each row shows code, display name, biomarker chips, status, and counts of batches/chips that reference it.

- **Add Model**: opens a form with fields for code (auto-uppercased, immutable after creation), display name, comma-separated biomarker keys, JSON config, optional guide video URL & text, status, and notes. Config is parsed and validated client-side as JSON; the server additionally enforces a non-empty `biomarker_keys` array.
- **Edit Model**: same form pre-filled. The `code` field is locked (it is the primary key and FK target). Saving issues `PUT /kino-chip-models/:code` with only the changed fields.
- **Delete Model**: blocked when `batch_count > 0` (the row UI disables the trash icon and the delete confirm shows the in-use count). Server-side, the FK constraint and an explicit count check both enforce this.
- **Status**: setting a model to `inactive` removes it from the model dropdown in the Add Batch flow but does not affect existing batches that reference it.

API: `GET / POST / PUT / DELETE /kino-chip-models[/:code]` — see [Worker API Endpoints](../api/worker-endpoints.md#kino-hardware-system).

---

## API Endpoints

See [Worker API Endpoints](../api/worker-endpoints.md#kino-devices) for the full endpoint reference.

---

## Migration

Schema files:

- `src/schemas/migration_kino_devices.sql` — `kino_devices` table + `biomarkers.kino_device_id` column
- `src/schemas/migration_kino_chips.sql` — `kino_chip_batches` + `kino_chips` tables
- `temp/migration_kino_chip_models.sql` — `kino_chip_models` table, K2 seed row, normalises existing `kino_chip_batches.model` to `'K2'`, and adds the FK `kino_chip_batches.model → kino_chip_models.code`. One-shot runner: `node temp/run-migration-kino-chip-models.js`.
