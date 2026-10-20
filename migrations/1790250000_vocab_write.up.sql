-- The writing card (plans/261020-1535-beyond-english-learning-areas, phase 3):
-- a Chinese or Japanese word being learned is drawn stroke by stroke from its
-- meaning and reading, each stroke checked as it is drawn.
ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_kind_check;
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_kind_check
    CHECK (kind IN ('recognition', 'cloze', 'flash', 'production', 'listen', 'write'));

-- The learner asked for a writing card ("Practise writing it"). It decides
-- whether resuming the note resumes that card too, as listening does.
ALTER TABLE vocab_notes ADD COLUMN writing boolean NOT NULL DEFAULT false;
