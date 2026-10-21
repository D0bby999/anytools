-- Groundwork shared by the learning-depth phases (the private design notes,
-- phase 0). Everything more than one later phase needs lands here once, so no
-- two parallel branches rewrite the same CHECK.

-- ─────────────────────────────────────────────── evidence kinds, widened once
-- explain_back (phase 2) and card_entry (phase 8) name tables those phases fill
-- out. They exist here as stubs because OwnsTarget has to prove ownership by
-- querying something: a kind with no table would fail closed forever.
CREATE TABLE explain_back_attempts (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, user_id)
);
CREATE INDEX explain_back_attempts_user_idx ON explain_back_attempts (user_id, created_at);

CREATE TABLE card_entries (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, user_id)
);
CREATE INDEX card_entries_user_idx ON card_entries (user_id, created_at);

-- The list is repeated in Go as loop.EvidenceKinds(); a test compares them.
ALTER TABLE evidence_refs DROP CONSTRAINT evidence_refs_kind_check;
ALTER TABLE evidence_refs ADD CONSTRAINT evidence_refs_kind_check CHECK (kind IN
    ('question_attempt', 'kp_state', 'note', 'research_report', 'chat_message',
     'explain_back', 'card_entry'));

-- ─────────────────────────────────────────────────────── the learner's zone
-- "Tomorrow", "02:00" and "due today" are calendar facts, and a calendar needs
-- a zone. The value is an IANA name; Go's time.LoadLocation is the validator
-- (a CHECK cannot consult the zone database). timezone_set_at is NULL until
-- the zone came from the learner or their browser, so the browser's automatic
-- report never overwrites a choice made in Settings.
ALTER TABLE users
    ADD COLUMN timezone text NOT NULL DEFAULT 'UTC'
        CONSTRAINT users_timezone_shape CHECK (timezone ~ '^[A-Za-z][A-Za-z0-9_+/-]{0,63}$'),
    ADD COLUMN timezone_set_at timestamptz;

-- ───────────────────────────────────────────── jobs that resume and cancel
-- progress is the handler's own checkpoint (jobs.RunUnits): which billed units
-- are finished, so a retry resumes instead of paying for them again.
ALTER TABLE jobs
    ADD COLUMN cancel_requested boolean NOT NULL DEFAULT false,
    ADD COLUMN progress jsonb NOT NULL DEFAULT '{}'::jsonb;
