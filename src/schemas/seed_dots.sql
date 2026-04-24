-- Seed all 18 Waven Dots from dots.md product spec
-- Uses ON CONFLICT to upsert safely

INSERT INTO dots (id, key_name, name, name_zh, is_isolate, color, color_zh, color_hex, group_name, group_name_zh, sub_age_target, sub_age_target_zh, timing, ingredients_summary, description, ingredients, ingredients_zh) VALUES

(1, 'DOT01', 'Cellular Fuel', '细胞原力', true, 'Deep Steel', '深钢蓝', '#4A5D7B', 'BioAge Reducing', '生物减龄', 'Cellular Age', '细胞年龄', 'Morning',
 'NMN / 烟酰胺单核苷酸',
 'The core NAD+ booster for cellular energy.',
 '[{"mg":24,"name":"NMN","mg_per_kg_male":7.5,"mg_per_kg_female":7.5,"max_mg_per_day":1000,"contraindications":["Active cancer or history of certain hormone-sensitive cancers"]}]',
 '[{"mg":24,"name":"烟酰胺单核苷酸","mg_per_kg_male":7.5,"mg_per_kg_female":7.5,"max_mg_per_day":1000,"contraindications":["活动性癌症或某些激素敏感性癌症史"]}]'),

(2, 'DOT02', 'Cellular Guard', '细胞守护', true, 'Muted Amethyst', '柔紫', '#6B5B95', 'BioAge Reducing', '生物减龄', 'Cellular Age', '细胞年龄', 'Evening',
 'Apigenin / 芹菜素',
 'Potent CD38 inhibitor to prevent NAD+ degradation and promote relaxation.',
 '[{"mg":24,"name":"Apigenin","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":100,"contraindications":["Sedatives","Muscle relaxants"]}]',
 '[{"mg":24,"name":"芹菜素","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":100,"contraindications":["镇静剂","肌肉松弛剂"]}]'),

(3, 'DOT03', 'Cellular Catalyst', '细胞催化', true, 'Stormy Blue', '风暴蓝', '#5B7B8C', 'BioAge Reducing', '生物减龄', 'Cellular Age', '细胞年龄', 'Morning',
 'Trans-Resveratrol / 反式白藜芦醇',
 'Sirtuin activator that works synergistically with NMN to promote cellular longevity.',
 '[{"mg":24,"name":"Trans-Resveratrol","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":500,"contraindications":["Bleeding disorders","Anticoagulant drugs","Hormone-sensitive conditions"]}]',
 '[{"mg":24,"name":"反式白藜芦醇","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":500,"contraindications":["出血性疾病","抗凝药物","激素敏感性疾病"]}]'),

(4, 'DOT04', 'Cellular Cleanup', '细胞净化', false, 'Dusty Purple', '灰紫', '#7B6B8C', 'BioAge Reducing', '生物减龄', 'Cellular Age', '细胞年龄', 'Evening',
 'Fisetin / 漆黄素, Pterostilbene / 紫檀芪, Taxifolin / 二氢槲皮素, Spermidine / 亚精胺',
 'Dual-action cellular cleanup: induces autophagy (Spermidine) and clears senescent zombie cells.',
 '[{"mg":8.4,"name":"Fisetin","mg_per_kg_male":0.45,"mg_per_kg_female":0.45,"max_mg_per_day":500,"contraindications":["Anticoagulants","Blood thinners"]},{"mg":6.9,"name":"Pterostilbene","mg_per_kg_male":0.35,"mg_per_kg_female":0.35,"max_mg_per_day":250,"contraindications":["Anticoagulants","Blood thinners"]},{"mg":6.6,"name":"Taxifolin","mg_per_kg_male":0.35,"mg_per_kg_female":0.35,"max_mg_per_day":200,"contraindications":[]},{"mg":2.1,"name":"Spermidine","mg_per_kg_male":0.05,"mg_per_kg_female":0.05,"max_mg_per_day":10,"contraindications":[]}]',
 '[{"mg":8.4,"name":"漆黄素","mg_per_kg_male":0.45,"mg_per_kg_female":0.45,"max_mg_per_day":500,"contraindications":["抗凝剂","血液稀释剂"]},{"mg":6.9,"name":"紫檀芪","mg_per_kg_male":0.35,"mg_per_kg_female":0.35,"max_mg_per_day":250,"contraindications":["抗凝剂","血液稀释剂"]},{"mg":6.6,"name":"二氢槲皮素","mg_per_kg_male":0.35,"mg_per_kg_female":0.35,"max_mg_per_day":200,"contraindications":[]},{"mg":2.1,"name":"亚精胺","mg_per_kg_male":0.05,"mg_per_kg_female":0.05,"max_mg_per_day":10,"contraindications":[]}]'),

