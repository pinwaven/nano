/**
 * Agentic plan -> generate -> judge -> revise loop for Viva's high-risk chat intents
 * (biomarker_question, nutrition_question, longevity_science, record_action).
 *
 * Extends the existing single-retry pattern in handlers/chat.js (grounding-check retry,
 * fabrication-risk retry) into a bounded loop with an up-front PLAN step and a semantic
 * JUDGE step, rather than only pattern-matching after the fact. Kept out of chat.js to
 * avoid growing an already large file further, alongside other lib/ cross-cutting modules
 * (factCheck.js, healthTwinUpdater.js).
 *
 * Hard ceilings per turn (never exceeded, matching the existing "one retry only, log and
 * ship if it still fails" precedent in chat.js's _regenerateIfFabricationRisk, but widened
 * to REVISE_MAX_ROUNDS after live dev testing on 2026-07-28 showed a single revise pass
 * sometimes left residual violations unfixed on multi-violation drafts):
 *   plan: 1 call, generate: <= GENERATE_MAX_ITERS iterations, judge: 1 call,
 *   revise: <= REVISE_MAX_ROUNDS calls, re-judge: <= REVISE_MAX_ROUNDS calls.
 */
'use strict';

const { AGENTIC_TOOL_DEFS, createAgenticToolHandlers } = require('./agenticTools');
const { detectAllRisks, detectDimensionMisattribution, detectDotNameMismatch } = require('./factCheck');
const { formatToShanghai } = require('./time-utils');
const { classifyBiomarkers, THRESHOLDS: BIOMARKER_THRESHOLDS, DIMENSION_BIOMARKERS } = require('./biomarkerStatus');
const planTemplate = require('../prompts/chat/planTemplate');
const judgeTemplate = require('../prompts/viva/judgeTemplate');
const { findRelevantEntries } = require('./knowledgeBase');
const { messageAsksAboutFormulationPackage } = require('../prompts/chat/formulationPackageBlock');

const GENERATE_MAX_ITERS = 3;
const REVISE_MAX_ROUNDS = 2;
const REAL_DIMENSIONS = new Set(['CellularAge', 'MetabolicAge', 'MicroVascularAge', 'ResilienceAge']);

// Deterministic backstop on top of PLAN's own (LLM-judged, unreliable) tools_needed field —
// PLAN sometimes returns an empty tools_needed for a message that obviously needs Kino test
// history, in which case nothing forces GENERATE toward get_biomarker_history at all and it
// can fall back to 'auto' and skip the tool entirely. Found via live dev testing 2026-08-05:
// "Kino测了几次？" got a confident, wrong "系统中仅存在这一份Kino检测...无其他Kino标记的检测记录"
// (only one test exists — false, ground truth was 63) with zero tool calls made. Cheap
// keyword match on the raw user message, same risk-acceptance level as every other
// regex-based heuristic in this codebase (extractBiomarkerMentions, etc.) — a false positive
// here just costs one extra harmless read-only tool call, never a wrong answer.
const BIOMARKER_HISTORY_TRIGGER_RE = /(几次|多少次|哪几次|历次|累计.*(测|检测|检查)|一共.*(测|检测|检查)|对比|比较|历史(检测|记录|数据)?|之前的?(检测|数据|结果)|以前的?(检测|数据|结果)|上一?次|两次|每次|变化趋势|趋势)|(how many (times|tests)|compare|history|trend|previous test|last two|change over time)/i;
function messageNeedsBiomarkerHistory(message) {
    return BIOMARKER_HISTORY_TRIGGER_RE.test(message || '');
}

// Which tools GENERATE is FORCED to call, in order, before it is allowed to write prose.
//
// Deterministic triggers come first, because they are the ones we know are needed from the
// message itself; PLAN's tools_needed is LLM-judged and advisory. Both are capped at
// GENERATE_MAX_ITERS - 1: each forced tool burns one iteration, so forcing all three leaves the
// loop with nothing but tool calls and it exits with rawReply === '' — which JUDGE then grades
// and finalizeChatReply ships as a canned acknowledgement. One iteration is always reserved for
// the reply itself.
function buildForcedToolQueue(plan, message, validToolNames, maxForced) {
    const deterministic = [
        ...(messageNeedsBiomarkerHistory(message) ? ['get_biomarker_history'] : []),
        ...(messageAsksAboutFormulationPackage(message) ? ['get_formulation_packages'] : []),
    ];
    const queue = Array.from(new Set([
        ...deterministic,
        ...(plan?.tools_needed || []),
    ])).filter(t => validToolNames.has(t));
    return queue.slice(0, Math.max(0, maxForced));
}

function safeParseJson(raw) {
    try {
        return JSON.parse((raw || '').replace(/```json|```/g, '').trim());
    } catch (err) {
        return null;
    }
}

