# Intent Routing — the UNDERSTAND Step

Record of why the message-only intent classifier was replaced, what replaced it, what was
measured, and what was deliberately *not* built. Rules summary: CLAUDE.md §47. How it runs on a
turn — inputs, output, what is consumed, logs, config, and how to extend it — is the
[Runtime reference](#runtime-reference) at the end.

## The problem

`handlePostChat` classified every message with one `qwen-plus` call at `max_tokens: 60`, seeing
**only the message** — no conversation history, no user state — and picked one of 8 labels.

The label does not pick the wording of the answer. It picks the **template**: which rules, data,
tools and vocabulary the model is handed. So a misread label does not produce a slightly worse
answer, it produces an answer written in the wrong world. On 2026-09-22 a request for an exercise
plan (「根据我的情况定制运动方案」) was classified `nutrition_question`, PLAN duly requested the
grocery tool, `buildForcedToolQueue` pinned `tool_choice` to it, and the user received a
supermarket substitution table for a meal plan from a week earlier.

Two structural weaknesses, not one bad prompt:

1. **No context.** 「那运动呢？」, 「刚才说错了，是男」, 「内容呢？」 are unclassifiable from the
   message alone. The classifier scored 76.9% on messages that need history, 50% on a held-out
   slice of them.
2. **A closed enum with no reasoning step.** The model emitted a label directly, so a message that
   did not resemble any of the 8 descriptions fell to `casual_chat` — the one route with *no
   tools at all*.

Five deterministic regex backstops (`messageAsksForMealPlan`, `…FormulationPackage`,
`…FoodSensitivity`, `…Wearable`, `…LifestylePlan`) had accumulated in ten days patching individual
cases of this. Each is correct; none generalises.

## What replaced it

`prompts/chat/understanding.js` + `lib/understanding.js`: one `qwen3.8-flash` call (thinking off — see *Model choice*) that sees the
message, **the last 4 turns** and **a one-line user state** (`has_kino`, `has_wearable`, an active
dots plan, up to 6 memory facts, active health plans), and answers in words before it names a
route — a resolved `request` in Chinese, an open `family` + `topics`, `continuation_of`, `needs`,
`actions`, `must_not`, `success_criteria`, `confidence`/`clarify`, and finally `route`.

The extra fields are not decoration: they are what makes it reason about the message before
routing it. Only `route`, `needs` and `request` are consumed downstream.

## Measured

Against hand labels, metric "the routed template is one the gold label accepts". The prompt was
frozen before the held-out set was built and labeled.

| slice | classifier | understanding |
|---|---|---|
| eval set (155 real prod messages + 29 recorded incidents) | 85.8% | **98.7%** |
| … needs conversation history (26) | 76.9% | **96.2%** |
| … recorded incidents (29) | 96.6% | **100%** |
| **held-out (67), labeled blind** | 88.1% | **94.0%** |
| … needs history (12) | 50.0% | **83.3%** |

Two of the classifier's held-out misses are `formulate_dots` false positives — in the miniapp that
route *starts a real formulation*, so those are wrong actions, not wrong answers.

Cost: ~6 s / ~3.2k tokens against 0.7 s / 1.3k, plus two small indexed queries. A thinking model
(`qwen3-235b-a22b-thinking`) scored no better at 3× the latency and was dropped.

**Run-to-run variance is real.** Re-scoring the *shipped* modules (`07-run-shipped.js`) gave
**96.1% and 96.8%** on the eval set and **97.0%** held out, against the single measured run's
98.7% / 94.0% — same prompt, `temperature: 0.1`. Read the table as "mid-90s vs mid-80s", not as
exact figures, and re-score twice before concluding that a prompt edit helped or hurt. The one
regression-set case that misses repeatedly (「我昨晚睡得怎么样」 → `record_action`) does so only
because the harness's hand-written cases carry no user state; with a real state row it routes to
`biomarker_question` 3/3. That is why `fetchUnderstandingInputs` returns `state: null` rather than
a row of `false`s when the lookup fails — an invented "this user has no ring" changes the route.

### Model choice (2026-09-23)

The figures above are qwen3-max. It was compared afterwards against cheaper models on the
**shipped** prompt and modules (`07-run-shipped.js`; `08-run-nothink.js` for thinking off), two
runs per set:

| | qwen3-max | qwen-plus-latest | **qwen3.8-flash, thinking off** |
|---|---|---|---|
| eval (155) | 96.1–96.8% | 95.5–96.1% | **97.4–98.1%** |
| held-out (67) | 97.0% | 94.0–95.5% | **95.5–97.0%** |
| median / p90 | 5.4–5.7 s / 6.7–7.1 s | 9.6–10.6 s / 12.4–13.3 s | 5.9–6.4 s / 7.9–9.0 s |
| tokens / call | ~3.2–3.4k | ~3.3–3.5k | ~3.3–3.4k |
| unusable output | 0 | 3 of 444 (a *family* name in `route`) | 0 |
| false `formulate_dots` | 0 | 「宏基因检测」, both runs | 0 |

qwen3.8-flash ships: accuracy ties qwen3-max within noise, it was picked over qwen3-max for cost, and it has
neither of qwen-plus's two failure shapes. **Thinking must stay off** (`enable_thinking: false`,
`UNDERSTANDING_THINKING` defaults to `off`): with the model's default reasoning a single call took
15–45 s and every call in a full run hit the 25 s timeout — which would silently hand every turn
back to the classifier.

