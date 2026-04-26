# Kino Hardware System

The Kino hardware ecosystem consists of two distinct physical components that work together to capture user biomarker data. They are modelled separately in the database and managed independently from the Admin Panel.

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

| Model | Description |
|---|---|
| `K2` | Standard full-panel chip (default) |
| `S1` | Slim single-biomarker chip |

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

## Data Flow

```
Admin creates chip batch
  → kino_chip_batches row inserted
  → N kino_chips rows generated (KNC{batch}-0001 … KNC{batch}-{N})

User scans QR code in Mini Program
  → POST /kino-scan  { openid, chip_id: "KNC12345678-0042" }
  → scans row created (chip_id = chip_code, status = "pending")

Kino Device reads biomarkers
  → POST /biomarkers  { openid, test_type: "kino_chip", test_data: {...}, kino_device_id }
  → BiomarkerEstimator fills missing values
  → BioAgeCalculator computes BioAge + SubAges
  → biomarkers row inserted (kino_device_id links back to device)

Result finalised
  → POST /kino-result  { chip_id, bio_age, data, kino_device_id }
  → scans row updated to status = "completed"
  → kino_chips.status updated to "used"
```

---

## Admin Panel Management

Both components are managed under the **Kino** and **Chips** tabs in the web admin panel (`/admin/`).

### Kino Tab — Device Management

- Register a device with serial number, display name, assigned coach/channel, and status
- Edit assignment and status at any time
- Device deletion preserves historical biomarker links (`kino_device_id` set to NULL on delete)
- Stats: total devices, active devices, total tests performed

### Chips Tab — Batch Management

- **Add Batch**: specify model (K2/S1) and quantity (1–9999); the batch code (`KNC{8-digits}`) is auto-generated; a preview shows the full range (e.g. `KNC12345678-0001 → KNC12345678-0100`)
- **View Chips** (QR icon): shows first 10 + last chip with rendered QR codes, plus a count of hidden chips
- **Download CSV**: downloads all chip codes for the batch as a plain text CSV (one code per line)
- **Print QR**: opens a print-ready A4 page with QR codes for the entire batch
- Batches with used chips cannot be deleted

---

## API Endpoints

See [Worker API Endpoints](../api/worker-endpoints.md#kino-devices) for the full endpoint reference.

---

## Migration

Schema files:

- `src/schemas/migration_kino_devices.sql` — `kino_devices` table + `biomarkers.kino_device_id` column
- `src/schemas/migration_kino_chips.sql` — `kino_chip_batches` + `kino_chips` tables
