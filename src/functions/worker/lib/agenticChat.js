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
const { detectAllRisks } = require('./factCheck');
const { formatToShanghai } = require('./time-utils');
const planTemplate = require('../prompts/chat/planTemplate');
const judgeTemplate = require('../prompts/viva/judgeTemplate');
const { findRelevantEntries } = require('./knowledgeBase');

const GENERATE_MAX_ITERS = 3;
const REVISE_MAX_ROUNDS = 2;
const REAL_DIMENSIONS = new Set(['CellularAge', 'MetabolicAge', 'MicroVascularAge', 'ResilienceAge']);

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
const DATE_FIELDS = ['tested_at', 'report_date', 'scheduled_date', 'scheduled_for', 'start_date', 'ended_at', 'last_dispensed_at'];
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

async function runAgenticTurn({ client, model, message, intent, llmContext, systemPrompt, cleanHistory, pool, user_id, language, personaType, logContext, onStatus }) {
    const budget = { plan: 0, generateIters: 0, judge: 0, revise: 0, rejudge: 0 };
    const toolHandlers = createAgenticToolHandlers({ pool, user_id, language });
    const knowledgeExcerpts = await findRelevantEntries(personaType || 'viva', message);
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
        planTemplate(message, intent, llmContext, knowledgeExcerpts),
        0.1, logContext, 'plan'
    );
    const planWarnings = validatePlan(plan, llmContext.dots);
    const planConstraintBlock = plan
        ? `\n\n【PLAN CHECK】You planned to make these claims: ${JSON.stringify(plan.intended_claims || [])}.${planWarnings.length ? ' ISSUES FOUND — correct these before writing your reply: ' + planWarnings.join(' ') : ''}`
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
    // or get_dot_inventory, and will reject it as "unverifiable" even when it's right (found via
    // live dev testing 2026-07-28: a correct "63 past tests" claim, sourced from a real
    // get_biomarker_history call, was rejected and revised away because JUDGE's ground truth
    // only ever covered get_biomarkers/get_dots).
    const toolCallLog = [];
    let rawReply = '';
    await notify('checking_data');
    for (let iter = 0; iter < GENERATE_MAX_ITERS; iter++) {
        budget.generateIters = iter + 1;
        const completion = await client.chat.completions.create({
            model,
            messages: generateMessages,
            tools: AGENTIC_TOOL_DEFS,
            tool_choice: 'auto',
            temperature: 0.3,
        });
        const choice = completion.choices[0];
        if (choice.finish_reason === 'tool_calls') {
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
        const groundTruth = {
            ...llmContext,
            biomarkers: freshBiomarkers.data,
            dots: freshDots.data,
            tool_calls_made: toolCallLog,
        };
        const detectorHits = detectAllRisks(replyText, llmContext.dots);
        const verdict = await callJson(
            client, model,
            judgeTemplate(replyText, plan, groundTruth, knowledgeExcerpts, detectorHits, message),
            0.1, logContext, 'judge'
        );
        // Fail open on a broken/unparseable judge call — ship the draft rather than block the
        // turn, matching the intent-classifier's "default and move on" precedent (chat.js:525-527).
        if (!verdict) return { verdict: 'PASS', violations: [] };
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
    const judgeResult = await runJudge(rawReply);
    console.log(JSON.stringify({ level: judgeResult.verdict === 'PASS' ? 'INFO' : 'WARN', msg: 'agentic_judge', context: logContext, verdict: judgeResult.verdict, violations: judgeResult.violations }));

    // 4. REVISE + RE-JUDGE — up to REVISE_MAX_ROUNDS rounds, stopping early the moment a
    // re-judge PASSes; ships the latest revision regardless if it still REJECTs after the
    // last round, never looping past this bound.
    let latestResult = judgeResult;
    for (let round = 0; round < REVISE_MAX_ROUNDS && latestResult.verdict === 'REJECT'; round++) {
        budget.revise += 1;
        const correctionPrompt = `Your previous reply has factual issues found by a fact-checker. Rewrite the SAME reply, keeping the same language/tone/structure, but fix:\n${(latestResult.violations || []).map(v => `- ${v.detail}${v.correction_hint ? ' — ' + v.correction_hint : ''}`).join('\n')}\n\nYour rewritten reply MUST still include the full conversational prose responding to the user's message, not just a corrected action JSON tail on its own — a bare action JSON with no surrounding reply text is never an acceptable output.`;
        try {
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
        } catch (err) {
            console.log(JSON.stringify({ level: 'WARN', msg: 'agentic_revise_failed', context: logContext, round: round + 1, error: err.message }));
            break;
        }
    }

    console.log(JSON.stringify({ level: 'INFO', msg: 'turn_budget_used', context: logContext, budget }));
    const { dates: extraValidDates, values: extraValidValues } = extractToolGroundTruth(toolCallLog);
    return { reply: rawReply, extraValidDates, extraValidValues };
}

module.exports = { runAgenticTurn };
