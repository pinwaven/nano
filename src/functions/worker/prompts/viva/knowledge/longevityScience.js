'use strict';

/**
 * Curated knowledge base — general longevity/aging science claims.
 * See tcmGeneVariants.js header for seeding rationale and the authoring-process open question.
 */
module.exports = [
    {
        id: 'inflammaging',
        topic: ['炎性衰老', 'inflammaging', '慢性炎症', 'NAD+'],
        claim_zh: '衰老在化学层面与慢性、无菌、低度的全身性炎症（inflammaging）相关，被认为会降解组织基质、影响微血管弹性、消耗 NAD+、增加 DNA 损伤风险。',
        evidence_level: 'meta_analysis',
        last_reviewed: '2026-07-28',
        reviewed_by: 'placeholder',
    },
    {
        id: 'glycan-immune-age',
        topic: ['糖链', 'Glycan', 'IgG', '免疫年龄'],
        claim_zh: '血清糖链（Glycan）是连接在免疫球蛋白（IgG）上的结构，其比例变化与全身炎症状态和免疫衰老程度相关，属于新兴的免疫年龄评估方向。',
        evidence_level: 'observational',
        last_reviewed: '2026-07-28',
        reviewed_by: 'placeholder',
    },
    {
        id: 'age-diff-tracking',
        topic: ['生理年龄差值', 'BioAge', 'ChronoAge', 'Δ'],
        claim_zh: '生理年龄与实际年龄的差值（Δ = BioAge − ChronoAge）是追踪干预效果的核心指标，建议每次 Kino 复测后比较变化趋势。',
        evidence_level: 'mechanistic_plausible',
        last_reviewed: '2026-07-28',
        reviewed_by: 'placeholder',
    },
    {
        id: 'senescent-cell-clearance',
        topic: ['衰老细胞', 'senolytic', '槲皮素', '漆黄素', 'SASP'],
        claim_zh: '衰老细胞会分泌促炎因子（SASP），槲皮素+漆黄素等 senolytic 化合物在人体研究中被用于探索清除衰老细胞的潜力。',
        evidence_level: 'rct',
        last_reviewed: '2026-07-28',
        reviewed_by: 'placeholder',
    },
];
