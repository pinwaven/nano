---
name: kino-hardware
description: Kino hardware system rules — reusable device vs consumable chips, scan flow, provisioning. Load when working on Kino scans, device/chip handling, or the miniapp Kino simulator.
---

Moved verbatim from `CLAUDE.md` on 2026-09-19 (section numbers kept; `§N` references point at `CLAUDE.md`).

## 13. Kino Hardware System

The Kino hardware ecosystem has two distinct physical components, managed separately.

### Kino Device (Reusable)

- Physical reader unit deployed at a clinic or partner location
- Table: `kino_devices` — serial number, name, coach/channel assignment, status (`active` / `inactive` / `maintenance`)
- Every biomarker record ingested via a device stores `kino_device_id` in `biomarkers.kino_device_id`
- Migration: `src/schemas/migration_kino_devices.sql`
- Admin Panel: **Kino** tab

### Kino Chip (Disposable, Single-Use)

- NFC test chip with biochemical reagent layer — one scan per chip
- Chips are issued in **batches**: each batch has a unique 8-digit code (`KNC{8digits}`) and a `model` that FK-references `kino_chip_models.code`
- **Chip code format:** `KNC{8-digit-batch}-{4-digit-sequence}` e.g. `KNC12345678-0001`
  - The chip code IS the QR code value scanned by the Mini Program
  - Max 9,999 chips per batch
- Tables: `kino_chip_batches` (prefix, model, quantity), `kino_chips` (chip_code, status)
- Chip status: `available` → `used` (after scan completed) or `damaged`
- Migration: `src/schemas/migration_kino_chips.sql`
- Admin Panel: **Chips** tab → **Batches** sub-tab — add batches, view QR codes, download CSV, print

### Kino Chip Model (per-chip-type config)

- Table `kino_chip_models` — one row per chip type (`K2`, future `K6`, `S1`, …). FK target of `kino_chip_batches.model`.
- Carries `biomarker_keys` (which biomarkers the chip outputs) and `config` JSONB (verbatim `card_config` consumed by the Kino reader: `scan_ppmm`, `top_list`, `var_list`, `cut_off*`, noise floors, …) plus optional `guide_video` / `guide_text` and a `status` (`active` / `inactive`).
- `GET /kino-chip` joins through to expose `model`, `biomarker_keys`, `chip_config`, `guide_video`, `guide_text` to the Mini Program at scan time.
- Migration: `temp/migration_kino_chip_models.sql` (one-shot runner: `node temp/run-migration-kino-chip-models.js`).
- Admin Panel: **Chips** tab → **Models** sub-tab — full CRUD; delete is blocked while any batch references the model. Inactive models are hidden from the Add Batch dropdown but still resolve for existing batches.
- Full details: `docs/architecture/kino-system.md`

### Scan Flow

```
QR scan in Mini Program → POST /kino-scan (links chip to user)
  → POST /biomarkers (raw values → BioAge calculation)
  → POST /kino-result (marks scan completed, chip becomes "used")
```

Full details: `docs/architecture/kino-system.md`
