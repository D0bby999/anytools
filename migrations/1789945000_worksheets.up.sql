-- 1789945000_worksheets — up's worksheets (the private design notes,
-- phase 0): a page of headed sections of fields and tables, whose kind is Go
-- data (internal/learning/worksheet). The engine validates every answer
-- against its kind before it is stored; the database holds the shape.
--
-- private is copied from the kind on insert and never updated, so SQL can
-- keep private worksheets out of every evidence query (red team SF-1): Go's
-- flag is invisible to a WHERE clause.

CREATE TABLE worksheets (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{0,47}$'),
    kind_version int  NOT NULL CHECK (kind_version >= 1),
    title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    -- section → field → value; bounded by the engine at 200 KB.
    answers      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
    state_id     uuid,
    document_id  uuid,
    status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    private      boolean NOT NULL,
    -- review key → {due, earliest, done}; due and earliest are the learner's
    -- local dates, computed in Go (learning.LocalDay).
    reviews      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(reviews) = 'object'),
    -- section → when it was last written: a PATCH carrying an older revision
    -- for a section is refused instead of overwriting it.
    section_revs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(section_revs) = 'object'),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT worksheets_id_user_unique UNIQUE (id, user_id),
    -- Deleting a learning state keeps its worksheets, unattached.
    CONSTRAINT worksheets_state_owner FOREIGN KEY (state_id, user_id)
        REFERENCES learning_states (id, user_id) ON DELETE SET NULL (state_id),
    -- A worksheet on a document is part of it, and goes with it.
    CONSTRAINT worksheets_document_owner FOREIGN KEY (document_id, user_id)
        REFERENCES documents (id, user_id) ON DELETE CASCADE
);

CREATE INDEX worksheets_user_kind_idx ON worksheets (user_id, kind, updated_at DESC);
CREATE INDEX worksheets_state_idx ON worksheets (state_id) WHERE state_id IS NOT NULL;
CREATE INDEX worksheets_document_idx ON worksheets (document_id) WHERE document_id IS NOT NULL;

-- A non-private worksheet is evidence. The full list is restated from
-- 1789775000_groundwork; loop.EvidenceKinds() repeats it and a test compares.
ALTER TABLE evidence_refs DROP CONSTRAINT evidence_refs_kind_check;
ALTER TABLE evidence_refs ADD CONSTRAINT evidence_refs_kind_check CHECK (kind IN
    ('question_attempt', 'kp_state', 'note', 'research_report', 'chat_message',
     'explain_back', 'card_entry', 'worksheet'));
