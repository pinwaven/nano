-- Migration: Add new fields to dots table from dots.md product spec
-- Adds: timing, color_hex, group_name, group_name_zh, sub_age_target, sub_age_target_zh, ingredients_summary
-- Also refreshes all 18 rows with authoritative data from dots.md

ALTER TABLE dots ADD COLUMN IF NOT EXISTS timing TEXT;
ALTER TABLE dots ADD COLUMN IF NOT EXISTS color_hex TEXT;
ALTER TABLE dots ADD COLUMN IF NOT EXISTS group_name TEXT;
ALTER TABLE dots ADD COLUMN IF NOT EXISTS group_name_zh TEXT;
ALTER TABLE dots ADD COLUMN IF NOT EXISTS sub_age_target TEXT;
ALTER TABLE dots ADD COLUMN IF NOT EXISTS sub_age_target_zh TEXT;
ALTER TABLE dots ADD COLUMN IF NOT EXISTS ingredients_summary TEXT;

-- DOT01 Cellular Fuel
UPDATE dots SET
  name = 'Cellular Fuel',
  name_zh = '细胞原力',
  is_isolate = true,
  color = 'Deep Steel',
  color_zh = '深钢蓝',
  color_hex = '#4A5D7B',
  group_name = 'BioAge Reducing',
  group_name_zh = '生物减龄',
  sub_age_target = 'Cellular Age',
  sub_age_target_zh = '细胞年龄',
  timing = 'Morning',
  ingredients_summary = 'NMN / 烟酰胺单核苷酸',
  description = 'The core NAD+ booster for cellular energy.',
  ingredients = '[{"mg":24,"name":"NMN","mg_per_kg_male":7.5,"mg_per_kg_female":7.5,"max_mg_per_day":1000,"contraindications":["Active cancer or history of certain hormone-sensitive cancers"]}]',
  ingredients_zh = '[{"mg":24,"name":"烟酰胺单核苷酸","mg_per_kg_male":7.5,"mg_per_kg_female":7.5,"max_mg_per_day":1000,"contraindications":["活动性癌症或某些激素敏感性癌症史"]}]'
WHERE key_name = 'DOT01';

-- DOT02 Cellular Guard
UPDATE dots SET
  name = 'Cellular Guard',
  name_zh = '细胞守护',
  is_isolate = true,
  color = 'Muted Amethyst',
  color_zh = '柔紫',
  color_hex = '#6B5B95',
  group_name = 'BioAge Reducing',
  group_name_zh = '生物减龄',
  sub_age_target = 'Cellular Age',
  sub_age_target_zh = '细胞年龄',
  timing = 'Evening',
  ingredients_summary = 'Apigenin / 芹菜素',
  description = 'Potent CD38 inhibitor to prevent NAD+ degradation and promote relaxation.',
  ingredients = '[{"mg":24,"name":"Apigenin","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":100,"contraindications":["Sedatives","Muscle relaxants"]}]',
  ingredients_zh = '[{"mg":24,"name":"芹菜素","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":100,"contraindications":["镇静剂","肌肉松弛剂"]}]'
WHERE key_name = 'DOT02';

-- DOT03 Cellular Catalyst
UPDATE dots SET
  name = 'Cellular Catalyst',
  name_zh = '细胞催化',
  is_isolate = true,
  color = 'Stormy Blue',
  color_zh = '风暴蓝',
  color_hex = '#5B7B8C',
  group_name = 'BioAge Reducing',
  group_name_zh = '生物减龄',
  sub_age_target = 'Cellular Age',
  sub_age_target_zh = '细胞年龄',
  timing = 'Morning',
  ingredients_summary = 'Trans-Resveratrol / 反式白藜芦醇',
  description = 'Sirtuin activator that works synergistically with NMN to promote cellular longevity.',
  ingredients = '[{"mg":24,"name":"Trans-Resveratrol","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":500,"contraindications":["Bleeding disorders","Anticoagulant drugs","Hormone-sensitive conditions"]}]',
  ingredients_zh = '[{"mg":24,"name":"反式白藜芦醇","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":500,"contraindications":["出血性疾病","抗凝药物","激素敏感性疾病"]}]'
WHERE key_name = 'DOT03';

