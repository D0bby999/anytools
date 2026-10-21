-- Unknown-word decisions and the production card
-- (the private design notes, phase 3).
--
-- up's vocabulary chapter §3 (docs/en/threads/part-1/2-vocabulary.md): not
-- every unknown word deserves review. Each saved term now carries one of five
-- decisions and that decision's minimum record. Only `learn` owns review
-- cards; the other four are kept with no card at all, or with their cards
-- suspended when the learner moved away from `learn` (never deleted, so
-- learn → skip → learn resumes the same schedule).
--
-- Every note saved before this migration was saved to be reviewed, so it
-- becomes `learn` and keeps its cards untouched.

ALTER TABLE vocab_notes
    ADD COLUMN decision text NOT NULL DEFAULT 'learn',
    -- The decision's minimum record, {field: text}. Its keys are checked per
    -- decision in Go (vocab.CheckRecord); the database only pins the shape.
    ADD COLUMN record jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- up's task impact: blocking / important / minor / none, or not said.
    ADD COLUMN task_impact text NOT NULL DEFAULT '',
    -- When the decision was last set: the learner's week of "learn" choices
    -- (five to eight per cycle) is counted from it.
    ADD COLUMN decided_at timestamptz NOT NULL DEFAULT now(),
    -- The production card's back (chapter §8): the learner's own second
    -- scenario, and one confusable expression with the difference.
    ADD COLUMN scenario   text NOT NULL DEFAULT '',
    ADD COLUMN confusable text NOT NULL DEFAULT '',
    -- The learner asked for a production card ("Practise using it"). It is
    -- what decides whether resuming the note resumes that card too.
    ADD COLUMN production boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT vocab_notes_decision_check
        CHECK (decision IN ('skip', 'infer', 'lookup', 'learn', 'verify')),
    ADD CONSTRAINT vocab_notes_record_check CHECK (jsonb_typeof(record) = 'object'),
    ADD CONSTRAINT vocab_notes_task_impact_check
        CHECK (task_impact IN ('', 'blocking', 'important', 'minor', 'none')),
    ADD CONSTRAINT vocab_notes_scenario_check CHECK (length(scenario) <= 300),
    ADD CONSTRAINT vocab_notes_confusable_check CHECK (length(confusable) <= 200),
    -- A production card is asked for with its scenario.
    ADD CONSTRAINT vocab_notes_production_scenario
        CHECK (NOT production OR length(btrim(scenario)) >= 1);

UPDATE vocab_notes SET decided_at = created_at;

-- The meaning was required of every note. Now only a word to learn or a quick
-- lookup needs one (its current sense); skip, infer and verify may have none.
ALTER TABLE vocab_notes DROP CONSTRAINT vocab_notes_meaning_check;
ALTER TABLE vocab_notes ADD CONSTRAINT vocab_notes_meaning_check CHECK (
    length(btrim(meaning)) <= 1000
    AND (decision NOT IN ('learn', 'lookup') OR length(btrim(meaning)) >= 1));

-- The learner's "learn" choices in a week.
CREATE INDEX vocab_notes_learn_week_idx ON vocab_notes (user_id, decided_at) WHERE decision = 'learn';

-- The production card (chapter §6 and §8): a situational cue → the
-- expression, typed. It is never created with a note; only the learner's
-- POST /v1/vocab/{id}/production does. The full list is restated from
-- 1789870000_books.up.sql.
ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_kind_check;
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_kind_check
    CHECK (kind IN ('recognition', 'cloze', 'flash', 'production'));
