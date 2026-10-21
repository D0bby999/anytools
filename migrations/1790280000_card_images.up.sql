-- A general deck's card may show a picture on its front (a flag, a map):
-- {"src", "source", "licence"}, src a file AnyLearn stages under
-- /tool-runtime/ (never a URL elsewhere), source and licence its credit.
ALTER TABLE vocab_cards ADD COLUMN image jsonb;
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_image_check
    CHECK (image IS NULL OR (kind = 'card' AND jsonb_typeof(image) = 'object'));