-- DOT04 Cellular Cleanup
UPDATE dots SET
  name = 'Cellular Cleanup',
  name_zh = '细胞净化',
  is_isolate = false,
  color = 'Dusty Purple',
  color_zh = '灰紫',
  color_hex = '#7B6B8C',
  group_name = 'BioAge Reducing',
  group_name_zh = '生物减龄',
  sub_age_target = 'Cellular Age',
  sub_age_target_zh = '细胞年龄',
  timing = 'Evening',
  ingredients_summary = 'Fisetin / 漆黄素, Pterostilbene / 紫檀芪, Taxifolin / 二氢槲皮素, Spermidine / 亚精胺',
  description = 'Dual-action cellular cleanup: induces autophagy (Spermidine) and clears senescent zombie cells.',
  ingredients = '[{"mg":8.4,"name":"Fisetin","mg_per_kg_male":0.45,"mg_per_kg_female":0.45,"max_mg_per_day":500,"contraindications":["Anticoagulants","Blood thinners"]},{"mg":6.9,"name":"Pterostilbene","mg_per_kg_male":0.35,"mg_per_kg_female":0.35,"max_mg_per_day":250,"contraindications":["Anticoagulants","Blood thinners"]},{"mg":6.6,"name":"Taxifolin","mg_per_kg_male":0.35,"mg_per_kg_female":0.35,"max_mg_per_day":200,"contraindications":[]},{"mg":2.1,"name":"Spermidine","mg_per_kg_male":0.05,"mg_per_kg_female":0.05,"max_mg_per_day":10,"contraindications":[]}]',
  ingredients_zh = '[{"mg":8.4,"name":"漆黄素","mg_per_kg_male":0.45,"mg_per_kg_female":0.45,"max_mg_per_day":500,"contraindications":["抗凝剂","血液稀释剂"]},{"mg":6.9,"name":"紫檀芪","mg_per_kg_male":0.35,"mg_per_kg_female":0.35,"max_mg_per_day":250,"contraindications":["抗凝剂","血液稀释剂"]},{"mg":6.6,"name":"二氢槲皮素","mg_per_kg_male":0.35,"mg_per_kg_female":0.35,"max_mg_per_day":200,"contraindications":[]},{"mg":2.1,"name":"亚精胺","mg_per_kg_male":0.05,"mg_per_kg_female":0.05,"max_mg_per_day":10,"contraindications":[]}]'
WHERE key_name = 'DOT04';

-- DOT05 Metabolic Resilience
UPDATE dots SET
  name = 'Metabolic Resilience',
  name_zh = '代谢韧性',
  is_isolate = false,
  color = 'Slate Gray',
  color_zh = '板岩灰',
  color_hex = '#4E5E66',
  group_name = 'BioAge Reducing',
  group_name_zh = '生物减龄',
  sub_age_target = 'Metabolic Age',
  sub_age_target_zh = '代谢年龄',
  timing = 'Morning',
  ingredients_summary = 'Urolithin A / 尿食素A, Ca-AKG / Alpha-酮戊二酸钙',
  description = 'Mitochondrial & Muscle Aging',
  ingredients = '[{"mg":12,"name":"Urolithin A","mg_per_kg_male":2,"mg_per_kg_female":2,"max_mg_per_day":1000,"contraindications":[]},{"mg":12,"name":"Ca-AKG","mg_per_kg_male":2,"mg_per_kg_female":2,"max_mg_per_day":2000,"contraindications":["Severe kidney disease"]}]',
  ingredients_zh = '[{"mg":12,"name":"尿食素A","mg_per_kg_male":2,"mg_per_kg_female":2,"max_mg_per_day":1000,"contraindications":[]},{"mg":12,"name":"Alpha-酮戊二酸钙","mg_per_kg_male":2,"mg_per_kg_female":2,"max_mg_per_day":2000,"contraindications":["严重肾病"]}]'
WHERE key_name = 'DOT05';