(5, 'DOT05', 'Metabolic Resilience', '代谢韧性', false, 'Slate Gray', '板岩灰', '#4E5E66', 'BioAge Reducing', '生物减龄', 'Metabolic Age', '代谢年龄', 'Morning',
 'Urolithin A / 尿食素A, Ca-AKG / Alpha-酮戊二酸钙',
 'Mitochondrial & Muscle Aging',
 '[{"mg":12,"name":"Urolithin A","mg_per_kg_male":2,"mg_per_kg_female":2,"max_mg_per_day":1000,"contraindications":[]},{"mg":12,"name":"Ca-AKG","mg_per_kg_male":2,"mg_per_kg_female":2,"max_mg_per_day":2000,"contraindications":["Severe kidney disease"]}]',
 '[{"mg":12,"name":"尿食素A","mg_per_kg_male":2,"mg_per_kg_female":2,"max_mg_per_day":1000,"contraindications":[]},{"mg":12,"name":"Alpha-酮戊二酸钙","mg_per_kg_male":2,"mg_per_kg_female":2,"max_mg_per_day":2000,"contraindications":["严重肾病"]}]'),

(6, 'DOT06', 'Dermal Radiance (Collagen & Matrix)', '紧致焕颜', false, 'Mist Blue', '雾蓝', '#8A9AAB', 'BioAge Reducing', '生物减龄', 'Cellular Age', '细胞年龄', 'Evening',
 'Elastin / 高纯弹性胶原蛋白, Sturgeon Collagen / 鲟鱼胶原蛋白肽, Collagen Tripeptide / 胶原三肽, N-乙酰神经氨酸',
 'Structural Matrix & Cellular Rejuvenation',
 '[{"mg":6,"name":"Elastin","mg_per_kg_male":0.25,"mg_per_kg_female":0.3,"max_mg_per_day":500,"contraindications":[]},{"mg":6,"name":"Sturgeon Collagen","mg_per_kg_male":0.25,"mg_per_kg_female":0.3,"max_mg_per_day":2000,"contraindications":["Fish allergies"]},{"mg":6,"name":"Collagen Tripeptide","mg_per_kg_male":0.25,"mg_per_kg_female":0.3,"max_mg_per_day":2000,"contraindications":[]},{"mg":6,"name":"N-乙酰神经氨酸","mg_per_kg_male":0.25,"mg_per_kg_female":0.3,"max_mg_per_day":500,"contraindications":[]}]',
 '[{"mg":6,"name":"高纯弹性胶原蛋白","mg_per_kg_male":0.25,"mg_per_kg_female":0.3,"max_mg_per_day":500,"contraindications":[]},{"mg":6,"name":"鲟鱼胶原蛋白肽","mg_per_kg_male":0.25,"mg_per_kg_female":0.3,"max_mg_per_day":2000,"contraindications":["鱼类过敏"]},{"mg":6,"name":"胶原三肽","mg_per_kg_male":0.25,"mg_per_kg_female":0.3,"max_mg_per_day":2000,"contraindications":[]},{"mg":6,"name":"N-乙酰神经氨酸","mg_per_kg_male":0.25,"mg_per_kg_female":0.3,"max_mg_per_day":500,"contraindications":[]}]'),

