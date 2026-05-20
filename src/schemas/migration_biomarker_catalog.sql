-- biomarker_catalog: registry of all known biomarkers (Kino-core and standard clinical panel)
-- Used by nano-lab to resolve LOINC codes → key_name, nano_dimension, is_kino_core
-- is_kino_core=TRUE  → participates directly in BioAgeCalculator (the 6 Kino biomarkers)
-- nano_dimension     → which of the 4 sub-ages this biomarker influences (NULL = context-only)

CREATE TABLE IF NOT EXISTS biomarker_catalog (
    id              SERIAL PRIMARY KEY,
    key_name        TEXT UNIQUE NOT NULL,
    loinc_code      TEXT UNIQUE,
    display_name    TEXT NOT NULL,
    display_name_zh TEXT,
    unit            TEXT NOT NULL,
    category        TEXT NOT NULL,     -- inflammation | metabolic | renal | lipid | cbc | thyroid | liver | cellular
    nano_dimension  TEXT,              -- ResilienceAge | CellularAge | MetabolicAge | MicroVascularAge | NULL
    is_kino_core    BOOLEAN NOT NULL DEFAULT FALSE,
    ref_low         NUMERIC,           -- lower bound of normal range
    ref_high        NUMERIC,           -- upper bound of normal range
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_biomarker_catalog_loinc
    ON biomarker_catalog(loinc_code)
    WHERE loinc_code IS NOT NULL;

-- ── Kino core biomarkers (is_kino_core = TRUE) ──────────────────────────────

INSERT INTO biomarker_catalog (key_name, loinc_code, display_name, display_name_zh, unit, category, nano_dimension, is_kino_core, ref_low, ref_high)
VALUES
    ('hsCRP',     '71426-1', 'hs-CRP',           '超敏C反应蛋白', 'mg/L',      'inflammation', 'ResilienceAge',    TRUE,  NULL, 1.0),
    ('IL6',       '26881-3', 'IL-6',              '白介素-6',     'pg/mL',     'inflammation', 'ResilienceAge',    TRUE,  NULL, 3.0),
    ('GDF15',     '96543-1', 'GDF-15',            'GDF-15蛋白',   'pg/mL',     'cellular',     'CellularAge',     TRUE,  NULL, 750.0),
    ('GA',        '13457-7', 'Glycated Albumin',  '糖化白蛋白',   '%',         'metabolic',    'MetabolicAge',    TRUE,  11.0, 15.0),
    ('CystatinC', '33863-2', 'Cystatin C',        '胱抑素C',      'mg/L',      'renal',        'MicroVascularAge', TRUE, 0.51, 0.95),
    ('CD38',      NULL,      'CD38',              'CD38活性',     'xBaseline', 'cellular',     'CellularAge',     TRUE,  1.0,  1.5)
ON CONFLICT (key_name) DO NOTHING;

-- ── Common clinical panel biomarkers ────────────────────────────────────────

INSERT INTO biomarker_catalog (key_name, loinc_code, display_name, display_name_zh, unit, category, nano_dimension, is_kino_core, ref_low, ref_high)
VALUES
    -- Metabolic / glucose
    ('HbA1c',           '4548-4',  'Hemoglobin A1c',         '糖化血红蛋白',   '%',            'metabolic',    'MetabolicAge',    FALSE, NULL, 5.7),
    ('FPG',             '1558-6',  'Fasting Plasma Glucose', '空腹血糖',       'mmol/L',       'metabolic',    'MetabolicAge',    FALSE, 3.9,  6.1),
    ('Triglycerides',   '2571-8',  'Triglycerides',          '甘油三酯',       'mmol/L',       'lipid',        'MetabolicAge',    FALSE, NULL, 1.7),

    -- Liver
    ('ALT',             '1742-6',  'Alanine Aminotransferase','丙氨酸氨基转移酶','U/L',         'liver',        'MetabolicAge',    FALSE, NULL, 40.0),
    ('AST',             '1920-8',  'Aspartate Aminotransferase','天冬氨酸氨基转移酶','U/L',     'liver',        'MetabolicAge',    FALSE, NULL, 40.0),
    ('GGT',             '2324-2',  'Gamma-Glutamyl Transferase','谷氨酰转肽酶', 'U/L',         'liver',        'MetabolicAge',    FALSE, NULL, 50.0),

    -- Thyroid
    ('TSH',             '3016-3',  'Thyroid Stimulating Hormone','促甲状腺激素','mIU/L',       'thyroid',      'MetabolicAge',    FALSE, 0.35, 4.5),

    -- Lipids / vascular
    ('TotalCholesterol','2093-3',  'Total Cholesterol',       '总胆固醇',       'mmol/L',       'lipid',        'MicroVascularAge', FALSE, NULL, 5.2),
    ('LDL',             '18262-6', 'LDL Cholesterol',         '低密度脂蛋白',   'mmol/L',       'lipid',        'MicroVascularAge', FALSE, NULL, 3.4),
    ('HDL',             '2085-9',  'HDL Cholesterol',         '高密度脂蛋白',   'mmol/L',       'lipid',        'MicroVascularAge', FALSE, 1.0,  NULL),

    -- Renal
    ('Creatinine',      '2160-0',  'Creatinine',              '肌酐',           'umol/L',       'renal',        'MicroVascularAge', FALSE, 53.0, 115.0),
    ('eGFR',            '62238-1', 'eGFR',                    '肾小球滤过率',   'mL/min/1.73m2','renal',       'MicroVascularAge', FALSE, 90.0, NULL),
    ('BUN',             '3094-0',  'Blood Urea Nitrogen',     '血尿素氮',       'mmol/L',       'renal',        'MicroVascularAge', FALSE, 1.7,  8.3),
    ('UricAcid',        '3084-1',  'Uric Acid',               '尿酸',           'umol/L',       'renal',        'MicroVascularAge', FALSE, NULL, 416.0),

    -- Inflammation
    ('CRP',             '1988-5',  'C-Reactive Protein',      'C反应蛋白',      'mg/L',         'inflammation', 'ResilienceAge',    FALSE, NULL, 10.0),
    ('VitaminD',        '1989-3',  '25-OH Vitamin D',         '维生素D',        'nmol/L',       'inflammation', 'ResilienceAge',    FALSE, 50.0, 150.0),
    ('WBC',             '6690-2',  'White Blood Cell Count',  '白细胞计数',     '10^9/L',       'cbc',          'ResilienceAge',    FALSE, 4.0,  10.0),

    -- Cellular
    ('Ferritin',        '2276-4',  'Ferritin',                '铁蛋白',         'ug/L',         'cellular',     'CellularAge',     FALSE, 13.0, 150.0),
    ('Hemoglobin',      '718-7',   'Hemoglobin',              '血红蛋白',        'g/L',          'cbc',          'CellularAge',     FALSE, 115.0, 175.0)

ON CONFLICT (key_name) DO NOTHING;
