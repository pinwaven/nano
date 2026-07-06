-- Per-template text overlay positions for auto-generating certificate images
ALTER TABLE academy_certifications
  ADD COLUMN IF NOT EXISTS template_layout JSONB DEFAULT '{}'::jsonb;
