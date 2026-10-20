-- The listening card (plans/261020-1155-open-source-adds, phase 1): a word
-- saved from a video's or a recording's transcript plays that line, and the
-- learner types the word they hear.
--
-- The moment is not stored here. A context names its document and page, and
-- documents.timeline gives that page's [start, end], so a re-transcribed
-- video plays its current timing.
ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_kind_check;
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_kind_check
    CHECK (kind IN ('recognition', 'cloze', 'flash', 'production', 'listen'));

-- The learner asked for a listening card ("Practise hearing it"). It decides
-- whether resuming the note resumes that card too, as production does.
ALTER TABLE vocab_notes ADD COLUMN listening boolean NOT NULL DEFAULT false;