-- DOT06 Dermal Radiance (Collagen & Matrix)
UPDATE dots SET
  name = 'Dermal Radiance (Collagen & Matrix)',
  name_zh = '紧致焕颜',
  is_isolate = false,
  color = 'Mist Blue',
  color_zh = '雾蓝',
  color_hex = '#8A9AAB',
  group_name = 'BioAge Reducing',
  group_name_zh = '生物减龄',
  sub_age_target = 'Cellular Age',
  sub_age_target_zh = '细胞年龄',
  timing = 'Evening',
  ingredients_summary = 'Elastin / 高纯弹性胶原蛋白, Sturgeon Collagen / 鲟鱼胶原蛋白肽, Collagen Tripeptide / 胶原三肽, N-乙酰神经氨酸',
  description = 'Structural Matrix & Cellular Rejuvenation',
  ingredients = '[{"mg":6,"name":"Elastin","mg_per_kg_male":0.25,"mg_per_kg_female":0.3,"max_mg_per_day":500,"contraindications":[]},{"mg":6,"name":"Sturgeon Collagen","mg_per_kg_male":0.25,"mg_per_kg_female":0.3,"max_mg_per_day":2000,"contraindications":["Fish allergies"]},{"mg":6,"name":"Collagen Tripeptide","mg_per_kg_male":0.25,"mg_per_kg_female":0.3,"max_mg_per_day":2000,"contraindications":[]},{"mg":6,"name":"N-乙酰神经氨酸","mg_per_kg_male":0.25,"mg_per_kg_female":0.3,"max_mg_per_day":500,"contraindications":[]}]',
  ingredients_zh = '[{"mg":6,"name":"高纯弹性胶原蛋白","mg_per_kg_male":0.25,"mg_per_kg_female":0.3,"max_mg_per_day":500,"contraindications":[]},{"mg":6,"name":"鲟鱼胶原蛋白肽","mg_per_kg_male":0.25,"mg_per_kg_female":0.3,"max_mg_per_day":2000,"contraindications":["鱼类过敏"]},{"mg":6,"name":"胶原三肽","mg_per_kg_male":0.25,"mg_per_kg_female":0.3,"max_mg_per_day":2000,"contraindications":[]},{"mg":6,"name":"N-乙酰神经氨酸","mg_per_kg_male":0.25,"mg_per_kg_female":0.3,"max_mg_per_day":500,"contraindications":[]}]'
WHERE key_name = 'DOT06';

-- DOT07 Metabolic Power
UPDATE dots SET
  name = 'Metabolic Power',
  name_zh = '代谢动力',
  is_isolate = true,
  color = 'Muted Gold',
  color_zh = '哑金',
  color_hex = '#C9A66B',
  group_name = 'Energy & Performance Boost',
  group_name_zh = '能量焕发',
  sub_age_target = 'Metabolic Age',
  sub_age_target_zh = '代谢年龄',
  timing = 'Morning',
  ingredients_summary = 'PQQ / PQQ',
  description = 'For mitochondrial biogenesis.',
  ingredients = '[{"mg":24,"name":"PQQ","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":40,"contraindications":[]}]',
  ingredients_zh = '[{"mg":24,"name":"PQQ","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":40,"contraindications":[]}]'
WHERE key_name = 'DOT07';

-- DOT08 Vascular Awakening (Flow & Methylation)
UPDATE dots SET
  name = 'Vascular Awakening (Flow & Methylation)',
  name_zh = '血管唤醒',
  is_isolate = false,
  color = 'Sage',
  color_zh = '鼠尾草绿',
  color_hex = '#8BA889',
  group_name = 'Energy & Performance Boost',
  group_name_zh = '能量焕发',
  sub_age_target = 'Micro-Vascular Age',
  sub_age_target_zh = '微血管年龄',
  timing = 'Morning',
  ingredients_summary = 'Beta-Alanine / β-丙氨酸, Niacin (Nicotinic Acid) / 烟酸, Methyl-B Complex / 甲基化复合B族',
  description = 'Induces mild paresthesia (tingle) and niacin flush for physical feedback, while supporting methylation.',
  ingredients = '[{"mg":15,"name":"Beta-Alanine","mg_per_kg_male":0.3,"mg_per_kg_female":0.24,"max_mg_per_day":3000,"contraindications":[]},{"mg":6,"name":"Niacin (Nicotinic Acid)","mg_per_kg_male":0.125,"mg_per_kg_female":0.1,"max_mg_per_day":100,"contraindications":["Active peptic ulcer disease","Severe gout","Liver disease","Statins (high doses)"]},{"mg":3,"name":"Methyl-B Complex","mg_per_kg_male":0.06,"mg_per_kg_female":0.06,"max_mg_per_day":100,"contraindications":[]}]',
  ingredients_zh = '[{"mg":15,"name":"β-丙氨酸","mg_per_kg_male":0.3,"mg_per_kg_female":0.24,"max_mg_per_day":3000,"contraindications":[]},{"mg":6,"name":"烟酸","mg_per_kg_male":0.125,"mg_per_kg_female":0.1,"max_mg_per_day":100,"contraindications":["活动性消化性溃疡","严重痛风","肝病","他汀类药物 (高剂量)"]},{"mg":3,"name":"甲基化复合B族","mg_per_kg_male":0.06,"mg_per_kg_female":0.06,"max_mg_per_day":100,"contraindications":[]}]'
