-- 维生素B9 is folate. A real page printed 「维生素B9(叶酸)」 and the reader keyed nothing:
-- parentheticals are stripped before matching and 维生素B9 was not an alias.
-- @requires: migration_biomarker_catalog_v2.sql
UPDATE biomarker_catalog SET aliases = array_append(aliases, '维生素B9')
 WHERE key_name = 'Folate' AND NOT ('维生素B9' = ANY(aliases));
