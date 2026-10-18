-- Production cards go first: the narrower kind CHECK would refuse them.
DELETE FROM vocab_cards WHERE kind = 'production';
ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_kind_check;
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_kind_check
    CHECK (kind IN ('recognition', 'cloze', 'flash'));

DROP INDEX IF EXISTS vocab_notes_learn_week_idx;

-- The old CHECK required a meaning of every note. A note saved without one
-- (skip, infer, verify) is kept, with its term standing in for the meaning,
-- rather than deleted.
ALTER TABLE vocab_notes DROP CONSTRAINT vocab_notes_meaning_check;
UPDATE vocab_notes SET meaning = term WHERE length(btrim(meaning)) = 0;
ALTER TABLE vocab_notes ADD CONSTRAINT vocab_notes_meaning_check
    CHECK (length(btrim(meaning)) BETWEEN 1 AND 1000);

ALTER TABLE vocab_notes
    DROP CONSTRAINT vocab_notes_production_scenario,
    DROP CONSTRAINT vocab_notes_confusable_check,
    DROP CONSTRAINT vocab_notes_scenario_check,
    DROP CONSTRAINT vocab_notes_task_impact_check,
    DROP CONSTRAINT vocab_notes_record_check,
    DROP CONSTRAINT vocab_notes_decision_check,
    DROP COLUMN production,
    DROP COLUMN confusable,
    DROP COLUMN scenario,
    DROP COLUMN decided_at,
    DROP COLUMN task_impact,
    DROP COLUMN record,
    DROP COLUMN decision;