WHERE key_name = 'DOT08';

-- DOT09 Resilience Support
UPDATE dots SET
  name = 'Resilience Support',
  name_zh = '抗压支持',
  is_isolate = true,
  color = 'Seafoam',
  color_zh = '海泡绿',
  color_hex = '#7FA99B',
  group_name = 'Energy & Performance Boost',
  group_name_zh = '能量焕发',
  sub_age_target = 'Resilience Age',
  sub_age_target_zh = '抗压年龄',
  timing = 'Morning',
  ingredients_summary = 'Curcumin / 姜黄素',
  description = 'The direct, real-time hs-CRP and acute inflammation suppressor.',
  ingredients = '[{"mg":24,"name":"Curcumin","mg_per_kg_male":5,"mg_per_kg_female":5,"max_mg_per_day":1500,"contraindications":["Gallbladder disease","Bleeding disorders","Anticoagulant drugs","Iron deficiency"]}]',
  ingredients_zh = '[{"mg":24,"name":"姜黄素","mg_per_kg_male":5,"mg_per_kg_female":5,"max_mg_per_day":1500,"contraindications":["胆囊疾病","出血性疾病","抗凝药物","缺铁"]}]'
WHERE key_name = 'DOT09';

-- DOT10 Morning Ignition (Energy & Focus)
UPDATE dots SET
  name = 'Morning Ignition (Energy & Focus)',
  name_zh = '晨间引擎',
  is_isolate = false,
  color = 'Olive Gold',
  color_zh = '橄榄金',
  color_hex = '#B8A44F',
  group_name = 'Energy & Performance Boost',
  group_name_zh = '能量焕发',
  sub_age_target = 'Cellular Age',
  sub_age_target_zh = '细胞年龄',
  timing = 'Morning',
  ingredients_summary = 'Dynamine (Methylliberine) / 甲基解放素, TeaCrine (Theacrine) / 苦茶碱',
  description = 'Jitter-free, rapid-onset cognitive energy, motivation, and focus peaking in 15 minutes.',
  ingredients = '[{"mg":12,"name":"Dynamine (Methylliberine)","mg_per_kg_male":0.25,"mg_per_kg_female":0.2,"max_mg_per_day":200,"contraindications":["Severe cardiovascular disease","Uncontrolled hypertension","MAOIs"]},{"mg":12,"name":"TeaCrine (Theacrine)","mg_per_kg_male":0.25,"mg_per_kg_female":0.2,"max_mg_per_day":200,"contraindications":["Severe cardiovascular disease","Uncontrolled hypertension"]}]',
  ingredients_zh = '[{"mg":12,"name":"甲基解放素 (Dynamine)","mg_per_kg_male":0.25,"mg_per_kg_female":0.2,"max_mg_per_day":200,"contraindications":["严重心血管疾病","未控制的高血压","单胺氧化酶抑制剂 (MAOIs)"]},{"mg":12,"name":"苦茶碱 (TeaCrine)","mg_per_kg_male":0.25,"mg_per_kg_female":0.2,"max_mg_per_day":200,"contraindications":["严重心血管疾病","未控制的高血压"]}]'
WHERE key_name = 'DOT10';

