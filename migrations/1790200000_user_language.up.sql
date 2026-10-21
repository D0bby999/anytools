-- 1790200000_user_language — the language AnyLearn speaks to a learner
-- (the private design notes, phase 2).
--
-- users.language is one of the four the site is written in. language_set_at
-- is NULL until the learner's first sign-in reported a language (the site's
-- choice, then the browser's) or the learner picked one in Settings; like the
-- time zone, the automatic report never overwrites a choice.
ALTER TABLE users
    ADD COLUMN language text NOT NULL DEFAULT 'en'
        CONSTRAINT users_language_known CHECK (language IN ('en', 'vi', 'es', 'pt')),
    ADD COLUMN language_set_at timestamptz;
