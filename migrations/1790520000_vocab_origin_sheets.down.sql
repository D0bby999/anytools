-- Words from a Google Sheet become plain imports again.
UPDATE vocab_notes SET origin = 'anki' WHERE origin = 'sheets';
ALTER TABLE vocab_notes DROP CONSTRAINT vocab_notes_origin_check;
ALTER TABLE vocab_notes ADD CONSTRAINT vocab_notes_origin_check
    CHECK (origin IN ('', 'anki') OR origin ~ '^library:[a-z0-9][a-z0-9-]{0,47}$');