-- DOT11 Athletic Peak (Endurance & ATP)
UPDATE dots SET
  name = 'Athletic Peak (Endurance & ATP)',
  name_zh = '巅峰体能',
  is_isolate = false,
  color = 'Burnt Orange',
  color_zh = '焦橙色',
  color_hex = '#B55A30',
  group_name = 'Energy & Performance Boost',
  group_name_zh = '能量焕发',
  sub_age_target = 'Metabolic Age',
  sub_age_target_zh = '代谢年龄',
  timing = 'Morning',
  ingredients_summary = 'Cordyceps Militaris / 蛹虫草, Rhodiola Rosea / 红景天',
  description = 'Increases VO2 max and ATP production for superior physical endurance and fatigue resistance.',
  ingredients = '[{"mg":12,"name":"Cordyceps Militaris","mg_per_kg_male":1,"mg_per_kg_female":1,"max_mg_per_day":1000,"contraindications":["Autoimmune diseases","Blood thinners"]},{"mg":12,"name":"Rhodiola Rosea","mg_per_kg_male":1,"mg_per_kg_female":0.8,"max_mg_per_day":600,"contraindications":["Bipolar disorder","Stimulant medications"]}]',
  ingredients_zh = '[{"mg":12,"name":"蛹虫草","mg_per_kg_male":1,"mg_per_kg_female":1,"max_mg_per_day":1000,"contraindications":["自身免疫性疾病","血液稀释剂"]},{"mg":12,"name":"红景天","mg_per_kg_male":1,"mg_per_kg_female":0.8,"max_mg_per_day":600,"contraindications":["双相情感障碍","兴奋剂类药物"]}]'
WHERE key_name = 'DOT11';

-- DOT12 Deep Sleep & Recovery
UPDATE dots SET
  name = 'Deep Sleep & Recovery',
  name_zh = '深度睡眠与恢复',
  is_isolate = false,
  color = 'Midnight Blue',
  color_zh = '午夜蓝',
  color_hex = '#2C3E50',
  group_name = 'Energy & Performance Boost',
  group_name_zh = '能量焕发',
  sub_age_target = 'Resilience Age',
  sub_age_target_zh = '抗压年龄',
  timing = 'Evening',
  ingredients_summary = 'Mag Threonate / 苏糖酸镁, Mag Glycinate / 甘氨酸镁, Ashwagandha / 南非醉茄内脂, Glycine / 甘氨酸',
  description = 'Non-hormonal sleep architecture. Lowers core body temperature and evening cortisol for profound restorative sleep.',
  ingredients = '[{"mg":6,"name":"Magnesium Threonate","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":400,"contraindications":["Severe renal impairment"]},{"mg":6,"name":"Magnesium Glycinate","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":400,"contraindications":["Severe renal impairment","Myasthenia gravis"]},{"mg":6,"name":"Ashwagandha Lactones","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":500,"contraindications":["Autoimmune diseases","Thyroid disorders"]},{"mg":6,"name":"Glycine","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":3000,"contraindications":["Clozapine interactions"]}]',
  ingredients_zh = '[{"mg":6,"name":"苏糖酸镁","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":400,"contraindications":["严重肾功能损害"]},{"mg":6,"name":"甘氨酸镁","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":400,"contraindications":["严重肾功能损害","重症肌无力"]},{"mg":6,"name":"南非醉茄内脂","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":500,"contraindications":["自身免疫性疾病","甲状腺疾病"]},{"mg":6,"name":"甘氨酸","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":3000,"contraindications":["氯氮平相互作用"]}]'
WHERE key_name = 'DOT12';

-- DOT13 Vascular Flow
UPDATE dots SET
  name = 'Vascular Flow',
  name_zh = '微血管通流',
  is_isolate = false,
  color = 'Terracotta',
  color_zh = '陶土红',
  color_hex = '#D68C7A',
  group_name = 'System Optimization',
  group_name_zh = '系统调优',
  sub_age_target = 'Micro-Vascular Age',
  sub_age_target_zh = '微血管年龄',
  timing = 'Morning',
  ingredients_summary = 'CoQ10 / 辅酶Q10, Nattokinase / 纳豆激酶',
  description = 'Potent cardiovascular clearing and mitochondrial energy support.',
  ingredients = '[{"mg":15,"name":"CoQ10","mg_per_kg_male":0.625,"mg_per_kg_female":0.625,"max_mg_per_day":400,"contraindications":["Blood pressure medications (additive effect)","Chemotherapy drugs"]},{"mg":9,"name":"Nattokinase","mg_per_kg_male":0.375,"mg_per_kg_female":0.375,"max_mg_per_day":200,"contraindications":["Bleeding disorders","Anticoagulant drugs (Warfarin, Heparin)","Recent surgery"]}]',
  ingredients_zh = '[{"mg":15,"name":"辅酶Q10","mg_per_kg_male":0.625,"mg_per_kg_female":0.625,"max_mg_per_day":400,"contraindications":["降压药物 (叠加效应)","化疗药物"]},{"mg":9,"name":"纳豆激酶","mg_per_kg_male":0.375,"mg_per_kg_female":0.375,"max_mg_per_day":200,"contraindications":["出血性疾病","抗凝药物 (华法林、肝素)","近期手术"]}]'
