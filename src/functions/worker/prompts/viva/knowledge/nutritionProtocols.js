'use strict';

/**
 * Curated knowledge base — nutrition/lifestyle protocol claims.
 * See tcmGeneVariants.js header for seeding rationale and the authoring-process open question.
 */
module.exports = [
    {
        id: 'meal-order-glucose',
        topic: ['进食顺序', '血糖峰值', '纤维', '蛋白质', '碳水'],
        claim_zh: '进食顺序法（先吃纤维，再吃蛋白质，最后吃碳水）可将餐后血糖峰值降低，是常见的血糖管理策略。',
        evidence_level: 'rct',
        last_reviewed: '2026-07-28',
        reviewed_by: 'placeholder',
    },
    {
        id: 'zone2-aerobic-mitochondria',
        topic: ['Zone 2', '有氧训练', '线粒体', '骨骼肌'],
        claim_zh: 'Zone 2 有氧训练（中等强度、可持续对话的心率区间）可提升线粒体密度与效率，骨骼肌作为最大的葡萄糖缓冲库。',
        evidence_level: 'observational',
        last_reviewed: '2026-07-28',
        reviewed_by: 'placeholder',
    },
    {
        id: 'visceral-fat-cytokines',
        topic: ['内脏脂肪', 'IL-6', 'TNF-α', '炎性细胞因子'],
        claim_zh: '内脏脂肪组织分泌 IL-6、TNF-α 等炎性细胞因子，是慢性低度炎症（inflammaging）的重要来源之一。',
        evidence_level: 'meta_analysis',
        last_reviewed: '2026-07-28',
        reviewed_by: 'placeholder',
    },
    {
        id: 'food-igg-elimination',
        topic: ['IgG', '食物不耐受', '轮替饮食', '肠黏膜', 'sIgA'],
        claim_zh: '食物特异性 IgG 升高反映长期高频摄入某类食物形成的"接触记忆"，而非病理性过敏；轮替饮食（每4天更换高频食物）配合肠屏障修复是常见的功能营养干预思路。',
        evidence_level: 'insufficient',
        last_reviewed: '2026-07-28',
        reviewed_by: 'placeholder',
    },
];
