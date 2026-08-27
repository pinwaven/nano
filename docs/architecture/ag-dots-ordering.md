# AI 精准营养素 — the AG Dots Ordering Flow

**Added 2026-08-25.** Cross-repo: nano (`/Users/pin/waven/nano`) and GCN
(`/Users/pin/waven/gcn`).

One purchase in GCN's Aeviva store now drives a chain that ends with a user physically holding
capsules formulated from their own biomarkers, and their nano plan starting the day they do.

This document is the canonical description of that chain. The pieces it connects are documented
separately and are **not** repeated here:

| Piece | Doc |
|---|---|
| The AG job queue, twin bundle, external API | [viva-ag.md](viva-ag.md) |
| The formula's file format (the agent's contract) | `src/functions/worker/docs/viva-ag-api.md` §8 |
| Dots, the 28-day cycle, `_commitNutritionPlan` | CLAUDE.md §14, §28 |
| GCN's commerce side — orders, compounding, expert review | `/Users/pin/waven/gcn/docs/aeviva/04-orders-and-fulfillment.md` |
| The nano↔GCN boundary and its credentials | `gcn-integration` skill, `docs/aeviva/06-nano-integration.md` |

---

## 1. The chain

```
 1  GCN store    buy 'AI 精准营养素'                          → order: pending_payment
 2  GCN          payment confirmed                            → order: awaiting_formulation
    GCN → nano   POST /viva-subscription-checkout-confirmed   → grants viva + viva_ag
 3  nano miniapp AG subtab: upload records, submit dots_formulation
 4  AG agent     POST /viva-ag/jobs/result   (result.formulation + an .md report)
 5  nano         parse + validate                             → viva_ag_formulations 'valid'
    nano → GCN   POST /api/mall/aeviva/formulation-ready
 6  GCN          opens formulation_reviews, notifies experts   → order: expert_review
 7  GCN expert   claims, reads nano's snapshot, approves       → order: compounding
    GCN → nano   POST /ag-formulation-approved                 → nutrition_plans, status 'approved'
 8  GCN          processing centre compounds, ships
 9  nano miniapp user scans the box → POST /box-claim
                 → 56 nutrition_schedules, plan 'active', day 1 = today
```

Steps 1, 6 and 8 are pre-existing GCN machinery. Step 3 is pre-existing nano machinery
(viva-ag.md). Everything else is this feature.

## 2. The sequence is inverted, and that drives most of the design

GCN already sold a **Custom Capsule Formulation** (its migrations 0060–0063, plus 0076 for the
Pro/expert-reviewed variant). There, the recipe existed *first*: the buyer had a committed
`nutrition_plans` row, checkout re-validated it through nano's
`GET /formulation-checkout-snapshot`, and priced it per dot.

Here the buyer **pays first** and the recipe arrives days later. Every awkward-looking consequence
below follows from that one fact:

- **Flat pricing.** `custom_formulation_dot_prices` cannot run at checkout, because there is no
  recipe to price. The bundle carries a plain `retail_price_cny`.
- **`order_item_custom_formulations.nano_nutrition_plan_id` had to become nullable**, along with
  `recipe_snapshot` and `nano_verification_ref`. They are filled in later, by
  `handleFormulationReady`.
- **A new order status, `awaiting_formulation`**, sitting before `expert_review`. Deliberately not
  a reuse of `'paid'`: `handleOrderShip` accepts `'paid'`, so an order parked there could ship
  before any formula existed. (Same reasoning migration 0076 used when it declined to reuse
  `'processing'`.)
- **The expert review is opened by nano's call, not at payment.** `handleOrderConfirmPayment`
  skips its review-row insert for a bundle, because `original_recipe` does not exist yet.

## 3. Entitlement — one purchase, two windows

The bundle grants Viva AG through the **existing** subscription endpoint, not a new one.
`viva_subscription_plans` and `viva_subscription_codes` gained a `product_type` column
(`'viva' | 'viva_ag'`), snapshotted at mint exactly like `duration_days` already is — the upgrade
path `migration_users_viva_ag_expiry.sql`'s own comment prescribed. No new endpoint, no new
`GCN_ALLOWED_PATHS` entry; `/viva-subscription-checkout-confirmed` already takes `plan_key`.