WHERE key_name = 'DOT13';

-- DOT14 Vascular Protection
UPDATE dots SET
  name = 'Vascular Protection',
  name_zh = '微血管保护',
  is_isolate = false,
  color = 'Periwinkle',
  color_zh = '长春花蓝',
  color_hex = '#A8B5E0',
  group_name = 'System Optimization',
  group_name_zh = '系统调优',
  sub_age_target = 'Micro-Vascular Age',
  sub_age_target_zh = '微血管年龄',
  timing = 'Morning',
  ingredients_summary = 'Vitamin D3 / 维生素D3, Vitamin K2 (MK-7) / 维生素K2 (MK-7), MCT Powder Carrier / MCT微囊粉',
  description = 'Essential D3+K2 paired with a lipid carrier for maximum absorption.',
  ingredients = '[{"mg":0.03,"name":"Vitamin D3","mg_per_kg_male":0.001,"mg_per_kg_female":0.001,"max_mg_per_day":0.1,"contraindications":["Hypercalcemia","Hyperparathyroidism","Sarcoidosis"]},{"mg":0.03,"name":"Vitamin K2 (MK-7)","mg_per_kg_male":0.001,"mg_per_kg_female":0.001,"max_mg_per_day":0.2,"contraindications":["Warfarin or similar Coumadin-based anticoagulants"]},{"mg":23.94,"name":"MCT Powder Carrier","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":5000,"contraindications":["Medium-chain acyl-CoA dehydrogenase (MCAD) deficiency"]}]',
  ingredients_zh = '[{"mg":0.03,"name":"维生素D3","mg_per_kg_male":0.001,"mg_per_kg_female":0.001,"max_mg_per_day":0.1,"contraindications":["高钙血症","甲状旁腺功能亢进","结节病"]},{"mg":0.03,"name":"维生素K2 (MK-7)","mg_per_kg_male":0.001,"mg_per_kg_female":0.001,"max_mg_per_day":0.2,"contraindications":["华法林或类似香豆素的抗凝剂"]},{"mg":23.94,"name":"MCT微囊粉","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":5000,"contraindications":["中链酰基辅酶A脱氢酶 (MCAD) 缺乏症"]}]'
WHERE key_name = 'DOT14';

-- DOT15 Zen & Stress Resonance
UPDATE dots SET
  name = 'Zen & Stress Resonance',
  name_zh = '禅意与抗压共振',
  is_isolate = false,
  color = 'Muted Rose',
  color_zh = '柔粉',
  color_hex = '#D9AEB4',
  group_name = 'System Optimization',
  group_name_zh = '系统调优',
  sub_age_target = 'Resilience Age',
  sub_age_target_zh = '抗压年龄',
  timing = 'Evening',
  ingredients_summary = 'Kanna Extract (Zembrin) / 枯蒂提取物, Saffron Extract / 藏红花提取物, Magnesium Glycinate / 甘氨酸镁',
  description = 'Rapid-acting mood elevation, deep physical calm, and mild euphoria via Kanna and Saffron.',
  ingredients = '[{"mg":12,"name":"Kanna Extract (Zembrin)","mg_per_kg_male":0.25,"mg_per_kg_female":0.25,"max_mg_per_day":50,"contraindications":["MAOIs","SSRIs","SNRIs (Risk of Serotonin Syndrome)","Bipolar disorder"]},{"mg":6,"name":"Saffron Extract","mg_per_kg_male":0.125,"mg_per_kg_female":0.125,"max_mg_per_day":30,"contraindications":["Bipolar disorder","Bleeding disorders","Pregnancy (high doses)"]},{"mg":6,"name":"Magnesium Glycinate","mg_per_kg_male":0.125,"mg_per_kg_female":0.125,"max_mg_per_day":400,"contraindications":["Severe renal impairment","Myasthenia gravis"]}]',
  ingredients_zh = '[{"mg":12,"name":"枯蒂提取物 (Zembrin)","mg_per_kg_male":0.25,"mg_per_kg_female":0.25,"max_mg_per_day":50,"contraindications":["单胺氧化酶抑制剂 (MAOIs)","SSRIs","SNRIs (血清素综合征风险)","双相情感障碍"]},{"mg":6,"name":"藏红花提取物","mg_per_kg_male":0.125,"mg_per_kg_female":0.125,"max_mg_per_day":30,"contraindications":["双相情感障碍","出血性疾病","妊娠 (高剂量)"]},{"mg":6,"name":"甘氨酸镁","mg_per_kg_male":0.125,"mg_per_kg_female":0.125,"max_mg_per_day":400,"contraindications":["严重肾功能损害","重症肌无力"]}]'