(7, 'DOT07', 'Metabolic Power', '代谢动力', true, 'Muted Gold', '哑金', '#C9A66B', 'Energy & Performance Boost', '能量焕发', 'Metabolic Age', '代谢年龄', 'Morning',
 'PQQ / PQQ',
 'For mitochondrial biogenesis.',
 '[{"mg":24,"name":"PQQ","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":40,"contraindications":[]}]',
 '[{"mg":24,"name":"PQQ","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":40,"contraindications":[]}]'),

(8, 'DOT08', 'Vascular Awakening (Flow & Methylation)', '血管唤醒', false, 'Sage', '鼠尾草绿', '#8BA889', 'Energy & Performance Boost', '能量焕发', 'Micro-Vascular Age', '微血管年龄', 'Morning',
 'Beta-Alanine / β-丙氨酸, Niacin (Nicotinic Acid) / 烟酸, Methyl-B Complex / 甲基化复合B族',
 'Induces mild paresthesia (tingle) and niacin flush for physical feedback, while supporting methylation.',
 '[{"mg":15,"name":"Beta-Alanine","mg_per_kg_male":0.3,"mg_per_kg_female":0.24,"max_mg_per_day":3000,"contraindications":[]},{"mg":6,"name":"Niacin (Nicotinic Acid)","mg_per_kg_male":0.125,"mg_per_kg_female":0.1,"max_mg_per_day":100,"contraindications":["Active peptic ulcer disease","Severe gout","Liver disease","Statins (high doses)"]},{"mg":3,"name":"Methyl-B Complex","mg_per_kg_male":0.06,"mg_per_kg_female":0.06,"max_mg_per_day":100,"contraindications":[]}]',
 '[{"mg":15,"name":"β-丙氨酸","mg_per_kg_male":0.3,"mg_per_kg_female":0.24,"max_mg_per_day":3000,"contraindications":[]},{"mg":6,"name":"烟酸","mg_per_kg_male":0.125,"mg_per_kg_female":0.1,"max_mg_per_day":100,"contraindications":["活动性消化性溃疡","严重痛风","肝病","他汀类药物 (高剂量)"]},{"mg":3,"name":"甲基化复合B族","mg_per_kg_male":0.06,"mg_per_kg_female":0.06,"max_mg_per_day":100,"contraindications":[]}]'),

(9, 'DOT09', 'Resilience Support', '抗压支持', true, 'Seafoam', '海泡绿', '#7FA99B', 'Energy & Performance Boost', '能量焕发', 'Resilience Age', '抗压年龄', 'Morning',
 'Curcumin / 姜黄素',
 'The direct, real-time hs-CRP and acute inflammation suppressor.',
 '[{"mg":24,"name":"Curcumin","mg_per_kg_male":5,"mg_per_kg_female":5,"max_mg_per_day":1500,"contraindications":["Gallbladder disease","Bleeding disorders","Anticoagulant drugs","Iron deficiency"]}]',
 '[{"mg":24,"name":"姜黄素","mg_per_kg_male":5,"mg_per_kg_female":5,"max_mg_per_day":1500,"contraindications":["胆囊疾病","出血性疾病","抗凝药物","缺铁"]}]'),

(10, 'DOT10', 'Morning Ignition (Energy & Focus)', '晨间引擎', false, 'Olive Gold', '橄榄金', '#B8A44F', 'Energy & Performance Boost', '能量焕发', 'Cellular Age', '细胞年龄', 'Morning',
 'Dynamine (Methylliberine) / 甲基解放素, TeaCrine (Theacrine) / 苦茶碱',
 'Jitter-free, rapid-onset cognitive energy, motivation, and focus peaking in 15 minutes.',
 '[{"mg":12,"name":"Dynamine (Methylliberine)","mg_per_kg_male":0.25,"mg_per_kg_female":0.2,"max_mg_per_day":200,"contraindications":["Severe cardiovascular disease","Uncontrolled hypertension","MAOIs"]},{"mg":12,"name":"TeaCrine (Theacrine)","mg_per_kg_male":0.25,"mg_per_kg_female":0.2,"max_mg_per_day":200,"contraindications":["Severe cardiovascular disease","Uncontrolled hypertension"]}]',
 '[{"mg":12,"name":"甲基解放素 (Dynamine)","mg_per_kg_male":0.25,"mg_per_kg_female":0.2,"max_mg_per_day":200,"contraindications":["严重心血管疾病","未控制的高血压","单胺氧化酶抑制剂 (MAOIs)"]},{"mg":12,"name":"苦茶碱 (TeaCrine)","mg_per_kg_male":0.25,"mg_per_kg_female":0.2,"max_mg_per_day":200,"contraindications":["严重心血管疾病","未控制的高血压"]}]'),

