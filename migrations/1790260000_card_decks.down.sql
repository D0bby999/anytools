-- Deck cards go first: the narrower CHECKs would refuse them.
DELETE FROM vocab_cards WHERE kind = 'card';
ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_flash_fields;
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_flash_fields CHECK (
    CASE WHEN kind = 'flash'
         THEN book_block_id IS NOT NULL AND front IS NOT NULL AND back IS NOT NULL
              AND length(btrim(front)) BETWEEN 1 AND 300
              AND length(btrim(back)) BETWEEN 1 AND 1000
         ELSE book_block_id IS NULL AND front IS NULL AND back IS NULL
    END);
ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_flash_has_no_note;
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_flash_has_no_note
    CHECK ((kind = 'flash') = (note_id IS NULL));
ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_kind_check;
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_kind_check
    CHECK (kind IN ('recognition', 'cloze', 'flash', 'production', 'listen', 'write'));
DROP INDEX vocab_cards_deck_idx;
ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_deck_same_owner;
ALTER TABLE vocab_cards DROP COLUMN deck_id;
DROP TABLE card_decks;