## What was deliberately not built

The first design was a full harness: understand → compose → answer → read back → rewrite. Three
end-to-end rounds on dev, through the real `handlePostChat`, 14 pairs per round, graded blind
three times by a data-aware grader:

- **Round 1** graded each reply against the understanding's `success_criteria` and rewrote failures
  outside the agentic loop. It *lost*, 8–4, and every loss was a rewritten case. `success_criteria`
  are written before the data is seen, so they assume user traits; a grounded reply that reported
  the real numbers was failed for not matching the assumption, and the ungrounded rewrite then
  asserted it — in one case inventing biomarkers, in another dropping sleep-deprivation safety
  adaptations. **Criteria may describe the shape of a good answer, never its content, and there is
  never a rewrite outside the loop.**
- **Round 2** injected the full understanding (request, family, topics, must_not, criteria) into
  the system prompt and kept a narrow off-topic read-back: 9–4–1 *against*. The templates are
  heavily tuned; an extra meta-layer competes with them.
- **Round 3** injected one line — the resolved request: 8–5–1, within noise of round 2.

Split by whether the two routers actually disagreed (round 3):

| | understanding | classifier | tie |
|---|---|---|---|
| same route (11) | 3 | 7 | 1 |
| **different route (3)** | **2** | 1 | 0 |

3 of the 11 same-route cases flipped winner between two runs that routed *identically*, and the
new arm's mean score moved 0.52 between runs against 0.21 for re-grading fixed replies — so the
same-route column is noise. The whole measurable gain is in the turns where the routes differ, and
there it is large (2.0 → 5.0 on a bare 「16号是什么」, 3.0 → 5.0 on a symptom question, both
`casual_chat` misroutes).

**Conclusion: use it for routing and data needs only.** The only thing that reaches GENERATE is
`resolvedRequestLine()` — one line, only when `continuation_of` is set. The narrow off-topic check
lives where it belongs, in JUDGE's `off_topic` category (§21).

One loss survives the correct route: a 「心肌炎怎么办」-shaped symptom question routed to
`biomarker_question` opens with four sub-ages before answering. That is template content, fixable
independently of routing.

## Where the 6 seconds are actually paid

On real traffic a high-risk turn publishes a `chat.generate` event and returns immediately (§22),
so the understanding is paid in the *publishing* invocation and the agentic loop still gets a
fresh 300s invocation of its own. The only path that pays for both inside one invocation is a
`sandbox:true` turn (the admin "login as" preview), which runs the loop inline — its margin under
FC's 300s ceiling narrows by ~6s. Non-agentic intents (`casual_chat`, `emotional_support`) run
inline too, but finish in seconds.

## Rollout

`CHAT_UNDERSTANDING_MODE` — `off` | `shadow` (code default) | `on`.

- **shadow** runs both routers concurrently, lets the classifier decide, and logs every
  disagreement as `msg:'route_disagreement'` with the message and the resolved request. Prod runs
  this first: the measured win is entirely in the disagreements, so that log is the evidence.
- **on** lets the understanding decide; the classifier runs only when it fails (unparseable JSON,
  a route outside `VALID_ROUTES`, a 25s timeout). Dev runs this.
- The five regex backstops keep only their **demotions away from `formulate_dots`** once the
  understanding routes. The promotions are gated off — the accuracy above was measured without
  them, and they would override a route chosen deliberately.

To re-measure after any prompt edit: `temp/understanding-harness/07-run-shipped.js` scores the
shipped modules against both gold sets. The harness itself stays local — its data files are real
prod chat text.

## Runtime reference

### Where it runs

Only in `handlePostChat` (`handlers/chat.js`, "Step 1"), the one handler that has to work out what
a free-text message is. The other chat entry points already know their answer shape and never
route: `handlePostHealthAdvice` and `handlePostFormulaDots` have fixed templates, the daily
check-in (§29) has its own prompt, and `handleChatGenerateEvent` receives the intent and the
finished `systemPrompt` in the `chat.generate` payload (§22), so the async half never re-routes.