(11, 'DOT11', 'Athletic Peak (Endurance & ATP)', '巅峰体能', false, 'Burnt Orange', '焦橙色', '#B55A30', 'Energy & Performance Boost', '能量焕发', 'Metabolic Age', '代谢年龄', 'Morning',
 'Cordyceps Militaris / 蛹虫草, Rhodiola Rosea / 红景天',
 'Increases VO2 max and ATP production for superior physical endurance and fatigue resistance.',
 '[{"mg":12,"name":"Cordyceps Militaris","mg_per_kg_male":1,"mg_per_kg_female":1,"max_mg_per_day":1000,"contraindications":["Autoimmune diseases","Blood thinners"]},{"mg":12,"name":"Rhodiola Rosea","mg_per_kg_male":1,"mg_per_kg_female":0.8,"max_mg_per_day":600,"contraindications":["Bipolar disorder","Stimulant medications"]}]',
 '[{"mg":12,"name":"蛹虫草","mg_per_kg_male":1,"mg_per_kg_female":1,"max_mg_per_day":1000,"contraindications":["自身免疫性疾病","血液稀释剂"]},{"mg":12,"name":"红景天","mg_per_kg_male":1,"mg_per_kg_female":0.8,"max_mg_per_day":600,"contraindications":["双相情感障碍","兴奋剂类药物"]}]'),

(12, 'DOT12', 'Deep Sleep & Recovery', '深度睡眠与恢复', false, 'Midnight Blue', '午夜蓝', '#2C3E50', 'Energy & Performance Boost', '能量焕发', 'Resilience Age', '抗压年龄', 'Evening',
 'Mag Threonate / 苏糖酸镁, Mag Glycinate / 甘氨酸镁, Ashwagandha / 南非醉茄内脂, Glycine / 甘氨酸',
 'Non-hormonal sleep architecture. Lowers core body temperature and evening cortisol for profound restorative sleep.',
 '[{"mg":6,"name":"Magnesium Threonate","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":400,"contraindications":["Severe renal impairment"]},{"mg":6,"name":"Magnesium Glycinate","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":400,"contraindications":["Severe renal impairment","Myasthenia gravis"]},{"mg":6,"name":"Ashwagandha Lactones","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":500,"contraindications":["Autoimmune diseases","Thyroid disorders"]},{"mg":6,"name":"Glycine","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":3000,"contraindications":["Clozapine interactions"]}]',
 '[{"mg":6,"name":"苏糖酸镁","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":400,"contraindications":["严重肾功能损害"]},{"mg":6,"name":"甘氨酸镁","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":400,"contraindications":["严重肾功能损害","重症肌无力"]},{"mg":6,"name":"南非醉茄内脂","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":500,"contraindications":["自身免疫性疾病","甲状腺疾病"]},{"mg":6,"name":"甘氨酸","mg_per_kg_male":0.3,"mg_per_kg_female":0.3,"max_mg_per_day":3000,"contraindications":["氯氮平相互作用"]}]'),

