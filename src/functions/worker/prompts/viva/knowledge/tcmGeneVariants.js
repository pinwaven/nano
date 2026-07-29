'use strict';

/**
 * Curated knowledge base — gene-variant / East Asian population genetics claims.
 *
 * Seeded from claims already hard-coded as static prose in systemChat.js/chat/science.js
 * today (2026-07-28) — since those ship in production already, they're implicitly already
 * product-approved, so seeding from them needs no new clinical sign-off. Anything ADDED
 * beyond this seed set should go through a named clinical/TCM reviewer via normal PR review
 * (see docs note in knowledge/index.js) — that reviewer identity/cadence is a product
 * decision not resolved by this file.
 */
module.exports = [
    {
        id: 'aldh2-flush',
        topic: ['ALDH2', '酒精代谢', '亚洲红脸', '酒精脸红基因', '氧化损伤'],
        claim_zh: 'ALDH2 突变（酒精脸红基因）在东亚人群中高发，饮酒后乙醛蓄积，触发氧化损伤并加速微血管老化。',
        evidence_level: 'observational',
        last_reviewed: '2026-07-28',
        reviewed_by: 'placeholder',
    },
    {
        id: 'lct-lactose-intolerance',
        topic: ['LCT', '乳糖不耐受', '乳制品'],
        claim_zh: 'LCT 基因型导致的乳糖不耐受在东亚人群中常见，建议调整乳制品摄入策略（如改用低乳糖或发酵乳制品）。',
        evidence_level: 'observational',
        last_reviewed: '2026-07-28',
        reviewed_by: 'placeholder',
    },
    {
        id: 'mthfr-folate',
        topic: ['MTHFR', '叶酸', '甲基叶酸', '5-MTHF'],
        claim_zh: 'MTHFR 基因变异者对合成叶酸的代谢效率较低，建议以活性甲基叶酸（5-MTHF）替代合成叶酸补充。',
        evidence_level: 'mechanistic_plausible',
        last_reviewed: '2026-07-28',
        reviewed_by: 'placeholder',
    },
    {
        id: 'skinny-fat-metabolic-paradox',
        topic: ['瘦胖体型', '代谢悖论', 'BMI正常', '内脏脂肪', '糖基化', '胰岛素抵抗'],
        claim_zh: '华人在 BMI 正常范围内也可能积累大量内脏脂肪并出现代谢功能障碍（糖基化、胰岛素抵抗）——BMI 正常不等于代谢安全。',
        evidence_level: 'observational',
        last_reviewed: '2026-07-28',
        reviewed_by: 'placeholder',
    },
    {
        id: 'refined-carb-sensitivity',
        topic: ['精制碳水', '血糖负荷', '糖化白蛋白', 'GA'],
        claim_zh: '东亚饮食以精米白面为主，较高的血糖负荷对胰岛素分泌造成压力，与糖化白蛋白（GA）升高相关。',
        evidence_level: 'mechanistic_plausible',
        last_reviewed: '2026-07-28',
        reviewed_by: 'placeholder',
    },
];
