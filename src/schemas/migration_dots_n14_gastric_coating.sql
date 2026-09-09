-- Migration: DOT-N14 (Vascular Flow / Cocoa Flavanols) reverts to gastric coating.
-- Flow-mediated dilation is a fast-acting effect (per the dot's own description,
-- "faster-moving surrogates") — gastric release gets it into circulation sooner
-- instead of delaying into the intestine via enteric coating.
-- Idempotent: only touches the row if not already 'gastric'.

UPDATE dots SET coating = 'gastric' WHERE key_name = 'DOT-N14' AND coating IS DISTINCT FROM 'gastric';
