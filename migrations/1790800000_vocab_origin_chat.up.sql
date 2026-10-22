-- the private design notes phase 3: a mistake corrected in chat is
-- saved as a word to learn, with no document behind it, and says where it
-- came from. It is due at once, not paced like an import.
ALTER TABLE vocab_notes DROP CONSTRAINT vocab_notes_origin_check;
ALTER TABLE vocab_notes ADD CONSTRAINT vocab_notes_origin_check
    CHECK (origin IN ('', 'anki', 'sheets', 'chat') OR origin ~ '^library:[a-z0-9][a-z0-9-]{0,47}$');
