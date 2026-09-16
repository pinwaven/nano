# Dots Formulation Lifecycle — statuses, labels, packages, orders, and the chat tool

The commercial and lifecycle half of **营养定制** (Formulate Dots): what a proposal *is*, how a
label code travels from formula to box, how the three packages are sold and redeemed, how the Dots
subtab and the chat model see an order, and every bug that shaped each decision.

**Scope.** Two neighbours this does not cover:

| Not here | Where |
|---|---|
| How a twin becomes doses and capsules — ranking, budget, levelling, expansion | [dots-formulation.md](dots-formulation.md) |
| The AG agent's externally-authored formula and its expert review | [ag-dots-ordering.md](ag-dots-ordering.md) |

The rules that must hold are summarised in `CLAUDE.md` §28; this file is the record of why.

**Section numbering.** The sections below keep their historical `§28x` numbers from `CLAUDE.md`,
because other sections of `CLAUDE.md` (§35, §36, §40) and comments in the code still cite them
that way. They were moved here verbatim on 2026-09-15.

**File locations (2026-09-16 split).** `handlers/dots.js` was carved up the day after this record
was written, and the sections below still name it for everything. Today: the package list, stage
vocabulary, `_resolveOrderContext`, and the submit/redeem handlers are
`handlers/formulation_orders.js`; the card builders are `lib/chatCards.js`; the tier ladder and
expansion are `lib/formulation.js`; the in-app store and cartridges are `handlers/store.js`.
`handlers/dots.js` keeps the plan rows, the snapshots, the label lookup and the formulation entry
point. Function names are unchanged.

---

## 28. Formulate Dots: Digital-Twin-Driven Agentic Formulation with AM/PM Balancing (Shared by Both Personas)

Added 2026-07-29, originally Viva-only. **Genericized by the persona-unification refactor** (see §16's note): the handler described below as `_handleFormulaDotsViva()` was renamed `_handleFormulaDotsAgentic()` and now runs for both personas — Nano's non-agentic single-completion path (`_runDeterministicFormulation()`) is a shared *fallback* used by either persona on EventBridge-publish failure or agentic-turn failure, not Nano's primary path. §25 gave Viva an agentic *narrative* for an already-committed dot plan, but the actual dot-count decision was still made by `handlePostFormulaDots`'s single non-agentic LLM completion, seeing only the latest biomarker snapshot — never `health_twin` (wearable trends), questionnaire/`bio_data` history, active health-plan goals, physical dot inventory (`user_cartridges`), or prior weeks' formulations, all of which already existed and were queryable but never fed into this one decision. This pass makes the decision itself agentic and adds a new requirement: try to balance total morning vs. evening pill counts, allowed to split a single dot's daily count across both slots (previously a dot was hard-locked to whichever one slot its `timing` column said).

### Three pre-existing bugs fixed along the way (found during research, independent of this feature)

1. `nano/systemNutrition.js` and `viva/systemNutrition.js` showed the model an output-format example using stale `D01:N`/`D02:N` keys, while the formulary listing in the same prompt (and the parser regex) use the real `D-N1`/`D-N2` format from `migration_dots_new_lineup.sql` (2026-07-25). Following the literal example silently parsed to `{}`, falling back to a flat count for every dot — i.e. personalization may frequently not have been taking effect at all. **Fix:** output-format example corrected to `D-N1:N`/`D-N2:N` in both files.
2. `dots` has real per-dot `target_dots_min`/`target_dots_max` columns (e.g. 1–2 for DOT-N1 vs. 56–100 for DOT-N15), but `handlePostFormulaDots` didn't even SELECT them — the clamp was a hardcoded global `Math.min(10, Math.max(1, N))`, and the old `_calcDotCounts()` fallback was a flat constant `4` regardless of the dot. **Fix:** the formulary SELECT now includes both columns; clamping and the fallback (`_fallbackCountForDot()`, midpoint of a dot's own min/max) are per-dot.
3. `agenticTools.js`'s `get_nutrition_schedule` tool queried `dot_id, dot_name, timing, quantity` — columns that don't exist on `nutrition_schedules` (the real schema only has `recipe JSONB`). It failed silently (caught, returned no data) on every call. **Fix:** rewritten to join `nutrition_plans` for `status` and flatten `recipe->'dots'` into rows in JS. This mattered here because the new agentic formulation flow reads schedule history through this exact tool.

### Design

**Deterministic formulator becomes a reusable, shared building block.** The original single-shot "call LLM, parse ANALYSIS/FORMULATION, clamp per-dot, split into morning/evening keys" logic was extracted out of `handlePostFormulaDots` into `_runDeterministicFormulation()` (`handlers/dots.js`) — it no longer touches the DB, just returns `{analysis, finalContent, morningRecipe, eveningRecipe}`. A second extracted helper, `_commitNutritionPlan()`, does the actual transaction: supersede any existing `active` plan for the user, activate (or insert) the plan row, write 7 identical days of morning/evening `nutrition_schedules`. Nano's path calls both directly, unchanged in behavior beyond inheriting the three bug fixes above.