**A `viva_ag` plan grants BOTH windows.** `requireVivaAgAccess()` (`lib/vivaAgAccess.js`) is a
composite of *effective persona is viva* **and** *a live Viva grant* **and** *a live AG grant*, so
setting only `users.viva_ag_expires_at` leaves a paying buyer locked out of the subtab they just
bought. `_extendUserSubscription` therefore moves `persona_override_expires_at` (plus its legacy
`viva_subscription_expires_at` mirror) *and* `viva_ag_expires_at`, and writes two
`persona_subscription_grants` audit rows so the admin history shows that one purchase moved two
entitlements.

Seeded plans: `viva_ag_1m` / `viva_ag_3m` / `viva_ag_1y` (30 / 90 / 365 days).

## 4. Nano validates the formula — reversing an earlier decision

[viva-ag.md](viva-ag.md) §9b originally said *"Nano does not parse or validate the file"* and *"it
is an artifact, not a prescription."* Both were correct while the formula was read-only. Both
became false the moment an approved formula gets compounded into capsules a person swallows,
because at that point `lib/agFormulation.js` is the **only** check anywhere in the chain.

`parseAgFormulation(result, mdText)` prefers `result.formulation` (the JSON mirror, now required
for this `command_key`) and falls back to parsing the `.md` tables.
`validateAgFormulation(parsed, dotsFormulary)` then enforces every §8 rule:

| | |
|---|---|
| Shape | all 56 `(day, slot)` pairs present, each once, days 1–28, no empty capsule |
| Keys | every `dot_key` exists in the `dots` formulary |
| Fill | each capsule ≤ `MAX_DOTS_PER_CAPSULE` (72) |
| Dose | each dot's **daily** AM+PM total within its own `target_dots_min…max` |
| Slot | a non-`timing_flexible` dot stays in its own slot; a flexible one keeps the majority there |
| `DOT-N7` | alone on days 10–11 at `target_dots_max`, absent on every other day |
| Checksum | `total_dots` equals what the capsules add up to |

Two properties that must survive any future edit:

1. **Reject, never repair.** A count outside a dot's range is refused, not clamped; a bad checksum
   is refused, not recomputed. Either repair would ship a formula nobody authored.
2. **No DB, no I/O.** Everything arrives as arguments, so the whole rule set is testable without a
   database.

`POST /viva-ag/jobs/result` still succeeds either way — the agent's analysis and report reach the
user regardless — and the response carries `formulation_accepted`, plus `formulation_violations`
when it is false. A rejected formula goes no further: no GCN notify, no review, nothing
compounded, and the user is told the formula needs regenerating.

### The constants now bind three consumers

`PLAN_DAYS`, `MAX_DOTS_PER_CAPSULE`, `N7_KEY` and `N7_ISOLATION_DAY_INDEXES` moved out of
`handlers/dots.js` into **`lib/dotsProductModel.js`**, so nano's own formulator and the validator
share one definition. The third consumer is `docs/viva-ag-api.md` §8 — a Markdown file nothing can
enforce. **Change any of those constants and you must change §8 in the same commit**, or the
external agent builds against rules nano no longer uses.

## 5. Created on approval, activated on scan

Expert approval inserts a `nutrition_plans` row at the new **`'approved'`** status with **zero**
`nutrition_schedules`. The 56 schedule rows are written when the user scans the delivered box,
which is also when `start_date` is rewritten to that day.

That split is the whole point: the 28-day cycle starts when the capsules are in the user's hand,
not while they are being compounded and shipped.

`'approved'` is deliberately **not** a reuse of `'pending'` — that value means "an async
formulation is mid-flight and may never land", is written and read by
`_handleFormulaDotsAgentic`'s own flow, and carries no schedules for a different reason.
`handleGetNutritionPlan` filters `status = 'active'`, so an approved-not-yet-scanned plan is
invisible to the Dots subtab for free: the user keeps seeing their previous plan until the box
arrives, with no client change.

### `_commitAgFormulation` is a sibling of `_commitNutritionPlan`, not a reuse of it

This is the single easiest thing to "clean up" and break.

`_commitNutritionPlan` takes a **steady-state** morning/evening recipe and *expands* it across the
cycle, applying `_applyPulseSchedule`, `_capRecipeTotal` and the `DOT-N7` isolation override day by
day as it goes.

An AG formula already encodes all 56 capsules explicitly — pulse days, isolation days and all,
validated against exactly those rules. Running it through that expansion would apply every rule a
second time and flatten the per-day variation the agent deliberately produced. So
`_commitAgFormulation` writes the capsules **verbatim**, re-applying only the fill cap, and only
defensively.