### One turn, step by step

```
handlePostChat
 ├─ mode = understandingMode()                       CHAT_UNDERSTANDING_MODE, default 'shadow'
 ├─ started concurrently:
 │    understanding  = fetchUnderstandingInputs() → runUnderstanding()     skipped when 'off'
 │    classifier     = intentClassifier (message only, max_tokens 60)      skipped when 'on'
 ├─ understandingRoutes = mode === 'on' && understanding.ok
 │    true  → intent = understanding.route, required_data = requiredDataFrom(needs)
 │    false → intent/required_data from the classifier
 │            ('on' + failed understanding starts the classifier only now: the one serial path)
 ├─ log 'Chat intent classified'   (routed_by, classifier_intent, understanding summary)
 ├─ five regex backstops           (the promotions only when !understandingRoutes)
 ├─ log 'route_disagreement'       (if the understanding's route ≠ the final intent)
 ├─ formulate_dots branch / optional fetches gated on required_data
 └─ systemPrompt = template(llmContext) + resolvedRequestLine()   (only when it routed and
                                                                  continuation_of is set)
```

In `shadow` the understanding is awaited even though it doesn't decide. It runs concurrently with
the classifier, so it adds the difference between the two (~5 s), not the sum. That sits inside
a sync turn's 30 s client wait (`CHAT_WAIT_SYNC_MS`, §22).

### Inputs — `fetchUnderstandingInputs(pool, user_id, personaType)`

Two queries in parallel, run **before** this turn's message is written to `chat_messages`, so the
history never includes the message being routed:

| input | source | shape |
|---|---|---|
| `history` | last 4 `chat_messages` rows, `role IN ('user','ai')`, same `persona_type` | oldest first, each capped at 600 chars (500 again inside the prompt) |
| `state` | one `users` row plus `EXISTS`/subqueries | `language`, `has_kino` (any `kino_chip` biomarker), `has_wearable` (`wearable_brand` set), `has_nutrition_plan` (an `active` plan), `facts` (≤6 active `user_memory_facts.fact_zh`), `health_plans` (active `custom_name_zh`) |

Either query failing degrades rather than throws: history becomes `[]`, and state becomes
`null`, which the prompt renders as `(unknown)`. It must not become a row of `false`s, because the
route depends on it (see *Measured*).

### Output — the JSON the prompt asks for

| field | meaning | consumed by |
|---|---|---|
| `reasoning` | 2–5 sentences of reading the message | nothing (it only makes the model think before routing) |
| `request` | the message restated in Chinese, continuations resolved | `resolvedRequestLine()`, both log lines |
| `family` | one of 17 open families (`explain_data`, `advice_plan`, `symptom_concern`, `meta_complaint`, `form_answer`, …) | logs only |
| `topics` | 1–4 free tags | logs only |
| `continuation_of` | `null` or the earlier turn this depends on | gates `resolvedRequestLine()` |
| `needs` | `{required:[], helpful:[]}` of tool names + `store_products` | `requiredDataFrom()` |
| `actions` | requested side effects | nothing — action tails are still parsed from the reply (§27) |
| `must_not`, `success_criteria` | shape-of-answer checks | nothing, deliberately (see *What was deliberately not built*) |
| `confidence`, `clarify` | how sure; one clarifying question if it isn't | logs only — no clarify flow exists |
| `route` | one of `VALID_ROUTES` | the intent, when it routes |

`family` is not `route`. Families describe what the user wants and routes pick one of the
existing templates. Several families share a route: `symptom_concern` and `explain_data` →
`biomarker_question`; `commerce` and `dots_question` → `nutrition_question`; `small_talk`,
`app_usage` and `meta_complaint` usually → `casual_chat`. The prompt's `ROUTES` list is what
teaches that mapping.

A response is **unusable** when it doesn't parse (after stripping ```` ``` ```` fences) or when
`route` is not in `VALID_ROUTES`. Either way the result is `{ok:false}` and the classifier routes
instead. There is no partial use and no repair.

### `needs` → `required_data`

The handler still gates its optional fetches on the classifier's older `required_data`
vocabulary. `requiredDataFrom()` translates the three needs that gate something:

| need | `required_data` key | counts when `helpful`? |
|---|---|---|
| `get_health_plan`, `get_nutrition_schedule` | `plan` | yes |
| `get_weight_history` | `weight_history` | yes |
| `store_products` | `store_products` | **no — `required` only** (§37: the catalog appears only when the user asked what they could obtain) |

