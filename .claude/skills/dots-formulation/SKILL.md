---
name: dots-formulation
description: Rules that must hold for Dots formulation, packages, redeem codes and orders (营养定制) — file map, formulating preconditions, plan statuses, checkout. Load when touching handlers/dots.js, lib/formulation.js, handlers/formulation_orders.js or handlers/store.js.
---

Moved verbatim from `CLAUDE.md` on 2026-09-19 (section numbers kept; `§N` references point at `CLAUDE.md`).

## 28. Dots Formulation, Packages & Orders (营养定制) — Rules

Two docs hold the full record and every "why"; this section is only the rules that must hold.

| | |
|---|---|
| Ranking → doses → budget → capsule levelling → expansion | [docs/architecture/dots-formulation.md](docs/architecture/dots-formulation.md) |
| Plan statuses, label QR, packages, redeem codes, orders, the Dots subtab, the chat tool (historical §28–§28g, moved 2026-09-15) | [docs/architecture/dots-formulation-lifecycle.md](docs/architecture/dots-formulation-lifecycle.md) |

Product constants (`PLAN_DAYS`, `MAX_DOTS_PER_CAPSULE`, `N7_KEY`, `N7_ISOLATION_DAY_INDEXES`) live
in `worker/lib/dotsProductModel.js` and bind three consumers — `lib/formulation.js` (with
`handlers/dots.js` behind it), `lib/agFormulation.js`, and §8 of `worker/docs/viva-ag-api.md`.
Change all three together.

**File map (split 2026-09-16; the two docs above predate it and say `handlers/dots.js` for all of
these).** `handlers/dots.js` — the I/O: `handlePostFormulaDots`/`_handleFormulaDotsAgentic`,
`_runDeterministicFormulation`, the plan writes (`_commitProposedPlan`, `_activateProposedPlan`,
`_commitAgFormulation`), `handleGetNutritionPlan`, the checkout/label/review snapshots, dots CRUD.
`lib/formulation.js` — the arithmetic, pure and DB-free: `_expandPlanDay`, `_planExpansionContext`,
`_fitRecipeToDailyBudget`, `_balanceCapsules`, `_capDistinctDots`, `_equalizeToTarget`, the tier
ladder, `_doseFromRanking`, `_fallbackCountForDot`, `_resolveCandidateDotKeys`. `lib/chatCards.js` —
`_buildFormulaChartBlock`, `_buildProductCardBlock`, `_tierPitch`. `handlers/formulation_orders.js`
— `PACKAGE_STAGES`/`PACKAGE_STAGE_NARRATION`, `_mergeFormulationPackages`,
`_fetchFormulationPackages`, `_resolveOrderContext`, `handlePostFormulationSubmit`,
`handlePostFormulationRedeem`. `handlers/store.js` — the whole in-app store: item/SKU CRUD and order listings (already
there) plus the storefront read, channel inventory, order placement and Neo cartridges (moved in). Nothing changed behaviour; every test that exercised the
pure functions now requires `lib/formulation.js` directly.

### Formulating

- Both personas run the agentic path (`_handleFormulaDotsAgentic`, async via `chat.generate`
  `kind:'formula_dots_generate'`); `_runDeterministicFormulation` is the shared fallback on any
  failure, never Nano's primary path.
- **A BioAge is a precondition.** `handlePostFormulaDots` refuses with no
  `bioage_profile.BioAge` and asks for a Kino scan — no plan row, no LLM call. A `lab_import` panel
  does not qualify (the query is `kino_chip`-only at all its call sites; widening it is a product
  decision). The refusal is delivered on both channels and returns `processing:true` so the
  client's canned 配方已生成 never prints beside it.
- **The model ranks; the server partitions and doses.** The tail is
  `{"action":"formulate_dots","ranking":[{dot_key, why}…]}` — no tier tags, counts or `weeks`
  from the model (nine measured qwen-plus runs never produced the partition). Every key is
  validated against the formulary; a missing/unparseable tail falls back deterministically.
- **`_expandPlanDay` is the single expansion rule set** (N7 isolation, pulse gate, cap, budget,
  balance) for four consumers that must never disagree: the `:::formula` card, the checkout
  snapshot, the fast-track submission, and the 56 schedules written on box scan. Never a second
  copy.
- Budget on **daily** totals: rebalance → reduce toward each dot's own floor → drop whole dots
  (from both slots). A dot is at a real dose or absent, never sub-therapeutic. `_capRecipeTotal` is
  a no-op safety net, not the budget decision. A recipe that already fits is returned untouched.
- `_balanceCapsules` levels AM/PM **per week**. Locked dots (`timing_flexible=false`: `DOT-N3`
  evening, `DOT-N4`/`DOT-N12` morning) are immovable and the only thing that can leave a day
  uneven. **No majority rule** — `slot_minority` was removed; if a dot must not be taken mostly at
  the other end of the day, lock it.