Both remain exported. `handleNutritionTopupEvent` is still `_commitNutritionPlan`'s caller and
still the thing that keeps the Dots subtab populated on the nano-native path (CLAUDE.md §28b).

## 6. The box scan

`boxes` previously existed only to back a public, unauthenticated ingredient page — scanning a box
told you what was in it and nothing else. It now carries `claimed_by_user_id`, `claimed_at` and
`nutrition_plan_id`, and `box_batches.ag_formulation_id` lets a batch be snapshotted from an
approved formulation rather than the user's *active* plan (which, for this flow, would be their
previous formula).

`POST /api/box-claim { openid, box_code }` — three behaviours that are load-bearing:

- **Idempotent.** A second scan returns the plan the first one made. A double-tap must not produce
  two overlapping 28-day cycles.
- **Non-transferable.** `not_your_box` when the batch belongs to someone else. These capsules are
  compounded from one person's biomarkers; taking someone else's is a safety issue, not a
  permissions nicety.
- **A second box from the same batch joins the existing plan** rather than regenerating the
  schedule.

Both a bare `WVB…` code and the public page's full URL are accepted, since a WeChat scan returns
either depending on what was encoded.

The printed box snapshot reads `adjusted_capsules || capsules`, so a box always shows what an
expert actually approved.

## 7. The expert review stays in GCN

Nano exposes `GET /ag-formulation-review-snapshot?formulationId=&openid=` (GCN-allowlisted, same
`{valid, reason}` always-HTTP-200 contract as its two siblings). GCN's
`handleFormulationReviewDetail` picks it over the plan-keyed endpoint whenever the order item
carries a `nano_ag_formulation_id`.

**The twin half of both review snapshots is one shared `_buildReviewTwinContext`** (`dots.js`).
Two review endpoints showing reviewers different evidence would be the worst failure mode
available here, so they differ only in where the *recipe* comes from.

The reviewer also gets short-lived signed links to the agent's own report files — the reasoning
behind a formula is most of what there is to review.

**An expert's adjustment is re-validated by nano**, through the same validator, before the plan is
created. The reviewer UI can be wrong too, and this recipe is about to become physical capsules;
"a human approved it" is not a reason to skip the only check there is.

In GCN's expert dashboard (`site/aeviva/dashboard-expert.html`):

- an AG formula is normalised to the flat per-dot shape the table already edits (`agFlatten`),
  because three places in that page call `.map`/`.reduce` straight on `original_recipe`;
- the counts shown and edited are **daily** totals — what a dot's `target_dots_min/max` actually
  compares against, and not comparable to a 28-day cycle total;
- `DOT-N7` is rendered read-only, because its dosing is system-controlled and editing it would
  produce a formula nano refuses;
- on submit, `agRebuild` reconstructs all 56 capsules from the edited daily totals, preserving each
  dot's AM/PM split.

`repriced_total_cny` stays NULL for a bundle: it is flat-priced, so a per-dot sum would record a
number this order was never charged.

## 8. Cross-repo calls are fire-and-forget in both directions

Matching the rest of this integration:

- nano → GCN (`formulation-ready`) happens *after* the formulation row is committed. The agent's
  submission must never fail because GCN is down.
- GCN → nano (`ag-formulation-approved`) happens *after* the review is committed. A human decision
  must not be lost because nano was briefly unreachable.

**The reconciliation query**, since there is no retry job:

```sql
SELECT id, user_id, created_at FROM viva_ag_formulations
 WHERE status = 'valid' AND gcn_order_id IS NULL;   -- idx_viva_ag_formulations_unnotified
```

A `valid` formulation with a null `gcn_order_id` either failed to reach GCN, or the user ran a
formulation without having bought the bundle — a perfectly normal thing to do, which is why
`formulation-ready` answers `{ok:true, reason:'no_awaiting_order'}` rather than an error.

## 9. Data model

**nano** (4 migrations)

| Table / column | Migration |
|---|---|
| `viva_subscription_plans.product_type`, `viva_subscription_codes.product_type` + `viva_ag_*` plans | `migration_subscription_product_type.sql` |
| `viva_ag_formulations` — the parsed formula and its review/commit state | `migration_viva_ag_formulations.sql` |
| `nutrition_plans.status += 'approved'`, `+ source`, `+ ag_formulation_id` | `migration_nutrition_plans_ag_status.sql` |
| `boxes.claimed_by_user_id/claimed_at/nutrition_plan_id`, `box_batches.ag_formulation_id` | `migration_boxes_claim.sql` |

