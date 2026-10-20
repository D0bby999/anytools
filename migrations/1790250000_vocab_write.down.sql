-- Writing cards go first: the narrower kind CHECK would refuse them.
DELETE FROM vocab_cards WHERE kind = 'write';
ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_kind_check;
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_kind_check
    CHECK (kind IN ('recognition', 'cloze', 'flash', 'production', 'listen'));

ALTER TABLE vocab_notes DROP COLUMN writing;