WHERE key_name = 'DOT15';

-- DOT16 Resilience Defense
UPDATE dots SET
  name = 'Resilience Defense',
  name_zh = '抗压防御',
  is_isolate = false,
  color = 'Soft Sky',
  color_zh = '柔空蓝',
  color_hex = '#9BB7D4',
  group_name = 'System Optimization',
  group_name_zh = '系统调优',
  sub_age_target = 'Resilience Age',
  sub_age_target_zh = '抗压年龄',
  timing = 'Evening',
  ingredients_summary = 'Glutathione / 谷胱甘肽, NAC / N-乙酰-L-半胱胺酸, Milk Thistle / 水飞蓟, L-Ergothioneine / 麦角硫因',
  description = 'Comprehensive defense against oxidative stress and support for liver detoxification.',
  ingredients = '[{"mg":9,"name":"Glutathione","mg_per_kg_male":0.75,"mg_per_kg_female":0.75,"max_mg_per_day":1000,"contraindications":["Asthma (inhalation risk, though oral is generally safe)"]},{"mg":6,"name":"NAC","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":1200,"contraindications":["Bleeding disorders","Nitroglycerin"]},{"mg":6,"name":"Milk Thistle","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":500,"contraindications":["Ragweed or daisy allergies","Hormone-sensitive conditions"]},{"mg":3,"name":"L-Ergothioneine","mg_per_kg_male":0.0125,"mg_per_kg_female":0.0125,"max_mg_per_day":30,"contraindications":[]}]',
  ingredients_zh = '[{"mg":9,"name":"谷胱甘肽","mg_per_kg_male":0.75,"mg_per_kg_female":0.75,"max_mg_per_day":1000,"contraindications":["哮喘 (吸入风险，尽管口服通常安全)"]},{"mg":6,"name":"N-乙酰-L-半胱胺酸","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":1200,"contraindications":["出血性疾病","硝酸甘油"]},{"mg":6,"name":"水飞蓟","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":500,"contraindications":["豚草或雏菊过敏","激素敏感性疾病"]},{"mg":3,"name":"麦角硫因","mg_per_kg_male":0.0125,"mg_per_kg_female":0.0125,"max_mg_per_day":30,"contraindications":[]}]'
WHERE key_name = 'DOT16';