`viva_ag_formulations.status`: `valid` → `approved` → `committed`, or `invalid` / `rejected`.
`capsules` is the canonical 56-entry array; `totals` is **derived**, never trusted from the agent's
own Totals table — it is what that table is checked against. `gcn_order_id` is plain `TEXT` with no
FK: GCN is a different database on the same cluster (CLAUDE.md §32), so cross-database referential
integrity is not available and is not pretended at.

**GCN** (`migration_0078_aeviva_ai_precision_nutrition.sql`)

`orders.status += 'awaiting_formulation'`; `skus.is_ag_formulation_bundle`;
`order_item_custom_formulations` gains `nano_ag_formulation_id` / `nano_ag_job_uid` /
`formulation_received_at` and drops three NOT NULLs; the product (`…b3`) and two SKUs (`…c6`,
`…c7`), supplied by the **processing centre** (`…a3`) rather than digital services, because this
one ships a physical box.

Prices (¥1,980 / ¥5,280) are **placeholders**, carrying the same caveat migrations 0061 and 0064
already carry — and note they cannot be derived per-dot the way the standard product's are,
because no recipe exists when the buyer pays.

### `recipe_snapshot` must stay write-once

GCN's migration 0076 depends on it, and `handleFormulationLabel`'s printed QR resolves against it.
`handleFormulationReady` fills it once (`COALESCE(recipe_snapshot, $2)`); an expert's edit belongs
in `formulation_reviews.adjusted_recipe`, never there.

## 10. Endpoints added

| Endpoint | Direction | Auth |
|---|---|---|
| `GET /api/ag-formulation-review-snapshot?formulationId=&openid=` | GCN → nano | `GCN_API_TOKEN` (allowlisted) |
| `POST /api/ag-formulation-approved` | GCN → nano | `GCN_API_TOKEN` (allowlisted) |
| `GET /api/viva-ag/formulation?openid=` | miniapp → nano | app bearer |
| `POST /api/box-claim` | miniapp → nano | app bearer |
| `POST /api/mall/aeviva/formulation-ready` | nano → GCN | `NANO_SERVICE_TOKEN` (`requireNanoService`) |

The two `/ag-formulation-*` endpoints are **not** in `VIVA_AG_ALLOWED_PATHS` — the external agent
must not reach them (verified: 403).

`NANO_SERVICE_TOKEN` was previously only on GCN's `auth` function; the `mall` function now needs it
too (`s.yaml` / `s-prod.yaml`).

## 11. Known gaps

1. **The bundle price is fixed before the recipe exists**, so an expensive formula sells for the
   same as a cheap one. `formulation_reviews.repriced_total_cny` records what an adjusted recipe
   *would* have cost on the per-dot sheet — worth watching before real prices are set.
2. **No retry job** for a failed cross-repo notify; §8's query is the manual reconciliation.
3. **The duplicate-purchase guard only covers paid orders.** Two unpaid bundles can coexist (an
   abandoned checkout must not permanently block a retry). Two *paid* ones are refused; if they
   somehow existed, `handleFormulationReady` resolves oldest-first, so each would need its own AG
   run.
4. **The public box page still exposes one person's ingredient list to anyone who scans it.**
   Pre-existing and by design (random, non-sequential codes) — but worth re-confirming now that
   boxes ship to consumers.
5. **`API_BEARER_TOKEN` reaches the new nano endpoints**, as it does every other endpoint — it is
   path-unrestricted and also compiled into the miniapp. Pre-existing and systemic
   (viva-ag.md §11.1); this adds a third endpoint returning a user's twin to that surface.

## 12. Verification performed

Beyond unit and integration suites (132 assertions: validator against the live dot catalog,
entitlement, the nano chain, GCN's handlers through its real router, the expert dashboard's
helpers, i18n), the whole flow was run **live against dev** — a real purchase through the deployed
storefront, a real approval clicked in the aeviva-dev sandbox, a real scan driven through WeChat
DevTools:

- a deliberately invalid formula was refused with 6 named violations, and the order did not
  advance, no review opened;
- a valid one reached the expert queue with its twin context and report links rendered;
- an adjustment (DOT-N5 18 → 12 daily) round-tripped: rebuilt to 9 AM / 3 PM, re-validated by
  nano, stored, and **rendered in the miniapp's Dots subtab as `D-N5 x9` / `x3`** — the expert's
  number, not the AI's original 14/4;
- the original `recipe_snapshot` still read 14, proving write-once held.

All test data was removed from both dev databases afterwards.
