-- DB-backed replacement for Viva's static knowledge layers:
--   1. "essential" tier — always-injected content (was prompts/viva/factConstraint.js's
--      hard-coded getFactConstraintBlock() string, prepended to every Viva prompt template).
--   2. "optional" tier — matched-on-request content (was the 13 static entries across
--      prompts/viva/knowledge/{tcmGeneVariants,nutritionProtocols,longevityScience}.js,
--      merged and substring/tag-matched by knowledge/index.js's findRelevantEntries()).
-- See CLAUDE.md for the full design writeup. persona_type is included from the start even
-- though only 'viva' is populated today, so Nano can plug into the same table later.

CREATE TABLE IF NOT EXISTS knowledge_entries (
    id             TEXT PRIMARY KEY,
    persona_type   TEXT NOT NULL DEFAULT 'viva',
    tier           TEXT NOT NULL CHECK (tier IN ('essential', 'optional')),
    category       TEXT,
    topic          TEXT[] NOT NULL DEFAULT '{}',
    content_zh     TEXT NOT NULL,
    evidence_level TEXT,
    status         TEXT NOT NULL DEFAULT 'active',
    sort_order     INTEGER NOT NULL DEFAULT 0,
    last_reviewed  DATE,
    reviewed_by    TEXT,
    created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_knowledge_entries_lookup ON knowledge_entries (persona_type, tier, status);

-- Essential tier: factConstraint.js's guardrail block, moved verbatim. Kept as one row
-- (sort_order 0) since the source was always a single block; future essential rows can
-- interleave via sort_order without a schema change.
INSERT INTO knowledge_entries (id, persona_type, tier, category, content_zh, status, sort_order, last_reviewed, reviewed_by)
VALUES (
    'fact-constraint-core',
    'viva',
    'essential',
    'fact_constraint',
    '【事实约束 — 最高优先级，不得违反】
严禁捏造以下内容：具体研究名称、期刊名称、发表年份、临床试验编号、受试者人数、统计百分比、具体起效时间窗口（如"72小时内""2周后"）、预期改善幅度或数值预测、作者姓名或机构名称、具体p值、基因位点编号（如rs开头的SNP编号）、等位基因频率、参考数据库名称。
错误示例（绝对禁止此类编造，即使内容听起来合理）：
• "上海瑞金医院队列研究显示，每周红肉摄入超过300g的人群，细胞年龄平均加速1.9岁（p=0.002）" —— 编造了机构、队列、具体数值与p值
• "东亚人FMO3 rs2266782基因型频率达89%" —— 编造了具体基因位点编号与等位基因频率
• "中华医学会血液学分会2023"、"中国多中心参考数据库" —— 编造了机构或数据库名称作为数据来源
引用循证等级时，只使用以下标准表述，不附加任何虚构细节：
• "有高质量人体临床证据"
• "有随机对照试验（RCT）支持"
• "有系统综述或荟萃分析支持"
• "证据尚不充分，建议保守参考"
如现有数据不足以支持某个判断，直接说："目前没有足够信息支持这个判断。"
严禁捏造或推断任何公司业务信息，包括：物流/配送时效、配送方式、会员计划、促销活动、价格、库存状态、退换货政策或任何未在本次对话中明确提供的服务细节。如用户询问此类信息，回复："这个问题需要联系 Aeviva 客服或在 App 内查看最新信息，我无法代为确认。"
严禁引入任何未在本提示词中提供的具体机制、暴露因素、基因型、族群遗传学或分子生物学细节（如特定基因位点、酶变异型、环境暴露来源如"油烟""重金属"等）；东方人群相关洞见仅限于使用提示词中已提供的表述，不得在其基础上编造新的具体诱因。

本系统仅测量以下四个生理年龄维度，没有其他维度：CellularAge（细胞年龄）、MetabolicAge（代谢年龄）、MicroVascularAge（微血管年龄）、ResilienceAge（抗压年龄）。如用户提及本系统未提供的其他"年龄"概念（如"排毒年龄""肠道年龄""皮肤年龄""免疫年龄"等），必须明确告知"本系统目前未提供该项检测"，可礼貌说明其与现有四个维度中最相关的一个并简要解释，但绝不可编造该维度专属的检测方法、生物标志物组合或具体数值——不得假装它是本系统的真实输出。

仅推荐原粒，不建议外购：任何具体成分/补充剂/剂量建议都必须来自 Waven 原粒配方库，绝不建议用户额外购买配方库之外的补充剂、草本、单体营养素或食材提取物（如"牛磺酸粉""硫辛酸""葡萄籽提取物"等）。若配方库中没有对应产品，直接说明"目前的原粒配方库中没有针对这一点的产品"，不得给出品牌、剂量或购买渠道建议。日常整体饮食/餐食建议不受此限制，但不得在饮食建议中夹带具体分离出的营养补充剂成分与剂量。

提及具体原粒时，编号、名称、成分必须逐字复制提示词中原粒配方库里给出的原文，不得凭记忆改写、替换或编造——配方库内容可能随产品迭代更新，你训练数据中记忆的旧版名称/成分可能已不准确。如果不确定某个编号对应的准确名称，宁可只说编号（如"12号原粒"）而不描述名称，也不要猜测或凭记忆填写名称。',
    'active',
    0,
    '2026-07-25',
    'seed-migration'
)
ON CONFLICT (id) DO NOTHING;

-- Optional tier: the 13 entries formerly in prompts/viva/knowledge/tcmGeneVariants.js,
-- nutritionProtocols.js, longevityScience.js — content unchanged, category tracks source file.

INSERT INTO knowledge_entries (id, persona_type, tier, category, topic, content_zh, evidence_level, status, last_reviewed, reviewed_by) VALUES
('aldh2-flush', 'viva', 'optional', 'tcm_gene_variant', ARRAY['ALDH2', '酒精代谢', '亚洲红脸', '酒精脸红基因', '氧化损伤'],
 'ALDH2 突变（酒精脸红基因）在东亚人群中高发，饮酒后乙醛蓄积，触发氧化损伤并加速微血管老化。', 'observational', 'active', '2026-07-28', 'placeholder'),

('lct-lactose-intolerance', 'viva', 'optional', 'tcm_gene_variant', ARRAY['LCT', '乳糖不耐受', '乳制品'],
 'LCT 基因型导致的乳糖不耐受在东亚人群中常见，建议调整乳制品摄入策略（如改用低乳糖或发酵乳制品）。', 'observational', 'active', '2026-07-28', 'placeholder'),

('mthfr-folate', 'viva', 'optional', 'tcm_gene_variant', ARRAY['MTHFR', '叶酸', '甲基叶酸', '5-MTHF'],
 'MTHFR 基因变异者对合成叶酸的代谢效率较低，建议以活性甲基叶酸（5-MTHF）替代合成叶酸补充。', 'mechanistic_plausible', 'active', '2026-07-28', 'placeholder'),

('skinny-fat-metabolic-paradox', 'viva', 'optional', 'tcm_gene_variant', ARRAY['瘦胖体型', '代谢悖论', 'BMI正常', '内脏脂肪', '糖基化', '胰岛素抵抗'],
 '华人在 BMI 正常范围内也可能积累大量内脏脂肪并出现代谢功能障碍（糖基化、胰岛素抵抗）——BMI 正常不等于代谢安全。', 'observational', 'active', '2026-07-28', 'placeholder'),

('refined-carb-sensitivity', 'viva', 'optional', 'tcm_gene_variant', ARRAY['精制碳水', '血糖负荷', '糖化白蛋白', 'GA'],
 '东亚饮食以精米白面为主，较高的血糖负荷对胰岛素分泌造成压力，与糖化白蛋白（GA）升高相关。', 'mechanistic_plausible', 'active', '2026-07-28', 'placeholder'),

('meal-order-glucose', 'viva', 'optional', 'nutrition_protocol', ARRAY['进食顺序', '血糖峰值', '纤维', '蛋白质', '碳水'],
 '进食顺序法（先吃纤维，再吃蛋白质，最后吃碳水）可将餐后血糖峰值降低，是常见的血糖管理策略。', 'rct', 'active', '2026-07-28', 'placeholder'),

('zone2-aerobic-mitochondria', 'viva', 'optional', 'nutrition_protocol', ARRAY['Zone 2', '有氧训练', '线粒体', '骨骼肌'],
 'Zone 2 有氧训练（中等强度、可持续对话的心率区间）可提升线粒体密度与效率，骨骼肌作为最大的葡萄糖缓冲库。', 'observational', 'active', '2026-07-28', 'placeholder'),

('visceral-fat-cytokines', 'viva', 'optional', 'nutrition_protocol', ARRAY['内脏脂肪', 'IL-6', 'TNF-α', '炎性细胞因子'],
 '内脏脂肪组织分泌 IL-6、TNF-α 等炎性细胞因子，是慢性低度炎症（inflammaging）的重要来源之一。', 'meta_analysis', 'active', '2026-07-28', 'placeholder'),

('food-igg-elimination', 'viva', 'optional', 'nutrition_protocol', ARRAY['IgG', '食物不耐受', '轮替饮食', '肠黏膜', 'sIgA'],
 '食物特异性 IgG 升高反映长期高频摄入某类食物形成的"接触记忆"，而非病理性过敏；轮替饮食（每4天更换高频食物）配合肠屏障修复是常见的功能营养干预思路。', 'insufficient', 'active', '2026-07-28', 'placeholder'),

('inflammaging', 'viva', 'optional', 'longevity_science', ARRAY['炎性衰老', 'inflammaging', '慢性炎症', 'NAD+'],
 '衰老在化学层面与慢性、无菌、低度的全身性炎症（inflammaging）相关，被认为会降解组织基质、影响微血管弹性、消耗 NAD+、增加 DNA 损伤风险。', 'meta_analysis', 'active', '2026-07-28', 'placeholder'),

('glycan-immune-age', 'viva', 'optional', 'longevity_science', ARRAY['糖链', 'Glycan', 'IgG', '免疫年龄'],
 '血清糖链（Glycan）是连接在免疫球蛋白（IgG）上的结构，其比例变化与全身炎症状态和免疫衰老程度相关，属于新兴的免疫年龄评估方向。', 'observational', 'active', '2026-07-28', 'placeholder'),

('age-diff-tracking', 'viva', 'optional', 'longevity_science', ARRAY['生理年龄差值', 'BioAge', 'ChronoAge', 'Δ'],
 '生理年龄与实际年龄的差值（Δ = BioAge − ChronoAge）是追踪干预效果的核心指标，建议每次 Kino 复测后比较变化趋势。', 'mechanistic_plausible', 'active', '2026-07-28', 'placeholder'),

('senescent-cell-clearance', 'viva', 'optional', 'longevity_science', ARRAY['衰老细胞', 'senolytic', '槲皮素', '漆黄素', 'SASP'],
 '衰老细胞会分泌促炎因子（SASP），槲皮素+漆黄素等 senolytic 化合物在人体研究中被用于探索清除衰老细胞的潜力。', 'rct', 'active', '2026-07-28', 'placeholder')

ON CONFLICT (id) DO NOTHING;
