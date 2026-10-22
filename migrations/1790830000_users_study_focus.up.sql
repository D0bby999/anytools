-- the private design notes phase 7: what the learner came to learn,
-- asked on their first visit. NULL is not asked yet, '{}' is skipped; Home
-- lists the parts of AnyLearn that serve it first.
ALTER TABLE users ADD COLUMN study_focus TEXT[]
    CONSTRAINT users_study_focus_check
    CHECK (study_focus <@ ARRAY['languages', 'documents', 'exams', 'research', 'body']::TEXT[]);
