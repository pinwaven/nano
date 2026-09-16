-- Tag vocabulary for document extraction, contract version 3 (CLAUDE.md §39).
--
-- The third catalog handed to the extraction agent, beside biomarker_catalog (numbers) and
-- food_catalog (IgG foods). A tag is a FACT ABOUT THE PERSON a document states — an allergy, a
-- diagnosis, a medication, a diet, a lifestyle, a keyed test result, a family history, a
-- procedure — with a stable key, so that a consumer can act on it without matching prose.
--
-- WHY A KEY. Contract 2's `findings` carried a category, free text and a confidence, and nothing
-- that let a consumer act on one safely: no key to match, no tense, no anchor. Two live runs on
-- dev (2026-09-15) wrote six false `allergy` facts off a genomics report's explanatory text, and
-- every one reached _filterProductsByUserFacts and dot formulation. With a key the rule becomes
-- the one dots and foods already follow (§11, §40): a tag that resolves to nothing in this
-- table is a DESCRIPTOR — stored, displayed, never acted on — and never guessed onto a
-- neighbour. Only a fact with a key here reaches user_memory_facts.
--
-- memory_category is nano's own column, never sent to the agent: which user_memory_facts
-- category a CURRENT fact of this key is mirrored into (lib/documentTags.js). NULL means the
-- fact is stored on the document and shown, but reaches no prompt and no filter. family_history
-- is NULL for every row BY DESIGN — 「父亲高血压」 must never satisfy a consumer looking for the
-- subject's own conditions. result / lifestyle / procedure are NULL too: no consumer reads them
-- yet, and rendering them uncapped into ~14 prompts (§27) is a cost to pay when one does.
--
-- `values` names the admitted values of a keyed RESULT (result:HPV52 → positive | negative);
-- NULL means the tag is a bare fact.
--
-- Seeded from what nano's own bundles and formulation already branch on (the 禁忌· and 在用·
-- vocabulary), plus the common 体检 / 病历 vocabulary. Curia supplies aliases from its corpus
-- as it meets them; adding a row or an alias is a migration, and lib/repromotion.js re-runs
-- promotion over what is already stored so nothing has to be re-read.