Every other need is a no-op here. Biomarkers, BioAge, dots, twin and facts are fetched on every
turn regardless (§21, 06-chat-pipeline step 5), and the agentic loop's tools are chosen by PLAN,
not by this list.

### The regex backstops, by mode

| backstop (`reclassified_as_*`) | demotes `formulate_dots` → | promotes (classifier routed only) |
|---|---|---|
| `package_question` | `nutrition_question` | `casual_chat` → `nutrition_question` |
| `food_sensitivity_question` | `nutrition_question` | `casual_chat` → `nutrition_question` |
| `wearable_question` | — | `casual_chat` → `biomarker_question` |
| `meal_plan_question` | `nutrition_question` | — |
| `lifestyle_question` | `lifestyle_question` | `nutrition_question`/`casual_chat` → `lifestyle_question` |

The demotions apply in every mode, because they can only prevent a real formulation from starting.
The promotions apply only when `understandingRoutes` is false.

### Logs

All are single-line JSON (`console.log(JSON.stringify(...))`); grep on `msg`.

| `msg` | level | when | notable fields |
|---|---|---|---|
| `Chat intent classified` | INFO | every turn | `intent`, `required_data`, `mode`, `routed_by` (`understanding`\|`classifier`), `classifier_intent`, `understanding{route,request,family,topics,continuation_of,confidence,clarify,needs,ms,tokens}` |
| `route_disagreement` | INFO | the understanding's route ≠ the final intent (**after** the backstops) | `mode`, `routed`, `understanding_route`, `message` (≤200 chars), `request` |
| `understanding_unusable` | WARN | unparseable JSON or unknown route | `ms`, `route`, `raw` (≤300 chars, only if unparseable) |
| `understanding_failed` | WARN | the call threw (timeout, network, API error) | `ms`, `error` |
| `reclassified_as_*` | INFO | a backstop fired | `from` |

**Reading the shadow evidence.** On prod (`shadow`), `route_disagreement` shows each turn where the
understanding would have routed differently from what was shipped. Before switching prod to `on`,
sample those lines and hand-judge which route was right. The measured win lives entirely in these
turns (*What was deliberately not built*). A high rate of `understanding_failed` or
`understanding_unusable` means the model or timeout needs attention first; in `on` mode every one
of those is a turn that paid for both calls in series.

### Configuration

| env var | default | effect |
|---|---|---|
| `CHAT_UNDERSTANDING_MODE` | `shadow` | `off` \| `shadow` \| `on`; any other value → `shadow`. `s.yaml` = `on`, `s-prod.yaml` = `shadow` |
| `UNDERSTANDING_MODEL` | `qwen3.8-flash` | the model; set explicitly in both yamls |
| `UNDERSTANDING_THINKING` | `off` | `on` re-enables the model's reasoning — measured 15–45 s per call, i.e. every call times out |
| `UNDERSTANDING_TIMEOUT_MS` | `25000` | per-call timeout, passed to the SDK call |
| `CLASSIFIER_MODEL` | `MODEL` | the fallback classifier's model (unchanged) |

Temperature is fixed at 0.1 in code.

### Changing it

- **Prompt wording** (`prompts/chat/understanding.js`): the header comment is binding. Re-score
  with `temp/understanding-harness/07-run-shipped.js` twice, because the run-to-run spread (~2 points)
  is about as large as a reordering of guidance bullets can move the score.
- **A new route** means changing four places together: `VALID_ROUTES` (`lib/understanding.js`),
  both prompt maps in `handlers/chat.js`, the prompt's `ROUTES` list, and `HIGH_RISK_INTENTS` if
  it should run the agentic loop. The classifier (`intentClassifier.js`) should learn it too,
  since it is still the fallback and the prod router. `tests/chat-understanding.test.js` asserts
  that `VALID_ROUTES` equals the prompt maps plus `formulate_dots`.
- **A new optional fetch** that the understanding should trigger means an entry in
  `NEED_TO_REQUIRED_DATA` plus the need's name in the prompt's `NEEDS` list. Decide whether
  `helpful` is enough, the way `HELPFUL_EXCLUDED` decides for the store catalog.
- **Putting more of the understanding in front of GENERATE** was measured and lost (rounds 1–3).
  Re-run an end-to-end comparison before trying it again.

### Tests

`tests/chat-understanding.test.js` (offline, `node --test`) covers: prompt rendering with and
without history/state, the route set, the needs mapping and the `store_products` rule, a well-formed
response, fenced JSON, every failure shape → `ok:false`, the `shadow` default, the thinking switch,
`resolvedRequestLine` only on continuations, history order and query-failure degradation. It also
source-level asserts on `handlePostChat`: routing only in `on`, promotions gated / demotions not,
disagreement logged after the backstops, and concurrent routers in shadow.