(13, 'DOT13', 'Vascular Flow', '微血管通流', false, 'Terracotta', '陶土红', '#D68C7A', 'System Optimization', '系统调优', 'Micro-Vascular Age', '微血管年龄', 'Morning',
 'CoQ10 / 辅酶Q10, Nattokinase / 纳豆激酶',
 'Potent cardiovascular clearing and mitochondrial energy support.',
 '[{"mg":15,"name":"CoQ10","mg_per_kg_male":0.625,"mg_per_kg_female":0.625,"max_mg_per_day":400,"contraindications":["Blood pressure medications (additive effect)","Chemotherapy drugs"]},{"mg":9,"name":"Nattokinase","mg_per_kg_male":0.375,"mg_per_kg_female":0.375,"max_mg_per_day":200,"contraindications":["Bleeding disorders","Anticoagulant drugs (Warfarin, Heparin)","Recent surgery"]}]',
 '[{"mg":15,"name":"辅酶Q10","mg_per_kg_male":0.625,"mg_per_kg_female":0.625,"max_mg_per_day":400,"contraindications":["降压药物 (叠加效应)","化疗药物"]},{"mg":9,"name":"纳豆激酶","mg_per_kg_male":0.375,"mg_per_kg_female":0.375,"max_mg_per_day":200,"contraindications":["出血性疾病","抗凝药物 (华法林、肝素)","近期手术"]}]'),

(14, 'DOT14', 'Vascular Protection', '微血管保护', false, 'Periwinkle', '长春花蓝', '#A8B5E0', 'System Optimization', '系统调优', 'Micro-Vascular Age', '微血管年龄', 'Morning',
 'Vitamin D3 / 维生素D3, Vitamin K2 (MK-7) / 维生素K2 (MK-7), MCT Powder Carrier / MCT微囊粉',
 'Essential D3+K2 paired with a lipid carrier for maximum absorption.',
 '[{"mg":0.03,"name":"Vitamin D3","mg_per_kg_male":0.001,"mg_per_kg_female":0.001,"max_mg_per_day":0.1,"contraindications":["Hypercalcemia","Hyperparathyroidism","Sarcoidosis"]},{"mg":0.03,"name":"Vitamin K2 (MK-7)","mg_per_kg_male":0.001,"mg_per_kg_female":0.001,"max_mg_per_day":0.2,"contraindications":["Warfarin or similar Coumadin-based anticoagulants"]},{"mg":23.94,"name":"MCT Powder Carrier","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":5000,"contraindications":["Medium-chain acyl-CoA dehydrogenase (MCAD) deficiency"]}]',
 '[{"mg":0.03,"name":"维生素D3","mg_per_kg_male":0.001,"mg_per_kg_female":0.001,"max_mg_per_day":0.1,"contraindications":["高钙血症","甲状旁腺功能亢进","结节病"]},{"mg":0.03,"name":"维生素K2 (MK-7)","mg_per_kg_male":0.001,"mg_per_kg_female":0.001,"max_mg_per_day":0.2,"contraindications":["华法林或类似香豆素的抗凝剂"]},{"mg":23.94,"name":"MCT微囊粉","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":5000,"contraindications":["中链酰基辅酶A脱氢酶 (MCAD) 缺乏症"]}]'),

(15, 'DOT15', 'Zen & Stress Resonance', '禅意与抗压共振', false, 'Muted Rose', '柔粉', '#D9AEB4', 'System Optimization', '系统调优', 'Resilience Age', '抗压年龄', 'Evening',
 'Kanna Extract (Zembrin) / 枯蒂提取物, Saffron Extract / 藏红花提取物, Magnesium Glycinate / 甘氨酸镁',
 'Rapid-acting mood elevation, deep physical calm, and mild euphoria via Kanna and Saffron.',
 '[{"mg":12,"name":"Kanna Extract (Zembrin)","mg_per_kg_male":0.25,"mg_per_kg_female":0.25,"max_mg_per_day":50,"contraindications":["MAOIs","SSRIs","SNRIs (Risk of Serotonin Syndrome)","Bipolar disorder"]},{"mg":6,"name":"Saffron Extract","mg_per_kg_male":0.125,"mg_per_kg_female":0.125,"max_mg_per_day":30,"contraindications":["Bipolar disorder","Bleeding disorders","Pregnancy (high doses)"]},{"mg":6,"name":"Magnesium Glycinate","mg_per_kg_male":0.125,"mg_per_kg_female":0.125,"max_mg_per_day":400,"contraindications":["Severe renal impairment","Myasthenia gravis"]}]',
 '[{"mg":12,"name":"枯蒂提取物 (Zembrin)","mg_per_kg_male":0.25,"mg_per_kg_female":0.25,"max_mg_per_day":50,"contraindications":["单胺氧化酶抑制剂 (MAOIs)","SSRIs","SNRIs (血清素综合征风险)","双相情感障碍"]},{"mg":6,"name":"藏红花提取物","mg_per_kg_male":0.125,"mg_per_kg_female":0.125,"max_mg_per_day":30,"contraindications":["双相情感障碍","出血性疾病","妊娠 (高剂量)"]},{"mg":6,"name":"甘氨酸镁","mg_per_kg_male":0.125,"mg_per_kg_female":0.125,"max_mg_per_day":400,"contraindications":["严重肾功能损害","重症肌无力"]}]'),

