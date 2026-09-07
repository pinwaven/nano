# Dots Formulation — from a digital twin to two capsules a day

How the chat toolbox's **营养定制** (Formulate Dots) turns a user's digital twin into a 28-day,
56-capsule 原粒 formula, and where each number in it is decided.

**Scope.** This is nano's *own* formulator. Two neighbours it deliberately does not cover:

| Not here | Where |
|---|---|
| The AG agent's externally-authored formula, and the order it is compounded against | [ag-dots-ordering.md](ag-dots-ordering.md) |
| What a tier costs, who sells the code, how an order is paid | GCN's repo; nano never prices this product |

The product model itself — 28 days, ≤ 72 dots per capsule, `DOT-N7` isolated on days 10–11 — lives
in one place, `worker/lib/dotsProductModel.js`, and binds three consumers: this pipeline, the
validator, and §8 of `worker/docs/viva-ag-api.md`. **Change a constant there and all three change.**

---

## 1. The chain

```
chat toolbox 营养定制
  → handlePostFormulaDots            (handlers/dots.js)
  → _handleFormulaDotsAgentic        publishes chat.generate {kind:'formula_dots_generate'}
                                      and returns {processing:true} immediately
  ─── separate FC invocation, via EventBridge ───
  → handleChatGenerateEvent          (handlers/chat.js)
  → runAgenticTurn                   PLAN → GENERATE → JUDGE → REVISE
  → finalizeFormulaDotsGenerate      everything below
  → _commitProposedPlan              a 'proposed' nutrition_plans row
  → _buildFormulaChartBlock          the :::formula card, delivered to chat
```

The handover to a second invocation is not an optimisation. FC cancels an invocation the moment
the HTTP client disconnects, and a turn here routinely runs 2–3 minutes, so an inline reply would
be destroyed by any client timeout. See CLAUDE.md §22.

---

## 2. What the model decides: an ordering, and nothing else

`systemFormulaGenerate.js` (both personas) asks for **an ordered list of dot keys** — the dots that
matter most to this user, most important first — in a trailing action tail:

```json
{"action":"formulate_dots","ranking":[{"dot_key":"D-N9","why":"…"}, …]}
```

It is told explicitly not to write dose numbers, not to split morning/evening, and not to worry
about capsule capacity. That inversion is the whole design: asking one completion for 18
independent numbers across ranges spanning two orders of magnitude was asking for the hard thing in
order to derive the easy one, and it measurably did not work.

Two older shapes are still parsed, in this order, and are genuinely still used — by the
deterministic fallback and by any completion from a prompt cached before the change:

| Shape | Read by |
|---|---|
| `ranking` | preferred |
| `formulation[].level` (`none`/`low`/`moderate`/`high`) | `_countForLevel` |
| `formulation[].count`, or a legacy `morning`/`evening` pair | summed |

No usable tail at all falls through to `_runDeterministicFormulation`, so the user is never left
with nothing.

---

## 3. Dose is the server's

`_doseFromRanking` places each dot inside **its own** `target_dots_min … target_dots_max` — the
ranges differ enormously (`DOT-N1` is 1–2, `DOT-N17` is 28–87), which is exactly why a shared
1–10 scale was wrong.

```
position = 0.6 × rank share  +  0.4 × severity share of the dot's own sub-age dimension
         capped at MAX_AUTO_POSITION (0.9)
count    = min + position × (max − min)
```

Severity comes from the stored `bioage_profile.SubAges` (§11), so a cellular-dominant user pushes
the cellular dots up their ranges without the model doing arithmetic.

Related, and easy to get wrong:

- **`_emphasisPosition`** reads emphasis back *out* of a finished allocation, and is what both
  droppers rank on. A dot whose `min === max` scores `NEUTRAL_EMPHASIS` (0.5), not 1 — scoring a
  fixed-dose cosmetic dot as maximum emphasis is what once let 明眸 and 肌光焕采 take core slots.
- **A declared `order` rides on the recipe** and outranks the dose-derived proxy everywhere.
  Without it, rounding flattens a narrow range to position 0 and a dot ranked *third* gets cut
  while one ranked ninth survives.

---

## 4. Quality check, and the one finding that mutates the formula

`lib/formulationQuality.js` is pure — no DB, no I/O — and returns findings, not fixes:

`empty_formulation` · `unknown_dot` · `dose_below_min` · `dose_above_max` · `allergy_conflict` ·
`no_emphasis_signal` · `elevated_dimension_uncovered` · `top_dimension_unemphasised` ·
`emphasis_inverted`

