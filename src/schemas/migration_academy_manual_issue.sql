ALTER TABLE academy_coach_certifications
  ADD COLUMN IF NOT EXISTS is_manual_issue BOOLEAN DEFAULT FALSE;
