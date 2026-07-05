-- Adds report_pdf_key: OSS object key of the archived lab report PDF for the
-- order (e.g. lab-reports/qcs/{order_id}/{good_id}-{random}.pdf). Objects are
-- uploaded public-read with a random suffix, so the key alone is enough to
-- build the permanent URL. NULL until the report has been archived.

ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS report_pdf_key TEXT;
