'use strict';

/**
 * The physical product model for a Dots formulation, in one place.
 *
 * These four constants describe what can actually be manufactured, and they are consumed by
 * three things that must never disagree:
 *
 *   1. handlers/dots.js       — nano's own formulator (_commitNutritionPlan expands a
 *                               steady-state recipe across the cycle using them)
 *   2. lib/agFormulation.js   — the validator for a formula authored by the external Viva AG
 *                               agent, which must be rejected if it breaks any of them
 *   3. docs/viva-ag-api.md §8 — the contract that agent builds against
 *
 * (3) is a Markdown file, so nothing can enforce it. CLAUDE.md §35 already warns that changing
 * any of these means changing that doc in the same commit; pulling the values out of dots.js
 * into a leaf module at least makes (1) and (2) share one definition rather than two copies
 * drifting apart.
 */

// Plan cycle length — 28 days (4 weeks) so one formulation run covers 56 capsules (28 days x
// AM/PM) instead of needing a weekly re-run. Changed from 7 2026-08-08.
const PLAN_DAYS = 28;

// Physical capsule-size ceiling: a capsule holding hundreds of dots (real observed totals ran
// into the high 300s) is impractical to swallow in one go, independent of what any individual
// dot's own target_dots_min/max range allows.
const MAX_DOTS_PER_CAPSULE = 72;

// DOT-N7 (Senescence Clear) dosing is fully system-controlled, never blended into the everyday
// capsule: on 2 consecutive days inside week 2 of the 28-day cycle (0-indexed day-offsets 9-10,
// i.e. calendar days 10-11 of 28), BOTH capsules that day contain ONLY DOT-N7, each at its own
// target_dots_max. It never appears on any other day. Its normal epoch-based pulse window
// (_isPulseActiveDate in handlers/dots.js) is bypassed entirely for this key, so it is never
// dosed via two different mechanisms within the same plan.
const N7_KEY = 'DOT-N7';
const N7_ISOLATION_DAY_INDEXES = [9, 10];

module.exports = { PLAN_DAYS, MAX_DOTS_PER_CAPSULE, N7_KEY, N7_ISOLATION_DAY_INDEXES };