- Tier width (`max_distinct_dots`) caps **one week**, not the cycle. `_capDistinctDots` runs once,
  on the recipe, before storage, removing a dot from an over-full week rather than the formula.
  `DOT-N7` is never counted. `_countDistinctDots` = the widest week.
  `proposed_recipe.morning/evening` is always the **narrowest** variant; `weeks`/`tiers` are
  optional and a key naming no weeks is in every week.
- `_equalizeToTarget` only ever adds, never past `target_dots_max`, never a locked dot out of its
  capsule; the widest variant is the ceiling and is returned untouched. A package landing short is
  at an authored limit — don't "fix" it. Membership nests because the same ranking is used at
  every width; never re-rank per variant. `_recommendedWidth` is measured before padding.
- **No internal dot code in prose** (`D-N9`/`DOT-N9`). `humanizeDotCodes()` (`lib/dotNames.js`)
  runs once per delivery on the assembled string, never inside `:::` fences (a card row is keyed
  on the code) and never inside `saveChatMessage`/the notification insert (a token's difference
  between the two rows defeats `_aiKey` de-dup and renders the bubble twice). Package pitches are
  humanized in `lib/tierCopy.js` before placement. An unmapped code is left for `factCheck.js`.

### Plan statuses

`pending` (async formulation in flight) · `proposed` (a purchasable recipe with **no**
`nutrition_schedules`, stored in `proposed_recipe`; never supersedes the `active` plan; one per
user via `uniq_nutrition_plans_proposed`) · `approved` (AG expert-signed, §36) · `active` (the
user physically has the capsules) · `superseded`.

- `handleGetNutritionPlan` is `active`-only, so a proposal is invisible to the Dots subtab — and
  its `plan` prose also comes from the latest **`nutrition_plan` notification**, so a proposal
  must deliver as `formulation_proposal`, never `nutrition_plan`.
- **Nothing creates a plan on a timer.** The `nutrition.topup` dispatcher scan and handler are
  gone. Only `_activateProposedPlan` and `_commitAgFormulation` create an active plan, both from
  `handlePostBoxClaim`. A future top-up must extend an existing plan and never match a user with
  none.
- Day numbers on a proposal are relative; `start_date` becomes real at scan. Pulse windows
  cannot be evaluated dateless (`_isPulseActiveDate` is calendar-anchored) — resolve at scan time,
  never invent a start date.

### The label code

- `nutrition_plans.label_code` (`WVB` + 12 hex, `lib/labelCode.js`) is minted **at generation**,
  unique across `boxes.box_code` **and** `nutrition_plans.label_code`. The first box of a batch
  reuses it. The shape is load-bearing: `handlePostBoxClaim` regex-extracts it from a bare code,
  nano's old `/api/box/{code}` URL, or the GCN aeviva URL.
- **A code does not make anything claimable.** Claim still resolves through
  `boxes`/`box_batches`; never "simplify" it to resolve off `label_code`.
- Sent to GCN as a **code, never a URL** (`handlePostFormulationSubmit`; GCN prints it from
  `formulation-label.html?c=`). Not shown on the chat card (a proposal is not a purchase).
- `GET /api/formulation-label?c=` is **public** (routed before the bearer gate): no user identity
  of any kind, truncated order ref, a test asserts it. Day 0 falls back to `proposed_recipe` for
  any plan with no schedules regardless of status, so a superseded label still renders (with a
  badge); `handleGetFormulationCheckoutSnapshot` stays gated on `active`/`proposed`.

### Packages, orders, redeem codes

- **Nano never prices this product.** GCN sums the dot breakdown and applies the buyer's tier.
  The card carries no price; the model is never given one.
- A package = GCN sku with `is_ag_formulation_bundle=TRUE`, `requires_expert_review=FALSE`,
  `viva_subscription_plan_key=NULL`; a third package is configuration, not code.
  `max_distinct_dots` is the contract — **never parse a width out of `tier_label`**. The tier
  name is merchandising.
- **Bought with a redeem code**, no payment at redemption. Every "is a package waiting?" answer
  comes from one live source, `fetchFormulationOrders` (`lib/gcnClient.js`), at three call sites
  (`_resolveOrderContext`, `handlePostFormulationSubmit`, `_fetchFormulationPackages`). **Never
  mirror orders into a nano table and never add a nano-local formulation-code table.**
- Order mode is resolved **at delivery time** (`buy` / `submit` / `ag`), never cached on the user
  row; any non-answer degrades to `buy`.
- Fast track (`POST /formulation-submit`): `validateAgFormulation` **refuses, never repairs**; an
  over-tier plan is refused, not trimmed; idempotent via `nutrition_plans.gcn_order_id`.
  `_selectTierVariant` picks the widest variant the code covers. Ownership is enforced by GCN's
  `ocf.nano_user_id` predicate, not by the client-supplied order id.
- `intended_nano_plan_id` is **advisory, never a join**. `_settleFastTrackPackage` is only ever an
  attempt; every refusal falls through to the nudge.
