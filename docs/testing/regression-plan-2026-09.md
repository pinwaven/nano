# Regression test plan — Nano + GCN (2026-09)

A repeatable, tiered checklist for a full-build regression pass across `nano` and the sibling `gcn`
repo. Priority = recent churn × blast radius × (no existing automated pin). Results for the
2026-09-15 run: [regression-findings-2026-09-15.md](regression-findings-2026-09-15.md). ☑ = passed
that run, ☒ = finding filed (id), ☐ = not exercised.

## Ground rules

- **Dev is read/write; prod is read-only** (Tier-7 SQL sweeps + `s <fn> info` only — never a write,
  never a chat turn). Name every dev fixture in the findings doc for cleanup.
- **Never** `freshStart`/`cleanup.js` in `tools/wechat-automator` — its pkill matches the real WeChat
  desktop app. Use `connect(port)` or `launch({port:<free>})`.
- No deploys, no commits — the user does both.
- Tokens never printed. Phone numbers/openids redacted in any recorded output.

## Tooling

- HTTP probe: `scratchpad/probe.js <base> <TOKEN_ENV|none> "<METHOD> <path> [json]" …` (reads
  `.env`, one line per request, tokens never echoed). Bases: `https://nano-dev.gcn.net/api`,
  `https://edge-dev.gcn.net` (GCN API edge — **not** `GCN_API_BASE_URL`, which is protocol-less in
  `s.yaml`), `https://aeviva-dev.gcn.net`.
- Sandbox chat runner: `scratchpad/chat.js <openid> <label> <message> [extraJson]` — writes the JSON
  and scans the reply for tool-name / sub-age-key / dot-code / json-tail / canned-refusal / stage-enum
  leaks outside `:::` fences.
- SQL sweeps: `scratchpad/t7-sweeps.sql` (`psql "$DATABASE_URL" -f …`, and `$DATABASE_URL_PROD`).
- Miniapp: `tools/wechat-automator` `connect(22090)`; drive `_sendMessage('…')`, `_loadDots(user,
  lang)`, `_poll(user)` via `page.callMethod`; **measure tap coverage with a `boundingClientRect`
  selector query**, never trust that `tap()` reaching a handler means a finger can.

## Tier 0 — automated suites (offline, ~1 min)

- ☑ **T0.1** `npm test` (both repos) → 0 fail. (nano 689, GCN 296.)
- ☑ **T0.2** contract self-consistency tests still cover their claim: `doc-extraction-contract`,
  `chat-formulation-package-tool` (prompt tool-name scan; `PACKAGE_STAGES` ⇄ `pkgStage_*` ⇄
  narration), `migration-ordering`, `food-sensitivity-tool`, `chat-meal-plan-guard`.
- ☑ **T0.3** static invariants (now `tests/static-invariants.test.js`): pool caps (§32);
  `AI_ECHO_TYPES` ⊇ every dual-write type; `VIVA_AG_ALLOWED_PATHS` ⇄ openapi; the two essential-block
  fallbacks byte-identical; every `t.*` key resolves in both `T.zh` and `T.en`.

## Tier 1 — worker auth & route matrix (HTTP, dev)

- ☑ **T1.1** branch order (`index.js:299-395`): none/junk/`ch.`→401; `vag_`/`dex_`/gcn off-allowlist
  → 403; cross-service token → 403; own ping → 200.
- ☑ **T1.2** public routes need no token (`/formulation-label`, `/box/:code`, `/academy/verify/*`,
  `/admin/login`, `/qr-login/*`, `/phone-otp/*`, root verify file).
- ☒ **F1.1** `/phone-otp/*` is exempt **and** unowned — unauth phone read + account-takeover bind.
- ☑ **T1.3** sandbox short-circuit: `sandbox:true` reaches the handler for `/chat` and `/health-advice`;
  returns `{success:true,sandbox:true}` for any other POST.
- ☑ **T1.4** both directions of the GCN service token (17 nano paths reachable; 11 GCN `requireNanoService`
  routes gated).
- ☑ **T1.5** `/viva-ag/{ping,docs,openapi.json}`, `/doc-extract/{ping,docs,openapi.json,catalog}` serve.
- ☒ **F1.4** unknown POST falls to `handlePostChat` → 500 (should be 404).

## Tier 2 — chat pipeline (dev, real LLM, `sandbox:true` for speed)