CREATE TABLE IF NOT EXISTS tag_catalog (
    tag_key         TEXT PRIMARY KEY,           -- '<category>:<slug>', e.g. 'allergy:shellfish'
    category        TEXT NOT NULL CHECK (category IN (
                        'allergy', 'condition', 'medication', 'diet', 'lifestyle',
                        'result', 'family_history', 'procedure')),
    name_zh         TEXT NOT NULL,
    name_en         TEXT,
    aliases         TEXT[] NOT NULL DEFAULT '{}',
    values          TEXT[],                     -- admitted values for a result tag; NULL = bare fact
    memory_category TEXT CHECK (memory_category IN (
                        'dietary_restriction', 'allergy', 'condition', 'medication')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tag_catalog_category ON tag_catalog (category, sort_order);

INSERT INTO tag_catalog (tag_key, category, name_zh, name_en, aliases, values, memory_category, sort_order) VALUES
    -- allergy (IgE-type / drug / environmental; IgG food sensitivities go through food_catalog)
    ('allergy:shellfish',       'allergy', '海鲜过敏',     'Shellfish allergy',      '{鱼虾贝类过敏,海鲜类过敏,虾蟹过敏,虾过敏,蟹过敏,贝类过敏,seafood allergy}', NULL, 'allergy', 10),
    ('allergy:fish',            'allergy', '鱼类过敏',     'Fish allergy',           '{鱼过敏}', NULL, 'allergy', 11),
    ('allergy:peanut',          'allergy', '花生过敏',     'Peanut allergy',         '{}', NULL, 'allergy', 12),
    ('allergy:tree_nut',        'allergy', '坚果过敏',     'Tree nut allergy',       '{核桃过敏,腰果过敏,杏仁过敏,nut allergy}', NULL, 'allergy', 13),
    ('allergy:milk',            'allergy', '牛奶过敏',     'Milk allergy',           '{奶制品过敏,乳制品过敏,牛奶蛋白过敏}', NULL, 'allergy', 14),
    ('allergy:egg',             'allergy', '鸡蛋过敏',     'Egg allergy',            '{蛋类过敏,鸡蛋白过敏}', NULL, 'allergy', 15),
    ('allergy:wheat',           'allergy', '小麦过敏',     'Wheat allergy',          '{面粉过敏}', NULL, 'allergy', 16),
    ('allergy:soy',             'allergy', '大豆过敏',     'Soy allergy',            '{豆类过敏,黄豆过敏}', NULL, 'allergy', 17),
    ('allergy:sesame',          'allergy', '芝麻过敏',     'Sesame allergy',         '{}', NULL, 'allergy', 18),
    ('allergy:mango',           'allergy', '芒果过敏',     'Mango allergy',          '{}', NULL, 'allergy', 19),
    ('allergy:penicillin',      'allergy', '青霉素过敏',   'Penicillin allergy',     '{青霉素类过敏,PG过敏,阿莫西林过敏}', NULL, 'allergy', 20),
    ('allergy:cephalosporin',   'allergy', '头孢过敏',     'Cephalosporin allergy',  '{头孢类过敏,头孢菌素过敏}', NULL, 'allergy', 21),
    ('allergy:sulfonamide',     'allergy', '磺胺过敏',     'Sulfonamide allergy',    '{磺胺类过敏}', NULL, 'allergy', 22),
    ('allergy:nsaid',           'allergy', '解热镇痛药过敏', 'NSAID allergy',         '{阿司匹林过敏,布洛芬过敏,非甾体抗炎药过敏}', NULL, 'allergy', 23),
    ('allergy:iodine_contrast', 'allergy', '碘造影剂过敏', 'Iodinated contrast allergy', '{造影剂过敏,碘过敏}', NULL, 'allergy', 24),
    ('allergy:local_anesthetic','allergy', '局麻药过敏',   'Local anesthetic allergy', '{利多卡因过敏,普鲁卡因过敏}', NULL, 'allergy', 25),
    ('allergy:pollen',          'allergy', '花粉过敏',     'Pollen allergy',         '{}', NULL, 'allergy', 30),
    ('allergy:dust_mite',       'allergy', '尘螨过敏',     'Dust mite allergy',      '{螨虫过敏,粉尘螨过敏,屋尘螨过敏}', NULL, 'allergy', 31),
    ('allergy:pet_dander',      'allergy', '动物皮屑过敏', 'Pet dander allergy',     '{猫毛过敏,狗毛过敏,宠物过敏}', NULL, 'allergy', 32),
    ('allergy:mold',            'allergy', '霉菌过敏',     'Mold allergy',           '{}', NULL, 'allergy', 33),
    ('allergy:latex',           'allergy', '乳胶过敏',     'Latex allergy',          '{}', NULL, 'allergy', 34),
    ('allergy:alcohol',         'allergy', '酒精过敏',     'Alcohol intolerance',    '{酒精不耐受}', NULL, 'allergy', 35),

    -- condition (the subject's own diagnoses)
    ('condition:hypertension',      'condition', '高血压',       'Hypertension',            '{原发性高血压,高血压病,血压高}', NULL, 'condition', 100),
    ('condition:diabetes_t2',       'condition', '2型糖尿病',    'Type 2 diabetes',         '{糖尿病,II型糖尿病,2型糖尿病病史,T2DM}', NULL, 'condition', 101),
    ('condition:diabetes_t1',       'condition', '1型糖尿病',    'Type 1 diabetes',         '{I型糖尿病,T1DM}', NULL, 'condition', 102),
    ('condition:prediabetes',       'condition', '糖尿病前期',   'Prediabetes',             '{糖耐量异常,糖耐量受损,空腹血糖受损,IGT,IFG}', NULL, 'condition', 103),
    ('condition:hyperlipidemia',    'condition', '高脂血症',     'Hyperlipidemia',          '{血脂异常,高血脂,高胆固醇血症,高甘油三酯血症}', NULL, 'condition', 104),
    ('condition:fatty_liver',       'condition', '脂肪肝',       'Fatty liver',             '{非酒精性脂肪肝,NAFLD,轻度脂肪肝,中度脂肪肝,重度脂肪肝}', NULL, 'condition', 105),
    ('condition:hyperuricemia',     'condition', '高尿酸血症',   'Hyperuricemia',           '{尿酸高,尿酸偏高}', NULL, 'condition', 106),
    ('condition:gout',              'condition', '痛风',         'Gout',                    '{痛风性关节炎}', NULL, 'condition', 107),
    ('condition:hypothyroidism',    'condition', '甲状腺功能减退', 'Hypothyroidism',        '{甲减,甲状腺功能减退症,亚临床甲减}', NULL, 'condition', 110),
    ('condition:hyperthyroidism',   'condition', '甲状腺功能亢进', 'Hyperthyroidism',       '{甲亢,甲状腺功能亢进症,Graves病}', NULL, 'condition', 111),
    ('condition:hashimoto',         'condition', '桥本甲状腺炎', 'Hashimoto thyroiditis',   '{桥本氏甲状腺炎,慢性淋巴细胞性甲状腺炎}', NULL, 'condition', 112),
    ('condition:thyroid_nodule',    'condition', '甲状腺结节',   'Thyroid nodule',          '{}', NULL, 'condition', 113),
    ('condition:pcos',              'condition', '多囊卵巢综合征', 'PCOS',                  '{多囊卵巢,PCOS}', NULL, 'condition', 114),
    ('condition:anemia',            'condition', '贫血',         'Anemia',                  '{缺铁性贫血,轻度贫血}', NULL, 'condition', 115),
    ('condition:osteoporosis',      'condition', '骨质疏松',     'Osteoporosis',            '{骨质疏松症,骨量减少}', NULL, 'condition', 116),
    ('condition:gerd',              'condition', '胃食管反流',   'GERD',                    '{反流性食管炎,胃食管反流病}', NULL, 'condition', 120),
    ('condition:gastritis',         'condition', '胃炎',         'Gastritis',               '{慢性胃炎,慢性浅表性胃炎,萎缩性胃炎}', NULL, 'condition', 121),
    ('condition:gastric_ulcer',     'condition', '消化性溃疡',   'Peptic ulcer',            '{胃溃疡,十二指肠溃疡}', NULL, 'condition', 122),
    ('condition:hp_infection',      'condition', '幽门螺杆菌感染', 'H. pylori infection',   '{幽门螺旋杆菌感染,HP感染,Hp阳性}', NULL, 'condition', 123),
    ('condition:ibs',               'condition', '肠易激综合征', 'IBS',                     '{}', NULL, 'condition', 124),
    ('condition:gallstone',         'condition', '胆结石',       'Gallstones',              '{胆囊结石,胆囊息肉}', NULL, 'condition', 125),
    ('condition:kidney_stone',      'condition', '肾结石',       'Kidney stones',           '{泌尿系结石,输尿管结石}', NULL, 'condition', 126),
    ('condition:ckd',               'condition', '慢性肾病',     'Chronic kidney disease',  '{慢性肾脏病,肾功能不全,CKD}', NULL, 'condition', 127),
    ('condition:chd',               'condition', '冠心病',       'Coronary heart disease',  '{冠状动脉粥样硬化性心脏病,心肌缺血}', NULL, 'condition', 130),
    ('condition:afib',              'condition', '房颤',         'Atrial fibrillation',     '{心房颤动}', NULL, 'condition', 131),
    ('condition:stroke',            'condition', '脑卒中',       'Stroke',                  '{中风,脑梗,脑梗死,脑出血}', NULL, 'condition', 132),
    ('condition:carotid_plaque',    'condition', '颈动脉斑块',   'Carotid plaque',          '{颈动脉粥样硬化}', NULL, 'condition', 133),
    ('condition:asthma',            'condition', '哮喘',         'Asthma',                  '{支气管哮喘}', NULL, 'condition', 140),
    ('condition:allergic_rhinitis', 'condition', '过敏性鼻炎',   'Allergic rhinitis',       '{变应性鼻炎}', NULL, 'condition', 141),
    ('condition:eczema',            'condition', '湿疹',         'Eczema',                  '{特应性皮炎}', NULL, 'condition', 142),
    ('condition:psoriasis',         'condition', '银屑病',       'Psoriasis',               '{牛皮癣}', NULL, 'condition', 143),
    ('condition:breast_nodule',     'condition', '乳腺结节',     'Breast nodule',           '{乳腺增生}', NULL, 'condition', 150),
    ('condition:uterine_fibroid',   'condition', '子宫肌瘤',     'Uterine fibroid',         '{}', NULL, 'condition', 151),
    ('condition:endometriosis',     'condition', '子宫内膜异位症', 'Endometriosis',         '{}', NULL, 'condition', 152),
    ('condition:bph',               'condition', '前列腺增生',   'BPH',                     '{良性前列腺增生}', NULL, 'condition', 153),
    ('condition:hbv',               'condition', '乙肝',         'Hepatitis B',             '{乙型肝炎,乙肝病毒携带者,慢性乙肝}', NULL, 'condition', 160),
    ('condition:depression',        'condition', '抑郁症',       'Depression',              '{抑郁状态}', NULL, 'condition', 170),
    ('condition:anxiety',           'condition', '焦虑症',       'Anxiety disorder',        '{焦虑状态}', NULL, 'condition', 171),
    ('condition:insomnia',          'condition', '失眠',         'Insomnia',                '{睡眠障碍}', NULL, 'condition', 172),
    ('condition:migraine',          'condition', '偏头痛',       'Migraine',                '{}', NULL, 'condition', 173),
    ('condition:osteoarthritis',    'condition', '骨关节炎',     'Osteoarthritis',          '{膝关节炎,退行性关节炎}', NULL, 'condition', 174),
    ('condition:lumbar_disc',       'condition', '腰椎间盘突出', 'Lumbar disc herniation',  '{腰椎间盘突出症,颈椎病}', NULL, 'condition', 175),
    ('condition:obesity',           'condition', '肥胖',         'Obesity',                 '{肥胖症,超重}', NULL, 'condition', 176),

    -- medication (drugs and supplements in use; the 在用· vocabulary)
    ('medication:metformin',        'medication', '二甲双胍',     'Metformin',               '{格华止}', NULL, 'medication', 200),
    ('medication:insulin',          'medication', '胰岛素',       'Insulin',                 '{}', NULL, 'medication', 201),
    ('medication:sglt2',            'medication', 'SGLT2抑制剂',  'SGLT2 inhibitor',         '{达格列净,恩格列净,卡格列净}', NULL, 'medication', 202),
    ('medication:glp1',             'medication', 'GLP-1受体激动剂', 'GLP-1 agonist',        '{司美格鲁肽,利拉鲁肽,度拉糖肽}', NULL, 'medication', 203),
    ('medication:statin',           'medication', '他汀类',       'Statin',                  '{阿托伐他汀,瑞舒伐他汀,辛伐他汀,匹伐他汀,立普妥,可定}', NULL, 'medication', 210),
    ('medication:ezetimibe',        'medication', '依折麦布',     'Ezetimibe',               '{}', NULL, 'medication', 211),
    ('medication:aspirin',          'medication', '阿司匹林',     'Aspirin',                 '{拜阿司匹林,阿司匹林肠溶片}', NULL, 'medication', 212),
    ('medication:clopidogrel',      'medication', '氯吡格雷',     'Clopidogrel',             '{波立维}', NULL, 'medication', 213),
    ('medication:anticoagulant',    'medication', '抗凝药',       'Anticoagulant',           '{华法林,利伐沙班,达比加群}', NULL, 'medication', 214),
    ('medication:arb_acei',         'medication', '沙坦/普利类降压药', 'ARB / ACE inhibitor', '{缬沙坦,氯沙坦,厄贝沙坦,替米沙坦,依那普利,贝那普利}', NULL, 'medication', 220),
    ('medication:ccb',              'medication', '地平类降压药', 'Calcium channel blocker', '{氨氯地平,硝苯地平,络活喜}', NULL, 'medication', 221),
    ('medication:beta_blocker',     'medication', '洛尔类',       'Beta blocker',            '{美托洛尔,比索洛尔,倍他乐克}', NULL, 'medication', 222),
    ('medication:diuretic',         'medication', '利尿剂',       'Diuretic',                '{氢氯噻嗪,呋塞米,螺内酯}', NULL, 'medication', 223),
    ('medication:levothyroxine',    'medication', '左甲状腺素',   'Levothyroxine',           '{优甲乐,雷替斯}', NULL, 'medication', 230),
    ('medication:methimazole',      'medication', '甲巯咪唑',     'Methimazole',             '{赛治}', NULL, 'medication', 231),
    ('medication:allopurinol',      'medication', '别嘌醇',       'Allopurinol',             '{}', NULL, 'medication', 240),
    ('medication:febuxostat',       'medication', '非布司他',     'Febuxostat',              '{}', NULL, 'medication', 241),
    ('medication:ppi',              'medication', '质子泵抑制剂', 'Proton pump inhibitor',   '{奥美拉唑,雷贝拉唑,泮托拉唑,埃索美拉唑,兰索拉唑}', NULL, 'medication', 250),
    ('medication:corticosteroid',   'medication', '糖皮质激素',   'Corticosteroid',          '{泼尼松,强的松,甲泼尼龙,地塞米松}', NULL, 'medication', 260),
    ('medication:hrt',              'medication', '激素替代治疗', 'Hormone replacement therapy', '{雌激素治疗,HRT}', NULL, 'medication', 261),
    ('medication:oral_contraceptive','medication', '口服避孕药',  'Oral contraceptive',      '{短效避孕药,优思明,达英-35}', NULL, 'medication', 262),
    ('medication:antidepressant',   'medication', '抗抑郁药',     'Antidepressant',          '{舍曲林,氟西汀,帕罗西汀,艾司西酞普兰}', NULL, 'medication', 270),
    ('medication:sedative',         'medication', '安眠药',       'Sedative / hypnotic',     '{佐匹克隆,右佐匹克隆,艾司唑仑,阿普唑仑}', NULL, 'medication', 271),
    ('medication:immunosuppressant','medication', '免疫抑制剂',   'Immunosuppressant',       '{甲氨蝶呤,环孢素,他克莫司}', NULL, 'medication', 272),
    ('medication:tcm',              'medication', '中药',         'Traditional Chinese medicine', '{中成药,汤药}', NULL, 'medication', 280),
    ('medication:supp_vitamin_d',   'medication', '维生素D补充剂', 'Vitamin D supplement',   '{维生素D3,VD3}', NULL, 'medication', 290),
    ('medication:supp_omega3',      'medication', '鱼油',         'Omega-3 / fish oil',      '{omega-3,深海鱼油,DHA}', NULL, 'medication', 291),
    ('medication:supp_coq10',       'medication', '辅酶Q10',      'Coenzyme Q10',            '{CoQ10}', NULL, 'medication', 292),
    ('medication:supp_nmn',         'medication', 'NMN',          'NMN',                     '{烟酰胺单核苷酸,NR}', NULL, 'medication', 293),
    ('medication:supp_iron',        'medication', '铁剂',         'Iron supplement',         '{补铁}', NULL, 'medication', 294),
    ('medication:supp_calcium',     'medication', '钙剂',         'Calcium supplement',      '{钙片,碳酸钙}', NULL, 'medication', 295),
    ('medication:supp_probiotic',   'medication', '益生菌',       'Probiotic',               '{}', NULL, 'medication', 296),
    ('medication:supp_multivitamin','medication', '复合维生素',   'Multivitamin',            '{善存,复合维生素片}', NULL, 'medication', 297),
    ('medication:supp_melatonin',   'medication', '褪黑素',       'Melatonin',               '{}', NULL, 'medication', 298),

    -- diet (the 禁忌· / 素食 vocabulary)
    ('diet:vegetarian',             'diet', '素食',         'Vegetarian',              '{吃素,素食者}', NULL, 'dietary_restriction', 300),
    ('diet:vegan',                  'diet', '纯素',         'Vegan',                   '{全素,纯素食}', NULL, 'dietary_restriction', 301),
    ('diet:no_pork',                'diet', '不吃猪肉',     'No pork',                 '{忌猪肉}', NULL, 'dietary_restriction', 302),
    ('diet:no_beef',                'diet', '不吃牛肉',     'No beef',                 '{忌牛肉}', NULL, 'dietary_restriction', 303),
    ('diet:no_seafood',             'diet', '不吃海鲜',     'No seafood',              '{忌海鲜}', NULL, 'dietary_restriction', 304),
    ('diet:halal',                  'diet', '清真饮食',     'Halal',                   '{清真}', NULL, 'dietary_restriction', 305),
    ('diet:gluten_free',            'diet', '无麸质饮食',   'Gluten-free',             '{无麸质}', NULL, 'dietary_restriction', 306),
    ('diet:lactose_free',           'diet', '无乳糖饮食',   'Lactose-free',            '{乳糖不耐受,不喝牛奶}', NULL, 'dietary_restriction', 307),
    ('diet:low_carb',               'diet', '低碳水饮食',   'Low-carb',                '{低碳饮食}', NULL, 'dietary_restriction', 310),
    ('diet:keto',                   'diet', '生酮饮食',     'Ketogenic diet',          '{}', NULL, 'dietary_restriction', 311),
    ('diet:low_salt',               'diet', '低盐饮食',     'Low-sodium',              '{低钠饮食,限盐}', NULL, 'dietary_restriction', 312),
    ('diet:low_purine',             'diet', '低嘌呤饮食',   'Low-purine',              '{}', NULL, 'dietary_restriction', 313),
    ('diet:low_fat',                'diet', '低脂饮食',     'Low-fat',                 '{}', NULL, 'dietary_restriction', 314),
    ('diet:intermittent_fasting',   'diet', '间歇性断食',   'Intermittent fasting',    '{轻断食,168断食}', NULL, 'dietary_restriction', 315),
    ('diet:no_alcohol',             'diet', '戒酒',         'No alcohol',              '{不饮酒,禁酒}', NULL, 'dietary_restriction', 316),
    ('diet:no_caffeine',            'diet', '不摄入咖啡因', 'No caffeine',             '{戒咖啡}', NULL, 'dietary_restriction', 317),

    -- lifestyle (not mirrored — no consumer yet)
    ('lifestyle:smoker',            'lifestyle', '吸烟',       'Smoker',                '{现吸烟,吸烟史,抽烟}', NULL, NULL, 400),
    ('lifestyle:ex_smoker',         'lifestyle', '已戒烟',     'Former smoker',         '{戒烟}', NULL, NULL, 401),
    ('lifestyle:alcohol_regular',   'lifestyle', '经常饮酒',   'Regular alcohol use',   '{饮酒,常饮酒,饮酒史}', NULL, NULL, 402),
    ('lifestyle:night_shift',       'lifestyle', '夜班',       'Night shift work',      '{长期夜班,倒班,熬夜}', NULL, NULL, 403),
    ('lifestyle:sedentary',         'lifestyle', '久坐',       'Sedentary',             '{缺乏运动,久坐少动}', NULL, NULL, 404),
    ('lifestyle:regular_exercise',  'lifestyle', '规律运动',   'Regular exercise',      '{经常运动}', NULL, NULL, 405),
    ('lifestyle:poor_sleep',        'lifestyle', '睡眠不足',   'Poor sleep',            '{睡眠差,睡眠不佳}', NULL, NULL, 406),
    ('lifestyle:high_stress',       'lifestyle', '压力大',     'High stress',           '{精神压力大,工作压力大}', NULL, NULL, 407),
    ('lifestyle:pregnant',          'lifestyle', '妊娠期',     'Pregnant',              '{怀孕,孕期}', NULL, NULL, 410),
    ('lifestyle:breastfeeding',     'lifestyle', '哺乳期',     'Breastfeeding',         '{}', NULL, NULL, 411),
    ('lifestyle:menopause',         'lifestyle', '绝经',       'Post-menopausal',       '{已绝经,围绝经期,更年期}', NULL, NULL, 412),

    -- result (keyed qualitative test results)
    ('result:hpv_high_risk',        'result', 'HPV高危型',    'High-risk HPV',          '{高危型HPV,HR-HPV}', '{positive,negative}', NULL, 500),
    ('result:hpv16',                'result', 'HPV16',        'HPV 16',                 '{HPV-16}', '{positive,negative}', NULL, 501),
    ('result:hpv18',                'result', 'HPV18',        'HPV 18',                 '{HPV-18}', '{positive,negative}', NULL, 502),
    ('result:hpv31',                'result', 'HPV31',        'HPV 31',                 '{HPV-31}', '{positive,negative}', NULL, 503),
    ('result:hpv33',                'result', 'HPV33',        'HPV 33',                 '{HPV-33}', '{positive,negative}', NULL, 504),
    ('result:hpv45',                'result', 'HPV45',        'HPV 45',                 '{HPV-45}', '{positive,negative}', NULL, 505),
    ('result:hpv52',                'result', 'HPV52',        'HPV 52',                 '{HPV-52}', '{positive,negative}', NULL, 506),
    ('result:hpv58',                'result', 'HPV58',        'HPV 58',                 '{HPV-58}', '{positive,negative}', NULL, 507),
    ('result:tct',                  'result', 'TCT',          'Cervical cytology (TCT)', '{宫颈液基细胞学,液基薄层细胞学}', '{normal,abnormal}', NULL, 510),
    ('result:hp_breath_test',       'result', '幽门螺杆菌呼气试验', 'H. pylori breath test', '{碳13呼气试验,碳14呼气试验,C13呼气,C14呼气,幽门螺杆菌检测}', '{positive,negative}', NULL, 520),
    ('result:hbsag',                'result', '乙肝表面抗原', 'HBsAg',                  '{HBsAg}', '{positive,negative}', NULL, 530),
    ('result:hbsab',                'result', '乙肝表面抗体', 'HBsAb',                  '{HBsAb,乙肝表面抗体}', '{positive,negative}', NULL, 531),
    ('result:anti_hcv',             'result', '丙肝抗体',     'Anti-HCV',               '{HCV抗体,anti-HCV}', '{positive,negative}', NULL, 532),
    ('result:fobt',                 'result', '大便隐血',     'Fecal occult blood',     '{粪便隐血,便潜血,FOBT}', '{positive,negative}', NULL, 540),
    ('result:urine_protein',        'result', '尿蛋白',       'Urine protein',          '{尿蛋白定性}', '{positive,negative}', NULL, 541),
    ('result:urine_glucose',        'result', '尿糖',         'Urine glucose',          '{尿葡萄糖}', '{positive,negative}', NULL, 542),
    ('result:ana',                  'result', '抗核抗体',     'ANA',                    '{ANA}', '{positive,negative}', NULL, 550),
    ('result:ecg',                  'result', '心电图',       'ECG',                    '{ECG,静息心电图}', '{normal,abnormal}', NULL, 560),

    -- family_history (about relatives — NEVER mirrored, never a condition)
    ('family_history:hypertension', 'family_history', '高血压家族史', 'Family history: hypertension', '{父亲高血压,母亲高血压,家族高血压}', NULL, NULL, 600),
    ('family_history:diabetes',     'family_history', '糖尿病家族史', 'Family history: diabetes',     '{父亲糖尿病,母亲糖尿病,家族糖尿病}', NULL, NULL, 601),
    ('family_history:chd',          'family_history', '冠心病家族史', 'Family history: CHD',          '{心脏病家族史,家族冠心病}', NULL, NULL, 602),
    ('family_history:stroke',       'family_history', '脑卒中家族史', 'Family history: stroke',       '{中风家族史}', NULL, NULL, 603),
    ('family_history:cancer',       'family_history', '肿瘤家族史',   'Family history: cancer',       '{癌症家族史,恶性肿瘤家族史}', NULL, NULL, 604),
    ('family_history:cancer_breast','family_history', '乳腺癌家族史', 'Family history: breast cancer', '{}', NULL, NULL, 605),
    ('family_history:cancer_colorectal','family_history', '结直肠癌家族史', 'Family history: colorectal cancer', '{肠癌家族史,大肠癌家族史}', NULL, NULL, 606),
    ('family_history:cancer_gastric','family_history', '胃癌家族史',  'Family history: gastric cancer', '{}', NULL, NULL, 607),
    ('family_history:cancer_liver', 'family_history', '肝癌家族史',   'Family history: liver cancer', '{}', NULL, NULL, 608),
    ('family_history:cancer_lung',  'family_history', '肺癌家族史',   'Family history: lung cancer',  '{}', NULL, NULL, 609),
    ('family_history:thyroid',      'family_history', '甲状腺疾病家族史', 'Family history: thyroid disease', '{}', NULL, NULL, 610),
    ('family_history:dementia',     'family_history', '痴呆家族史',   'Family history: dementia',     '{阿尔茨海默病家族史,老年痴呆家族史}', NULL, NULL, 611),
    ('family_history:osteoporosis', 'family_history', '骨质疏松家族史', 'Family history: osteoporosis', '{}', NULL, NULL, 612),
    ('family_history:hyperlipidemia','family_history', '高血脂家族史', 'Family history: hyperlipidemia', '{血脂异常家族史}', NULL, NULL, 613),

    -- procedure (surgical history)
    ('procedure:appendectomy',      'procedure', '阑尾切除术',   'Appendectomy',           '{阑尾炎手术,阑尾手术}', NULL, NULL, 700),
    ('procedure:cholecystectomy',   'procedure', '胆囊切除术',   'Cholecystectomy',        '{胆囊手术,胆囊切除}', NULL, NULL, 701),
    ('procedure:cesarean',          'procedure', '剖宫产',       'Cesarean section',       '{剖腹产}', NULL, NULL, 702),
    ('procedure:thyroidectomy',     'procedure', '甲状腺切除术', 'Thyroidectomy',          '{甲状腺手术,甲状腺部分切除}', NULL, NULL, 703),
    ('procedure:hysterectomy',      'procedure', '子宫切除术',   'Hysterectomy',           '{子宫切除}', NULL, NULL, 704),
    ('procedure:myomectomy',        'procedure', '子宫肌瘤剔除术', 'Myomectomy',           '{肌瘤剔除}', NULL, NULL, 705),
    ('procedure:oophorectomy',      'procedure', '卵巢切除术',   'Oophorectomy',           '{卵巢囊肿手术}', NULL, NULL, 706),
    ('procedure:breast_surgery',    'procedure', '乳腺手术',     'Breast surgery',         '{乳腺结节切除,乳腺纤维瘤手术}', NULL, NULL, 707),
    ('procedure:cardiac_stent',     'procedure', '冠脉支架',     'Coronary stent',         '{心脏支架,PCI,支架植入}', NULL, NULL, 710),
    ('procedure:cabg',              'procedure', '冠脉搭桥',     'CABG',                   '{搭桥手术}', NULL, NULL, 711),
    ('procedure:polypectomy',       'procedure', '息肉切除术',   'Polypectomy',            '{肠息肉切除,胃息肉切除}', NULL, NULL, 720),
    ('procedure:hernia_repair',     'procedure', '疝修补术',     'Hernia repair',          '{疝气手术}', NULL, NULL, 721),
    ('procedure:tonsillectomy',     'procedure', '扁桃体切除术', 'Tonsillectomy',          '{}', NULL, NULL, 722),
    ('procedure:joint_replacement', 'procedure', '关节置换术',   'Joint replacement',      '{膝关节置换,髋关节置换}', NULL, NULL, 723),
    ('procedure:lasik',             'procedure', '近视激光手术', 'Refractive surgery',     '{LASIK,全飞秒,半飞秒}', NULL, NULL, 724),
    ('procedure:tubal_ligation',    'procedure', '输卵管结扎', 'Tubal ligation',         '{结扎}', NULL, NULL, 725),
    ('procedure:ivf',               'procedure', '试管婴儿',     'IVF',                    '{体外受精,IVF}', NULL, NULL, 726),
    ('procedure:kidney_stone_surgery','procedure', '碎石术',     'Lithotripsy',            '{体外碎石,输尿管镜碎石}', NULL, NULL, 727),
    ('procedure:organ_transplant',  'procedure', '器官移植',     'Organ transplant',       '{肾移植,肝移植}', NULL, NULL, 728)
ON CONFLICT (tag_key) DO NOTHING;