All are logged. **Only `allergy_conflict` changes the formula** — the dot is removed before the
ladder is built, because shipping it is a safety issue rather than a quality one. It is checked
against `user_memory_facts` rows of category `allergy` / `dietary_restriction` (§27).

It runs **twice**: once on the full allocation, once on the core the user would actually receive.
A finding that is true of the whole formula but not of its narrowest tier is a different fact.

---

## 5. The tier ladder

With nothing purchased, one allocation becomes **three nested formulas** — 6 / 8 / 10 种原粒 —
because that width is what the three packages differ by, and it is what the user is choosing
between (§28c).

- `_buildTierLadder` ranks the allocation **once** and takes the top *k* of each week for each
  width. Nesting follows from ranking the same list every time; ranking each variant
  independently can drop from the wide variant a dot the narrow one kept — an upgrade that takes
  something away.
- **A width caps one WEEK, not the cycle.** A 6种 formula may run six dots this week and a partly
  different six next week, so `_capDistinctDots` caps each week separately and returns a `weeks`
  map. `_countDistinctDots` is the widest week, never the cycle's union.
- `DOT-N7` is in every variant and counted toward none.
- `_padCandidatesFor` fills upgrade slots the model left empty — GENERATE curates inside the
  agentic loop and often returns exactly the narrowest tier, which would collapse the wider
  variants into duplicates and produce no ladder at all. Padding never reaches the core.
- `attachRungCopy` writes each rung's one-line pitch **afterwards**, in a separate call shown the
  rung's real dots (names, ingredients, dimension — never doses). Asking the formulating
  completion to also tag tiers and pitch them never worked: it produced copy naming dots that were
  not in the rung. A pitch naming a dot outside its own rung is still dropped, as a backstop.

---

## 6. What is stored — and what it is not

`nutrition_plans.proposed_recipe`:

```json
{ "morning": {…}, "evening": {…},
  "weeks":   { "DOT-N9": [1,2] },
  "tiers":   [ {"max_distinct_dots": 6, "morning": {…}, "evening": {…}}, … ] }
```

- **The base is the NARROWEST variant.** Every reader that predates `tiers` — the box scan, the
  printed label, the checkout snapshot, `_packageRow.distinct_dots` — keeps working untouched and
  sees a recipe that fits any tier. A proposal can no longer be born unpurchasable.
- **`weeks` and `tiers` are optional.** A key naming no weeks is in every week, so a recipe stored
  before either existed expands to four identical weeks — the old behaviour, with no migration and
  no shape check.
- **The stored AM/PM split is a nominal intermediate, not the final answer.** It carries daily
  totals; which capsule each dose is taken in is settled at expansion, per week (§7). Do not read
  `sum(morning)` off this column and expect it to match the capsule anyone swallows.

---

## 7. Where capsules are actually decided

`_planExpansionContext` → `_expandPlanDay` is **the single expansion rule set**, shared by every
consumer. It runs per week, in this order:

```
1. _fitRecipeToDailyBudget   settle the day's budget, on DAILY totals
2. _balanceCapsules          decide which capsule each dose is taken in
3. _expandPlanDay per day    N7 isolation → pulse gate → _capRecipeTotal (a no-op safety net)
```

### 7.1 The daily budget, in three stages

Every dot has a `target_dots_min`, and the floors sum past the `2 × 72` a day holds — so a full
formulary *cannot* keep every dot, and something must give. **A sub-therapeutic dot is worse than
an absent one**: it occupies capsule space a real dose could have used, and the validator agrees
(an absent dot is legal, an underdosed one is not). Cheapest sacrifice first:

1. **Rebalance** — a flexible dot moves out of an over-full capsule. Costs nothing.
2. **Reduce toward each dot's own floor**, proportionally to how much it asked for above that
   floor. This stage is what stops the function destroying whole interventions to buy room already
   lying unused inside the survivors.
3. **Drop whole dots**, only once even the floors don't fit — and from **both** slots, since half a
   daily dose is the underdose this exists to prevent.

A recipe that already fits is returned untouched.

### 7.2 Levelling the two capsules

Fitting the budget is a different question from *which capsule* a dose is taken in, and until
2026-09-08 nothing answered the second one. `_splitDotTiming` decides one dot at a time and cannot
see the day, so a real proposal came out **71 in the morning against 31 in the evening** simply
because four of its six dots default to Morning — under the cap, so the budget fitter correctly
ignored it. Nothing was wrong with it except that one capsule was more than twice the other, which
is the half the user has to swallow.

