-- 1790020000_worksheet_diagnoses — the writing evidence card's per-pass
-- diagnoses (plans/260930-0915-up-methods, phase 4). A model diagnoses one
-- of up's five revision passes on the learner's unaided draft; it never
-- rewrites it.
--
-- Diagnoses live here and not in worksheets.answers (red team SF-3/AS-3): the
-- server never writes into the learner's fields, a diagnosis cannot overwrite
-- a draft being edited at the same moment, and it never counts against the
-- answers' 200 KB bound.
--
-- One diagnosis per pass and draft: the draft's sha256 is part of the key, so
-- asking again for the same draft returns the stored one, and editing the
-- draft makes room for a new one.

CREATE TABLE worksheet_diagnoses (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    worksheet_id uuid NOT NULL,
    pass         smallint NOT NULL CHECK (pass BETWEEN 1 AND 5),
    draft_sha256 text NOT NULL CHECK (draft_sha256 ~ '^[0-9a-f]{64}$'),
    -- At most three issues, validated by the engine before it is stored
    -- (writingdiag.Validate).
    issues       jsonb NOT NULL CHECK (jsonb_typeof(issues) = 'array' AND jsonb_array_length(issues) <= 3),
    model        text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT worksheet_diagnoses_worksheet_owner FOREIGN KEY (worksheet_id, user_id)
        REFERENCES worksheets (id, user_id) ON DELETE CASCADE,
    CONSTRAINT worksheet_diagnoses_one_per_draft UNIQUE (worksheet_id, pass, draft_sha256)
);

CREATE INDEX worksheet_diagnoses_user_idx ON worksheet_diagnoses (user_id);
