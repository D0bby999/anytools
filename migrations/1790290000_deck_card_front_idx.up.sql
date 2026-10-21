-- A deck's cards are looked up by their front, once per card added, to find
-- the deck's duplicates; a large deck's import holds the learner's row while
-- it does. The (deck_id, front) index serves those and every deck_id lookup.
CREATE INDEX vocab_cards_deck_front_idx ON vocab_cards (deck_id, front) WHERE deck_id IS NOT NULL;
DROP INDEX IF EXISTS vocab_cards_deck_idx;
