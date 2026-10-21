CREATE INDEX IF NOT EXISTS vocab_cards_deck_idx ON vocab_cards (deck_id) WHERE deck_id IS NOT NULL;
DROP INDEX IF EXISTS vocab_cards_deck_front_idx;
