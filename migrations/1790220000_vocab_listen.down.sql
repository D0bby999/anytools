-- Listening cards go first: the narrower kind CHECK would refuse them.
DELETE FROM vocab_cards WHERE kind = 'listen';
ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_kind_check;
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_kind_check
    CHECK (kind IN ('recognition', 'cloze', 'flash', 'production'));

ALTER TABLE vocab_notes DROP COLUMN listening;
