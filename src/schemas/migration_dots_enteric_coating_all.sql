-- Migration: Switch all 18 current dots (DOT-N1..DOT-N18) to enteric coating
-- Was: mixed, but effectively all 'gastric' under the current (2026-07-25) formulary.
-- Idempotent: only touches rows not already 'enteric'.

UPDATE dots SET coating = 'enteric' WHERE coating IS DISTINCT FROM 'enteric';