- ☑ **T2.1** intent routing (the WIP guards): meal-plan → no `launch_tool`; 「我要定制营养素」 →
  `launch_tool`; package / food-sensitivity tools force-queued; casual sync.
- ☑ **T2.2/T2.3** sub-age keys & dot codes stripped from prose, `:::` fences untouched
  (☒ F2.2 double-label — fixed; ☒ F3.2 override data defeats it for en users).
- ☑ **T2.4** async delivery: `{processing:true}`, both channels written, `chat_generate_events` grows.
- ☑ **T2.5** history grounding not rewritten.
- ☑ **T2.6** Formulate Dots: no-BioAge refusal / three-tier card / order-mode transitions.
- ☑ **T2.7** health-advice sync + async.
- ☒ **F2.1** tool-name leak (being fixed: `toolNameScrub.js`). ☒ **F2.5** JUDGE misses package-content/
  population claims. ☐ **T2.8** check-in (dormant — 0 active plans). ☐ **T2.9** `:::product`
  (dormant — `product_ai_profiles` empty).

## Tier 3 — cross-repo journeys (dev, nano ⇄ aeviva)

- ☑ **T3.1** SSO exchange (single-use token, context echo, `coach_user_id`, phone mirror).
- ☑ **T3.2** fast-track: formulate → submit → GCN `compounding` + `nano_label_code`; idempotent.
- ☑ **T3.3** box claim: activate, non-transferable, idempotent, `box_not_found`.
- ☑ **T3.5** public label wording & no-identity JSON.
- ☑ **T3.7** waven-sector isolation (static).
- ☐ **T3.4** full AG re-run (light claim ✓; SKIP LOCKED + fencing pinned by unit tests).
- ☐ **T3.6** ai-catalog exclusion list (dormant — no profiles). ☐ **T3.8** coach-store binding
  (Pin not a store partner on GCN dev). ☒ **F3.4** codes not fetched cross-sector.

## Tier 4 — miniapp (live DevTools via automator)

- ☑ **T4.1** sync reply renders once; `chat_messages` replay backstops a lost poll.
- ☑ **T4.3** Dots subtab reflects live package/plan state (stage labels, `submit_plan_id`, Neo hidden).
- ☑ **T4.4** health tab: twin 4/4 layers, food-sensitivity keys, health-documents (upload in self
  mode, extraction status).
- ☐ **T4.2** three-package card tap-coverage — only single-tier submit cards were on the transcript
  this run; re-measure with a fresh `#order|buy` card. ☐ **T4.5/T4.6/T4.7** coach app, chrome, real
  device.

## Tier 5 — admin surfaces

- ☑ **T5.1** web admin builds; every list endpoint returns through the proxy.
- ☑ **T5.2** channel-admin scoping pinned by `coach-channel-scope.test.js` (not re-verified live).
- ☐ **T5.3** miniapp admin/superadmin pages; the `[object Object]` ingredients hazard (§40).

## Tier 6 — background & infra

- ☑ **T6.5** deployed-vs-source diff (see findings: dev kino behind prod; prod worker behind HEAD+WIP).
- ☑ **T6.4** `pg_stat_activity` healthy (`nano_admin` ≤ 3+dev).
- ☑ **T6.1** EventBridge routing exercised indirectly (async chat + formulation delivered).
- ☐ **T6.2/T6.3** dispatcher tick dedupe; lease sweep (pinned by unit tests).

## Tier 7 — data-integrity sweeps (`scratchpad/t7-sweeps.sql`, dev + prod, read-only)

Run `psql "$DATABASE_URL" -f t7-sweeps.sql` and again with `$DATABASE_URL_PROD`. Every non-zero
count is a finding. This run: ☒ **F7.1** (prod extraction never ran), ☒ **F7.2** (notification
backlog); F7.4/F7.5/F7.6 minor. Everything else 0.

## Tier 8 — security invariants (dev)

- ☒ **F8.1** `/oss/presign` per-object hole (known, §35 — do not widen).
- ☑ coach cannot read/write another client's documents; foreign-plan submit refused; AG questionnaire
  security fields stripped; report links neutralised.

## Verification of the pass itself

- `npm test` green in both repos, run once with all changes on the tree.
- Findings doc lists baseline numbers, the deployed-vs-source table, and every non-zero sweep.
- No deploys, no commits, no prod writes; dev fixtures enumerated for cleanup.
