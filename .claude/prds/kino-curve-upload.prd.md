# Kino Curve Upload API

## Problem

The Kino hardware device reads a raw optical ADC curve from the disposable chip sensor during a scan. This binary waveform data (the raw fluorescence signal) is currently discarded on-device — there is no API to persist it. Without it, retrospective analysis of scan quality, sensor calibration drift, and reagent lot-to-lot variance is impossible.

## Evidence

- Requirement from hardware team: Kotlin parsing algorithm provided directly by device developer — confirms the binary format is already defined and stable.
- Assumption — downstream analytical value (calibration, QC) needs validation via data science review once stored.

## Users

- **Primary**: Kino hardware reader devices (authenticated via `comm_token`), uploading curve data immediately after a chip scan.
- **Not for**: Mini Program users, admin panel operators, or any human actor — this is a machine-to-server upload only.

## Hypothesis

We believe **a `POST /kino-curve` endpoint that accepts the QR code and raw binary file, parses the ADC waveform, and stores it in `kino_curve`** will **preserve the full optical curve for each scan** for **authenticated Kino devices**.
We'll know we're right when every completed chip scan has a corresponding `kino_curve` row retrievable by `chip_code`.

## Success Metrics

| Metric | Target | How measured |
|---|---|---|
| Parse success rate | ≥ 99% for well-formed bins | Error log count in CloudWatch |
| Endpoint p99 latency | < 500 ms | FC monitoring |
| Data completeness | 1 row per scan | `kino_curve` count vs `biomarkers` count |

## Scope

**MVP** — Single endpoint in `src/functions/kino/` that:

1. Authenticates the calling device via `comm_token` (existing `handleProtectedDeviceRequest`).
2. Accepts `multipart/form-data` with fields:
   - `qrcode` — chip code string (maps to `kino_chips.chip_code`)
   - `curve_file` — raw binary `.bin` file
3. Parses the binary using the ported Kotlin algorithm:
   - Reads 10-byte header (little-endian):
     - bytes 0–1: `dataLen` (uint16) — number of 2-byte ADC samples
     - bytes 2–3: `laserCurr` (uint16)
     - byte 4: fixed `0x5A` — reject if mismatch
     - bytes 5–6: `dataBias` (uint16)
     - bytes 7–8: `laserCurrBias` (uint16)
     - byte 9: fixed `0xA5` — reject if mismatch
   - Validates remaining bytes length = `dataLen × 2`
   - Parses each uint16-LE sample; rejects any value > `0x1FFF` (13-bit ADC max)
4. Stores one row in `kino_curve`:
   - `kino_device_id` — from auth context
   - `chip_code` — from `qrcode` field
   - `curve` — `integer[]` of parsed ADC values
   - `reference_values` — JSON of header fields `{ dataLen, laserCurr, dataBias, laserCurrBias }`
   - `created_at`, `updated_at`
5. Returns `{ success: true, id: <row_id> }` on success, or structured error on parse/validation failure.

**Migration**: New file `src/schemas/migration_kino_curve.sql` with `CREATE TABLE IF NOT EXISTS kino_curve (...)`.

**Out of scope**

- Reading or querying stored curves — deferred until analytics use case is defined.
- Linking `kino_curve` to `biomarkers` rows via FK — can be added later; `chip_code` is sufficient to join.
- Curve visualization in admin panel — future milestone.
- Binary format versioning — current format is stable; add when hardware rev changes.
- Marking the chip as `used` — that remains in the existing `POST /kino-result` flow.

## Delivery Milestones

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | DB migration | `kino_curve` table exists in dev and prod | in-progress | `.claude/plans/kino-curve-upload.plan.md` |
| 2 | Binary parser module | `parseBinCurve(buffer)` returns `{ curve, referenceValues }` or throws | in-progress | `.claude/plans/kino-curve-upload.plan.md` |
| 3 | Endpoint wired | `POST /kino-curve` authenticated, parses, stores, responds | in-progress | `.claude/plans/kino-curve-upload.plan.md` |
| 4 | Deploy to dev | Verified end-to-end with real `.bin` fixture | in-progress | `.claude/plans/kino-curve-upload.plan.md` |

## Open Questions

- [ ] Should `kino_curve` allow multiple rows per `chip_code` (retry uploads) or enforce UNIQUE on `chip_code`? Current assumption: allow multiple, take latest.
- [ ] What is the expected `.bin` file size in practice? (Affects whether base64 body or streaming multipart is needed at FC 3.0 layer.)
- [ ] Does the endpoint need to validate that the `chip_code` exists in `kino_chips`? Or is a dangling reference acceptable until the chip scan flow completes?
- [ ] Should `reference_values` also store the raw `dataLen` or just the derived metadata?

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| FC 3.0 multipart parsing complexity | Medium | High — FC 3.0 delivers body as base64; no built-in multipart | Use `busboy` or manual boundary parsing; test with real device before prod deploy |
| Binary format changes with future chip models | Low | Medium | Keep parser versioned behind `kino_chip_models.config` in future |
| Large curve arrays bloating `integer[]` column | Low | Low — typical ADC scan is < 10 K samples | No action needed for MVP |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
