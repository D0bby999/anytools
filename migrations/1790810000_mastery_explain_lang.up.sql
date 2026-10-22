-- the private design notes phase 4: what a path's model writes for the
-- learner is in their language.
--
-- explain_lang: '' is the learner's interface language, 'source' follows the
-- documents (the old behaviour), anything else is a language code.
ALTER TABLE mastery_paths ADD COLUMN explain_lang text NOT NULL DEFAULT ''
    CONSTRAINT mastery_paths_explain_lang_check
    CHECK (explain_lang IN ('', 'source') OR explain_lang ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$');

-- A point the plan proposed that the knowledge base hardly covers, kept by
-- the learner when they approved it.
ALTER TABLE knowledge_points ADD COLUMN outside_source boolean NOT NULL DEFAULT false;

-- A lesson in Vietnamese and one in English are two cache entries. '' is a
-- lesson written before languages were asked for.
ALTER TABLE kp_explanations ADD COLUMN lang text NOT NULL DEFAULT '';
ALTER TABLE kp_explanations DROP CONSTRAINT kp_explanations_unique;
ALTER TABLE kp_explanations ADD CONSTRAINT kp_explanations_unique UNIQUE (user_id, kp_id, model, variant, lang);