- **No sku id in the client, ever.** Address packages by width; GCN resolves width → sku
  (`openFormulationPackageByWidth`).
- `_awaitingOrders` re-sorts oldest-first to agree with what GCN attaches. Both submit surfaces
  go through one `_submitFormulation`.
- GCN's `dashboard.html` routes the miniapp's intents, so card copy must ship with any change to
  where an intent lands. Deploy GCN first.

### The Dots subtab

- `packages` is a **sibling** of `plan`/`structured_plan`/`schedules`, never a source for them.
- Stage is derived from both halves (`PACKAGE_STAGES`); `awaiting_formulation` vs `awaiting_ag`
  split one GCN status by package type; an active plan outranks the order; `day_index` is null
  unless `active`. **A new stage needs `pkgStage_<stage>` in both `T.zh` and `T.en`.**
- `submit_plan_id` is offered, not matched. A proposal is suppressed while an order is in
  `AWAITING_FORMULA_STAGES` — keyed on stage, never on `intended_nano_plan_id`. Keep that set
  narrow.
- `pkgTitle` = `package_name` + **bare** `tier_label` (one definition, three surfaces). The
  package rows and submit picker still print `最多 N 种原粒`; the card does not — retire together.
- The order card runs 营养定制, never a store link; `neoAvailable`/`neoBound` stay separate flags.

### The card

- Meta lines are `#`-prefixed and **all optional**: `#cycle`, `#plan` (digits-validated),
  `#day|<ranges>|<kind>` (bare numbers, day word is the page's), `#tier|<label>|<width>|<rec>`,
  `#note`, `#pitch`. `#label` and `#rung` are retired but **still parsed** (chat history is
  permanent). No `#tier` → one unnamed open package. Nothing renders `<width>`.
- Server-built from the validated recipe (`_buildFormulaChartBlock`); bars normalise across all
  groups of all packages.
- The whole collapsed package is the tap target (`bindtap` on a bare `<text>` does not fire);
  `handleFormulaTierToggle` is a radio. The CTA follows the **open** package (`_formulaCtaFor`,
  `seg.cta`): unpaid check first, **exact** width match, addressed by width; recomputed on build,
  open, and `_refreshFormulaCtas`.
- Tier copy: the store's line from GCN verbatim; the per-user pitch from `lib/tierCopy.js`,
  dropped (never repaired) if it names a dot the package lacks.

### The chat tool — `get_formulation_packages`

- `messageAsksAboutFormulationPackage` force-queues it and promotes `casual_chat`/
  `formulate_dots` → `nutrition_question`. Anchor on purchase vocabulary; it **must never match
  the Formulate-Dots trigger message**. A test pins both halves.
- **The stage vocabulary lives in exactly two places** — `PACKAGE_STAGES` +
  `PACKAGE_STAGE_NARRATION` (`handlers/formulation_orders.js`) and `pkgStage_*` in `main.js` — **never in a
  prompt**. The raw `stage` enum and `plan_status` are not sent; the server writes
  `stage_meaning`/`next_step`/`formula_status` sentences.
- A **flat array**, never a wrapper (`extractToolGroundTruth` harvests nothing from one). Dates
  **date-only** (`formatToShanghai` + `addDate` double-applies +8 otherwise). All three sources
  empty at once → `{ok:false}` — degraded is not empty.
- Not given: `order_id`, `plan_id`, `sku_id`, `label_code`, the redeem code string, any price,
  tier widths.
- `get_dot_inventory` is gone; **removing a tool means removing every prompt that names it** (a
  test scans prompts for `\bget_[a-z_]+`). `buildForcedToolQueue` caps at
  `GENERATE_MAX_ITERS - 1` and the final iteration pins `tool_choice:'none'` (verified live on
  qwen-plus; re-probe before changing).

### Guardrail couplings (per §26/§37)

The refusal wording (`migration_knowledge_refusal_wording.sql`) and the package-copy permission
(`migration_knowledge_tier_copy.sql`) each live in `knowledge_entries`,
`lib/knowledgeBase.js`'s `FALLBACK_ESSENTIAL_BLOCK`, and `prompts/chat/factConstraint.js` —
**change all three together**. `planTemplate.js`/`judgeTemplate.js` are taught the
`formulate_dots` tail; keep JUDGE's DELIBERATELY NARROW clause. If a `shipped` order still gets the
canned 联系客服 line, narrow the logistics ban at the same three sites.

### Known open items

- `_getCommittedPlanDay0Breakdown` reads day 0, which under a `weeks` rotation is week 1, not the
  cycle union — affects the checkout snapshot and the printed label. Don't quietly redefine day 0.
- `formulationQuality._ingredientNames` maps JSONB to `"[object Object]"`, so the allergen check
  only compares dot names (see §40).
- Neither GCN processing centre has `payment_qr_urls`; only bites if one becomes a seller.
