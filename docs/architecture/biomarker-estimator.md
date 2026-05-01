# Biomarker Estimator

The Biomarker Estimator computes the six numeric biomarkers (`GDF15`, `IL6`, `hsCRP`, `GA`, `CystatinC`, `CD38`) used by `BioAgeCalculator`. When a Kino chip scan provides measured values, those win unchanged; for missing markers the estimator generates physiologically plausible numbers from the user's chronological age, biometrics, and a derived **tag set** capturing nutrition compliance, weight trend, and prior-scan trajectory.

The estimator is **deterministic, synchronous, and LLM-free.** A given user always sees the same estimate for the same scan-date. This is intentional — the downstream BioAge math (`src/lib/bioage/BioAgeCalculator.js`) and the trajectory logic both treat the output as ground truth, and both break under non-deterministic numerics.

## Files

| File | Role |
|---|---|
| `src/functions/worker/lib/estimator/BiomarkerEstimator.js` | Core class. Per-biomarker formulas, tag adjustments, seeded noise. |
| `src/functions/worker/lib/estimator/tagRegistry.js` | Controlled vocabulary mapping each tag → `{biomarker: [op, n]}` adjustments. |
| `src/functions/worker/lib/estimator/tagDerivation.js` | Pure `deriveTags({history, weightHistory, compliance, selfReported})`. |
| `src/functions/worker/index.js` (`fetchTagDerivationContext`, `handlePostBiomarkers`) | Queries the DB for context and wires tags into the estimator. |
| `src/lib/estimator/*` | Mirror used for local dev / unit tests. **The worker copy is the deployed source of truth** — only `./src/functions/worker` is bundled by `s.yaml`. |

## Data Flow

```
POST /api/biomarkers (kino_chip)
    │
    ├─ resolveOrUpsertUser → users.bio_data (weight, height), birth_date
    │
    ├─ fetchTagDerivationContext(user_id):
    │     ├─ SELECT last 5 biomarkers WHERE test_type='kino_chip'      → history
    │     ├─ SELECT last 10 biomarkers WHERE test_type='body_composition' → weightHistory
    │     └─ JOIN nutrition_schedules ⨝ dots over last 14 days,
    │         GROUP BY dots.sub_age_target                              → compliance
    │
    ├─ deriveTags(context) → string[] (validated against tagRegistry)
    │
    ├─ seed = `${user_id}:${YYYY-MM-DD}`     ← reproducibility key
    │
    ├─ new BiomarkerEstimator(age, test_data, biometrics, tags, { seed })
    │     For each biomarker:
    │       formula(age, BMI) → applyTagAdjustments → applyBiologicalNoise
    │
    └─ INSERT biomarkers.data = { actual, estimated, tags, bioage_profile, context }
       LOG  level=INFO msg=biomarker_tags_derived (audit trail)
```

## Tag Registry

Each tag maps to one or more biomarker effects. Operators: `'*'` multiplies, `'+'` adds. Adjustments apply **before** noise — the random component is then sampled around the adjusted mean.

| Tag | Effect |
|---|---|
| `inflammation_load_high` | `hsCRP × 1.20`, `IL6 × 1.20` |
| `inflammation_load_low` | `hsCRP × 0.90`, `IL6 × 0.90` |
| `cellular_stress_high` | `GDF15 × 1.15`, `CD38 × 1.10` |
| `cellular_stress_low` | `GDF15 × 0.92`, `CD38 × 0.95` |
| `metabolic_load_high` | `GA + 0.8` |
| `metabolic_load_low` | `GA + −0.4` |
| `microvascular_load_high` | `CystatinC × 1.10` |
| `microvascular_load_low` | `CystatinC × 0.95` |
| `weight_loss_sustained` | `GA + −0.3`, `hsCRP × 0.95` |
| `weight_gain_recent` | `GA + 0.4`, `hsCRP × 1.05` |
| `diabetes_prediabetic` | `GA + 1.0` |
| `diabetes_diagnosed` | `GA + 2.0` |

Aliases (legacy / Chinese self-report strings):

| Alias | Resolves to |
|---|---|
| `糖尿病前期` | `diabetes_prediabetic` |
| `糖尿病` | `diabetes_diagnosed` |

Unknown tags passed to `BiomarkerEstimator` are silently dropped — both the Chinese aliases and the registry filter happen in the constructor (`tags.map(normalizeTag).filter(t => TAG_REGISTRY[t])`). The applied set is exposed on the report as `AppliedTags`.

The four pathway names (`Cellular Age`, `Metabolic Age`, `Micro-Vascular Age`, `Resilience Age`) are the canonical `dots.sub_age_target` strings; the worker maps them to the code keys (`CellularAge`, `MetabolicAge`, `MicroVascularAge`, `ResilienceAge`) used in `compliance` and elsewhere in `BioAgeCalculator`.

## Derivation Rules

`deriveTags` is a pure function — no I/O, fully unit-testable. The worker fetches the structured context; derivation just classifies it.

### Pathway compliance (14-day window)

For each pathway `p`, let `compliance[p] = Σ taken_count / Σ scheduled_count` over the last 14 days, weighted by dot count in each scheduled slot.