(16, 'DOT16', 'Resilience Defense', '抗压防御', false, 'Soft Sky', '柔空蓝', '#9BB7D4', 'System Optimization', '系统调优', 'Resilience Age', '抗压年龄', 'Evening',
 'Glutathione / 谷胱甘肽, NAC / N-乙酰-L-半胱胺酸, Milk Thistle / 水飞蓟, L-Ergothioneine / 麦角硫因',
 'Comprehensive defense against oxidative stress and support for liver detoxification.',
 '[{"mg":9,"name":"Glutathione","mg_per_kg_male":0.75,"mg_per_kg_female":0.75,"max_mg_per_day":1000,"contraindications":["Asthma (inhalation risk, though oral is generally safe)"]},{"mg":6,"name":"NAC","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":1200,"contraindications":["Bleeding disorders","Nitroglycerin"]},{"mg":6,"name":"Milk Thistle","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":500,"contraindications":["Ragweed or daisy allergies","Hormone-sensitive conditions"]},{"mg":3,"name":"L-Ergothioneine","mg_per_kg_male":0.0125,"mg_per_kg_female":0.0125,"max_mg_per_day":30,"contraindications":[]}]',
 '[{"mg":9,"name":"谷胱甘肽","mg_per_kg_male":0.75,"mg_per_kg_female":0.75,"max_mg_per_day":1000,"contraindications":["哮喘 (吸入风险，尽管口服通常安全)"]},{"mg":6,"name":"N-乙酰-L-半胱胺酸","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":1200,"contraindications":["出血性疾病","硝酸甘油"]},{"mg":6,"name":"水飞蓟","mg_per_kg_male":0.5,"mg_per_kg_female":0.5,"max_mg_per_day":500,"contraindications":["豚草或雏菊过敏","激素敏感性疾病"]},{"mg":3,"name":"麦角硫因","mg_per_kg_male":0.0125,"mg_per_kg_female":0.0125,"max_mg_per_day":30,"contraindications":[]}]'),

(17, 'DOT17', 'Gut & Microbiome', '肠道屏障与微生态', false, 'Pebble', '鹅卵石灰', '#C2C5BB', 'System Optimization', '系统调优', 'Resilience Age', '抗压年龄', 'Evening',
 'L-Glutamine / L-谷氨酰胺, Akkermansia / AKK益生菌, Digestive Enzymes / 复合蛋白酶',
 'Gut Barrier & Microbiome',
 '[{"mg":9,"name":"L-Glutamine","mg_per_kg_male":1.125,"mg_per_kg_female":1.125,"max_mg_per_day":5000,"contraindications":["Severe liver disease with encephalopathy","Bipolar disorder","Seizure disorders"]},{"mg":7.5,"name":"Akkermansia","mg_per_kg_male":0.9375,"mg_per_kg_female":0.9375,"max_mg_per_day":1000,"contraindications":["Severely immunocompromised individuals (theoretical)"]},{"mg":7.5,"name":"Digestive Enzymes","mg_per_kg_male":0.9375,"mg_per_kg_female":0.9375,"max_mg_per_day":1000,"contraindications":["Active peptic ulcers","Acute pancreatitis"]}]',
 '[{"mg":9,"name":"L-谷氨酰胺","mg_per_kg_male":1.125,"mg_per_kg_female":1.125,"max_mg_per_day":5000,"contraindications":["伴有脑病的严重肝病","双相情感障碍","癫痫发作"]},{"mg":7.5,"name":"AKK益生菌","mg_per_kg_male":0.9375,"mg_per_kg_female":0.9375,"max_mg_per_day":1000,"contraindications":["严重免疫功能低下者 (理论上)"]},{"mg":7.5,"name":"复合蛋白酶","mg_per_kg_male":0.9375,"mg_per_kg_female":0.9375,"max_mg_per_day":1000,"contraindications":["活动性消化性溃疡","急性胰腺炎"]}]'),

