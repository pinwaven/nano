-- @requires: migration_biomarker_catalog.sql
--
-- Alternate spellings the document-extraction agent may match a printed label against.
--
-- The agent (CLAUDE.md §39) resolves a printed analyte name to a catalog key by substring match
-- on display_name / display_name_zh. Real 体检报告 print abbreviations — 血红蛋白 as "Hb", 甘油三酯
-- as "TG", 空腹血糖 as "FBG" or "Glu" — and on dev these were being dropped as unmapped although
-- the marker itself is in the catalog. The alternates ship with every claim (`catalog[].aliases`)
-- and on GET /doc-extract/catalog, so extending the vocabulary is a row edit, not a deploy on
-- either side.
--
-- Only ever ADDS spellings. The key_name stays the one identifier nano resolves (§11's rule for
-- dots applies here too); an alias is a hint for the reader, never an identity.
ALTER TABLE biomarker_catalog
    ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}';

-- Idempotent: only rows that still carry the default are seeded, so a later hand edit survives a
-- re-run.
UPDATE biomarker_catalog SET aliases = v.aliases
FROM (VALUES
    ('hsCRP',            ARRAY['hs-CRP', 'HS-CRP', 'hsCRP', '超敏CRP', '超敏C-反应蛋白']),
    ('IL6',              ARRAY['IL-6', '白细胞介素-6', '白细胞介素6']),
    ('GDF15',            ARRAY['GDF-15', 'GDF15']),
    ('GA',               ARRAY['糖化白蛋白', 'Glycated Albumin']),
    ('CystatinC',        ARRAY['Cys-C', 'CysC', '胱抑素-C']),
    ('HbA1c',            ARRAY['HbA1c', 'A1c', '糖化血红蛋白A1c']),
    ('FPG',              ARRAY['FBG', 'Glu', 'GLU', '葡萄糖', '空腹血葡萄糖', '空腹葡萄糖', '血糖']),
    ('Triglycerides',    ARRAY['TG', '甘油三脂']),
    ('ALT',              ARRAY['GPT', '谷丙转氨酶', '丙氨酸转氨酶']),
    ('AST',              ARRAY['GOT', '谷草转氨酶', '天门冬氨酸氨基转移酶', '天冬氨酸转氨酶']),
    ('GGT',              ARRAY['γ-GT', 'GGT', 'r-GT', 'γ-谷氨酰转移酶', '谷氨酰转移酶']),
    ('TSH',              ARRAY['促甲状腺素', '促甲状腺激素']),
    ('TotalCholesterol', ARRAY['TC', 'CHOL', 'TCHO', '总胆固醇']),
    ('LDL',              ARRAY['LDL-C', 'LDLC', '低密度脂蛋白胆固醇']),
    ('HDL',              ARRAY['HDL-C', 'HDLC', '高密度脂蛋白胆固醇']),
    ('Creatinine',       ARRAY['Cr', 'CREA', 'Crea', '血肌酐']),
    ('eGFR',             ARRAY['eGFR', '估算肾小球滤过率']),
    ('BUN',              ARRAY['BUN', 'Urea', '尿素', '尿素氮']),
    ('UricAcid',         ARRAY['UA', 'URIC', '血尿酸']),
    ('CRP',              ARRAY['CRP', 'C-反应蛋白']),
    ('VitaminD',         ARRAY['25-OH-VD', '25-OHD', '25(OH)D', '25羟维生素D', '25-羟基维生素D', '维生素D3', 'VD']),
    ('WBC',              ARRAY['WBC', '白细胞', '白细胞数']),
    ('Ferritin',         ARRAY['FER', 'SF', '血清铁蛋白']),
    ('Hemoglobin',       ARRAY['Hb', 'HGB', '血红蛋白量'])
) AS v(key_name, aliases)
WHERE biomarker_catalog.key_name = v.key_name AND biomarker_catalog.aliases = '{}';
