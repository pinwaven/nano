-- @requires: migration_biomarker_catalog_aliases.sql
--
-- Widens biomarker_catalog from the 25 keys the Kino model and a basic clinical panel need to
-- what actually appears in the documents users upload (CLAUDE.md §38/§39): a Chinese 体检报告's
-- CBC / liver / thyroid / tumor-marker blocks, and the functional-medicine reports a longevity
-- clinic sells — NAD+, homocysteine, AMH, telomere length, a hair nutrient/toxic-element panel.
--
-- Measured need, not a wishlist. Dev user 55761144's 22 documents and the 17 extractions run on
-- dev to 2026-09-15 are where every key below comes from; before this file the extraction
-- dropped Hcy 16.4, insulin 10.8, Lp(a), ApoB, CEA and AFP from one 体检 alone as `unmapped`, and
-- an NAD+ report yielded nothing but a summary.
--
-- Every row is CONTEXT-ONLY: nano_dimension NULL, is_kino_core FALSE. Nothing here reaches
-- BioAgeCalculator — an OCR'd document must not manufacture a biological age (§39). The catalog
-- is what the extraction agent matches printed labels against, what `unit_mismatch` compares to,
-- and what the twin's lab panel is keyed on; that is all it is.
--
-- ref_low / ref_high feed the validator's ORDER-OF-MAGNITUDE band (0.1× … 100×), not a clinical
-- verdict, so they are left NULL wherever the range is genuinely assay- or cycle-dependent
-- (hormones, NAD+, telomere, hair nutrients) rather than guessed — NULL only disables the band
-- and keeps the non-negativity check.
--
-- Units are what Chinese labs print (SI). The hair panel is in µg/g and is its own category:
-- a serum zinc in µmol/L must not resolve to a hair zinc, so the keys carry the sample type.
--
-- ROW FORMAT IS LOAD-BEARING: tests/doc-extraction-contract.test.js parses these rows with a
-- regex that expects exactly the v1 layout (4-space indent, ten columns, no trailing aliases).
-- Aliases are set in a separate UPDATE below for that reason.

