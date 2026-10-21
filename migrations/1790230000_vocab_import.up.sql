-- Anki decks in (the private design notes, phase 3). A note
-- imported from a deck is a word to learn the learner did not choose this
-- week, one at a time, so it is marked: up's "five to eight a week" counts
-- only the words chosen while reading, and an import's pace follows the
-- imports before it.
ALTER TABLE vocab_notes
    ADD COLUMN origin text NOT NULL DEFAULT '',
    ADD CONSTRAINT vocab_notes_origin_check CHECK (origin IN ('', 'anki'));
