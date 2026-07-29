'use strict';

/**
 * JUDGE step for the Viva agentic loop (lib/agenticChat.js) — grades a drafted reply against
 * the PLAN's intended claims, freshly re-fetched ground truth, the curated knowledge source
 * (prompts/viva/knowledge/), and the deterministic factCheck.js detectors, before the reply
 * ships. An internal grading task, not user-facing content, so this stays in English like
 * intentClassifier.js/planTemplate.js.
 */
module.exports = (draftReply, plan, groundTruth, knowledgeExcerpts, detectorHits) => {
    const kbList = (knowledgeExcerpts || [])
        .map(e => `${e.id}: ${e.claim_zh} [${e.evidence_level}]`)
        .join('\n') || '(none matched)';

    return `Grade the DRAFT REPLY below for factual accuracy. You are a strict fact-checker, not a writing coach — ignore style/tone/language, only check claims against the provided ground truth.

DRAFT REPLY:
${draftReply}

PLAN (claims the model intended to make before drafting):
${JSON.stringify(plan?.intended_claims || [])}

FRESH GROUND TRUTH (authoritative over anything in the draft or plan). "biomarkers"/"dots" were re-fetched fresh at judge time. "tool_calls_made" is the COMPLETE list of every tool call made while drafting this reply, in order, each with its real result — this is equally authoritative: if a claim in the draft matches a result in tool_calls_made (e.g. a test count, inventory quantity, plan history), that claim IS grounded and must NOT be flagged just because it isn't repeated in "biomarkers"/"dots". Only flag a claim as unsupported if it matches NEITHER the biomarkers/dots re-fetch NOR any tool_calls_made result:
${JSON.stringify(groundTruth)}

APPROVED KNOWLEDGE BASE EXCERPTS (only these are pre-vetted specific science/protocol facts for this message):
${kbList}

DETERMINISTIC RISK DETECTOR HITS (pattern-based pre-flags from factCheck.js, may include false positives — use judgment, don't blindly reject on these alone):
${(detectorHits || []).join(', ') || '(none)'}

Check the draft for:
- plan_drift: a specific factual claim in the draft that wasn't in the plan and doesn't match ground truth
- biomarker_mismatch: a stated biomarker/BMI/date/age value that doesn't match the fresh ground truth
- dot_mismatch: a dot number/name/ingredient that doesn't match the real formulary in ground truth
- unsupported_science_claim: a specific mechanism, gene variant, statistic, citation, or protocol claim not covered by the approved knowledge base excerpts or a generic evidence-level phrase
- fake_dimension: any dimension name outside CellularAge/MetabolicAge/MicroVascularAge/ResilienceAge asserted as real, or a numeric value given for a dimension that doesn't exist

Only flag SPECIFIC, checkable factual errors. Do not flag reasonable paraphrasing, tone, formatting, or claims already correctly hedged with a generic evidence-level phrase (e.g. "supported by RCT evidence" without inventing specifics).

RESPOND WITH ONLY VALID JSON, NO OTHER TEXT:
{
  "verdict": "PASS" | "REJECT",
  "violations": [
    {"category": "plan_drift|biomarker_mismatch|dot_mismatch|unsupported_science_claim|fake_dimension", "detail": "<what's wrong>", "correction_hint": "<what should be said instead>"}
  ]
}`;
};
