'use strict';

/**
 * Canonical "Digital Twin" vocabulary — the umbrella term plus its four layers.
 *
 * Background: "Digital Twin / 数字孪生" was supposed to mean the user's entire health model,
 * but the term had drifted to mean one narrow thing (and three *different* narrow things
 * depending on where you looked). The worst offender was the prompt layer: every template
 * rendering `health_twin` labelled it "DIGITAL TWIN (WEARABLE & LIFESTYLE DATA)" / "可穿戴 &
 * 生活方式数据", which taught the model that the twin *is* the ring — so replies described a
 * user's whole health model as "your wearable data," contradicting what the app shows and
 * making the Kino scan, hospital records and self-reported facts sound like separate products.
 *
 * The `health_twin` row was never actually that narrow — it already carries the latest lab
 * panel, latest body composition and denormalized BioAge/sub-ages alongside the ring averages.
 * The narrowness was purely in the labels, so the fix is a shared vocabulary block that every
 * heavyweight prompt injects, teaching the model the same four layer names the user reads in
 * the miniapp's Health tab.
 *
 * Persona-agnostic like currentDateBlock.js / factConstraint.js / factMemoryBlock.js (lives in
 * prompts/chat/, not prompts/viva/ or prompts/nano/) — takes isZh explicitly since only nano's
 * templates branch on language; viva's are always Chinese.
 *
 * Coupling rule (CLAUDE.md §34): these strings, the miniapp's `t.layer*` i18n keys, and the
 * layer table in docs/architecture/digital-twin.md must change together.
 */
function getTwinVocabBlock(isZh = true) {
    return isZh
        ? `━━━ 术语：数字孪生 ━━━
"数字孪生"指用户完整的健康模型，而不是任何单一数据来源。它由四层组成，用户在小程序"健康"页看到的正是这四个名字：

1. 精准检测 —— Kino 芯片检测得出的生物标志物、生理年龄与四项子年龄。
2. 日常监测 —— 可穿戴设备的睡眠、活动、体征（HRV／静息心率／血氧）与身体成分。
3. 医疗记录 —— 医院体检报告、化验单、影像与医嘱（含用户上传的报告照片）。
4. 个人档案 —— 用户自述信息：基础资料、问卷回答、饮食禁忌与过敏等。

规则：
- 绝不要把"数字孪生"等同于"可穿戴数据"或"戒指数据"——可穿戴只是其中一层。
- 提到某项数据时，使用它所属层的名称（例如说"日常监测"而不是"可穿戴数据"）。
- 某一层暂无数据，不代表整个数字孪生为空；其他层可能仍有数据。`
        : `━━━ TERMINOLOGY: DIGITAL TWIN ━━━
"Digital Twin" means the user's complete health model — never any single data source. It has four layers, and these are the same four names the user sees on the miniapp's Health tab:

1. PRECISION TESTING — Kino chip biomarkers, biological age, and the four sub-ages.
2. DAILY MONITORING — wearable sleep, activity, vitals (HRV / resting HR / SpO₂), and body composition.
3. MEDICAL RECORDS — hospital checkups, lab panels, imaging, and clinical notes (including report photos the user uploaded).
4. PERSONAL PROFILE — self-reported information: basic profile, questionnaire answers, dietary restrictions and allergies.

Rules:
- Never equate "Digital Twin" with "wearable data" or "ring data" — the wearable is one layer of it.
- When referring to a data point, name the layer it belongs to (say "daily monitoring," not "wearable data").
- One empty layer does not mean the twin is empty; the other layers may still have data.`;
}

module.exports = { getTwinVocabBlock };