(18, 'DOT18', 'Immunity & Gastric', '免疫与胃部防御', false, 'Peach Clay', '桃泥色', '#E6BEA5', 'System Optimization', '系统调优', 'Resilience Age', '抗压年龄', 'Morning',
 'Liposomal Vit C / 脂质体维生素C, EGCG / EGCG, Zinc Glycinate / 甘氨酸锌, Zinc Carnosine / 肌肽锌',
 'Immunity & Gastric Defense',
 '[{"mg":9,"name":"Liposomal Vit C","mg_per_kg_male":0.375,"mg_per_kg_female":0.375,"max_mg_per_day":2000,"contraindications":["Hemochromatosis","History of kidney stones"]},{"mg":6,"name":"EGCG","mg_per_kg_male":0.25,"mg_per_kg_female":0.25,"max_mg_per_day":400,"contraindications":["Severe liver disease","Stimulant medications (if combined with caffeine)"]},{"mg":4.5,"name":"Zinc Glycinate","mg_per_kg_male":0.1875,"mg_per_kg_female":0.1875,"max_mg_per_day":30,"contraindications":["Penicillamine","Quinolone or Tetracycline antibiotics"]},{"mg":4.5,"name":"Zinc Carnosine","mg_per_kg_male":0.1875,"mg_per_kg_female":0.1875,"max_mg_per_day":50,"contraindications":["Penicillamine","Quinolone or Tetracycline antibiotics"]}]',
 '[{"mg":9,"name":"脂质体维生素C","mg_per_kg_male":0.375,"mg_per_kg_female":0.375,"max_mg_per_day":2000,"contraindications":["血色病","肾结石病史"]},{"mg":6,"name":"EGCG","mg_per_kg_male":0.25,"mg_per_kg_female":0.25,"max_mg_per_day":400,"contraindications":["严重肝病","兴奋剂药物 (如果与咖啡因结合)"]},{"mg":4.5,"name":"甘氨酸锌","mg_per_kg_male":0.1875,"mg_per_kg_female":0.1875,"max_mg_per_day":30,"contraindications":["青霉胺","喹诺酮类或四环素类抗生素"]},{"mg":4.5,"name":"肌肽锌","mg_per_kg_male":0.1875,"mg_per_kg_female":0.1875,"max_mg_per_day":50,"contraindications":["青霉胺","喹诺酮类或四环素类抗生素"]}]')

ON CONFLICT (key_name) DO UPDATE SET
  name               = EXCLUDED.name,
  name_zh            = EXCLUDED.name_zh,
  is_isolate         = EXCLUDED.is_isolate,
  color              = EXCLUDED.color,
  color_zh           = EXCLUDED.color_zh,
  color_hex          = EXCLUDED.color_hex,
  group_name         = EXCLUDED.group_name,
  group_name_zh      = EXCLUDED.group_name_zh,
  sub_age_target     = EXCLUDED.sub_age_target,
  sub_age_target_zh  = EXCLUDED.sub_age_target_zh,
  timing             = EXCLUDED.timing,
  ingredients_summary = EXCLUDED.ingredients_summary,
  description        = EXCLUDED.description,
  ingredients        = EXCLUDED.ingredients,
  ingredients_zh     = EXCLUDED.ingredients_zh;

-- Verify
SELECT id, key_name, name_zh, timing, color_hex, group_name, sub_age_target FROM dots ORDER BY id;
