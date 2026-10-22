-- Words saved from chat become words saved by hand.
UPDATE vocab_notes SET origin = '' WHERE origin = 'chat';
ALTER TABLE vocab_notes DROP CONSTRAINT vocab_notes_origin_check;
ALTER TABLE vocab_notes ADD CONSTRAINT vocab_notes_origin_check
    CHECK (origin IN ('', 'anki', 'sheets') OR origin ~ '^library:[a-z0-9][a-z0-9-]{0,47}$');