INSERT INTO biomarker_catalog (key_name, loinc_code, display_name, display_name_zh, unit, category, nano_dimension, is_kino_core, ref_low, ref_high)
VALUES
    -- Metabolic
    ('Insulin',         '20448-7', 'Fasting Insulin',          '空腹胰岛素',     'uIU/mL',       'metabolic',    NULL, FALSE, 2.6,  24.9),
    ('Hcy',             '13965-9', 'Homocysteine',             '同型半胱氨酸',   'umol/L',       'metabolic',    NULL, FALSE, NULL, 15.0),
    ('VitaminB12',      '14685-2', 'Vitamin B12',              '维生素B12',      'pmol/L',       'metabolic',    NULL, FALSE, 145.0, 569.0),
    ('Folate',          '14732-2', 'Folate',                   '叶酸',           'nmol/L',       'metabolic',    NULL, FALSE, 7.0,  NULL),

    -- Liver
    ('ALP',             '6768-6',  'Alkaline Phosphatase',     '碱性磷酸酶',     'U/L',          'liver',        NULL, FALSE, 45.0, 125.0),
    ('LDH',             '2532-0',  'Lactate Dehydrogenase',    '乳酸脱氢酶',     'U/L',          'liver',        NULL, FALSE, 120.0, 250.0),
    ('CK',              '2157-6',  'Creatine Kinase',          '肌酸激酶',       'U/L',          'liver',        NULL, FALSE, 50.0, 310.0),
    ('TBIL',            '14631-6', 'Total Bilirubin',          '总胆红素',       'umol/L',       'liver',        NULL, FALSE, 5.0,  21.0),
    ('DBIL',            '14629-0', 'Direct Bilirubin',         '直接胆红素',     'umol/L',       'liver',        NULL, FALSE, NULL, 6.8),
    ('IBIL',            '14630-8', 'Indirect Bilirubin',       '间接胆红素',     'umol/L',       'liver',        NULL, FALSE, NULL, 17.0),
    ('ALB',             '1751-7',  'Albumin',                  '白蛋白',         'g/L',          'liver',        NULL, FALSE, 40.0, 55.0),
    ('TP',              '2885-2',  'Total Protein',            '总蛋白',         'g/L',          'liver',        NULL, FALSE, 65.0, 85.0),
    ('GLB',             '10834-0', 'Globulin',                 '球蛋白',         'g/L',          'liver',        NULL, FALSE, 20.0, 40.0),

    -- Lipids
    ('LpA',             '10835-7', 'Lipoprotein(a)',           '脂蛋白a',        'mg/L',         'lipid',        NULL, FALSE, NULL, 300.0),
    ('ApoA1',           '1869-7',  'Apolipoprotein A1',        '载脂蛋白A1',     'g/L',          'lipid',        NULL, FALSE, 1.0,  1.6),
    ('ApoB',            '1884-6',  'Apolipoprotein B',         '载脂蛋白B',      'g/L',          'lipid',        NULL, FALSE, 0.6,  1.1),

    -- Complete blood count
    ('RBC',             '789-8',   'Red Blood Cell Count',     '红细胞计数',     '10^12/L',      'cbc',          NULL, FALSE, 3.8,  5.8),
    ('HCT',             '4544-3',  'Hematocrit',               '红细胞压积',     '%',            'cbc',          NULL, FALSE, 35.0, 50.0),
    ('MCV',             '787-2',   'Mean Corpuscular Volume',  '平均红细胞体积', 'fL',           'cbc',          NULL, FALSE, 82.0, 100.0),
    ('MCH',             '785-6',   'Mean Corpuscular Hemoglobin','平均红细胞血红蛋白量','pg',    'cbc',          NULL, FALSE, 27.0, 34.0),
    ('MCHC',            '786-4',   'Mean Corpuscular Hb Concentration','平均红细胞血红蛋白浓度','g/L','cbc',   NULL, FALSE, 316.0, 354.0),
    ('RDW',             '788-0',   'Red Cell Distribution Width','红细胞分布宽度','%',           'cbc',          NULL, FALSE, 11.5, 14.5),
    ('PLT',             '777-3',   'Platelet Count',           '血小板计数',     '10^9/L',       'cbc',          NULL, FALSE, 125.0, 350.0),
    ('NEUT',            '751-8',   'Neutrophil Count',         '中性粒细胞计数', '10^9/L',       'cbc',          NULL, FALSE, 1.8,  6.3),
    ('LYMPH',           '731-0',   'Lymphocyte Count',         '淋巴细胞计数',   '10^9/L',       'cbc',          NULL, FALSE, 1.1,  3.2),
    ('MONO',            '742-7',   'Monocyte Count',           '单核细胞计数',   '10^9/L',       'cbc',          NULL, FALSE, 0.1,  0.6),
    ('EOS',             '711-2',   'Eosinophil Count',         '嗜酸性粒细胞计数','10^9/L',      'cbc',          NULL, FALSE, 0.02, 0.52),
    ('BASO',            '704-7',   'Basophil Count',           '嗜碱性粒细胞计数','10^9/L',      'cbc',          NULL, FALSE, NULL, 0.06),

    -- Thyroid
    ('FT3',             '3051-0',  'Free T3',                  '游离三碘甲状腺原氨酸','pmol/L',  'thyroid',      NULL, FALSE, 3.1,  6.8),
    ('FT4',             '3024-7',  'Free T4',                  '游离甲状腺素',   'pmol/L',       'thyroid',      NULL, FALSE, 12.0, 22.0),
    ('TPOAb',           '8099-4',  'Thyroid Peroxidase Antibody','甲状腺过氧化物酶抗体','IU/mL','thyroid',      NULL, FALSE, NULL, 34.0),

    -- Hormones (cycle-, age- and assay-dependent ranges: left NULL on purpose)
    ('AMH',             NULL,      'Anti-Mullerian Hormone',   '抗缪勒氏管激素', 'ng/mL',        'hormone',      NULL, FALSE, NULL, NULL),
    ('Estradiol',       '14715-7', 'Estradiol',                '雌二醇',         'pmol/L',       'hormone',      NULL, FALSE, NULL, NULL),
    ('Testosterone',    NULL,      'Total Testosterone',       '总睾酮',         'nmol/L',       'hormone',      NULL, FALSE, NULL, NULL),
    ('Cortisol',        NULL,      'Cortisol',                 '皮质醇',         'nmol/L',       'hormone',      NULL, FALSE, NULL, NULL),

    -- Tumor markers (zero is normal: ref_low NULL)
    ('CEA',             '2039-6',  'Carcinoembryonic Antigen', '癌胚抗原',       'ng/mL',        'tumor_marker', NULL, FALSE, NULL, 5.0),
    ('AFP',             '1834-1',  'Alpha-Fetoprotein',        '甲胎蛋白',       'ng/mL',        'tumor_marker', NULL, FALSE, NULL, 7.0),
    ('NSE',             '15061-5', 'Neuron-Specific Enolase',  '神经元特异性烯醇化酶','ng/mL',   'tumor_marker', NULL, FALSE, NULL, 16.3),
    ('SCC',             NULL,      'Squamous Cell Carcinoma Antigen','鳞状细胞癌抗原','ng/mL',    'tumor_marker', NULL, FALSE, NULL, 1.5),
    ('CA125',           '10334-1', 'CA 125',                   '糖类抗原125',    'U/mL',         'tumor_marker', NULL, FALSE, NULL, 35.0),
    ('CA199',           '24108-3', 'CA 19-9',                  '糖类抗原19-9',   'U/mL',         'tumor_marker', NULL, FALSE, NULL, 37.0),
    ('CA153',           '6875-9',  'CA 15-3',                  '糖类抗原15-3',   'U/mL',         'tumor_marker', NULL, FALSE, NULL, 25.0),
    ('PSA',             '2857-1',  'Prostate-Specific Antigen','前列腺特异性抗原','ng/mL',       'tumor_marker', NULL, FALSE, NULL, 4.0),
    ('PGI',             NULL,      'Pepsinogen I',             '胃蛋白酶原I',    'ng/mL',        'tumor_marker', NULL, FALSE, 70.0, NULL),
    ('PGII',            NULL,      'Pepsinogen II',            '胃蛋白酶原II',   'ng/mL',        'tumor_marker', NULL, FALSE, NULL, NULL),

    -- Hair nutrient / toxic elements (ICP-MS on hair; the sample type is in the key so a serum
    -- value in a different unit can never resolve here). Toxic ceilings are the panel's own.
    ('HairZn',          NULL,      'Hair Zinc',                '头发锌',         'ug/g',         'hair_element', NULL, FALSE, NULL, NULL),
    ('HairSe',          NULL,      'Hair Selenium',            '头发硒',         'ug/g',         'hair_element', NULL, FALSE, NULL, NULL),
    ('HairCu',          NULL,      'Hair Copper',              '头发铜',         'ug/g',         'hair_element', NULL, FALSE, NULL, NULL),
    ('HairMg',          NULL,      'Hair Magnesium',           '头发镁',         'ug/g',         'hair_element', NULL, FALSE, NULL, NULL),
    ('HairCa',          NULL,      'Hair Calcium',             '头发钙',         'ug/g',         'hair_element', NULL, FALSE, NULL, NULL),
    ('HairFe',          NULL,      'Hair Iron',                '头发铁',         'ug/g',         'hair_element', NULL, FALSE, NULL, NULL),
    ('HairPb',          NULL,      'Hair Lead',                '头发铅',         'ug/g',         'hair_element', NULL, FALSE, NULL, 1.0),
    ('HairHg',          NULL,      'Hair Mercury',             '头发汞',         'ug/g',         'hair_element', NULL, FALSE, NULL, 0.4),
    ('HairCd',          NULL,      'Hair Cadmium',             '头发镉',         'ug/g',         'hair_element', NULL, FALSE, NULL, 0.07),
    ('HairAs',          NULL,      'Hair Arsenic',             '头发砷',         'ug/g',         'hair_element', NULL, FALSE, NULL, 0.08),
    ('HairAl',          NULL,      'Hair Aluminium',           '头发铝',         'ug/g',         'hair_element', NULL, FALSE, NULL, 8.0),

    -- Aging / longevity assays (no established population ranges: NULL)
    ('NAD',             NULL,      'NAD+',                     '烟酰胺腺嘌呤二核苷酸','umol/L',  'aging',        NULL, FALSE, NULL, NULL),
    ('TelomereLength',  NULL,      'Mean Telomere Length',     '平均端粒绝对长度','bp',          'aging',        NULL, FALSE, NULL, NULL),
    ('TelomereTS',      NULL,      'Telomere T/S Ratio',       '平均端粒相对长度','T/S',         'aging',        NULL, FALSE, NULL, NULL),

    -- Vitals printed on a 体检 cover sheet. lab_result rows, not wearable vitals.
    ('SBP',             '8480-6',  'Systolic Blood Pressure',  '收缩压',         'mmHg',         'vitals',       NULL, FALSE, 90.0, 140.0),
    ('DBP',             '8462-4',  'Diastolic Blood Pressure', '舒张压',         'mmHg',         'vitals',       NULL, FALSE, 60.0, 90.0)
