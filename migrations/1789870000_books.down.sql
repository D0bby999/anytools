-- Flash cards exist only for books; they go first, so note_id can be NOT NULL
-- again.
DELETE FROM vocab_cards WHERE kind = 'flash';

DROP INDEX IF EXISTS vocab_cards_block_idx;
ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_block_same_owner;
ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_flash_fields;
ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_flash_has_no_note;
ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_kind_check;
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_kind_check CHECK (kind IN ('recognition', 'cloze'));
ALTER TABLE vocab_cards
    DROP COLUMN book_block_id,
    DROP COLUMN back,
    DROP COLUMN front;
ALTER TABLE vocab_cards ALTER COLUMN note_id SET NOT NULL;

DROP TABLE book_blocks;
DROP TABLE book_chapters;
DROP TABLE books;