async function callJson(client, model, prompt, temperature, logContext, stepName) {
    try {
        const completion = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature,
        });
        const raw = completion.choices[0].message.content || '';
        const parsed = safeParseJson(raw);
        if (parsed === null) {
            console.log(JSON.stringify({ level: 'WARN', msg: `agentic_${stepName}_parse_failed`, context: logContext, raw: raw.slice(0, 300) }));
        }
        return parsed;
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: `agentic_${stepName}_call_failed`, context: logContext, error: err.message }));
        return null;
    }
}

// Every date-shaped field AND every historical biomarker value across every tool result
// GENERATE actually fetched (kino test dates/values, weight-history dates, report dates, plan
// start/end dates, schedule/reminder dates), normalized to Shanghai-local YYYY-MM-DD for dates.
// Fed back to handlers/chat.js's unconditional verifyBiomarkerGrounding pass so it doesn't
// misflag a real historical date or value (e.g. from get_biomarker_history) as a fabrication
// just because it isn't the single latest snapshot that check otherwise compares against —
// found via live dev testing 2026-07-28: a correct "63 past tests" answer citing real
// historical dates AND real historical biomarker readings got rewritten away twice, first
// because the date check only knew one valid date, then because the value check only knew
// one valid value per biomarker key. Both extractions run in a single pass over the same rows.
// 'ordered_at'/'shipped_at'/'sold_at' come from get_formulation_packages: a reply that correctly
// names the day an order was placed must not be flagged as a fabrication. extraValidDates is a
// permissive allowlist, so widening it can only ever reduce false positives.
const DATE_FIELDS = ['tested_at', 'report_date', 'scheduled_date', 'scheduled_for', 'start_date', 'ended_at', 'last_dispensed_at', 'ordered_at', 'shipped_at', 'sold_at'];
function extractToolGroundTruth(toolCallLog) {
    const dates = new Set();
    const values = {};
    const addDate = (value) => {
        if (!value) return;
        try {
            const d = formatToShanghai(new Date(value)).slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dates.add(d);
        } catch (err) { /* not a real date-shaped value, ignore */ }
    };
    const addValues = (validated) => {
        if (!validated || typeof validated !== 'object') return;
        for (const [key, value] of Object.entries(validated)) {
            if (typeof value !== 'number') continue;
            if (!values[key]) values[key] = [];
            values[key].push(value);
        }
    };
    for (const call of toolCallLog) {
        const data = call.result?.data;
        if (!data) continue;
        const rows = Array.isArray(data) ? data : (Array.isArray(data.tests) ? data.tests : [data]);
        for (const row of rows) {
            if (!row || typeof row !== 'object') continue;
            for (const field of DATE_FIELDS) addDate(row[field]);
            addValues(row.validated);
        }
    }
    return { dates: Array.from(dates), values };
}

// A dimension is "elevated" the same way every prompt template already computes and shows it
// (e.g. systemFormulaGenerate.js's "偏高维度" line): its SubAge exceeds the user's ChronoAge.
// Kept here so PLAN/JUDGE can check a "CellularAge is elevated"-type claim the same way
// biomarker_status lets them check a biomarker status claim, instead of having no ground truth
// for it at all — see the biomarker_status comment in runJudge below for why this class of gap
// matters (found via the same 2026-08-08 live sampling: dimension-level "偏高" claims hit the
// identical false-positive pattern as biomarker-level ones, just one level up).
function getElevatedDimensions(bioage) {
    const chronoAge = bioage?.ChronoAge;
    if (chronoAge == null) return [];
    return Object.entries(bioage?.SubAges || {})
        .filter(([, age]) => age > chronoAge)
        .map(([dim]) => dim);
}

// Deterministic, zero-LLM-cost check of the plan's dot/dimension references against real
// data, so the cheapest class of fabrication is caught and corrected before generation runs.
function validatePlan(plan, dots) {
    const dotsById = new Map((dots || []).map(d => [String(d.id), d]));
    const warnings = [];
    for (const claim of plan?.intended_claims || []) {
        if (claim.type === 'dot_recommendation' && claim.ref_id != null && !dotsById.has(String(claim.ref_id))) {
            warnings.push(`Dot #${claim.ref_id} referenced in your plan does not exist in the real formulary — do not reference it.`);
        }
        if (claim.type === 'dimension_reference' && claim.ref_id != null && !REAL_DIMENSIONS.has(claim.ref_id)) {
            warnings.push(`"${claim.ref_id}" referenced in your plan is not one of the 4 real dimensions (CellularAge/MetabolicAge/MicroVascularAge/ResilienceAge) — do not present it as real.`);
        }
    }
    return warnings;
}

