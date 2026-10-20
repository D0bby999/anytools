-- The languages a learner studies (plans/261020-1535-beyond-english-learning-areas,
-- phase 1). The Languages page shows one tab per studied language, in the
-- learner's order, and opens on the one viewed last. Words keep their own
-- language (vocab_notes.lang); this list only says which tabs to show, so
-- taking a language off it hides its tab and keeps its words.
--
-- Each code is checked in Go (vocab.ValidLang), as vocab_notes.lang is by its
-- CHECK; an array CHECK cannot use the same pattern per element.
CREATE TABLE vocab_languages (
    user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    studied    text[] NOT NULL DEFAULT '{}' CHECK (cardinality(studied) <= 20),
    current    text NOT NULL DEFAULT '' CHECK (current = '' OR current = ANY (studied)),
    updated_at timestamptz NOT NULL DEFAULT now()
);