| Threshold | Tag emitted |
|---|---|
| `compliance.ResilienceAge ≥ 0.7` | `inflammation_load_low` |
| `compliance.ResilienceAge ≤ 0.3` | `inflammation_load_high` |
| `compliance.MetabolicAge ≥ 0.7` | `metabolic_load_low` |
| `compliance.MetabolicAge ≤ 0.3` | `metabolic_load_high` |
| `compliance.CellularAge ≥ 0.7` | `cellular_stress_low` |
| `compliance.CellularAge ≤ 0.3` | `cellular_stress_high` |
| `compliance.MicroVascularAge ≥ 0.7` | `microvascular_load_low` |
| `compliance.MicroVascularAge ≤ 0.3` | `microvascular_load_high` |

Compliance values in `(0.3, 0.7)` are intentionally a dead zone — the estimator falls back to age-only formulas. Missing or non-numeric values are skipped.

### Weight trend (90-day window)

Sort `weightHistory` oldest-first. Pick the earliest entry at least 90 days old as baseline (or oldest available). Let `delta = latest.weight − baseline.weight`.

| Condition | Tag |
|---|---|
| `delta ≤ −2 kg` | `weight_loss_sustained` |
| `delta ≥ +2 kg` | `weight_gain_recent` |

Requires ≥ 2 weight entries; otherwise no tag.

### hsCRP trajectory

Compute least-squares slope of `hsCRP` over time across the user's last `kino_chip` history (≥ 3 points required). Slope unit: mg/L per day.

| Condition | Tag |
|---|---|
| `slope ≤ −0.05 mg/L/day` | `inflammation_load_low` |
| `slope ≥ +0.05 mg/L/day` | `inflammation_load_high` |

Trajectory tags can co-occur with compliance tags wanting the same effect — the result is a `Set`, so each tag fires at most once.

### Self-reported

Tags passed in `selfReported[]` are normalized through aliases and filtered against the registry. Currently no UX surface populates this — the field is wired for future use (e.g. a `users.health_conditions` JSONB column for diabetes status).

## Determinism

`BiomarkerEstimator.applyBiologicalNoise` uses a **seeded** mulberry32 PRNG when `options.seed` is provided. The worker passes `${user_id}:${YYYY-MM-DD}` so:

- The same user re-scanning on the same day gets identical estimates across retries.
- Different users on the same day get different noise realisations.
- The same user on different days gets different noise (date varies the seed).

Without a seed, the constructor falls back to `Math.random()` for backward compatibility (used by ad-hoc / local invocations).

This matters because **trajectory tags read prior estimates from the DB and feed them back as adjustments** to the next scan. Non-deterministic noise would make the trajectory chase its own tail — slope detection would respond to noise rather than to real change.

The Box-Muller transform is hard-capped at `±variancePercent` to prevent outliers from breaking downstream BioAge formulas.

## Adding a New Tag

1. Add the tag entry to `tagRegistry.js` — pick the affected biomarkers and choose `'*'` (multiplicative) or `'+'` (additive) plus the magnitude. Register the effect on every biomarker the new condition should influence.
2. Add a derivation rule to `tagDerivation.js` — a new function inside `deriveTags`, consuming whatever fields of the context are relevant. Keep the function pure; don't query the DB from here.
3. If the rule needs new structured data, extend `fetchTagDerivationContext` in `src/functions/worker/index.js` and add the new field to the context object.
4. Add unit tests in `tests/tagRegistry.test.js` (effect validity) and `tests/tagDerivation.test.js` (threshold boundaries, missing-data paths).
5. Mirror the registry/derivation changes from `src/lib/estimator/` to `src/functions/worker/lib/estimator/` — the worker copy is what deploys.

Run `node --test tests/tagRegistry.test.js tests/tagDerivation.test.js tests/biomarkerEstimator.test.js` before deploying.

## Auditing in Production

Every estimation logs a structured line to SLS:

```json
{
  "level": "INFO",
  "msg": "biomarker_tags_derived",
  "data": {
    "user_id": "...",
    "tags": ["inflammation_load_low", "weight_loss_sustained"],
    "compliance": { "ResilienceAge": 0.83, "MetabolicAge": 0.71 },
    "history_count": 4,
    "weight_count": 6
  }
}
```

The same tag list is also persisted to `biomarkers.data.tags` so the admin panel and any downstream analysis can show which tags fired for a given scan without re-running derivation.

## What This Estimator Is Not

- **Not an LLM.** Numeric biomarker estimation runs on deterministic formulas + a controlled-vocabulary tag layer. LLMs wobble for narrow-range numerics and would block the synchronous response path. If we ever want LLM-generated *narrative* (e.g. expanding `ClinicalContext` from a hardcoded phase string into a personalized paragraph), that is layered on top — never inside the numeric path.
- **Not calibrated against real blood draws.** The formula coefficients and tag effect sizes are based on published reference ranges; they are not yet fit to actual lab data from Kino-chip users. Once we collect paired (kino_chip, blood draw) samples, the long-term direction is to replace the formulas with a small per-pathway regression. The tag layer survives that change unchanged.
- **Not free-form.** The tag vocabulary is closed and lives in `tagRegistry.js`. Unknown tags from any source are dropped by the constructor.
