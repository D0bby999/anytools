-- The learner profile (plans/260926-2301-learning-depth, phase 9): what the
-- learner studies, where they struggle and how they like to be taught, as
-- short entries they can see, edit and delete.
--
-- Two kinds of author write here. The learner writes entries directly
-- (origin 'learner', status 'accepted'). The nightly consolidation, which is
-- off until the learner turns it on, writes PROPOSALS (origin 'consolidated',
-- status 'proposed') computed from engine aggregates; nothing proposed is
-- ever read into a prompt until the learner accepts it (red team SF-3).

-- ─────────────────────────────────────────────────────────── profile_entries
CREATE TABLE profile_entries (
    id      uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- The list is repeated in Go as profile.Sections(); a test compares them.
    section text NOT NULL CHECK (section IN
                ('studying', 'strengths', 'struggles', 'preferences', 'constraints')),
    text    text NOT NULL CHECK (char_length(btrim(text)) BETWEEN 1 AND 280),

    -- [{"kind": "mistake"|"knowledge_point"|…, "id": "…"}]: the evidence a
    -- consolidated statement cites. The ids have no foreign key, so they are
    -- resolved with the owner's user_id when saved AND when read back
    -- (internal/store/pg/profile.go).
    refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(refs) = 'array'),

    origin text NOT NULL CHECK (origin IN ('learner', 'consolidated')),
    status text NOT NULL DEFAULT 'accepted' CHECK (status IN ('proposed', 'accepted', 'rejected')),

    -- What a proposal would do when accepted: add itself, or update / remove
    -- the entry it replaces. Accepted and learner entries are always 'add'.
    op          text NOT NULL DEFAULT 'add' CHECK (op IN ('add', 'update', 'remove')),
    replaces_id uuid,

    -- The knowledge base an entry is about, when it is about one: Mastery
    -- reads Struggles for its own knowledge base and unscoped ones.
    kb_id uuid,

    -- The run that proposed it; NULL for the learner's own entries.
    run_id uuid,

    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (id),
    UNIQUE (id, user_id),

    -- The learner writes accepted entries only; nothing the learner wrote is
    -- ever a proposal, and nothing proposed is ever the learner's.
    CONSTRAINT profile_entries_learner_accepted CHECK (origin = 'consolidated' OR status = 'accepted'),
    CONSTRAINT profile_entries_op_shape CHECK ((op = 'add') = (replaces_id IS NULL)),
    CONSTRAINT profile_entries_op_proposed CHECK (op = 'add' OR status <> 'accepted'),

    -- A proposal to change an entry goes with that entry.
    CONSTRAINT profile_entries_replaces_same_owner
        FOREIGN KEY (replaces_id, user_id) REFERENCES profile_entries (id, user_id) ON DELETE CASCADE,
    -- An entry about a knowledge base is meaningless once the base is gone.
    CONSTRAINT profile_entries_kb_same_owner
        FOREIGN KEY (kb_id, user_id) REFERENCES knowledge_bases (id, user_id) ON DELETE CASCADE
);

CREATE INDEX profile_entries_user_idx ON profile_entries (user_id, section, status, created_at);

-- ────────────────────────────────────────────────────────────── profile_runs
-- One row per consolidation pass for one learner: the history Settings shows,
-- and the "last run" the job reads to decide whether anything is new.
CREATE TABLE profile_runs (
    id      uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    started_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    -- running → succeeded | skipped | failed. skipped is a night with no new
    -- activity or no model routed: recorded, so the job does not ask again
    -- every hour until morning.
    status text NOT NULL DEFAULT 'running'
           CHECK (status IN ('running', 'succeeded', 'skipped', 'failed')),
    -- [{op, section, text, status: proposed|dropped, reason}] as validated.
    ops   jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(ops) = 'array'),
    error text NOT NULL DEFAULT '' CHECK (length(error) <= 2000),
    model text NOT NULL DEFAULT '',

    PRIMARY KEY (id),
    UNIQUE (id, user_id)
);

CREATE INDEX profile_runs_user_idx ON profile_runs (user_id, started_at DESC);

ALTER TABLE profile_entries
    ADD CONSTRAINT profile_entries_run_same_owner
        FOREIGN KEY (run_id, user_id) REFERENCES profile_runs (id, user_id)
        ON DELETE SET NULL (run_id);

-- ─────────────────────────────────────────────────────────── the opt-in
-- Off by default (owner's decision, 2026-09-27): nothing is consolidated, and
-- no model call is made, until the learner turns it on in Settings.
ALTER TABLE users ADD COLUMN profile_consolidation boolean NOT NULL DEFAULT false;
