-- Extend certification templates with display/issuing metadata
ALTER TABLE academy_certifications
  ADD COLUMN IF NOT EXISTS cert_number_prefix       TEXT    DEFAULT '',
  ADD COLUMN IF NOT EXISTS issuing_org              TEXT,
  ADD COLUMN IF NOT EXISTS school_org               TEXT,
  ADD COLUMN IF NOT EXISTS validity_years           INT     DEFAULT 3,
  ADD COLUMN IF NOT EXISTS course_display_name      TEXT,
  ADD COLUMN IF NOT EXISTS template_image_oss_key   TEXT;

-- Extend issued certs with certificate number and assessment details
ALTER TABLE academy_coach_certifications
  ADD COLUMN IF NOT EXISTS certificate_number   TEXT    UNIQUE,
  ADD COLUMN IF NOT EXISTS issue_date           DATE    DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS expiry_date          DATE,
  ADD COLUMN IF NOT EXISTS score                INT,
  ADD COLUMN IF NOT EXISTS assessment_period    TEXT,
  ADD COLUMN IF NOT EXISTS cert_oss_key         TEXT,
  ADD COLUMN IF NOT EXISTS is_revoked           BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notes                TEXT;
