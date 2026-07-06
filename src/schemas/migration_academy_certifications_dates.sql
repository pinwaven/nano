-- Issue date and validity date now live on the certification (template) itself,
-- since every student in a cohort graduates and gets issued on the same day.
ALTER TABLE academy_certifications
  ADD COLUMN IF NOT EXISTS issue_date    DATE,
  ADD COLUMN IF NOT EXISTS validity_date DATE;