`_balanceCapsules`, two stages, and only the first is a constraint:

1. **Timing-locked dots first**, whole, into their own capsule. Today that is three dots:

   | | Locked to | Why |
   |---|---|---|
   | `DOT-N3` 静心夜 | Evening | sleep / calming |
   | `DOT-N4` 持续精力 | Morning | stimulant |
   | `DOT-N12` 敏锐心智 | Morning | cognition |

   Nothing afterwards may move them, so a day whose morning is mostly locked stays a heavier
   morning. **They are the only thing that can leave a day uneven.**

2. **Flexible dots hand dose from the heavier capsule to the lighter one**, largest first, until
   the two meet. A flexible dot may end up **wholly** in its non-default capsule — `timing` on a
   flexible dot is a default, not a requirement.

It only ever moves dose between capsules. Daily totals, formula membership and what a tier counts
are untouched, and the move is bounded by half the gap, so a capsule can only get closer to the
other and the worst capsule is never made worse.

Per **week**, not once for the cycle: a week that rotates an evening dot out is lopsided in a way
the stored recipe cannot anticipate, and the budget fitter will not touch it because it fits.

It also runs at the two points a recipe is first built — the agentic path and the deterministic
fallback — so a plan stored with no ladder is sensible on its own.

### 7.3 The two slot rules

`lib/agFormulation.js` is the only check between a fast-track formula and capsules a person
swallows, and it **rejects, never repairs**.

| Rule | Status |
|---|---|
| `slot_violation` — a dot with `timing_flexible = false` has dose outside its own slot | **enforced** |
| `slot_minority` — a flexible dot has more dose in the other capsule than its own | **removed 2026-09-08** |

`slot_minority` was the one thing preventing an exactly level day, and it was redundant three ways:
`timing_flexible` already means 早晚皆可，可自由拆分 (the column's own words, rendered verbatim into
the prompt); `timing_flexible = false` is what exists to express a genuine diurnal requirement; and
§8 of `viva-ag-api.md` — the contract the external agent builds against — lists only "non-flexible
dots confined to their own slot" in its enforcement summary. Removing it is a loosening, so nothing
that validated before stops validating.

> **If a dot must not be taken mostly at the other end of the day, mark it
> `timing_flexible = false`.** Do not reintroduce a majority rule.

---

## 8. The four consumers that must never disagree

All of them read the same expansion, which is why it has exactly one implementation:

| Consumer | Path |
|---|---|
| The `:::formula` card in chat | `_planDayGroups` |
| GCN's per-dot checkout snapshot | `handleGetFormulationCheckoutSnapshot` (day 0) |
| Fast-track submission → compounding | `_expandProposalToCapsules` → `validateAgFormulation` |
| The 56 schedule rows written on box scan | `_activateProposedPlan` → `_writeExpandedSchedules` |

A second copy of the isolation / pulse / cap / balance rules anywhere would mean two of these
disagreeing about what a user is actually taking.

---

## 9. Invariants

1. **The model never writes a number that reaches a capsule.** It ranks; the server doses, splits
   and caps. Every model-supplied key is validated against the real formulary.
2. **Daily totals are the unit of dose.** `target_dots_min/max` and the validator both apply to
   AM + PM, never to one capsule.
3. **A dot is either at a real dose or absent.** Never scaled below its own floor.
4. **Expansion is one function.** Anything that turns a recipe into days goes through
   `_expandPlanDay`.
5. **`proposed_recipe`'s base fits every tier**, so a proposal is always purchasable.
6. **Locked dots are immovable**; flexible dots are free.

---

## 10. Verification

```bash
node --test tests/capsule-balance.test.js      # levelling, locked dots, validator conformance
node --test tests/formula-28day-proposal.test.js
node --test tests/formulation-package-tier.test.js
node --test tests/ranking-formulation.test.js
node --test tests/dose-levels.test.js
node --test tests/formulation-quality.test.js
node --test tests/rung-copy.test.js
```

`npm test` is an unconfigured stub (`exit 1`) — run the files directly, or `node --test tests/`.

Live on dev (2026-09-08), plan 38864, one 营养定制 run:

| Variant | Stored | Expanded day 1 | Worst gap over 28 days | Validator |
|---|---|---|---|---|
| base / 6种 | 66 / 21 | **44 / 43** | 1 | ok |
| 8种 | 73 / 30 | **52 / 51** | 1 | ok |
| 10种 | 73 / 72 | **72 / 72** | 0 | ok |

The stored column being uneven while every expanded day is level is §6's point, demonstrated.
