-- Fix misspelled "Infiniti" -> "Infinity" in the smart ring APK digital asset.
-- Appears in the Aeviva (channel 2) academy/box (魔盒) media list download link.
-- Idempotent: REPLACE only touches rows still containing the typo.
UPDATE digital_assets
SET title    = REPLACE(title, 'Infiniti', 'Infinity'),
    title_zh = REPLACE(title_zh, 'Infiniti', 'Infinity')
WHERE title ILIKE '%Infiniti%' OR title_zh ILIKE '%Infiniti%';
