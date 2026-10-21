-- Words from a library list become plain imports again.
UPDATE vocab_notes SET origin = 'anki' WHERE origin LIKE 'library:%';
ALTER TABLE vocab_notes DROP CONSTRAINT vocab_notes_origin_check;
ALTER TABLE vocab_notes ADD CONSTRAINT vocab_notes_origin_check CHECK (origin IN ('', 'anki'));