-- DOT17 Gut & Microbiome
UPDATE dots SET
  name = 'Gut & Microbiome',
  name_zh = '肠道屏障与微生态',
  is_isolate = false,
  color = 'Pebble',
  color_zh = '鹅卵石灰',
  color_hex = '#C2C5BB',
  group_name = 'System Optimization',
  group_name_zh = '系统调优',
  sub_age_target = 'Resilience Age',
  sub_age_target_zh = '抗压年龄',
  timing = 'Evening',
  ingredients_summary = 'L-Glutamine / L-谷氨酰胺, Akkermansia / AKK益生菌, Digestive Enzymes / 复合蛋白酶',
  description = 'Gut Barrier & Microbiome',
  ingredients = '[{"mg":9,"name":"L-Glutamine","mg_per_kg_male":1.125,"mg_per_kg_female":1.125,"max_mg_per_day":5000,"contraindications":["Severe liver disease with encephalopathy","Bipolar disorder","Seizure disorders"]},{"mg":7.5,"name":"Akkermansia","mg_per_kg_male":0.9375,"mg_per_kg_female":0.9375,"max_mg_per_day":1000,"contraindications":["Severely immunocompromised individuals (theoretical)"]},{"mg":7.5,"name":"Digestive Enzymes","mg_per_kg_male":0.9375,"mg_per_kg_female":0.9375,"max_mg_per_day":1000,"contraindications":["Active peptic ulcers","Acute pancreatitis"]}]',
  ingredients_zh = '[{"mg":9,"name":"L-谷氨酰胺","mg_per_kg_male":1.125,"mg_per_kg_female":1.125,"max_mg_per_day":5000,"contraindications":["伴有脑病的严重肝病","双相情感障碍","癫痫发作"]},{"mg":7.5,"name":"AKK益生菌","mg_per_kg_male":0.9375,"mg_per_kg_female":0.9375,"max_mg_per_day":1000,"contraindications":["严重免疫功能低下者 (理论上)"]},{"mg":7.5,"name":"复合蛋白酶","mg_per_kg_male":0.9375,"mg_per_kg_female":0.9375,"max_mg_per_day":1000,"contraindications":["活动性消化性溃疡","急性胰腺炎"]}]'
WHERE key_name = 'DOT17';

-- DOT18 Immunity & Gastric
UPDATE dots SET
  name = 'Immunity & Gastric',
  name_zh = '免疫与胃部防御',
  is_isolate = false,
  color = 'Peach Clay',
  color_zh = '桃泥色',
  color_hex = '#E6BEA5',
  group_name = 'System Optimization',
  group_name_zh = '系统调优',
  sub_age_target = 'Resilience Age',
  sub_age_target_zh = '抗压年龄',
  timing = 'Morning',
  ingredients_summary = 'Liposomal Vit C / 脂质体维生素C, EGCG / EGCG, Zinc Glycinate / 甘氨酸锌, Zinc Carnosine / 肌肽锌',
  description = 'Immunity & Gastric Defense',
  ingredients = '[{"mg":9,"name":"Liposomal Vit C","mg_per_kg_male":0.375,"mg_per_kg_female":0.375,"max_mg_per_day":2000,"contraindications":["Hemochromatosis","History of kidney stones"]},{"mg":6,"name":"EGCG","mg_per_kg_male":0.25,"mg_per_kg_female":0.25,"max_mg_per_day":400,"contraindications":["Severe liver disease","Stimulant medications (if combined with caffeine)"]},{"mg":4.5,"name":"Zinc Glycinate","mg_per_kg_male":0.1875,"mg_per_kg_female":0.1875,"max_mg_per_day":30,"contraindications":["Penicillamine","Quinolone or Tetracycline antibiotics"]},{"mg":4.5,"name":"Zinc Carnosine","mg_per_kg_male":0.1875,"mg_per_kg_female":0.1875,"max_mg_per_day":50,"contraindications":["Penicillamine","Quinolone or Tetracycline antibiotics"]}]',
  ingredients_zh = '[{"mg":9,"name":"脂质体维生素C","mg_per_kg_male":0.375,"mg_per_kg_female":0.375,"max_mg_per_day":2000,"contraindications":["血色病","肾结石病史"]},{"mg":6,"name":"EGCG","mg_per_kg_male":0.25,"mg_per_kg_female":0.25,"max_mg_per_day":400,"contraindications":["严重肝病","兴奋剂药物 (如果与咖啡因结合)"]},{"mg":4.5,"name":"甘氨酸锌","mg_per_kg_male":0.1875,"mg_per_kg_female":0.1875,"max_mg_per_day":30,"contraindications":["青霉胺","喹诺酮类或四环素类抗生素"]},{"mg":4.5,"name":"肌肽锌","mg_per_kg_male":0.1875,"mg_per_kg_female":0.1875,"max_mg_per_day":50,"contraindications":["青霉胺","喹诺酮类或四环素类抗生素"]}]'
WHERE key_name = 'DOT18';

-- Verify
SELECT key_name, name, timing, color_hex, group_name, sub_age_target FROM dots ORDER BY id;
