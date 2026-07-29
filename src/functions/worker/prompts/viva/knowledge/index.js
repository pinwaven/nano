'use strict';

/**
 * Curated knowledge base for Viva's science/TCM/protocol claims — the one source of truth
 * PLAN and JUDGE (lib/agenticChat.js) check specific claims against, since factCheck.js's
 * detectors only validate biomarker numbers and dot names/ingredients, not the science prose
 * itself. No RAG/vector DB exists in this codebase (by design, per the 2026-07-28 planning
 * discussion) — matching is a cheap in-process keyword/tag substring check, not embeddings.
 *
 * Seeded (2026-07-28) from claims already shipping as static prose in systemChat.js/chat/
 * science.js — see each entry file's header. Zero KB matches for a message is NOT a failure
 * signal: the KB is a positive-match aid for specific claims, not an exhaustive allowlist, so
 * JUDGE falls back to factConstraint.js's general rules + factCheck.js detector hits alone
 * when nothing matches.
 *
 * OPEN QUESTION (flagged for product, not resolved by this file): who authors and vets NEW
 * entries added beyond this seed set going forward. Recommend new entries go through a named
 * clinical/TCM reviewer via normal PR review, but the reviewer identity and review cadence is
 * a product/clinical decision, not an engineering one.
 */
const tcmGeneVariants = require('./tcmGeneVariants');
const nutritionProtocols = require('./nutritionProtocols');
const longevityScience = require('./longevityScience');

const ALL_ENTRIES = [...tcmGeneVariants, ...nutritionProtocols, ...longevityScience];

// Cheap substring/tag match against the message + (optionally) a draft reply — no embeddings.
// Matches if any of an entry's topic tags appears as a substring of the text.
function findRelevantEntries(text, limit = 8) {
    if (!text || typeof text !== 'string') return [];
    const hits = ALL_ENTRIES.filter(entry => entry.topic.some(tag => text.includes(tag)));
    return hits.slice(0, limit);
}

module.exports = { ALL_ENTRIES, findRelevantEntries };
