'use strict';

/**
 * PLAN step for the agentic chat loop (lib/agenticChat.js) — an internal reasoning step,
 * not user-facing content, so this stays in English like intentClassifier.js regardless of
 * which persona invoked it. Nothing here is Viva-specific; only Viva calls it today (see
 * handlers/chat.js useAgenticLoop), so Nano could adopt the same loop later without a rewrite.
 *
 * Produces a structured list of factual claims the model intends to make BEFORE it drafts
 * any prose, so the cheapest class of fabrication (a wrong dot id, a nonexistent dimension)
 * can be caught and corrected deterministically ahead of generation, not just after.
 */
const { classifyBiomarkers, THRESHOLDS: BIOMARKER_THRESHOLDS } = require('../../lib/biomarkerStatus');

module.exports = (message, intent, llmContext, knowledgeExcerpts, elevatedDimensions) => {
    // record_action is transactional, not analytical (user is logging a value — weight today —
    // not asking a question), and its GENERATE system prompt (chat/record.js) already correctly
    // scopes the reply to one short sentence + a record_weight action tag. The generic template
    // below ("list every checkable claim you plan to make") is the wrong framing for it: on a
    // turn with biomarker-heavy conversation history nearby, PLAN would keep elaborating that
    // thread into a large intended_claims list (15 claims logged in one live 2026-08-21 case),
    // which then gets injected into GENERATE's system prompt as a "you planned to make these
    // claims" instruction and pulls it away from record.js's simple one-liner — the model wrote
    // an unrelated biomarker essay and never emitted the record_weight tag at all, so the
    // reported weight silently never got recorded. Short-circuiting PLAN to a near-empty,
    // zero-tool plan for this intent removes that pollution at the source.
    if (intent === 'record_action') {
        return `The user is logging a personal data value (e.g. weight) — this is a short, transactional turn, not an analytical question. Your only job here is to note that, not to plan a substantive answer.

USER MESSAGE: ${message}

Do NOT plan a biomarker, bioage, dimension, or dot claim of any kind for this turn, regardless of what was discussed earlier in this conversation — the reply must stay a short acknowledgment plus the recording action tag, nothing else. No tool call is needed; the value being reported is already in the user's own message.

RESPOND WITH ONLY VALID JSON, NO OTHER TEXT:
{
  "intended_claims": [],
  "tools_needed": [],
  "risk_notes": "<note here only if the reported value is ambiguous or missing, else empty string>"
}`;
    }

    const dotsList = (llmContext.dots || [])
        .map(d => `${d.id}: ${d.name_zh || d.name}${d.sub_age_target ? ` (${d.sub_age_target})` : ''}`)
        .join('\n') || '(none available)';

    const kbList = (knowledgeExcerpts || [])
        .map(e => `${e.id}: ${e.claim_zh} [${e.evidence_level}]`)
        .join('\n') || '(none matched)';

    return `Before answering, plan out exactly which factual claims you intend to make, so they can be checked against ground truth BEFORE you write the reply.

USER MESSAGE: ${message}
INTENT: ${intent}

REAL DOTS FORMULARY (id: name (dimension)) — any dot claim must reference one of these ids/names verbatim:
${dotsList}

REAL DIMENSIONS: CellularAge, MetabolicAge, MicroVascularAge, ResilienceAge (no others exist)

MATCHED KNOWLEDGE BASE ENTRIES for this message (only these are pre-approved specific science/protocol claims; anything else must use a generic evidence-level phrase, not a fabricated specific detail):
${kbList}

CURRENT BIOMARKERS/BIOAGE ALREADY IN CONTEXT (only cite these numbers, never invent or recall a different value from memory). "biomarker_status" is the system's own pre-computed normal/elevated/high classification per "biomarker_reference_ranges" — use these exact labels if you plan to call a biomarker elevated/high/normal; never threshold-compare a raw value yourself, and never claim a status a biomarker's real classification here contradicts. "elevated_dimensions" lists which of the 4 real sub-age dimensions are elevated (SubAge > ChronoAge) — a dimension not in this list must NOT be called elevated/偏高:
${JSON.stringify({ biomarkers: llmContext.biomarkers, bioage: llmContext.bioage, biomarker_status: classifyBiomarkers(llmContext.biomarkers || {}), biomarker_reference_ranges: BIOMARKER_THRESHOLDS, elevated_dimensions: elevatedDimensions || [] })}

List every specific, checkable factual claim you plan to make: biomarker values, dot recommendations, science/protocol facts, dimension references, or evidence-level statements. Do not list general conversational content, only checkable facts.

If answering fully requires data NOT already in context above — e.g. comparing multiple past Kino tests, a trend over time, a count of past tests/reports, dot inventory levels, scheduled doses, or reminders — this is NOT grounds to decline or say the data is unavailable. A dedicated tool exists for exactly this (see tools_needed below); list it there so it gets called before you write the reply, instead of telling the user the information doesn't exist.

Do NOT list a user's own self-reported personal fact (diet, allergy, preference, goal — anything they just stated about themselves in USER MESSAGE above) as a claim needing evidence-level backing or knowledge-base grounding. Acknowledging what the user just told you is not a scientific claim; it doesn't need a citation or evidence-level phrase, and a lack of a matching knowledge-base entry is not a gap to flag.
Likewise, suggesting a product from the "recommendable products" list supplied in the system prompt is a merchandising choice, not a scientific claim: it needs no evidence-level backing or knowledge-base entry of its own. Any HEALTH claim made ABOUT that product is still a normal claim and must be planned as one.

Ordering the dots in a {"action":"formulate_dots",...} tail is a formulation and merchandising decision over the formulary supplied above, not a scientific claim: it needs no evidence-level backing or knowledge-base entry of its own, and the fact that packages of different widths exist is not a claim to ground. Which dots make up each package, and the one line of copy describing each, are decided by server code after this turn — never by the draft. A health claim made ABOUT a dot is still a normal claim and must be planned as one.
On a formulation turn, do NOT plan a claim that the user should receive every clinically indicated dot. Each package carries only as many distinct dots as its width allows, so listing more than that as intended claims sets up an expectation the reply is required to break.

Do NOT list a proposed follow-up questionnaire (an {"action":"ask_questions",...} tail you intend to append, and the question text within it) as a claim needing evidence-level backing. A question is not an assertion — it needs no citation, ground-truth match, or knowledge-base entry.

RESPOND WITH ONLY VALID JSON, NO OTHER TEXT:
{
  "intended_claims": [
    {"type": "biomarker_value|dot_recommendation|science_fact|dimension_reference|evidence_level|other", "claim": "<short description>", "ref_id": "<dot id, biomarker key, or KB entry id, or null>"}
  ],
  "tools_needed": ["<any of: get_biomarkers, get_biomarker_history, get_dots, get_health_plan, get_dot_inventory, get_health_reports, get_questionnaire_responses, get_weight_history, get_health_twin, get_nutrition_schedule, get_reminders>"],
  "risk_notes": "<anything you're unsure is grounded, or empty string>"
}`;
};
