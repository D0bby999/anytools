-- Keep one lesson per (point, model, variant): the one written last.
DELETE FROM kp_explanations x
 USING kp_explanations y
 WHERE x.user_id = y.user_id AND x.kp_id = y.kp_id AND x.model = y.model AND x.variant = y.variant
   AND (x.created_at, x.id) < (y.created_at, y.id);
ALTER TABLE kp_explanations DROP CONSTRAINT kp_explanations_unique;
ALTER TABLE kp_explanations DROP COLUMN lang;
ALTER TABLE kp_explanations ADD CONSTRAINT kp_explanations_unique UNIQUE (user_id, kp_id, model, variant);
ALTER TABLE knowledge_points DROP COLUMN outside_source;
ALTER TABLE mastery_paths DROP COLUMN explain_lang;
