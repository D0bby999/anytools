-- 1790840000_mastery_paths_keep_source — paths made before explanations
-- followed the learner's language keep the documents' language
-- (owner, 2026-10-22; the private design notes M1).
--
-- 1790810000 gave every path explain_lang '' (the learner's interface
-- language), so a course already under way changed language midway and its
-- lessons were written again on the learner's own key. 'source' is what those
-- paths did before, and it reads the lessons already cached (lang ''). Only
-- paths made before that deploy reached production (09:27:51 UTC) and still
-- on the default are changed; the learner can pick another language on the
-- path's page.

UPDATE mastery_paths
   SET explain_lang = 'source'
 WHERE explain_lang = ''
   AND created_at < '2026-10-22 09:27:51+00';