// Hard wall-clock ceiling for the whole PLAN->GENERATE->JUDGE->REVISE turn, independent of the
// per-call LLM client timeout (handlers/chat.js's getLlmClient). The two are complementary, not
// redundant: the per-call timeout stops a single stalled call from hanging forever, but even
// every call individually finishing within its own cap can still sum past the worker FC
// function's 300s invocation ceiling (s.yaml) in a worst case (PLAN + 3 GENERATE iterations +
// JUDGE + 2 REVISE rounds x 2 calls each, each near its own per-call cap). Once TURN_DEADLINE_MS
// has elapsed, no further GENERATE iteration, JUDGE, or REVISE round is started — the turn ships
// whatever reply it has so far, exactly like the existing "ship the latest revision regardless"
// behavior on REJECT-after-max-rounds. Leaves ~100s of the 300s budget for finalizeChatReply's
// grounding check + DB writes to run afterward. Found necessary after a live incident
// 2026-08-21 where an uncapped single call ate the whole 300s budget and the invocation was
// killed by the platform mid-REVISE with no reply ever delivered.
const TURN_DEADLINE_MS = 200_000;

// Never start a further stage without at least this much budget left, even when no stage has
// been timed yet — a single LLM call is capped at 60s by getLlmClient (handlers/chat.js) and
// retried once, so anything less than this cannot reliably complete.
const MIN_STAGE_RESERVE_MS = 45_000;

// Drops judge violations that must not, on their own, force a rewrite. The judge prompt asks for
// all three of these rules, but asking measurably does not hold: after adding the severity field
// and the detector-gating instruction, live sampling 2026-08-22 still produced 16
// dimension_misattribution flags across 12 judged drafts that contained none. Every surviving
// REJECT costs a ~70s REVISE round and rewrites a correct reply into a worse one, so the rules
// are enforced here rather than merely requested. Exported for tests.
function sanitizeJudgeVerdict(verdict, groundTruth, detectorHits) {
    const allowed = new Set(
        ((groundTruth && groundTruth.dimension_misattribution_found) || []).map(m => `${m.dimension}:${m.biomarker}`)
    );
    const dropped = [];
    const kept = (verdict.violations || []).filter(v => {
        // (a) The model marked it non-material itself.
        if (v.severity === 'minor') { dropped.push('minor'); return false; }
        // (b) The model's own dimension_misattribution flags are discarded outright — the
        // deterministic scan owns this category entirely, and its findings are re-added below.
        // Keeping the model's version added nothing: measured 16 flags across 12 drafts that
        // contained none, while the scan reproduced every real one exactly.
        if (v.category === 'dimension_misattribution') { dropped.push('llm_misattribution'); return false; }
        // (b2) Same treatment for dots. factCheck.js already checks dot names, product names and
        // ingredients deterministically, and those hits are in detectorHits. With none of them
        // firing, an LLM dot_mismatch was in practice never about a wrong id/name/ingredient —
        // it was the "the dot is correctly mapped, WHILE the described mechanism..." pattern,
        // i.e. an objection to wording on a factually correct recommendation.
        if (v.category === 'dot_mismatch') {
            const dotHits = ['dotNameMismatch', 'fakeProductName', 'dotIngredientMismatch'];
            if (!(detectorHits || []).some(h => dotHits.includes(h))) { dropped.push('uncorroborated_dot_mismatch'); return false; }
        }
        // (c) The judge talked itself out of it mid-sentence but still emitted the row — an
        // observed habit on long ground truth ("...so this is grounded. No violation. (This was
        // a false positive — disregard.)"). Requires the hint to be absent or self-disregarding
        // too: the phrase alone is not enough, because a REAL violation's detail can discuss a
        // neighbouring clause it decided was fine, and dropping that would hide a true error
        // (seen live 2026-08-22 — an invented-dimension negative control slipped through when
        // this matched on detail text alone). A genuine violation always names a concrete fix.
        // Includes the "...matches ground truth ... Correct." shape: live sampling 2026-08-22 saw
        // five biomarker_mismatch rows in a single verdict whose own detail confirmed the draft
        // was right. Biomarker VALUES are in any case already verified deterministically after
        // the turn by verifyBiomarkerGrounding (handlers/chat.js), which has its own retry — so
        // the judge's opinion here is a redundant second pass, and dropping its self-negating
        // rows loses no real coverage. A genuine mismatch reads "states X, but ground truth
        // shows Y" and matches none of these.
        const selfDisregard = /no violation|false positive|disregard|not a violation|no mismatch|matches ground truth|matches biomarker_status|is correct\b|are correct\b|[—-]\s*correct[.\s]*$/i;
        const hint = String(v.correction_hint || '').trim();
        if (selfDisregard.test(String(v.detail || '')) && (!hint || selfDisregard.test(hint))) {
            dropped.push('self_disregarded');
            return false;
        }
        return true;
    });
    // Re-add the deterministic findings as material violations. Detection for this category no
    // longer depends on the model noticing (which it did only ~2 times in 3 on a draft with an
    // injected misattribution) — if the scan fired, the reply is wrong, full stop.
    for (const d of ((groundTruth && groundTruth.dot_mismatch_found) || [])) {
        kept.push({
            category: 'dot_mismatch',
            severity: 'material',
            detail: `The reply calls dot ${d.num} "${d.claimedName}", but its real name is ${d.realName === null ? '(no such dot in the formulary)' : `"${d.realName}"`}.`,
            correction_hint: d.realName === null
                ? `There is no dot ${d.num} in the formulary — remove the recommendation entirely.`
                : `Dot ${d.num} is "${d.realName}" — use that name or drop the name and refer to the number only.`,
        });
    }
    for (const m of ((groundTruth && groundTruth.dimension_misattribution_found) || [])) {
        kept.push({
            category: 'dimension_misattribution',
            severity: 'material',
            detail: `"${m.quote}" attributes ${m.biomarker} to ${m.dimension}, whose score is computed only from: ${(m.allowed || []).join(', ') || '(none)'}.`,
            correction_hint: `Delete the clause linking ${m.biomarker} to ${m.dimension}. ${m.dimension} is driven only by ${(m.allowed || []).join(', ') || '(none)'} — rephrasing while keeping the same causal claim does not fix it.`,
        });
    }
    const out = { verdict: kept.length === 0 ? 'PASS' : 'REJECT', violations: kept };
    return { result: out, dropped };
}

