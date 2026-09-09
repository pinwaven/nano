-- Migration: DOT-N12 (Sharp Mind / Citicoline + Huperzine A) reverts to gastric coating.
-- Choline-driven mental clarity is sometimes felt within an hour of dosing —
-- gastric release favors that faster onset over delayed enteric release.
-- Idempotent: only touches the row if not already 'gastric'.

UPDATE dots SET coating = 'gastric' WHERE key_name = 'DOT-N12' AND coating IS DISTINCT FROM 'gastric';
