# Intent Routing — the UNDERSTAND Step

Record of why the message-only intent classifier was replaced, what replaced it, what was
measured, and what was deliberately *not* built. Rules summary: CLAUDE.md §47.

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
