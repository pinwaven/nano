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
module.exports = (message, intent, llmContext, knowledgeExcerpts) => {
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

CURRENT BIOMARKERS/BIOAGE ALREADY IN CONTEXT (only cite these numbers, never invent or recall a different value from memory):
${JSON.stringify({ biomarkers: llmContext.biomarkers, bioage: llmContext.bioage })}

List every specific, checkable factual claim you plan to make: biomarker values, dot recommendations, science/protocol facts, dimension references, or evidence-level statements. Do not list general conversational content, only checkable facts.

If answering fully requires data NOT already in context above — e.g. comparing multiple past Kino tests, a trend over time, a count of past tests/reports, dot inventory levels, scheduled doses, or reminders — this is NOT grounds to decline or say the data is unavailable. A dedicated tool exists for exactly this (see tools_needed below); list it there so it gets called before you write the reply, instead of telling the user the information doesn't exist.

Do NOT list a user's own self-reported personal fact (diet, allergy, preference, goal — anything they just stated about themselves in USER MESSAGE above) as a claim needing evidence-level backing or knowledge-base grounding. Acknowledging what the user just told you is not a scientific claim; it doesn't need a citation or evidence-level phrase, and a lack of a matching knowledge-base entry is not a gap to flag.

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
