-- A word list added from the Library (the private design notes, phase 4) is an import like an Anki deck's, recorded with the
-- list it came from: "library:<list>-<level>".
ALTER TABLE vocab_notes DROP CONSTRAINT vocab_notes_origin_check;
ALTER TABLE vocab_notes ADD CONSTRAINT vocab_notes_origin_check
    CHECK (origin IN ('', 'anki') OR origin ~ '^library:[a-z0-9][a-z0-9-]{0,47}$');