ON CONFLICT (key_name) DO NOTHING;

-- Aliases for the new rows (same idempotency rule as migration_biomarker_catalog_aliases.sql).
-- Single-character names are listed for nano's own display but the extraction agent ignores
-- names under 2 characters, so every element also carries its symbol and a 2+ char spelling.
UPDATE biomarker_catalog SET aliases = v.aliases
FROM (VALUES
    ('Insulin',        ARRAY['INS', 'FINS', '胰岛素', '空腹胰岛素']),
    ('Hcy',            ARRAY['HCY', 'Hcy', 'HCY同型半胱氨酸', '同型半胱胺酸', '高半胱氨酸']),
    ('VitaminB12',     ARRAY['VB12', 'B12', '维生素B-12', '钴胺素']),
    ('Folate',         ARRAY['FA', 'FOL', '叶酸', '血清叶酸']),
    ('ALP',            ARRAY['ALP', 'AKP', '碱性磷酸酶']),
    ('LDH',            ARRAY['LDH', 'LD', '乳酸脱氢酶']),
    ('CK',             ARRAY['CK', 'CPK', '肌酸激酶', '肌酸磷酸激酶']),
    ('TBIL',           ARRAY['TBIL', 'T-BIL', 'TBil', '总胆红素']),
    ('DBIL',           ARRAY['DBIL', 'D-BIL', 'DBil', '直接胆红素', '结合胆红素']),
    ('IBIL',           ARRAY['IBIL', 'I-BIL', 'IBil', '间接胆红素', '非结合胆红素']),
    ('ALB',            ARRAY['ALB', 'Alb', '白蛋白', '血清白蛋白']),
    ('TP',             ARRAY['TP', '总蛋白', '血清总蛋白']),
    ('GLB',            ARRAY['GLB', 'GLO', '球蛋白']),
    ('LpA',            ARRAY['Lp(a)', 'LPA', 'LP(a)', '脂蛋白(a)', '脂蛋白（a）', '脂蛋白a']),
    ('ApoA1',          ARRAY['ApoA1', 'APOA1', 'ApoA-I', 'APO-A1', '载脂蛋白A1', '载脂蛋白AⅠ']),
    ('ApoB',           ARRAY['ApoB', 'APOB', 'APO-B', '载脂蛋白B']),
    ('RBC',            ARRAY['RBC', '红细胞', '红细胞数']),
    ('HCT',            ARRAY['HCT', 'Hct', 'PCV', '红细胞比容', '血细胞比容']),
    ('MCV',            ARRAY['MCV', '平均红细胞体积']),
    ('MCH',            ARRAY['MCH', '平均红细胞血红蛋白含量', '平均血红蛋白量']),
    ('MCHC',           ARRAY['MCHC', '平均红细胞血红蛋白浓度', '平均血红蛋白浓度']),
    ('RDW',            ARRAY['RDW', 'RDW-CV', '红细胞分布宽度', '红细胞分布宽度变异系数']),
    ('PLT',            ARRAY['PLT', '血小板', '血小板数']),
    ('NEUT',           ARRAY['NEUT', 'NEU', 'NEUT#', 'GRAN', '中性粒细胞', '中性粒细胞绝对值', '中性粒细胞数']),
    ('LYMPH',          ARRAY['LYMPH', 'LYM', 'LYM#', '淋巴细胞', '淋巴细胞绝对值', '淋巴细胞数']),
    ('MONO',           ARRAY['MONO', 'MON', 'MONO#', '单核细胞', '单核细胞绝对值', '单核细胞数']),
    ('EOS',            ARRAY['EOS', 'EO', 'EOS#', '嗜酸性粒细胞', '嗜酸性粒细胞绝对值', '嗜酸粒细胞']),
    ('BASO',           ARRAY['BASO', 'BAS', 'BASO#', '嗜碱性粒细胞', '嗜碱性粒细胞绝对值', '嗜碱粒细胞']),
    ('FT3',            ARRAY['FT3', 'fT3', '游离T3', '游离三碘甲腺原氨酸']),
    ('FT4',            ARRAY['FT4', 'fT4', '游离T4', '游离甲状腺素']),
    ('TPOAb',          ARRAY['TPOAb', 'TPO-Ab', 'A-TPO', 'Anti-TPO', '抗甲状腺过氧化物酶抗体', '甲状腺过氧化物酶抗体']),
    ('AMH',            ARRAY['AMH', 'AMH值', '抗苗勒管激素', '抗缪勒管激素', '抗米勒管激素', '抗缪勒氏管激素']),
    ('Estradiol',      ARRAY['E2', 'Estradiol', '雌二醇']),
    ('Testosterone',   ARRAY['TESTO', 'Testosterone', '睾酮', '总睾酮', '睾丸酮']),
    ('Cortisol',       ARRAY['COR', 'Cortisol', '皮质醇']),
    ('CEA',            ARRAY['CEA', '癌胚抗原']),
    ('AFP',            ARRAY['AFP', '甲胎蛋白']),
    ('NSE',            ARRAY['NSE', '神经元特异性烯醇化酶', '神经元特异烯醇化酶']),
    ('SCC',            ARRAY['SCC', 'SCCA', 'SCC-Ag', '鳞状细胞癌抗原', '鳞状上皮细胞癌抗原']),
    ('CA125',          ARRAY['CA125', 'CA-125', 'CA 125', '糖类抗原125', '糖链抗原125']),
    ('CA199',          ARRAY['CA199', 'CA19-9', 'CA 19-9', '糖类抗原19-9', '糖链抗原19-9']),
    ('CA153',          ARRAY['CA153', 'CA15-3', 'CA 15-3', '糖类抗原15-3', '糖链抗原15-3']),
    ('PSA',            ARRAY['PSA', 'tPSA', 'T-PSA', '总前列腺特异性抗原', '前列腺特异性抗原']),
    ('PGI',            ARRAY['PGI', 'PG I', 'PGⅠ', '胃蛋白酶原I', '胃蛋白酶原Ⅰ']),
    ('PGII',           ARRAY['PGII', 'PG II', 'PGⅡ', '胃蛋白酶原II', '胃蛋白酶原Ⅱ']),
    ('HairZn',         ARRAY['Zn', '锌', '锌(头发)', '头发锌']),
    ('HairSe',         ARRAY['Se', '硒', '硒(头发)', '头发硒']),
    ('HairCu',         ARRAY['Cu', '铜', '铜(头发)', '头发铜']),
    ('HairMg',         ARRAY['Mg', '镁', '镁(头发)', '头发镁']),
    ('HairCa',         ARRAY['Ca', '钙', '钙(头发)', '头发钙']),
    ('HairFe',         ARRAY['Fe', '铁', '铁(头发)', '头发铁']),
    ('HairPb',         ARRAY['Pb', '铅', '铅(头发)', '头发铅']),
    ('HairHg',         ARRAY['Hg', '汞', '汞(头发)', '头发汞']),
    ('HairCd',         ARRAY['Cd', '镉', '镉(头发)', '头发镉']),
    ('HairAs',         ARRAY['As', '砷', '砷(头发)', '头发砷']),
    ('HairAl',         ARRAY['Al', '铝', '铝(头发)', '头发铝']),
    ('NAD',            ARRAY['NAD+', 'NAD', '烟酰胺腺嘌呤二核苷酸', 'NAD+水平']),
    ('TelomereLength', ARRAY['端粒长度', '平均端粒绝对长度', '端粒绝对长度', 'Telomere Length']),
    ('TelomereTS',     ARRAY['T/S', 'T/S比值', '平均端粒相对长度', '端粒相对长度']),
    ('SBP',            ARRAY['SBP', '收缩压', '高压']),
    ('DBP',            ARRAY['DBP', '舒张压', '低压'])
) AS v(key_name, aliases)
WHERE biomarker_catalog.key_name = v.key_name AND biomarker_catalog.aliases = '{}';
