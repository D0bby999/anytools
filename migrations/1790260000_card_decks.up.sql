-- General decks (plans/261020-1535-beyond-english-learning-areas, phase 5;
-- owner decision 5): a deck that is not vocabulary (countries and capitals,
-- a programming deck) brought in from the library or an Anki file. Its cards
-- have a front and a back and no note, like a living book's flash cards, and
-- are reviewed in their own queue, counted in Home's total and the reminder.
CREATE TABLE card_decks (
    id         uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    -- Where it came from: a library deck's id (library:<slug>) or a file's name.
    source     text NOT NULL DEFAULT '' CHECK (length(source) <= 500),
    -- The licence as the library or the learner gave it, and its link.
    licence    text NOT NULL DEFAULT '' CHECK (length(licence) <= 200),
    source_url text NOT NULL DEFAULT '' CHECK (length(source_url) <= 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    CONSTRAINT card_decks_id_user_unique UNIQUE (id, user_id)
);
CREATE INDEX card_decks_user_idx ON card_decks (user_id, created_at);

ALTER TABLE vocab_cards ADD COLUMN deck_id uuid;
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_deck_same_owner
    FOREIGN KEY (deck_id, user_id) REFERENCES card_decks (id, user_id) ON DELETE CASCADE;
CREATE INDEX vocab_cards_deck_idx ON vocab_cards (deck_id) WHERE deck_id IS NOT NULL;

ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_kind_check;
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_kind_check
    CHECK (kind IN ('recognition', 'cloze', 'flash', 'production', 'listen', 'write', 'card'));

-- A book's flash card and a deck's card have no note; every other card has one.
ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_flash_has_no_note;
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_flash_has_no_note
    CHECK ((kind IN ('flash', 'card')) = (note_id IS NULL));
-- Each carries its own two faces and its owner: a block, or a deck. A deck's
-- faces are longer than a book's: a card from a deck may carry a paragraph.
ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_flash_fields;
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_flash_fields CHECK (
    CASE WHEN kind = 'flash'
         THEN book_block_id IS NOT NULL AND deck_id IS NULL AND front IS NOT NULL AND back IS NOT NULL
              AND length(btrim(front)) BETWEEN 1 AND 300
              AND length(btrim(back)) BETWEEN 1 AND 1000
         WHEN kind = 'card'
         THEN deck_id IS NOT NULL AND book_block_id IS NULL AND front IS NOT NULL AND back IS NOT NULL
              AND length(btrim(front)) BETWEEN 1 AND 500
              AND length(btrim(back)) BETWEEN 1 AND 2000
         ELSE book_block_id IS NULL AND deck_id IS NULL AND front IS NULL AND back IS NULL
    END);
