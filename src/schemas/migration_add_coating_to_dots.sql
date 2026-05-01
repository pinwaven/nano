-- Migration: Add coating column to dots table
-- Values: 'gastric' (stomach release), 'enteric' (intestinal release)

ALTER TABLE dots ADD COLUMN IF NOT EXISTS coating TEXT DEFAULT 'gastric';

-- DOT01 Cellular Fuel
UPDATE dots SET coating = 'enteric', description = 'The core NAD+ booster for cellular energy. [Enteric Coated for Intestinal Release]' WHERE key_name = 'DOT01';

-- DOT13 Vascular Flow
UPDATE dots SET coating = 'enteric', description = 'Potent cardiovascular clearing and mitochondrial energy support. [Enteric Coated for Intestinal Release]' WHERE key_name = 'DOT13';

-- DOT16 Resilience Defense
UPDATE dots SET coating = 'enteric', description = 'Comprehensive defense against oxidative stress and support for liver detoxification. [Enteric Coated for Intestinal Release]' WHERE key_name = 'DOT16';

-- DOT17 Gut & Microbiome
UPDATE dots SET coating = 'enteric', description = 'Gut Barrier & Microbiome [Enteric Coated for Intestinal Release]' WHERE key_name = 'DOT17';

-- Explicit Gastric markings
UPDATE dots SET description = 'Induces mild paresthesia (tingle) and niacin flush for physical feedback, while supporting methylation. [Rapid Gastric Release]' WHERE key_name = 'DOT08';
UPDATE dots SET description = 'Jitter-free, rapid-onset cognitive energy, motivation, and focus peaking in 15 minutes. [Rapid Gastric Release]' WHERE key_name = 'DOT10';
UPDATE dots SET description = 'Immunity & Gastric Defense [Gastric Release for Mucosal Support]' WHERE key_name = 'DOT18';
