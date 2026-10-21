-- learning-tool-connections phase 5: words imported from a Google Sheet are
-- paced like any import, and say where they came from.
ALTER TABLE vocab_notes DROP CONSTRAINT vocab_notes_origin_check;
ALTER TABLE vocab_notes ADD CONSTRAINT vocab_notes_origin_check
    CHECK (origin IN ('', 'anki', 'sheets') OR origin ~ '^library:[a-z0-9][a-z0-9-]{0,47}$');