async function runAgenticTurn({ client, model, message, intent, llmContext, systemPrompt, cleanHistory, pool, user_id, language, personaType, logContext, onStatus }) {
    const turnStartedAt = Date.now();
    const timeLeftMs = () => TURN_DEADLINE_MS - (Date.now() - turnStartedAt);
    // `timeLeftMs() <= 0` alone only stops a stage from STARTING once the budget is already
    // blown — it happily begins a ~70s revise round with 1ms left, so the turn routinely
    // overran TURN_DEADLINE_MS by a full round. Measured live 2026-08-22: JUDGE finished at 81s,
    // re-judge round 1 at 149s, and round 2 was still started (51s left) and ran to 218s, after
    // which finalizeChatReply's grounding retry added ~39s — ~257s locally, and more on FC with
    // a cold start, against the worker's hard 300s invocation ceiling (s.yaml). That is how a
    // health-advice turn could be killed by the platform with no reply ever delivered, leaving
    // chat_generate_events stuck at 'claimed'. So a stage now has to fit in the time that's
    // actually left, using what the previous comparable stage really cost.
    let lastStageMs = 0;
    const stageFits = (estimateMs) => timeLeftMs() > Math.max(estimateMs, MIN_STAGE_RESERVE_MS);
    const timeStage = async (fn) => {
        const startedAt = Date.now();
        try { return await fn(); } finally { lastStageMs = Date.now() - startedAt; }
    };
    const budget = { plan: 0, generateIters: 0, judge: 0, revise: 0, rejudge: 0 };
    const toolHandlers = createAgenticToolHandlers({ pool, user_id, language });
    const knowledgeExcerpts = await findRelevantEntries(personaType || 'nano', message);
    // Fires a short "what I'm doing" status update at 3 phase-transition checkpoints (not on
    // every REVISE/RE-JUDGE round — re-narrating a retry as new activity would just look odd).
    // Never lets a notification-write failure abort the turn.
    const notify = async (key) => {
        if (!onStatus) return;
        try { await onStatus(key); } catch (err) { /* status update is best-effort, never fatal */ }
    };

    // 1. PLAN — structured intended-claims list, before any prose is written.
    await notify('understanding');
    budget.plan = 1;
    const plan = await callJson(
        client, model,
        planTemplate(message, intent, llmContext, knowledgeExcerpts, getElevatedDimensions(llmContext.bioage)),
        0.1, logContext, 'plan'
    );
    console.log(JSON.stringify({ level: 'INFO', msg: 'agentic_plan', context: logContext, tools_needed: plan?.tools_needed || [], intended_claims: (plan?.intended_claims || []).length }));
    const planWarnings = validatePlan(plan, llmContext.dots);
    // Surface PLAN's own tools_needed assessment as an explicit instruction, not just a logged
    // field — without this, GENERATE's tool_choice:'auto' had nothing steering it toward a tool
    // PLAN itself already determined was necessary, so it could (and did) skip straight to a
    // "no data available" answer instead of calling e.g. get_biomarker_history. Found via live
    // dev testing 2026-07-29: a "compare my last two Kino scans" question never triggered a
    // single tool call despite get_biomarker_history existing for exactly this.
    const toolsNeededHint = (plan?.tools_needed || []).length
        ? `\n\n【TOOLS NEEDED】To fully answer this, your own plan determined you need: ${plan.tools_needed.join(', ')}. Call the relevant tool(s) via the tool-calling interface BEFORE writing your reply. Do not tell the user data is unavailable or out of context without first calling the tool that could provide it.`
        : '';
    const planConstraintBlock = plan
        ? `\n\n【PLAN CHECK】You planned to make these claims: ${JSON.stringify(plan.intended_claims || [])}.${planWarnings.length ? ' ISSUES FOUND — correct these before writing your reply: ' + planWarnings.join(' ') : ''}${toolsNeededHint}`
        : '';

    // 2. GENERATE — same tool-calling shape as the pre-existing loop in handlers/chat.js, but
    // with dedicated per-domain read tools instead of the generic query_database SQL tool.
    const generateMessages = [
        { role: 'system', content: systemPrompt + planConstraintBlock },
        ...cleanHistory,
    ];
    // Every tool call GENERATE actually makes gets logged here (name + args + result), so
    // JUDGE can verify claims grounded in ANY tool — not just the two re-fetched below. Without
    // this, JUDGE has no way to confirm a correct claim sourced from e.g. get_biomarker_history
    // or get_formulation_packages, and will reject it as "unverifiable" even when it's right (found via
    // live dev testing 2026-07-28: a correct "63 past tests" claim, sourced from a real
    // get_biomarker_history call, was rejected and revised away because JUDGE's ground truth
    // only ever covered get_biomarkers/get_dots).
    const toolCallLog = [];
    let rawReply = '';
    await notify('checking_data');
    // A hint in the system prompt telling GENERATE which tools PLAN determined are needed
    // (toolsNeededHint above) is not enough on its own — tool_choice:'auto' still leaves the
    // model free to ignore it, and it did: live dev testing 2026-08-05 reproduced GENERATE
    // skipping straight to "no data available" with zero tool calls even with the hint in
    // place. Force the issue instead: burn the first N GENERATE iterations (one per distinct
    // tool PLAN named, N capped by GENERATE_MAX_ITERS) with tool_choice pinned to that exact
    // function, so the data is guaranteed to be fetched rather than merely suggested. Falls
    // back to 'auto' once the forced queue is drained, same as before PLAN found nothing to force.
    const validToolNames = new Set(AGENTIC_TOOL_DEFS.map(t => t.function.name));
    const forcedToolQueue = buildForcedToolQueue(plan, message, validToolNames, GENERATE_MAX_ITERS - 1);
    for (let iter = 0; iter < GENERATE_MAX_ITERS; iter++) {
        if (!stageFits(lastStageMs)) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'agentic_turn_deadline_exceeded', context: logContext, stage: 'generate', iter, time_left_ms: timeLeftMs(), last_stage_ms: lastStageMs }));
            break;
        }
        budget.generateIters = iter + 1;
        const forcedTool = forcedToolQueue.shift();
        // The last iteration must produce prose, so tools are taken off the table for it. Without
        // this, a loop whose every iteration returns tool_calls falls out with rawReply === '',
        // JUDGE grades an empty string, and finalizeChatReply ships its canned acknowledgement —
        // a nonsense answer to a real question. Capping forcedToolQueue frees the iteration; this
        // stops the model spending it on another tool call anyway. §21's "generate ≤3" is intact.
        //
        // tool_choice:'none' verified live against DashScope qwen-plus 2026-09-10 on the exact
        // message shape this sees (history already containing a tool call and its result):
        // finish_reason 'stop', zero tool_calls, real content. Worth re-probing before changing —
        // this file already records one case where DashScope diverged from the spec under a
        // non-'auto' tool_choice.
        const lastIter = iter === GENERATE_MAX_ITERS - 1;
        const completion = await timeStage(() => client.chat.completions.create({
            model,
            messages: generateMessages,
            tools: AGENTIC_TOOL_DEFS,
            tool_choice: forcedTool
                ? { type: 'function', function: { name: forcedTool } }
                : (lastIter ? 'none' : 'auto'),
            temperature: 0.3,
        }));
        const choice = completion.choices[0];
        // DashScope reports finish_reason:'stop' (not 'tool_calls') whenever tool_choice is
        // forced to a specific function, even though message.tool_calls is populated correctly
        // — confirmed via a direct isolated API call 2026-08-05. Checking finish_reason alone
        // silently dropped every forced tool call (content was '""', so the loop treated it as
        // an empty final reply and broke immediately without ever invoking the handler) — this
        // is what made the forcedToolQueue mechanism above a no-op until this check was widened.
        if (choice.finish_reason === 'tool_calls' || (choice.message.tool_calls || []).length > 0) {
            generateMessages.push(choice.message);
            const toolResults = [];
            for (const tc of choice.message.tool_calls || []) {
                const handler = toolHandlers[tc.function.name];
                let result;
                let args = {};
                if (!handler) {
                    result = { ok: false, reason: `unknown tool: ${tc.function.name}` };
                } else {
                    try {
                        args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
                        result = await handler(args);
                    } catch (err) {
                        result = { ok: false, reason: err.message };
                    }
                }
                console.log(JSON.stringify({ level: 'INFO', msg: 'agentic_tool_call', context: logContext, tool: tc.function.name, ok: result.ok }));
                toolCallLog.push({ tool: tc.function.name, args, result });
                toolResults.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
            }
            generateMessages.push(...toolResults);
        } else {
            rawReply = choice.message.content || '';
            break;
        }
    }

    // 3. JUDGE — grades the draft against the plan, freshly re-fetched biomarkers/dots (not the
    // GENERATE-time llmContext snapshot, so drift across a long tool loop or conversation gets
    // caught) PLUS every tool call GENERATE actually made, the curated knowledge base, and the
    // existing factCheck.js detectors.
    async function runJudge(replyText) {
        budget.judge += 1;
        const [freshBiomarkers, freshDots] = await Promise.all([
            toolHandlers.get_biomarkers(),
            toolHandlers.get_dots(),
        ]);
        // Start from the SAME context GENERATE's system prompt was built from (health_twin,
        // questionnaire_context, active_health_plans, user_profile, plan, ...) — without this,
        // JUDGE could only verify claims sourced from get_biomarkers/get_dots/tool_calls_made,
        // and rejected as "unsupported" anything correctly answered straight from the pre-fetched
        // context (e.g. wearable/health_twin numbers), even when accurate. Found via live dev
        // testing 2026-07-28: a correct wearable-data analysis (sleep/HR/steps, all matching
        // health_twin exactly) got fully stripped out across 2 revise rounds because JUDGE had
        // no visibility into health_twin at all. biomarkers/dots are still overridden with a
        // fresh re-fetch afterward, preserving the original "catch mid-conversation drift" intent
        // for those two fields specifically.
        // biomarker_status/biomarker_reference_ranges: the same normal/elevated/high
        // classification (lib/biomarkerStatus.js) GENERATE's own system prompt already labels
        // each biomarker with (e.g. "hsCRP: 1.6（偏高）") — added 2026-08-08 after live sampling
        // against 5 real prod users found this was the single largest driver of false-positive
        // REJECTs: JUDGE's ground truth previously carried only raw values, so it had no way to
        // confirm a "偏高"/"elevated" label was legitimate and reflexively flagged nearly every
        // one as an "unsupported clinical interpretation — ground truth provides no reference
        // range" (~63% of all violations across the sample matched this exact pattern). The
        // label was never fabricated — it's the same code-computed classification GENERATE was
        // given verbatim; JUDGE just wasn't given the same data to check it against.
        // health_twin.latest_lab_data is an EXTERNAL lab panel (an uploaded report — the Medical
        // Records twin layer), keyed by the SAME names as the authoritative Kino panel but from a
        // different, usually older test. Spreading llmContext handed JUDGE both under matching
        // keys with no precedence rule, and it oscillated: round 1 "hsCRP is 0.35 not 1.8"
        // (external), round 2 "hsCRP is 1.8 not 0.35" (validated), round 3 flipped again on
        // CystatinC — REVISE dutifully complied each time, so the turn could never converge and
        // burned its entire budget (judge 3 / revise 2 / rejudge 2) plus a grounding retry on
        // EVERY health-advice turn. That pushed a turn to ~266s, past the miniapp's own wait, so
        // the user saw a timeout. Found 2026-08-22 by reproducing against a real dev account
        // whose two panels disagree on 5 of the 6 Kino-core markers.
        //
        // The panel can't simply be dropped: it's the only source for ~17 markers the Kino chip
        // doesn't measure at all (ALT, HDL, HbA1c, eGFR, ...), and JUDGE needs those to verify a
        // draft that legitimately cites them. So it moves to its own clearly-labelled key with
        // its own date, and judgeTemplate states the precedence explicitly. Cloned rather than
        // mutated — llmContext is shared with GENERATE and the caller.
        const { latest_lab_data, latest_lab_date, ...twinWithoutLabPanel } = llmContext.health_twin || {};
        const groundTruth = {
            ...llmContext,
            health_twin: llmContext.health_twin ? twinWithoutLabPanel : llmContext.health_twin,
            external_lab_panel: latest_lab_data
                ? { collected_on: latest_lab_date || null, markers: latest_lab_data.markers || latest_lab_data }
                : null,
            biomarkers: freshBiomarkers.data,
            biomarker_status: classifyBiomarkers(freshBiomarkers.data?.validated || {}),
            biomarker_reference_ranges: BIOMARKER_THRESHOLDS,
            dimension_biomarker_map: DIMENSION_BIOMARKERS,
            // Computed in code, not left to the model. See detectDimensionMisattribution's
            // comment: asked to compare prose against the map itself, JUDGE produced 3-7 false
            // positives per run on drafts with zero real misattributions. It is now told to
            // treat only these pre-verified pairs as material.
            dimension_misattribution_found: detectDimensionMisattribution(
                replyText, DIMENSION_BIOMARKERS, llmContext.sub_age_display_names),
            // Same reasoning: the model reported an injected wrong dot name only 1 time in 3.
            dot_mismatch_found: detectDotNameMismatch(replyText, freshDots.data || []),
            elevated_dimensions: getElevatedDimensions(llmContext.bioage),
            dots: freshDots.data,
            tool_calls_made: toolCallLog,
        };
        const detectorHits = detectAllRisks(replyText, llmContext.dots, llmContext.store_products);
        const verdict = await callJson(
            client, model,
            judgeTemplate(replyText, plan, groundTruth, knowledgeExcerpts, detectorHits, message),
            0.1, logContext, 'judge'
        );
        // Fail open on a broken/unparseable judge call — ship the draft rather than block the
        // turn, matching the intent-classifier's "default and move on" precedent (chat.js:525-527).
        // The deterministic findings still apply though: they don't depend on the judge model
        // having answered, and silently dropping them here would let a real, code-detected error
        // through precisely when the judge is malfunctioning (seen live 2026-08-22 — a judge
        // response that failed to parse would have shipped an injected dimension misattribution).
        if (!verdict) return sanitizeJudgeVerdict({ verdict: 'PASS', violations: [] }, groundTruth, detectorHits).result;

        const { result: sanitized, dropped } = sanitizeJudgeVerdict(verdict, groundTruth, detectorHits);
        if (dropped.length) {
            console.log(JSON.stringify({ level: 'INFO', msg: 'agentic_judge_violations_filtered', context: logContext, dropped, kept: sanitized.violations.length }));
        }
        if (verdict.verdict === 'REJECT' && sanitized.verdict === 'PASS') {
            console.log(JSON.stringify({ level: 'INFO', msg: 'agentic_judge_downgraded_no_material_violations', context: logContext }));
            return sanitized;
        }
        verdict.violations = sanitized.violations;

        // Self-contradiction guard: on a long/complex ground truth object the judge model
        // occasionally reasons its way to "no real issue found" in its own analysis text but
        // still emits a structured REJECT out of habit — the one reliable signal for this is
        // every violation's correction_hint coming back empty (a real violation always names a
        // concrete fix; "found nothing to fix" is exactly what an empty hint means). Found via
        // live testing 2026-07-29: this produced an unnecessary REVISE cycle that then
        // regenerated an unrelated, hallucinated reply from scratch. Downgrade to PASS rather
        // than let a judge that couldn't articulate a fix still force a rewrite.
        if (verdict.verdict === 'REJECT' && (verdict.violations || []).length > 0
            && verdict.violations.every(v => !v.correction_hint || !v.correction_hint.trim())) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'agentic_judge_self_contradiction_downgraded', context: logContext, violations: verdict.violations }));
            return { verdict: 'PASS', violations: [] };
        }
        return verdict;
    }

    await notify('verifying');
    let judgeResult;
    if (!stageFits(lastStageMs)) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'agentic_turn_deadline_exceeded', context: logContext, stage: 'judge', time_left_ms: timeLeftMs(), last_stage_ms: lastStageMs }));
        judgeResult = { verdict: 'PASS', violations: [] }; // ship the draft as-is, out of budget to check it
    } else {
        judgeResult = await timeStage(() => runJudge(rawReply));
        console.log(JSON.stringify({ level: judgeResult.verdict === 'PASS' ? 'INFO' : 'WARN', msg: 'agentic_judge', context: logContext, verdict: judgeResult.verdict, violations: judgeResult.violations }));
    }

    // 4. REVISE + RE-JUDGE — up to REVISE_MAX_ROUNDS rounds, stopping early the moment a
    // re-judge PASSes; ships the latest revision regardless if it still REJECTs after the
    // last round, never looping past this bound. Also stops early once TURN_DEADLINE_MS has
    // elapsed, shipping the latest draft rather than risk exceeding the FC function's own
    // timeout (see TURN_DEADLINE_MS comment above runAgenticTurn).
    let latestResult = judgeResult;
    for (let round = 0; round < REVISE_MAX_ROUNDS && latestResult.verdict === 'REJECT'; round++) {
        // A round is a REVISE completion plus a full RE-JUDGE, so it costs at least as much as
        // the stage just measured (the JUDGE for round 1, the previous whole round after that).
        // Requiring it to fit is what keeps the turn inside TURN_DEADLINE_MS instead of one
        // round past it. When rounds are fast both still run, exactly as before; only a turn
        // that is already running slow gives up its last round to protect the reply.
        if (!stageFits(lastStageMs)) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'agentic_turn_deadline_exceeded', context: logContext, stage: 'revise', round: round + 1, time_left_ms: timeLeftMs(), last_stage_ms: lastStageMs }));
            break;
        }
        budget.revise += 1;
        // A dimension_misattribution violation's free-text detail/hint alone wasn't enough to
        // reliably fix the error across REVISE rounds in live testing 2026-08-21 (the model kept
        // reproducing the same wrong causal framing in slightly different words rather than
        // removing it) — give the rewrite the actual lookup table as a hard constraint instead of
        // prose to reinterpret, and tell it to delete the offending clause outright rather than
        // rephrase it.
        const hasDimensionMisattribution = (latestResult.violations || []).some(v => v.category === 'dimension_misattribution');
        const dimensionConstraintBlock = hasDimensionMisattribution
            ? `\n\nCRITICAL CONSTRAINT — a dimension's elevation may ONLY be attributed to the biomarkers actually listed for it below. Do not name, reference, or imply any other biomarker as a cause/driver/factor for a dimension not listed here, even in passing:\n${Object.entries(DIMENSION_BIOMARKERS).map(([dim, keys]) => `- ${dim}: ${keys.join(', ')}`).join('\n')}\nIf a sentence or clause attributes a biomarker to the wrong dimension, delete that sentence/clause entirely rather than rephrasing it — swapping words while keeping the same causal claim does not fix the violation.`
            : '';
        // Found via a live incident 2026-08-21: a record_action REVISE round correctly dropped
        // an unsupported clinical claim JUDGE flagged, but ALSO silently dropped the trailing
        // {"action":"record_weight",...} JSON tag along with it (the correction_hint only
        // quoted the human-readable confirmation text, not the tag) — the rewritten reply still
        // said "✅ 已记录您的体重" but finalizeChatReply's downstream regex had nothing left to
        // match, so the weight was NEVER actually written to the database despite the confident
        // success message. None of the flagged violations even mentioned the action tag; REVISE
        // just didn't know to preserve it. Detect any of the three flat action tags in the
        // CURRENT draft before rewriting and require it verbatim in the output, independent of
        // whatever violations are being fixed this round.
        const actionTagMatch = rawReply.match(/\{"action"\s*:\s*"(record_weight|set_reminder|remember_fact)"[^}]*\}/);
        const actionPreserveBlock = actionTagMatch
            ? `\n\nCRITICAL: your rewritten reply MUST still end with this exact JSON line, verbatim and unchanged: ${actionTagMatch[0]}\nDo not remove, reword, or omit it even though none of the violations above mention it — it is a separate control signal the system depends on to actually carry out what the user asked (e.g. recording a value), and silently dropping it while your reply still claims success would fail the user's request without them knowing.`
            : '';
        // Same failure mode as actionPreserveBlock above, one layer out: a REVISE round fixing an
        // unrelated violation can silently drop a ::: display block that no violation mentioned,
        // because the correction prompt only quotes the flagged prose. The block carries real
        // content (biomarker values, the concrete next step), so losing it degrades the reply
        // without anything reporting a failure. Detect any fence in the CURRENT draft and require
        // them preserved, independent of what is being fixed this round.
        const hasDirectiveBlock = /^\s*:{3}\s*[a-z][a-z0-9_-]*\s*$/im.test(rawReply);
        const directivePreserveBlock = hasDirectiveBlock
            ? `\n\nCRITICAL: your previous reply contains one or more ":::" display blocks (e.g. ":::metric", ":::takeaway", ":::dots"). Keep every one of them in your rewritten reply, with the same structure and closing ":::" line. They are display markup the client renders as cards, not prose you may drop or reflow into sentences. If a violation above concerns a value INSIDE a block, correct that value in place and keep the block. Do not remove, merge, or convert a block to plain text just because the violations above don't mention it.`
            : '';
        const correctionPrompt = `Your previous reply has factual issues found by a fact-checker. Rewrite the SAME reply, keeping the same language/tone/structure, but fix:\n${(latestResult.violations || []).map(v => `- ${v.detail}${v.correction_hint ? ' — ' + v.correction_hint : ''}`).join('\n')}${dimensionConstraintBlock}${actionPreserveBlock}${directivePreserveBlock}\n\nYour rewritten reply MUST still include the full conversational prose responding to the user's message, not just a corrected action JSON tail on its own — a bare action JSON with no surrounding reply text is never an acceptable output.`;
        try {
            // Timed as one unit (REVISE completion + RE-JUDGE) — that whole cost is what the
            // next round's fit check has to budget for.
            await timeStage(async () => {
                const retryCompletion = await client.chat.completions.create({
                    model,
                    messages: [...generateMessages, { role: 'assistant', content: rawReply }, { role: 'user', content: correctionPrompt }],
                    temperature: 0.2,
                });
                const retryReply = retryCompletion.choices[0].message.content || rawReply;
                budget.rejudge += 1;
                const rejudgeResult = await runJudge(retryReply);
                console.log(JSON.stringify({ level: rejudgeResult.verdict === 'PASS' ? 'INFO' : 'WARN', msg: 'agentic_rejudge', context: logContext, round: round + 1, verdict: rejudgeResult.verdict, violations: rejudgeResult.violations }));
                rawReply = retryReply; // ship the latest revision even if this round still REJECTs
                latestResult = rejudgeResult;
            });
        } catch (err) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'agentic_revise_failed', context: logContext, round: round + 1, error: err.message }));
            break;
        }
    }

    console.log(JSON.stringify({ level: 'INFO', msg: 'turn_budget_used', context: logContext, budget }));
    const { dates: extraValidDates, values: extraValidValues } = extractToolGroundTruth(toolCallLog);
    return { reply: rawReply, extraValidDates, extraValidValues };
}

// extractToolGroundTruth and buildForcedToolQueue are exported for tests: both are pure, and both
// guard a failure mode that is invisible until it ships (a correct date rewritten as a
// fabrication; a turn that spends every iteration on tool calls and replies with nothing).
module.exports = { runAgenticTurn, sanitizeJudgeVerdict, extractToolGroundTruth, buildForcedToolQueue };
