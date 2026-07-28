-- Syncs the "PRECISION LONGEVITY PRACTITIONER" certification's settings (issuing
-- org, template image, template layout, dates, etc.) to the values configured in
-- dev. Prod had a bare placeholder row (same title, blank settings); this brings
-- it in line so the media function can render real certificate images in prod.
-- Idempotent: re-running is a no-op once the row already matches (and a no-op on
-- dev, which already has these values).
UPDATE academy_certifications SET
  description             = '谢克曼长寿管理实操班认证证书 第一期',
  required_course_ids      = ARRAY[4],
  min_credits              = 0,
  badge_image_url          = NULL,
  is_active                = TRUE,
  cert_number_prefix       = 'SCH',
  issuing_org              = 'RANDY W. SCHEKMAN INTERNATIONAL HEALTH EDUCATION COLLEGE LIMITED',
  school_org               = 'AEVIVA LONGEVITY INSTITUTE',
  validity_years           = 2,
  course_display_name      = '谢克曼长寿管理实操班',
  template_image_oss_key   = 'academy/cert/a62ac7e810fad7fa.jpg',
  template_layout          = '{
    "name": {"xPct": 49.13970947265625, "yPct": 49.3889846856112, "align": "center", "color": "#1a1a1a", "enabled": true, "fontWeight": "bold", "fontSizePct": 4.2942247144531525},
    "issue_date": {"xPct": 49.697265625, "yPct": 68.01300760692207, "align": "center", "color": "#1a1a1a", "enabled": true, "fontWeight": "normal", "fontSizePct": 2},
    "validity_date": {"xPct": 12.276204427083332, "yPct": 85.82262772045137, "align": "left", "color": "#1a1a1a", "enabled": true, "fontWeight": "normal", "fontSizePct": 1.8},
    "certificate_number": {"xPct": 12.281901041666666, "yPct": 82.9315377013766, "align": "left", "color": "#8a7440", "enabled": true, "fontWeight": "normal", "fontSizePct": 1.8}
  }'::jsonb,
  tier          = NULL,
  issue_date    = DATE '2026-06-13',
  validity_date = DATE '2027-12-31'
WHERE title = 'PRECISION LONGEVITY PRACTITIONER';
