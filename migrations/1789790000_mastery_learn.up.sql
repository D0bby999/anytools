-- Mastery: learn, then explain it back (the private design notes,
-- phase 2). A session teaches a knowledge point from the learner's own
-- documents before testing it, and concept and design points need a passed
-- explain-back (the Feynman check) before their module graduates.

-- ───────────────────────────────────────────── cached explanations
-- One row per (point, model, variant). Variant 0 is the explanation a session
-- shows unasked; "Explain it differently" writes variant 1, 2, … . The
-- versions of every document it cites are stored beside it, so a re-parse or
-- a re-sync marks the cache stale rather than leaving it quoting text the
-- document no longer holds (red team SF-13).
CREATE TABLE kp_explanations (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kp_id   uuid NOT NULL,
    model   text NOT NULL,
    variant integer NOT NULL DEFAULT 0 CHECK (variant >= 0 AND variant < 5),
    body_md text NOT NULL CHECK (body_md <> ''),
    -- citations.Source[] the body's markers resolve to.
    sources jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- [{"document_id": "…", "version": 3}] as they stood when this was written.
    source_versions jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT kp_explanations_kp_fk FOREIGN KEY (kp_id, user_id)
        REFERENCES knowledge_points (id, user_id) ON DELETE CASCADE,
    CONSTRAINT kp_explanations_unique UNIQUE (user_id, kp_id, model, variant)
);

-- ───────────────────────────────────────────── explain-back attempts
-- The groundwork migration created this table as a stub (id, user_id,
-- created_at) so the evidence kind could prove ownership. Nothing writes a
-- stub row, so the NOT NULL columns below need no defaults; a database that
-- somehow holds one fails here loudly instead of carrying an attempt with no
-- knowledge point.
--
-- verdict is written in two steps: the row is reserved as 'pending' under the
-- request's idempotency key BEFORE the model call, so a double-submit waits
-- for the first judgement instead of paying for a second. 'unjudged' is a
-- reply that could not be read: not a pass, and no change to the schedule.
ALTER TABLE explain_back_attempts
    ADD COLUMN kp_id          uuid NOT NULL,
    ADD COLUMN path_id        uuid NOT NULL,
    ADD COLUMN request_id     uuid NOT NULL,
    ADD COLUMN explanation    text NOT NULL CHECK (char_length(explanation) BETWEEN 20 AND 4000),
    ADD COLUMN verdict        text NOT NULL DEFAULT 'pending'
        CHECK (verdict IN ('pending', 'passed', 'failed', 'unjudged')),
    ADD COLUMN passed         boolean GENERATED ALWAYS AS (verdict = 'passed') STORED,
    ADD COLUMN gaps           jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN misconceptions jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN feedback       text NOT NULL DEFAULT '',
    ADD COLUMN sources        jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN model          text NOT NULL DEFAULT '',
    -- The learner's own verdict ("I think this was judged wrongly"). NULL
    -- until they override; the judge's verdict above is never rewritten, so
    -- an override is always shown as the learner's, not as a system pass.
    ADD COLUMN override_passed boolean,
    ADD COLUMN overridden_at  timestamptz,
    -- The knowledge point's kp_state before this attempt rated it, for
    -- override replay (the same shape as question_attempts.kp_before).
    ADD COLUMN kp_before      jsonb,
    ADD COLUMN judged_at      timestamptz,
    ADD CONSTRAINT explain_back_attempts_kp_fk FOREIGN KEY (kp_id, user_id)
        REFERENCES knowledge_points (id, user_id) ON DELETE CASCADE,
    ADD CONSTRAINT explain_back_attempts_path_fk FOREIGN KEY (path_id, user_id)
        REFERENCES mastery_paths (id, user_id) ON DELETE CASCADE,
    ADD CONSTRAINT explain_back_attempts_request_unique UNIQUE (user_id, request_id),
    ADD CONSTRAINT explain_back_attempts_override_shape
        CHECK ((override_passed IS NULL) = (overridden_at IS NULL));

CREATE INDEX explain_back_attempts_kp_idx ON explain_back_attempts (user_id, kp_id, created_at);

-- ───────────────────────────────────────────── the gate
-- When the point's explain-back was (last) passed; NULL until then.
ALTER TABLE kp_state ADD COLUMN explain_passed_at timestamptz;

-- The gate binds only paths created from now on (owner's decision,
-- 2026-09-27): existing rows get false, so a learner one answer from
-- graduating an older path does not regress on the day this ships. The
-- default then flips to true, so every path created after this migration is
-- gated without the path service having to remember to ask.
ALTER TABLE mastery_paths ADD COLUMN explain_gate boolean NOT NULL DEFAULT false;
ALTER TABLE mastery_paths ALTER COLUMN explain_gate SET DEFAULT true;
