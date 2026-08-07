-- Migration: Add key_name_zh to dots — a Chinese-friendly identifier used when an AI persona
-- refers to a specific dot in conversation with a user (e.g. "原粒1号"), instead of the raw
-- internal short code (D-N1) or a regex computed on the fly (as viva/systemHealthAdvice.js
-- previously did inline: dot.key_name.replace(/^DOT-?N?/, '') + '号原粒'). key_name itself stays
-- the machine-facing identifier used in action-JSON tails (formulate_dots, etc.) and DB joins.
--
-- Mapping: DOT-N{n} -> 原粒{n}号 (confirmed 2026-08-07), e.g. DOT-N1 -> 原粒1号, DOT-N18 -> 原粒18号.

ALTER TABLE dots ADD COLUMN IF NOT EXISTS key_name_zh TEXT;

UPDATE dots SET key_name_zh = '原粒' || substring(key_name from '\d+$') || '号'
WHERE key_name ~ '\d+$';

-- Verify
SELECT key_name, key_name_zh, name_zh FROM dots ORDER BY id;