**The decision now runs through the full agentic loop, delivered async — not a blocking HTTP call.** Given §22's confirmed FC 3.0 behavior (the platform cancels an invocation the instant the HTTP client disconnects) and that a PLAN→GENERATE→JUDGE→REVISE turn can take 10s–180s+, `handlePostFormulaDots`'s agentic branch (`_handleFormulaDotsAgentic()`, both personas — see this section's opening note) does not run the decision inline. Instead:

1. **Phase 1 (fast, synchronous):** insert a `nutrition_plans` row with `status = 'pending'` (new column, migration `migration_nutrition_plans_status.sql`; `'pending' | 'active' | 'superseded'`, default `'active'` so every pre-existing row and Nano's path need zero change) — no schedules yet. Build a rich `llmContext` following the same "always-fetch" convention `handlePostChat`/`handlePostHealthAdvice` use: `health_twin`, `questionnaire_context`, `active_health_plans` are now fetched here for the first time (previously `null`/never fetched for this handler); `user_facts`, `essential_knowledge`, `current_solar_term`, `dots` (now with min/max) as before. Biomarker history, dot inventory, and prior schedules are deliberately *not* pre-fetched — they're reachable on-demand through the agentic loop's existing tools (`get_biomarker_history`, `get_nutrition_schedule`), mirroring how `handlePostChat` already splits "always fetched" vs. "tool-fetched" data. Publish a `chat.generate` event (`publishChatGenerateEvent`, unmodified) with a new `kind: 'formula_dots_generate'` and `pending_plan_id` in the payload, then return `{success:true, processing:true}` immediately — actually *faster* than the old synchronous path, since no LLM call blocks the response anymore.
2. **Phase 2 (async, `handleChatGenerateEvent`'s `kind === 'formula_dots_generate'` branch):** runs `runAgenticTurn()` unmodified against a new prompt, `prompts/viva/systemFormulaGenerate.js` (supersedes and replaces the old narrative-only `systemFormulaExplain.js`, now deleted — nothing publishes the old `'formula_dots'` kind anymore). The prompt lists each dot's real min–max range (not a flat 1–10) and default timing slot, includes the full digital-twin context, and instructs the model to scale within each dot's own range by biomarker severity, plus a **soft, prompt-driven AM/PM balancing rule**: after assigning each dot's total to its default slot, compare morning vs. evening totals and move part of a dot's count to its non-primary slot to narrow the gap — but keep the majority of any dot's count in its biologically appropriate slot, and never move a stimulant dot into evening or a sleep/relaxation dot into morning. (The schema has no hard `timing_flexible` flag — this is a "try the best" scope by design; a future column could tighten the guarantee if the soft version proves too loose in practice.) Output is normal prose analysis followed by a trailing action-JSON tail, the same established convention `record_weight`/`set_reminder`/`remember_fact` use: `{"action":"formulate_dots","formulation":[{"dot_key":"D-N1","morning":2,"evening":1}, ...]}`, one entry per formulary dot including explicit 0s.
3. **New finalizer `finalizeFormulaDotsGenerate()`** (`handlers/chat.js`) parses the action tail (`_extractTrailingJson()` — a brace-depth scan, not a `[^}]*` regex, since this action's JSON nests objects unlike the other three's flat shape), validates every `dot_key` against the real formulary and clamps each dot's `morning + evening` total into its own min/max (scaling the split proportionally if clamping changes the total) — never trusting the model's numbers or keys blindly, same principle as every other action. Any dot the model omitted gets the same deterministic per-dot fallback (`_fallbackCountForDot()`), split entirely into its default slot. If the action tail is missing or unparseable entirely, the whole thing falls back to `_runDeterministicFormulation()` so the user is never left with nothing (same resilience principle as §27's `remember_fact` blank-reply fix). Commits via `_commitNutritionPlan()` against the `pending_plan_id`. **The agentic reply's own prose (tail stripped) doubles as the user-facing explanation** — collapsing the old two-hop "decide, then a second agentic call to explain" design into one, since Phase 2 is now the smart call itself rather than a dumb single-shot needing a narrator.
4. On any Phase-2 failure (agentic turn throws), `handleChatGenerateEvent`'s catch block runs the same deterministic-formulation-and-commit fallback rather than just posting an error notification — a pending row is never left orphaned.
5. `handleGetNutritionPlan` filters `WHERE status = 'active'` — while a new formulation is `pending`, this naturally keeps serving the previous plan (graceful "still last week's plan until the new one lands," no new frontend state needed).

**No miniapp changes.** `runFormulaDs` (`utils/tool-actions.js`) already never displayed inline formulation content — it shows canned "generating…"/"complete" text and relies entirely on the existing notification-poll mechanism (confirmed true since §25). The Viva POST returns at least as fast as before (faster, since no synchronous LLM call blocks it), so none of §24's timeout/async-flag plumbing was needed here.

### Files

New: `src/schemas/migration_nutrition_plans_status.sql`, `src/functions/worker/prompts/viva/systemFormulaGenerate.js` (later joined by a Nano-branded `prompts/nano/systemFormulaGenerate.js` — see §16's persona-unification note). Modified: `handlers/dots.js` (shared bug fixes, `_runDeterministicFormulation()`/`_commitNutritionPlan()`/`_fallbackCountForDot()` extraction and export, `_handleFormulaDotsAgentic()` — originally `_handleFormulaDotsViva()`, renamed and shared, `handleGetNutritionPlan` status filter), `prompts/nano/systemNutrition.js` + `prompts/viva/systemNutrition.js` (key-format fix), `lib/agenticTools.js` (`get_nutrition_schedule` real-column fix), `handlers/chat.js` (`finalizeFormulaDotsGenerate()`, `_extractTrailingJson()`, `handleChatGenerateEvent`'s `kind` branch + failure fallback). Deleted: `prompts/viva/systemFormulaExplain.js` (superseded — its job is now done by `systemFormulaGenerate.js`'s own reply).

Files: `prompts/viva/judgeTemplate.js` (`message` param), `prompts/chat/planTemplate.js` (self-reported-fact clarification), `lib/agenticChat.js` (`message` threaded into `runJudge`, REVISE correction prompt strengthened, self-contradiction downgrade), `handlers/chat.js` (`recordedFactText`-aware fallback, replacing the old bare-generic fallback), `prompts/viva/chat/nutrition.js` (relevance-first rule, mirroring `chat/biomarker.js`).

## 28b. Formulate-Dots Proposes a 28-Day Plan (2026-08-28)

The chat toolbox's **Formulate Dots** (`handlePostFormulaDots` → `_handleFormulaDotsAgentic` →
`finalizeFormulaDotsGenerate`) writes a **`'proposed'`** `nutrition_plans` row and renders the whole
28-day cycle in the chat bubble as a `:::formula` card.

Between 2026-08-25 and 2026-08-28 this tool was evaluation-only and wrote nothing, on the reasoning
that the 28-day formula a user receives comes from Viva AG's `dots_formulation` job (§35/§36). That
left it with no route to the store: GCN's custom-formulation checkout prices a recipe out of a
`nutrition_plans` row, and there was no longer a row to price. It now proposes.

### A user never sees an internal dot code (2026-09-08)

`D-N9` is how the prompt addresses a dot; `DOT-N9` is its `dots.key_name` and the key of a
`:::formula` row. Both prompts forbid writing either in prose, and prod had the model doing it in
13 of 4394 AI replies over 30 days anyway. `lib/dotNames.js`'s `humanizeDotCodes()` rewrites them
to the 对话中称呼 (`key_name_zh`) in zh and the dot name in en, deterministically — there is one
correct rendering, read from the same row the card is drawn from, so there is nothing to judge and
no retry.

Two rules make it safe, and both are load-bearing:

- **It never rewrites inside a `::: ... :::` block.** A `:::formula` row is keyed on the code and
  `utils/markdown.js` parses that key. Which is also why **package pitches are rewritten in
  `lib/tierCopy.js` instead** — they end up inside the fence as `#pitch|<text>`.
- **It runs once per delivery, on the assembled string**, never inside `saveChatMessage` or the
  notification insert. A chat row and its notification row differing by a token defeat the client's
  text-keyed de-dup (`_aiKey`) and render the bubble twice.

An unmapped code (`D-N77`) is left exactly as written — that is a fabricated dot for
`factCheck.js` to flag, and renaming it would hide it. Viva AG summaries go through it too, in
`_sanitizeSummary`, the ingest point that already strips `:::`.

### A BioAge is a precondition, not an input (2026-09-08)

`handlePostFormulaDots` **refuses to formulate at all** when `data.bioage_profile.BioAge` is null,
and asks the user for a Kino scan instead. No plan row, no LLM call, no card. The gate sits before
`getEssentialBlock`/`getCurrentSolarTerm` so it short-circuits the work, and a test pins that it
precedes `_handleFormulaDotsAgentic`.

Every dose here is scaled by how far a sub-age sits above chronological age — `_doseFromRanking`,
`_fallbackCountForDot`, and the severity ranking the prompt asks the model to produce. With no
BioAge there is nothing to scale against, so what shipped instead was a formula derived from age
and BMI alone, narrated by a model that had been handed no biology to explain it with. Prod,
2026-09-08: a full 28-day card with the entire narrative above it replaced by
**目前没有足够信息支持这个判断。** — a card the user is invited to order, under a sentence saying it
could not be reasoned about.

**A `lab_import` panel does not qualify.** The biomarker query is `kino_chip`-only, as it is at all
13 of its call sites, so a user with 21 lab rows and no scan lands here too. Widening that is a
product decision about whether an imported panel is a Kino test, and it is not made here.

The refusal is delivered as a normal AI bubble on **both** channels (`chat_messages` plus a
`formulation_proposal` notification — a type already in the client's `AI_ECHO_TYPES`) and the
handler returns `processing: true`. **Deliberately no client change:** `runFormulaDs` prints its
canned 配方已生成 for any non-`processing` success, so a plain `{success:true}` would put "generated"
beside the refusal, and `{success:false}` would show a generic error rather than the explanation.

The other half of that prod bug was the guardrail itself, and it is **not** specific to
formulation — see §26's note on the essential block. It used to hand the model a quoted,
ready-made refusal (`直接说："目前没有足够信息支持这个判断。"`), which is the cheapest thing in a
prompt to emit: 25 replies in 30 days reached for it, either as the whole reply or as a refusal
followed by paragraphs of the advice it had just declined. The clause now says to name the missing
data and continue with what the available data supports, and bans both shapes outright.
`migration_knowledge_refusal_wording.sql` plus the three hardcoded copies — **change all four
together**, per §26/§37.

### `'proposed'` is a fourth status, and none of the other three would do

`migration_nutrition_plans_proposed.sql`. `'pending'` means an async formulation is mid-flight and
may never land. `'approved'` means a nutrition expert signed the recipe off and a batch is being
compounded — conflating the two would let unreviewed model output reach the compounding queue.
`'active'` means the user physically has the capsules. A proposal is none of those: a real,
purchasable recipe for capsules that do not exist yet.

- **No `nutrition_schedules` rows**, same as `'approved'`. The recipe lives in
  `nutrition_plans.proposed_recipe` (`{morning:{}, evening:{}}`) — a proposal has no schedules to
  read it back out of.
- **It never supersedes the `'active'` plan.** Only a previous proposal is superseded, so a user
  mid-cycle on a box they already have keeps taking it. `uniq_nutrition_plans_proposed` enforces
  one live proposal per user.
- `handleGetNutritionPlan` filters `status = 'active'`, so a proposal is invisible to the Dots
  subtab with no code change — which is also why the card carries the numbers itself and there is
  still **no "view plan" button**: it would open the *previous* plan.

### Day numbers are relative, and that is the product, not a limitation

The capsules must be compounded and shipped, so the card says `Day 1–9 · 12–28`, never a date.
`_activateProposedPlan` (called from `handlePostBoxClaim` when a batch carries `plan_id` and no
`ag_formulation_id`) is where "Day 1" stops being relative: `start_date` becomes that day and the
56 capsules are written. Same shape as the AG flow's `_commitAgFormulation`, one status earlier.

### `_expandPlanDay` is the single expansion rule set

The N7 isolation override, the pulse window and the `MAX_DOTS_PER_CAPSULE` cap are applied in
exactly one place, shared by **three** consumers that must never disagree about what a user is
actually taking: `_commitNutritionPlan` (nano's own formulator writing schedules),
`_activateProposedPlan` (the box scan) and `_planDayGroups` (the card).
`tests/formula-28day-proposal.test.js` asserts the dateless preview matches what the scan writes,
day for day. Don't reintroduce a second copy of these rules.

**`_isPulseActiveDate` cannot be evaluated without a date** — it is anchored to a fixed calendar
epoch — so `_expandPlanDay(i, ctx, null)` leaves pulse dots in every day. Exact today (`DOT-N7` is
the only pulse dot and is routed through isolation, never through that gate), but a second pulse
dot would make a proposal over-state the days it appears on until the scan anchors the cycle. Fix
that by resolving the window at scan time, **not** by inventing a start date for a proposal.

### The card

`_buildFormulaChartBlock` (`handlers/dots.js`) builds it **server-side from the already validated
recipe** — the model never writes it, so the bars can never disagree with the numbers they draw.
Days whose two capsules are identical are collapsed into one group, so a 28-day plan is normally
two groups (the everyday dose, and the two `DOT-N7` reset days) rather than 28 near-identical rows.

Dot rows are still `key|name|color|am|pm`. Meta lines are **`'#'`-prefixed and all optional**, which
no dot key can start with, so a card written before this change still renders as one unlabelled
group — **keep them optional**:

- `#cycle|<days>|<capsules>` — footer
- `#plan|<id>` — the proposed row; enables the order CTA, and is digits-validated in the renderer
  before it reaches a `data-` attribute
- `#label|<url>` — **retired 2026-09-10, no longer written or rendered.** A proposal is not a
  purchase: nothing has been paid for and no box exists, so the QR pointed at a label for capsules
  nobody was compounding. The label belongs after payment, on the GCN order. The parser and its
  https check are kept for cards already in chat history. `label_code` is still minted with the plan
  and `GET /api/formulation-label` is unchanged — only the chat CTA is gone.
- `#day|<ranges>|<kind>` — starts a group. Ranges are **bare numbers**; the localised day word is
  the page's (`t.formulaDayWord`), because `utils/markdown.js` has no language context.

Bar widths normalise against the largest capsule across **all** groups, so a reset day reads as the
smaller capsule it genuinely is instead of self-normalising to look full.

### Checkout needed no GCN change

`handleGetFormulationCheckoutSnapshot` now accepts `'proposed'` as well as `'active'`, deriving
day 0 from `proposed_recipe` through `_expandPlanDay` (day index 0 is never an isolation day, so it
yields exactly the steady-state capsules that endpoint already promised). GCN's checkout reads
`snapshot.valid` and the dot breakdown and never inspects plan status, so nothing changed there.
The tap-through reuses the existing `webview_tokens.context` bridge with
`{intent:'buy_custom_formulation', nutrition_plan_id}` (§31), which GCN's `dashboard.html` already
routes into `openCustomFormulationCheckout`.

**Nano does not price this, and must not start.** GCN sums the dot breakdown against its own
`custom_formulation_dot_prices` and, since 2026-08-28, takes the buyer's own aeviva partner tier
off that subtotal (`silver_store`/`gold_store`/`platinum_store`, `migration_0082` there) — a
premier partner tapping this CTA had been paying the plain consumer price because every
formulation sku is intercepted before GCN's wholesale machinery runs. The card carries no price
for exactly this reason: the number the user is charged is settled on GCN's side at order time,
after nano's snapshot is validated. Detail: GCN's `CLAUDE.md` §"Premier-partner pricing on
formulation products".

### The daily budget and the levelling of the two capsules

Both mechanisms — `_fitRecipeToDailyBudget`'s three stages (rebalance → reduce toward each dot's
floor → drop whole dots from both slots) and `_balanceCapsules` (locked dots first, then flexible
dose handed from the heavier capsule to the lighter, per week) — are documented in
[dots-formulation.md](dots-formulation.md) §7.1 and §7.2, including why `slot_minority` was
removed from `validateAgFormulation` on 2026-09-08. Not repeated here.

### The label QR: one code from formula to box to activation

`nutrition_plans.label_code` (`WVB` + 12 hex, `migration_nutrition_plans_label_code.sql`) is minted
by `lib/labelCode.js` **when the formula is generated** — not at box-batch time, which is far too
late to show anyone. It is the QR the user views in chat, the label printed on the box, and the
code the Mini Program scans to activate the plan.

```
_commitProposedPlan  → label_code minted
box batch for a plan → the FIRST box reuses that code as its box_code
printed box label    → https://aeviva.gcn.net/formulation-label.html?c=WVB…
user scans the box   → /WVB[0-9A-Fa-f]{12}/ reads it out of that URL → plan goes active
```

**The chat card no longer shows it** (2026-09-10). It did, on the reasoning that the QR is "part of
what the user gets here" — but at proposal time nothing is paid for and no box exists, so it offered
a label for capsules nobody was compounding.

**It belongs to whoever compounds the box.** `handlePostFormulationSubmit` sends `label_code` to GCN
with the fast-track submission (GCN `migration_0111` stores it as
`order_item_custom_formulations.nano_label_code`), and the supplier dashboard prints it from
`formulation-label.html?c=<code>` — the same page the box QR resolves to, so 维秋云健 prints
byte-for-byte what the customer later scans. GCN's own print button predates this but was gated on
`nano_verification_ref`, which only the older per-dot product ever sets: measured 2026-09-10, not one
order on either environment carried one, so it had never appeared for a real order.

Sending the **code**, never a URL: where GCN hosts the label page is GCN's decision, and nano must
not be the thing that fixes it.

- **One code space, two tables.** `generateLabelCode()` checks `boxes.box_code` **and**
  `nutrition_plans.label_code`. A collision means a scan resolving to someone else's capsules.
- **The `WVB` + 12-hex shape is load-bearing.** It is what lets one QR be both a human-readable
  page (phone camera) and a claim token (Mini Program) — `handlePostBoxClaim` regex-extracts it
  from a bare code, nano's old `/api/box/{code}` URL, or the GCN aeviva URL alike. Old printed
  labels therefore keep working; physical objects already shipped cannot be re-printed.
- **Minting a code does NOT make anything claimable.** A scan still resolves through
  `boxes`/`box_batches`, which exist only once a batch is compounded — so scanning the QR of a
  formulation nobody manufactured returns `box_not_found`, not an activated plan for capsules the
  user does not have. **Don't "simplify" claim to resolve straight off `label_code`.**

### A label outlives the formulation it describes

The QR is printed on a physical box, so it must keep resolving after the plan behind it stops being
current. Day 0 therefore falls back to `proposed_recipe` whenever a plan has **no schedules**,
regardless of status — **not** gated on `status === 'proposed'`, which is what made a superseded
proposal's label fail with `plan_has_no_schedule` the moment its owner formulated again.

`status` is what tells the reader where they stand (`proposed` / `approved` / `active` /
`superseded`), and the page renders a 已被新配方替代 badge plus a hint that scanning it activates
nothing. **`handleGetFormulationCheckoutSnapshot` stays gated on `active`/`proposed`** — a replaced
formulation may be read, never bought.

An unresolvable code says the label has expired and was likely replaced, rather than "not found":
a mistyped code and a deleted one are indistinguishable from the server, and "not found" reads to a
customer as "your box is counterfeit".

### `GET /api/formulation-label?c=` is PUBLIC, and that constrains it

Routed before the bearer gate, like `/api/box/{code}`, because the code is printed on a physical
object — whoever holds the box can read it. So it returns **no user identity of any kind** (no
user_id, openid, nickname, phone, or biomarker value) and truncates the order reference. A test
asserts the user id is absent from the payload. **Never enrich this response with anything
user-identifying**, on either side of the proxy.

GCN's `formulation-label.html` reads it through `GET /api/mall/aeviva/formulation-label` — a
server-side proxy, not a browser fetch, for the two reasons `handleNanoFocusTemplates` documents:
nano's routes all require some bearer, and nano's custom domain emits a duplicate
`Access-Control-Allow-Origin` header that browsers reject outright.

`AEVIVA_SITE_BASE_URL` (`s.yaml` / `s-prod.yaml`) is the public aeviva site — distinct from
`GCN_API_BASE_URL`, which is the server-to-server API edge. It is a verified WeChat business
domain, which is why `<web-view>` can load it and why the miniapp opens the label rather than
drawing a QR natively: the user should see the exact page that prints on the box.

### Two purchase orderings, and the card is where they differ

A custom-dots order can be placed either way round, and the chat card adapts:

```
formulate → buy    chat tool → 'proposed' plan → GCN prices THAT recipe per-dot
buy → formulate    GCN parks the order at 'awaiting_formulation' → chat tool fills it in
```

`_resolveOrderMode()` asks GCN (`fetchFormulationOrderStatus`, `lib/gcnClient.js`) which case this
is, and the answer becomes the card's `#order` mode: `buy`, `submit` (a paid **fast-track**
package is waiting) or `ag` (a paid **premium** package is waiting — Viva AG owns it, no CTA).

- **Pulled at delivery time, never cached on the user row.** An order can be refunded, cancelled,
  or fulfilled by an AG run in between. Resolved when the card is built rather than when the
  request was made, because the turn is async and may be minutes old.
- **Any non-answer degrades to `buy`** — the safe direction. A buy button someone already paid
  past is ignorable; a submit button with no order behind it fails on tap.

### Fast track: `POST /formulation-submit`

The user confirming that a proposal is the formula to compound for a package they already bought.
**No expert reviews it** (that is what the premium AG package's higher price buys), which makes
`validateAgFormulation` the only thing between a generated allocation and capsules a person
swallows. It **refuses** on any violation and repairs nothing — §36's rule, same reasoning. The
expansion is rule-conformant by construction (`_expandProposalToCapsules` → `_expandPlanDay`), so
a violation means the expansion regressed.

The AM/PM split is what keeps it valid: `_splitDotTiming` forces a non-`timing_flexible` dot
(`DOT-N3`, `DOT-N4`, `DOT-N12` today) wholly into its own slot, and the validator's
`slot_violation` rule rejects anything else. **Never assemble a recipe without it** — a test pins
both halves of that.

Submission is idempotent via `nutrition_plans.gcn_order_id`, so a double tap can never send two
formulas for one purchase.

### On GCN's side: no new branch flag

Three existing SKU columns express the fast-track product (`migration_0081`):

| column | meaning here |
|---|---|
| `is_ag_formulation_bundle = TRUE` | the **order shape** — flat-priced, no recipe at checkout, parks at `awaiting_formulation`. The "AG" is historical (0078 shipped it first); read it as "buy-first formulation bundle". |
| `requires_expert_review = FALSE` | the **fulfilment** — reported to nano as `fulfillment: 'fast_track'`. This one flag is the entire difference between the two packages. |
| `viva_subscription_plan_key = NULL` | the **entitlement** — none. A NULL key means the purchase grants nothing, and the insert is skipped rather than defaulted. |

A future third package is therefore a configuration change, not a code change.
`handleFormulationFastTrack` **refuses** an order whose SKU requires review rather than quietly
downgrading it; nano surfaces that to the user as "that package is formulated by Viva AG".

### Nothing creates a plan on a timer (removed 2026-08-28)

The dispatcher's nutrition top-up scan is **gone**, along with the worker's `nutrition.topup` route,
`handleNutritionTopupEvent`, and `_commitNutritionPlan` (whose only caller it was).

It ran every minute with no plan requirement — a LEFT JOIN over `users` counting *schedules* — so
it did not top anything up: it manufactured an `active` plan, via an LLM call, for anyone who did
not have one, including every user who had never ordered a box. Dev had accumulated 1,133 plans
across 676 users with **zero boxes ever produced**.

**A plan now means "this person physically has these capsules."** Exactly two things may create
one, and both require a scanned box:

| | |
|---|---|
| `_activateProposedPlan` | a chat-tool proposal, activated by `handlePostBoxClaim` |
| `_commitAgFormulation`  | a Viva AG formula, same scan |

Do not reintroduce a timer that creates a plan. If a genuine top-up need appears, it must **extend
a plan the user is already on** and must never match a user who has none.

**`handleGetNutritionPlan` has a second, non-obvious source.** Its `plan` field is the content of
the user's most recent `nutrition_plan` **notification**, not the `nutrition_plans` table — a
legacy prose fallback. Clearing the table alone leaves the Plans tab showing stale text; the
notification rows are what actually populate it.

Which is why a Formulate-Dots proposal delivers as **`formulation_proposal`**, never
`nutrition_plan`. Delivering it under the latter made the tab report `hasPlan: true` off the card's
own text even though the plan row was correctly `'proposed'` and invisible to the structured query
— the proposal repopulating the tab it exists to stay out of. Found in the simulator; the DB and
the API each looked correct on their own.

## 28c. The 营养定制 Tool Sells a Tiered Package (2026-08-30)

The formula card's `#order|buy` CTA opens **原粒 · 定制营养素 · 28天** — a buy-first package with
three tiers — instead of the per-dot `定制原粒方案` it opened before. GCN `migration_0085`.

```
chat card  #order|buy  → GCN package picker → pay → order parks 'awaiting_formulation'
GCN → nano  /formulation-purchase-confirmed  → 'formulation_order_paid' chat message
user runs 营养定制 again → card is now #order|submit → confirm → fast track (§28b)
```

Nothing here is a new order shape. §28b's fast-track SKU flags already expressed a flat-priced,
no-expert-review, buy-first package; this product just *is* one, at a real price, with a tier.

### The tier is a WEEKLY width, and that is why a recipe has weeks at all

`skus.metadata.max_distinct_dots` (6 / 8 / 10, merchandised as 轻享套装 / 臻选套装 / 尊享套装) is
the only difference between the three prices, so honouring it is not optional. GCN **reports** it
on the waiting order (`handleNanoFormulationOrderStatus`) and enforces nothing: the rule needs the
dots formulary and a product judgement about what a tier counts, and neither belongs on the far
side of the wire.

**The name is merchandising; the number is the contract.** GCN's `migration_0107` renamed the three
tiers off their widths — a shopper read 6种原粒 as the whole 28-day box — but `max_distinct_dots` is
untouched and is what every side enforces and reports. **Never parse a width out of `tier_label`.**

**The width is no longer shown on the formulation card** (2026-09-10, reversing the rule that stood
here). What separates the packages is a product decision moving beyond "how many kinds of dot", so a
number on the card would be the first thing to go stale, and it is the one claim there that a user
cannot check for themselves. The card names each package, gives it the store's own positioning line,
and draws its actual formula — which answers "what do I get" without asserting a spec. `systemFormulaGenerate`
still states 轻享套装：任意一周最多 6 种 to the **model**, because that is the enforcement contract, not
merchandising. Two surfaces still print `最多 N 种原粒` — the Plans ▸ Dots package row and the submit
picker (§28d) — and they describe a package the user has already bought rather than one they are
choosing between; retire them together with whatever replaces the width, not before.

**It caps one week, not the cycle.** A 轻享套装 buyer may take six dots this week and a partly
different six next week; what they bought is the width of any single week. So a 28-day formula can
genuinely use more than six dots — it just may never run more than six at once.

That is the whole reason `_expandPlanDay` is week-aware. A recipe may carry an **optional** `weeks`
map alongside its `dots` counts:

```js
{ dots: { 'DOT-N3': 7 }, weeks: { 'DOT-N3': [1, 2] } }   // taken in weeks 1-2 only
```

**A key that names no weeks is in every week**, which is what makes this backward compatible in
both directions with no migration and no shape check: a proposal stored before weeks existed, a
completion from a stale cached prompt, and the deterministic fallback formulator all expand to
`PLAN_WEEKS` identical weeks — exactly the old behaviour. `_planExpansionContext` therefore
budget-fits **once per week**, because a week running five of a formula's twelve dots has capsule
room the others do not.

**The model owns the rotation, not the server.** Whether a dot can be paused for a week is a
clinical judgement — continuous sleep support and a seasonal accent are not interchangeable — so
the prompt asks for a per-dot `weeks` field and says continuous dots stay in all four. The server
only enforces the width.

**`_capDistinctDots` runs ONCE, on the recipe, before it is stored**, and removes a dot **from an
over-full week** rather than from the formula: a dot cut from week 3 keeps weeks 1-2, and only a
dot left with no weeks disappears. Everything downstream expands `proposed_recipe` through
`_expandPlanDay` — the card, the box scan writing 56 capsules, the fast-track submission — so they
cannot disagree. Apply it inside the expansion instead and the box scan, which knows nothing about
the order, would expand a different recipe than the card the user was shown.

**`DOT-N7` is not counted.** It is the system reset dot, dosed alone on 2 of the 28 days in every
plan regardless of tier (`_planExpansionContext` lifts it out of the everyday recipe entirely), so
counting it would silently cost a 6种 buyer one of the six dots they paid for. A product judgement,
and the reason the tier is described to the user as the width of their weekly formula rather than
as the number of labels on the box. `_countDistinctDots` is the one definition of that count — the
**widest week**, never the cycle's distinct total.

Ranking reuses **`_emphasisPosition`**, now shared with `_fitRecipeToDailyBudget`'s stage 3 — a dot
dropped for capsule space and a dot dropped for the tier are the same judgement about the same
recipe.

`handlePostFormulationSubmit` **refuses** a plan over the tier rather than trimming it — a plan
proposed before the package was bought was capped by nothing, and re-running 营养定制 produces a
better formula than that one minus a dot. Same reject-never-repair rule as §36.

**Open, and now user-visible if a rotation ever ships:** `_getCommittedPlanDay0Breakdown` reads day
0, which under rotation is week 1 rather than the cycle. Its two callers both want the cycle-wide
union — GCN's per-dot checkout snapshot (changing it changes what a customer is charged) and the
printed box label (which would under-list a box that physically holds all four weeks). Give them
one when someone owns the pricing question; do not quietly redefine day 0.

### Buying a package attaches the formulation the buyer was looking at

The chat card's order CTA is tapped while a specific proposal is on screen, so GCN carries its id
into the order as **`order_item_custom_formulations.intended_nano_plan_id`** (`migration_0086`) and
payment confirmation asks nano to attach it. Without this the buyer taps "order this formulation"
and gets an order referencing no formulation at all — which is exactly how this was first reported.

**Advisory, and a separate column on purpose.** `nano_nutrition_plan_id` is the audit record of what
will be compounded and is what `formulation_reviews` resolves against; the intent may never be
compounded. Collapsing them would make an unpaid, unvalidated intention indistinguishable from a
committed formula.

`_settleFastTrackPackage` (`handlers/users.js`) runs the attempt, and it is **only ever an attempt**:
`handlePostFormulationSubmit` re-checks ownership, `'proposed'` status, that an order is waiting,
the weekly width, and the validator. Every refusal falls through to the nudge — the behaviour this
flow had before an id was carried — so nothing can leave a buyer worse off. The one refusal with its
own message is an over-tier plan, because a generic "go formulate it" would have them regenerate the
same too-wide formula and fail the same way.

**GCN's `dashboard.html` is what routes the miniapp's `buy_custom_formulation` intent**, so a
production miniapp reaches whatever checkout the web function was last deployed with. That is how a
card still reading 按此方案定制下单 ended up opening a package picker. When changing where that
intent lands, the miniapp card copy has to ship with it or it will promise the wrong thing.

### 查看配方 is not 我的激活码

`openOrderCodes` serves three item kinds and its heading was hardcoded to the activation-code one,
so a buyer tapping 查看配方 was told they were looking at activation codes. It now titles itself
from its contents.

A buy-first package is paid **before** anything is formulated, so that modal routinely has no
recipe. It used to render an empty shell with `配方主打方向: —`; it now drops the focus line when
there is no focus and says whose move it is. That answer is per-product, which is why
`is_ag_formulation_bundle` / `requires_expert_review` ride on the order item — at
`awaiting_formulation` a fast-track package waits on the buyer running 营养定制, a premium one waits
on Viva AG. `order.status` cannot tell them apart, and getting it backwards either strands the order
or sends someone somewhere that cannot fulfil it.

### A paid package says so in chat

An order at `awaiting_formulation` is waiting on something only this app can produce, and the store
never said so. `/formulation-purchase-confirmed` now carries the package, and delivers a
`formulation_order_paid` message (**in `AI_ECHO_TYPES`** — it writes both channels). An
expert-review package sends none: Viva AG owns that one and the user has nothing to do.

`handlers/users.js` requires `./chat` **at call time**. Not a cycle — nothing in the chat graph
requires users.js — just keeping a cold path off every warm container's module load.

### No sku id in the client, ever again

The picker reads `GET /api/mall/aeviva/formulation-packages`. A tier added, repriced or retired in
the admin panel takes effect with no web deploy, and a stale client-side formulation sku constant
is exactly what broke both checkouts in the sandbox on 2026-08-22. An empty response falls back to
the per-dot product rather than dead-ending a CTA the user already tapped.

Seller and fulfiller stay separate without the client knowing either: the order carries the
**buyer's own bound store** as `store_partner_id`, and `handleAgFormulationBundleOrderCreate`
stamps the processing centre onto the order *item*.

**Resolved 2026-09-01 (GCN `migration_0089`).** That handler used to hardcode
`PROCESSING_CENTER_PARTNER_ID` (`…a3`) while the AI 精准营养素 product sat on `42f7307f`, so the
28天 packages, `AI精准营养素` and every redeem-code order were all addressed to a compounding centre
that does not make them, while the per-dot product independently used its own *seller*. GCN now
carries `products.processing_center_partner_id` and both order paths resolve
`COALESCE(processing_center_partner_id, supplier_partner_id)` — see GCN's `CLAUDE.md`
§"Selling a product and compounding it are different partners". Nothing in nano changed.

Still open: neither processing centre has a `payment_qr_urls`. Not on this path (the customer pays
the store, and a redeemed code charges nothing), so it only bites if a processing centre is ever
made a *seller*.

## 28d. The Dots Subtab Is Order-Aware (2026-09-01)

Plans ▸ Dots lists **one row per dots package**, merged from two systems that each know only half
of a journey: GCN owns the order (`pending_payment → paid → awaiting_formulation → expert_review →
compounding → shipped`) and nano owns the formula (`proposed → approved → active`). Before this,
nano's entire record that an order existed was `users.custom_formulation_purchased_at` — one
timestamp, no id, no status — so the only way to learn where your capsules were was the GCN store
webview.

### Nothing is mirrored, and that is the point

The order half is read live through `fetchFormulationOrders` (`lib/gcnClient.js`) on every request
and **never written to a nano table**. A cached status has nothing to reconcile itself against: an
order can be refunded, cancelled, or filled from another device between two reads. Same reasoning
that already governs why "is a package waiting" is pulled rather than stamped on the user row.
**No migration, either repo** — every field already existed.

`_fetchFormulationPackages` is awaited inside `handleGetNutritionPlan`'s existing `Promise.all`, so
a slow GCN costs `max(db, gcn)` rather than the sum, and it degrades to `[]` on any failure. The
Dots subtab must still render the user's active plan when the order half is unavailable.

> **`packages` is a SIBLING of `plan` / `structured_plan` / `schedules`, never a source for them.**
> Those keep meaning "the plan you are physically on" and stay `status='active'`-only. §28b records
> the live bug where a proposal repopulated this tab and made it report a plan the user did not
> have.

### The stage is derived from both halves, and is neither system's status column

`PACKAGE_STAGES` (12 values) is the vocabulary; the miniapp keys its copy off the string
(`t['pkgStage_' + stage]`), so **a new stage needs a line in both `T.zh` and `T.en`** — WXML has no
compile-time key checking and a missing key renders empty. Since 2026-09-10 the chat model reads
these too, through `PACKAGE_STAGE_NARRATION` in the same file — see §28g for the coupling rule and
why the prompt is deliberately not a third site.

- `awaiting_formulation` vs `awaiting_ag` are **one GCN status split by which package was bought**.
  A fast-track package waits on the buyer; a premium one is Viva AG's to fulfil and asks nothing of
  them. Offering a submit CTA on the latter sends someone somewhere that cannot fulfil their order.
- An **active plan outranks the order** — the user scanned the box, which is a truer statement than
  an order still sitting at `shipped` because nobody closed it out on the commerce side.
- `completed` becomes `delivered`, not "done": for a physical box the journey ends at the scan, and
  that scan is a nano-side event GCN never hears about.
- `day_index` is null for anything but `active`. A proposal's `start_date` is a placeholder and an
  approved plan's is provisional until the box is scanned, so counting from either would claim the
  user is taking capsules that do not exist.

### The row title carries the tier — `pkgTitle`

A package row's bold line is `原粒 · 定制营养素 · 28天 · 臻选套装`, composed in the client from
`package_name` + `tier_label`. Two packages of one product differ in **nothing but** their tier, so
a title stopping at the product reads as a duplicate and the buyer has to hunt for the difference
in grey secondary text — which is how this was reported.

`pkgTitle` is one definition, shared by the package rows, the 兑换码 rows and the submit picker,
because those three name the same purchase and a user comparing them must not see three spellings
of it. **It is a plain join, and that only holds while every GCN endpoint returns a BARE tier**
(`臻选套装`, never a full sentence) — `handleNanoFormulationCodes` used to return the code sku's own
name here, which contains the product name, and composing with that printed it twice.

The width moved down to the meta line (`最多 8 种原粒`) and is shown **unconditionally**, not as a
fallback for a missing tier: renaming the tiers off their dot counts (GCN `migration_0107`) took the
number out of the name, and nothing else on the row was saying it.

**These rows still print the width; the formulation card no longer does** (§28c, 2026-09-10). That
is not drift: a package row and the submit picker describe a package the user has **already bought**,
where the number is a fact about their purchase, while the card is where three packages are being
chosen between and a spec that is about to stop meaning "how many kinds of dot" would go stale
first. Retire these two together with whatever replaces the width — not before, or the user loses
the only statement of what they bought.

### Offered, not matched

A waiting package carries **`submit_plan_id`** — the user's single un-submitted proposal
(`uniq_nutrition_plans_proposed`) — which is deliberately *not* `plan_id`. Buying writes no plan and
formulating writes no order; the two are bound only by `handlePostFormulationSubmit`. The
standalone proposal row is suppressed once offered, because the same formula listed twice (once to
buy, once to fill) reads as two formulas.

**`intended_nano_plan_id` is never a link.** It is advisory — what the buyer was looking at, possibly
a formula since superseded (GCN's `migration_0086`) — and joining on it would report a package as
carrying a recipe nothing is going to make.

**A proposal is also suppressed while an order is waiting for a recipe** (`AWAITING_FORMULA_STAGES`
= `pending_payment` / `paid` / `awaiting_formulation` / `awaiting_ag`, with no plan attached). The
plan is not attached until payment confirms, so at `pending_payment` one journey is genuinely two
rows — and the standalone one was still offering 按此配方下单 for a package already ordered.

The stage is what this keys on, **not `intended_nano_plan_id`**, per the rule directly above: at
most one un-submitted proposal exists per user, so "an order is waiting" already identifies it
without trusting an advisory link. Keep the set narrow — a package at `compounding` or `shipped`
already has its formula, so a proposal made afterwards is a real next-cycle formula and must stay
orderable; `cancelled`/`refunded` release it. Only `'proposed'` rows are suppressed, never an
`active` plan.

### Selecting which package a formula fills

Both halves of the handoff were hardcoded `ORDER BY o.created_at ASC LIMIT 1`, so "oldest wins" was
silently deciding. **Two waiting packages is reachable**: GCN's `formulation_already_in_progress`
guard runs at order *creation*, so two checkouts started while both were `pending_payment` can both
be confirmed.

`_attachRecipeToAwaitingOrder` (GCN) now takes an optional `orderId`. **Ownership stays enforced by
the `ocf.nano_user_id` predicate**, not by the caller having supplied a plausible id — keep it that
way; it is the only thing between a client-chosen id and another buyer's order.

- **Chat card** — `handleFormulaSubmit` resolves the list at **tap** time via
  `GET /api/formulation-orders`, not from the card. The turn is async, so a card can be minutes old.
  One waiting package behaves exactly as before; several open an action sheet.
- **Dots subtab** — tapping a package row *is* the choice; the row already names its order.
- Both go through one `_submitFormulation`, so the two surfaces cannot drift on what a reason code
  means.

**`_awaitingOrders` re-sorts oldest-first.** GCN returns newest-first for display but attaches
oldest-first, so anything that must agree with what GCN will actually do has to re-sort. Not doing
this is how a picker and a submission end up naming two different packages.

### GCN side

New `GET /api/mall/nano/formulation-orders` (`requireNanoService`, always 200, `{orders: []}` on any
failure). It shares `FORMULATION_ORDER_FROM` with the older single-row status probe — a row visible
to one and not the other would show a package the submit path cannot find. It returns **no buyer
identity and no money**: the response travels back out to a Mini Program, and what someone paid is
the store's to show.

`handleNanoFormulationOrderStatus` is kept but **has no caller** — nano and GCN deploy separately,
and leaving it means neither deploy order breaks the chat card. **Deploy GCN first.** Retire it once
nano prod is confirmed on the new endpoint.

### The order card leads with the tool, not the store (2026-09-01)

The Dots subtab has **one** order card and it only ever runs 营养定制 in the chat tab
(`handleGoFormulate`), gated on `!hasProposedFormula` — derived from `packages`, not from
`hasPlan`.

Buying without a formula is a real flow (§28c) but a worse one: the order parks at
`awaiting_formulation` and hands the buyer back the same job one screen later. And once a formula
*does* exist, the package row above already carries 按此配方下单, which passes the plan id so GCN
prices that exact recipe. A second card next to it opening `buy_custom_formulation` with no plan
id is a strictly worse route to the same product — which is why the old `handleOrderDots` and its
`orderDots*` strings were **removed**, not kept as a fallback. Don't reintroduce a store link
here; the package row is the buy path.

**The Neo dispenser entry point is off behind `neoAvailable: false`.** The hardware is not
shipping, so the bind card offered something nobody could act on. Gated rather than deleted:
nothing about the dispenser changed, and this is its only entry point. `neoBound` is still
permanently false and still gates the cartridge grid, the Dispense button and the order card's own
`!neoBound` — don't collapse the two flags into one.

## 28e. A Dots Package Is Bought With a Redeem Code (2026-09-01)

The direct checkout is retired. A store buys codes wholesale, resells them, and the holder redeems
one for the 28-day package it stands for — **with no payment step at redemption**.

Direct checkout was the wrong shape for how these are sold: the buyer is an end user, but the money
is owed to the **root supplier** that compounds the capsules while the order is attributed to the
buyer's bound store. That split is where the self-approved payment, the payee override and the
per-order 确认收款 all came from. Making it a wholesale order was rejected on GCN's side, because
`wholesale_transfer_out` would book stock of capsules compounded from one person's biomarkers. A
code has none of those problems — it is fungible, non-perishable and transferable, so stocking codes
is a genuine 补货订单 and the money moves once, in bulk.

**The mechanics live in GCN** (`migration_0088`, `handleFormulationCodeRedeem`, `skus.redeems_for_sku_id`,
`skus.wholesale_only`, `sku_activation_codes.holder_partner_id`). See its `CLAUDE.md`
§"Custom Dots sold as prepaid redeem codes" before changing anything about the flow.

### Why nano barely changed, and must not grow its own code table

Every "is a package waiting for me?" answer here comes from **one** source, `fetchFormulationOrders`
(`lib/gcnClient.js`), read live at three call sites:

| Call site | Breaks without a real GCN order |
|---|---|
| `_resolveOrderContext` (`handlers/dots.js`) | the chat card's `#order` mode never becomes `submit` |
| `handlePostFormulationSubmit` | refuses `no_awaiting_order` — the formula can never be submitted |
| `_fetchFormulationPackages` | no package row, so no stage, no tracking, no scan CTA |

Redemption produces a real `orders` row exactly as a purchase did, so **none of those changed**. A
nano-local `formulation_codes` table (mirroring `viva_subscription_codes`) would mean merging a
second source into all three *and* would still leave the capsules with no order to be compounded and
shipped against. `viva_subscription_codes` stays where it belongs: a subscription is a pure
entitlement with nothing to ship, so a nano-local code is right there and wrong here.

### What did change

`handleFormulaOrder` sends `intent: 'redeem_formulation_code'` through the existing
`webview_tokens.context` bridge, and `t.formulaOrderCta` / `t.pkgOrderBtn` name a code rather than a
purchase. The plan id is still carried, and is **advisory only** — a code is not priced against a
recipe; nano attaches whatever formula the user has when they submit it. It is still sent because
the GCN page deploys independently of this miniapp and older builds of it read one.

GCN routes the old `buy_custom_formulation` intent to the same redeem screen, so a miniapp build
already in the wild keeps working. **Deploy GCN's `mall` and `web` together** — the redeem route and
the redeem screen are two halves of one flow.

**Verified end to end on dev** (2026-09-01), including the two halves nano owns: the 使用兑换码 CTA
carries `redeem_formulation_code` plus the plan id through the webview token, and a code-created
order is indistinguishable downstream — `_resolveOrderContext` reads `max_distinct_dots: 8` off it,
`handlePostFormulationSubmit` correctly refuses a 17-dot proposal made before any package existed,
and a re-run of 营养定制 caps to 8 (+`DOT-N7`, which is never counted) and submits to `compounding`.

The order card in Plans ▸ Dots is unchanged and still runs 营养定制: formulate first, then redeem.
Where a code comes from is answered on the redeem screen ("your store provides this code"), which is
the only surface that can say it truthfully.

## 28f. 营养定制 Proposes Three Packages (2026-09-10)

With **nothing waiting**, the chat tool proposes **three complete formulas** — one per purchasable
package (§28c) — with the one matched to this user open and the other two collapsed beside it. Each
carries the store's own positioning line and a line written for this user.

Before this the tool proposed one formula and bolted two "+2" upgrade rungs underneath it, styled
as deliberately subordinate. That was right while the tiers were merchandised as 6种/8种/10种. GCN's
`migration_0107`/`0108` renamed them off their dot counts and gave each a positioning line, so a
shopper now reads three **products**, and a card saying "here is your formula, plus two add-ons"
describes something the store no longer sells.

Before *that* (until 2026-09-07) the tool formulated against no ceiling at all, so a proposal was
routinely wider than any package sold — prod's `c40d46a4` held a 17-dot one — and unpurchasable the
moment a code was spent on it.

### The model ranks; the server partitions. Do not move that line.

The tail is `{"action":"formulate_dots","ranking":[{dot_key, why}, …]}` — no `tier` tags, no
`upgrades` array, no counts, no `weeks`. Those were removed on 2026-09-07 after **nine measured
qwen-plus runs** in which it never once produced the requested partition (17/0/0, 7/6/4, 9/4/4 ×3,
4/0/0 ×2, 6/3/2), and one revision of the instruction pushed it to zero 13 of 17 dots and emit no
ladder at all. `_capDistinctDots`'s `tierByKey` parameter is the vestige of it and is `undefined` at
every production call site; only `tests/formula-tier-ladder.test.js` exercises it.

The prompt says so in as many words — 你不需要、也不要自己挑出哪几种属于哪一款 — and asks for
**`rankTarget` = the widest package's width** entries, because the entries after the narrowest
package's width *are* the wider packages.

### Each package is dosed as its own formula — `_equalizeToTarget`

Until 2026-09-10 every variant was `_capDistinctDots` applied to the **same** allocation, so the
doses were byte-identical across widths. Measured on dev proposal 38864: **79 dots a day at the
6-wide package against 109 at the 10-wide**, out of a 144 capacity. 轻享 was not a lighter formula,
it was the expensive one with four dots deleted and 45% of the capsule empty — and nothing about it
said 基础均衡.

`_equalizeToTarget` is the mirror of `_fitRecipeToDailyBudget`, which by contract only ever takes
away. It runs inside `_buildTierLadder`'s width loop, **after** the cap and before
`_ladderAdditions`. Same allocation now delivers 98 / 109 / 109.

**Parity is the goal, not a guarantee.** A narrow package can only carry what its own dots' ceilings
allow, and several real dots top out at 1-3 (`DOT-N3`, `DOT-N10`, `DOT-N13`, `DOT-N18`). Live dev run
(plan 38865): 61 → **91** at 6-wide, where 91 is exactly the sum of that package's six ceilings;
100 → **144** at 8-wide, stopped by the capsule budget; 150 unchanged at 10-wide. Do not "fix" a
package that lands short — it is at an authored limit, and passing it is what `dose_above_max`
exists to refuse.

**The target is the widest variant's own daily total, never the raw `2 × MAX_DOTS_PER_CAPSULE`.**
This equalises what the packages deliver; it does not fill capsules. Dosing a package above what the
formulator prescribed for the whole formulary is padding, which every other dose path in this file
refuses to do — so the widest variant is the ceiling and is returned byte-identical.

Three constraints, all load-bearing:

1. **No dot passes its own `target_dots_max`**, and a dot with no authored range is not raised at
   all. `validateAgFormulation`'s `dose_above_max` is a refusal, not a warning.
2. **A locked dot (`timing_flexible = false`) stays inside one capsule.** It cannot be moved between
   capsules by `_balanceCapsules` or by `_fitRecipeToDailyBudget` stage 1, so an over-full locked
   slot is resolved downstream by **dropping a whole dot** — an equalisation that removes an
   intervention is the worst outcome available here.
3. **It only ever adds.** Never below what came in, and never a change of membership.

`weeks` / `levels` / `order` ride through untouched. `_fitRecipeToDailyBudget` may drop them because
it runs last inside the per-week loop; this runs long before that, and `_capDistinctDots`'s ranking
downstream reads all three.

**Membership still nests strictly**, because `_capDistinctDots` still ranks the same `full`
allocation at every width and a week's top 6 are always inside its top 8. Do not re-rank per
variant — that can drop from the wide variant a dot the narrow one kept, i.e. an upgrade that takes
something away.

### A width is PER WEEK, and every variant carries its own rotation

§28c's rule is untouched: a 6种 formula may run six dots this week and a partly different six next
week, so its four weeks together can contain well more than six distinct dots. Each variant is built
by **`_capDistinctDots`** — the same cap that binds a purchased package — which caps each week
independently and returns that variant's own `weeks` map. `_countDistinctDots` (the widest week) is
what both the card and `handlePostFormulationSubmit` compare against.

The tier tag rides into that ranking via `_capDistinctDots`'s optional `tierByKey`, which nothing
passes today. `_padCandidatesFor` fills the upper packages when GENERATE curates below the widest
width — live dev runs returned six dots where a single-shot completion of the same prompt gave
seventeen, and six is the narrowest package, so the wider variants collapse as duplicates and no
choice appears at all. **Padding never reaches the core**: it runs only once the model has filled
the narrowest width itself, and a padded dot is untagged so it sorts behind everything the model
chose.

### Which package is recommended

`_recommendedWidth`: the narrowest that carries **every dot the model itself asked for**, measured
from `distinct.size` captured at the top of `_buildTierLadder` **before** the padding loop. Widest
as the fallback.

The claim is only *your recommended protocol needs N slots, and this is the narrowest package with
N* — a fact about the allocation, not about the product. It is server-computed and never model
prose, so it sits outside everything JUDGE grades.

**A padded dot must not widen it.** Padding completes the ladder, not the protocol; letting one
count would recommend the top package on every proposal and make the badge mean nothing.

### The card

`#tier|<label>|<width>|<rec>` starts a package; every `#day` group and row after it belongs to it
until the next `#tier`. `#note` is the store's positioning line and `#pitch` the one written for
this user; both are optional and both rejoin their tail on `|`.

- **`#rung` is retired and no longer written**, but is still **parsed** — chat history is permanent
  and every card written before 2026-09-10 contains one. `_ladderAdditions` outlived its own output:
  nothing renders `added` any more, and its remaining job inside `_buildTierLadder` is the one that
  was always load-bearing — **a width that adds nothing over the one below it is not a package**, so
  it is skipped rather than shown as a duplicate the buyer is asked to choose between.
- **A card with no `#tier` becomes one unnamed open package**, so `main.wxml` has a single code
  path. That covers every legacy card and every user who already holds a package.
- **The card states no dot count and no "+N over the one below."** What separates the packages is a
  product decision moving beyond "how many kinds of dot" (§28c), so a number here would be the first
  thing to go stale — and it is the one claim on this card a user cannot check for themselves. A
  collapsed package shows its name, the store's positioning line and its **actual dot roster**; the
  open one shows the whole formula. `<width>` still rides in the `#tier` line as data, but nothing
  renders it, and the parser deliberately derives no `dotCount`/`more` for anything to reach for.
- **The whole collapsed package is the tap target**, not its title row. Measured 2026-09-10 after a
  real-device report: with `bindtap` on the header alone, **19%** of a collapsed block was live —
  a 17px strip — and the positioning line and dot roster, i.e. everything a finger aims at, did
  nothing. Now 73%. When a package is OPEN only its title row and positioning line collapse it: a
  tap on the chart being read must not close it. A `⌄`/`⌃` chevron supplies the affordance, without
  which the collapsed packages read as static summaries — which is how they were reported.
  - **`bindtap` on a bare `<text>` does not fire**; it works on a wrapping `<view>`. Confirmed live
    with the identical handler and `data-*` on both.
  - **An automator `tap()` by selector proves the handler is wired, not that a finger can reach
    it.** The tap test passed throughout. Measure coverage instead — `tools/wechat-automator/README.md`.
- Bar widths normalise against the largest capsule across **all** groups of **all** packages, so the
  visible difference between them is the number of colour segments rather than the bar length —
  which is the honest reading, since the daily loads are now equal by construction.
- **The CTA follows the OPEN package** (2026-09-10, reversing the one-shared-CTA rule that stood
  here — "which tier a user gets is decided by whichever redeem code they hold, not by what they
  tap"). That stopped being true: a shopper can buy a specific tier's 兑换码 from their own bound
  store, and may already hold codes for several. Three branches, resolved in `_formulaCtaFor` and
  stored on the segment as `seg.cta` because WXML cannot join a tier against the codes list:

  | state for THAT tier | line above | button | action |
  |---|---|---|---|
  | order at `pending_payment` | `<tier>订单待支付` | 去支付 | `pay_order` intent on that order |
  | unredeemed fast-track code | `你已购买<tier>` | 开始配制 | the code sheet, prefilled with that code |
  | neither | — | 购买<tier> | `buy_formulation_package` intent, addressed by WIDTH |

  **The unpaid check comes first**, or a buyer who already ordered that tier is sent to order it
  again — GCN refuses a second with `formulation_already_in_progress`, so it dead-ends.

  **EXACT width match.** A wider code compounds its own variant (`_selectTierVariant` takes the
  widest the code covers), so offering 开始配制 on a narrower package while holding a wider code
  would compound a formula other than the one on screen.

  **Addressed by width, never by sku id.** §28c's ban is why: a stale client-side formulation sku
  broke both checkouts in the sandbox on 2026-08-22, and this card is a stored chat message that
  would freeze one for good. GCN resolves width → sku against the buyer's own listed items
  (`openFormulationPackageByWidth`), and what a shopper can actually buy is the **兑换码** sku —
  `handleStoreItems` strips any sku another active sku redeems for.

  `seg.cta` is recomputed on all three of its inputs: when the card is built, when a package is
  opened, and when `_loadDots` lands the codes/packages lists (`_refreshFormulaCtas`). A card with
  no packages has no `cta` and falls back to the generic redeem CTA.
- `handleFormulaTierToggle` is a **radio, not a checkbox** — two open charts in one bubble is the
  stacked layout the collapsing exists to avoid — and is addressed by message + segment + tier index
  because a transcript can hold several formula cards, each remembering its own open package.

### The copy: the store's line, and one written here

The tagline comes from GCN (`skus.description` → `tier_description` on
`GET /api/mall/nano/formulation-packages` → `fetchFormulationTiers` → `llmContext.formulation_tiers`).
It is **not** re-written on this side: a package reading one way on the shelf and another in chat is
the defect `migration_0107` fixed for the tier name, one line lower.

**`lib/tierCopy.js`** (was `rungCopy.js`) writes the per-user line — one per package including the
narrowest, from a short scoped second call that is **shown** the dots it is describing, so the
sentence and the chart under it cannot disagree. It never cites a dose, because it is never given
one. It is never fatal: a package with no pitch renders as its dots alone.

`_tierPitch` drops a pitch outright if it names any dot that package does not hold — found live on
dev, where the model narrated one split and tagged a different one. **Drops, never repairs.**

Pitches are humanized (`humanizeDotCodes`) **inside `tierCopy.js`, before placement**, because
`dotNames.js` deliberately refuses to rewrite anything between `:::` fences and a `#pitch` line
lives inside one.

### Storage is unchanged, and there is no migration

`proposed_recipe.morning`/`evening` stays the **narrowest** variant. Every reader that predates
`tiers` — `_activateProposedPlan`, `handleGetFormulationCheckoutSnapshot`,
`_getCommittedPlanDay0Breakdown` (the printed label), `_packageRow.distinct_dots` — keeps working
and sees a recipe that fits any package sold. `handlePostFormulationSubmit` picks the widest variant
the redeemed code covers (`_selectTierVariant`) and collapses the row to it. §28c's over-tier
refusal is untouched and still fires for a plan with no `tiers`.

The base's per-dot day-0 numbers are now higher, so the printed label and the checkout snapshot
report what a 轻享 code actually compounds. That is correct — and it does mean a label printed
before this differs from one printed after.

### The guardrail is scoped to the package line, in three places

Aspirational product copy collides with the always-injected essential block, which reads every claim
as a clinical one. The exception used to name the `"upgrades"` field — gone from the prompts since
2026-09-07, and never covering the narrowest package at all — and now names the card's per-package
positioning line. It is a **permission plus a restatement of the hard bans**: no onset window,
improvement magnitude, numeric forecast, guarantee, invented mechanism, or price; dot names still
verbatim.

Per §26/§37 it lives in `knowledge_entries` (`migration_knowledge_tier_copy.sql`),
`lib/knowledgeBase.js`'s `FALLBACK_ESSENTIAL_BLOCK`, and `prompts/chat/factConstraint.js` —
**change all three together**, or a transient DB error silently returns the model to refusing to
write package copy at all. `planTemplate.js` and `judgeTemplate.js` were taught the tail for the
reason §27 and §37 both record: an unrecognised action tail is graded as an unsupported claim and
burns REVISE rounds. **Keep JUDGE's DELIBERATELY NARROW clause** — it is what stops a six-dot
package being graded as `plan_drift`.

## 28g. Viva Can Answer "What Have I Bought?" (2026-09-10)

`get_formulation_packages` (`lib/agenticTools.js`) is how the chat model learns what the user has
actually **purchased** of 原粒 · 定制营养素 · 28天 — the order, its stage, unredeemed codes they
hold, and the three packages the store sells. Before it, nothing in chat could see an order.

A user asked 「我已经买了什么原粒套餐?」 and got *"你目前已激活并正在使用的原粒共17款…剩余800粒…"*.
On dev that user had **no `active` plan at all**, `custom_formulation_purchased_at` NULL, and two
28天 orders sitting at `pending_payment`. The 17 dots came from `get_dot_inventory` →
`user_cartridges`, the **Neo dispenser's** cartridge table (800 dots per cartridge, hence 剩余800粒)
for hardware §28d gated off — legacy rows that cannot grow, narrated as a live regimen.

**JUDGE passed it, and would again.** The answer *was* grounded, in the wrong table. §27 records
the class: JUDGE checks facts, not relevance. So relevance had to be fixed structurally, not by
grading harder.

### The fix is deterministic, because a prompt hope is not a fix here

`messageAsksAboutFormulationPackage` (`prompts/chat/formulationPackageBlock.js`) force-queues the
tool, exactly as `messageNeedsBiomarkerHistory` already does — PLAN decides `tools_needed` with an
LLM and is unreliable, and §28f's nine measured qwen-plus runs are the standing reminder of what
betting on model compliance costs.

The same regex **also promotes two intents to `nutrition_question`** in `handlePostChat`, before the
`launch_tool` branch, and each has a measured failure behind it:

- **`formulate_dots`** — that branch is not a degraded answer, it is a wrong *action*.
  「我已经买了什么原粒套餐」 is one word away from a request to formulate, and misreading it starts a
  brand-new formulation instead of answering.
- **`casual_chat`** — it is not in `HIGH_RISK_INTENTS`, so it has no tools and its template renders
  no package block. 「我的订单到哪了」 classified there on dev and came back with `factConstraint`'s
  canned 联系客服 line: the right answer for a model with no order data, the wrong one when a tool
  could have fetched it. Only these two are promoted; every other intent either already has the
  tools or is answering a different question.

**It must never match the Formulate-Dots trigger message** (`请根据我的完整健康数据…`), which rides
the same `runAgenticTurn`. Anchor on purchase vocabulary — 买/订单/付款/发货/物流/兑换码 — never on
方案/配方/定制 alone. A test pins both halves.

### The model narrates; the server writes the stage sentence

`PACKAGE_STAGE_NARRATION` (`handlers/dots.js`, directly below `PACKAGE_STAGES`) holds one
`{meaning, next_step}` per stage per language, and the tool projects them onto each row. Same
division §28f draws for the card ("the model ranks; the server partitions") and §37 for product
copy ("the model picks, the server writes").

> ### The stage vocabulary is code, in two places, and neither is a prompt
>
> 1. `handlers/dots.js` — the `PACKAGE_STAGES` set and `PACKAGE_STAGE_NARRATION` beside it.
> 2. `pages/main/main.js` — `pkgStage_<stage>` in **both** `T.zh` and `T.en`.
> 3. Nothing else. **The chat prompt never learns a stage string.** A prompt enumerating them
>    would be a third definition in the one medium where drift is invisible: rename a stage in
>    code and the prompt keeps narrating the old meaning, confidently, forever.
>
> `tests/chat-formulation-package-tool.test.js` enforces 1 against 2 and asserts 3 against the
> **rendered** block (the module's header comment may name a stage while explaining the bug — a
> comment is not something the model reads).

`next_step` is empty wherever the honest answer is "nothing, wait" — `awaiting_ag` most of all,
where the whole point of the premium package is that it asks nothing of the user.

**The raw `stage` enum is not sent at all.** Given it alongside the sentence, the model quoted the
machine value into user prose — 状态均为"**pending_payment**" — which is the exact thing the
sentence exists to prevent (dev, 2026-09-10). `stage_meaning` is already distinct per stage, so the
enum adds nothing a reply can use. `plan_status` is withheld for the same reason and replaced by
**`formula_status`**, a second server-written sentence: handed only a null, the model invented a
dot roster for two unformulated orders — *"两套方案中都已包含原粒6号、9号、7号"* — and **JUDGE
passed it**, because every dot it named was real. A null field is an invitation to fill it in; a
sentence saying "nobody has decided what goes in this yet" is not.

Three wording rules in the block exist because a live run produced each one: don't quote a field
name back to the user; you may still give dot **advice**, but never as "already in your package";
and `max_distinct_dots` is a weekly cap ("up to N"), never a content list. A fourth — that paying
does not itself generate a formula (§28c: the fast track needs the user to run 营养定制 again) — is
phrased as a constraint on wording rather than as a fact to relay, because the first, emphatic
version was copied verbatim into a reply that had just contradicted it one sentence earlier.

### Three details that each have a bug behind them

**A flat array, never a `{packages, codes, tiers}` wrapper.** `extractToolGroundTruth` normalises
a result with `Array.isArray(data) ? data : (Array.isArray(data.tests) ? data.tests : [data])`, so
a wrapper is treated as one row and nothing is harvested — real order dates would never reach
`extraValidDates` and `verifyBiomarkerGrounding` would rewrite a correct answer away as a
fabrication (§21 step 6). The `data.tests` branch is already the fossil of one such wrapper; don't
add the second. `ordered_at`/`shipped_at`/`sold_at` joined `DATE_FIELDS` for the same reason.

**Dates are emitted date-only.** `formatToShanghai` returns an **offsetless** `yyyy-MM-dd HH:mm:ss`
and `addDate` re-parses it with `new Date(...)`, which reads it in the process timezone (UTC on FC)
and applies +8 again — every timestamp at or after 16:00 Shanghai would be allowlisted under the
following day. A bare `YYYY-MM-DD` is parsed as UTC midnight by spec, so the round trip is exact.
*The same skew still affects `get_biomarkers`/`get_biomarker_history`'s `tested_at`; not fixed
here, and worth its own pass.*

**Degraded is not empty.** All three fetchers swallow every failure and return `[]`, so "GCN is
unreachable" and "you have bought nothing" are byte-identical to the model — this bug relocated.
`fetchFormulationTiers` is user-independent and returns three rows in a healthy system, so **all
three sources empty at once** returns `{ok:false}` with an explicit "do not tell them they have no
packages". The conjunction matters: a nano-side `proposed` plan still answers while GCN is down.

### What the model is not given

No `order_id`, `plan_id`, `submit_plan_id`, `sku_id`, `label_code`, and **not the redeem code
string** — redeeming happens in the app, so the model has no use for it, and a value it was never
given is one it cannot leak (§37's rule for prices). No price exists in any of the three sources
and none may be added: nano does not price this product, a store sells the code upstream. `tier`
rows carry no width either — §28f took that number off the card, and on the catalog it is a
merchandising claim rather than a fact about something the user owns.

### `get_dot_inventory` was removed from the tool set

The handler and `user_cartridges` stay so the dispenser can be re-enabled; only the tool def and
impl are gone. **Removing a tool means removing every prompt that names it** — three shipping
prompts did (`prompts/{nano,viva}/systemFormulaGenerate.js`), and the formulation turn runs the
*same* `AGENTIC_TOOL_DEFS`, so leaving one would burn a GENERATE iteration on `unknown tool`.
`tests/chat-formulation-package-tool.test.js` scans every prompt for `\bget_[a-z_]+` and fails on
any name that is not a real tool. (The `\b` is load-bearing: `target_dots_min` contains
`get_dots_min`.)

### A latent bug fixed in passing: a turn that replies with nothing

Each forced tool burns one GENERATE iteration, so three forced tools left `rawReply === ''` — JUDGE
graded an empty string and `finalizeChatReply` shipped its canned acknowledgement. A second
deterministic trigger made that likelier, so `buildForcedToolQueue` now caps the queue at
`GENERATE_MAX_ITERS - 1` (deterministic triggers first, PLAN's advisory ones after) and the final
iteration pins `tool_choice: 'none'`. §21's "generate ≤3" ceiling is unchanged.

`tool_choice:'none'` was **verified live** against DashScope qwen-plus on the exact message shape
this sees (history already holding a tool call and its result): `finish_reason` `stop`, zero tool
calls, real content. Re-probe before changing it — `agenticChat.js` already records one case where
DashScope diverged from the spec under a non-`auto` `tool_choice`.

### The essential block's logistics ban was NOT narrowed

`factConstraint.js` forbids inferring 物流/配送时效 and prescribes a canned 联系客服 line — the exact
shape "发货了吗" fires. Its existing carve-out (*未在本次对话中明确提供*) already covers data the
tool supplied this turn, so the new block only restates that locally. **If a dev run on a
`shipped` order still returns the 联系客服 line, that is the signal to do §26/§37's three-site
narrowing** — the `knowledge_entries` row, `FALLBACK_ESSENTIAL_BLOCK`, and `factConstraint.js`'s
`FALLBACK_ZH`/`FALLBACK_EN`, all together, or a transient DB error silently restores the refusal.

### Nothing changed in GCN

`fetchFormulationOrders`/`fetchFormulationCodes`/`fetchFormulationTiers` already wrapped three
served `requireNanoService` endpoints carrying every field kept here. No migration, no GCN deploy,
no miniapp change. *Know, don't change:* `fetchFormulationTiers` is not store-scoped, so `tier`
rows are the global catalog — the same source the formula card uses, so chat and card agree, but
the block describes packages and never tells the user where to buy one.

