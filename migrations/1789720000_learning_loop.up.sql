-- 1789720000_learning_loop — the learning loop: a state per goal, a 90-day
-- cycle with three evidence-gated phases, weekly reviews, evidence chains, and
-- the AI task brief / AI learning log pair.
--
-- Seven tables, seven `user_id` columns, and every child points at its parent
-- through a COMPOSITE foreign key on (id, user_id), the same rule the quiz and
-- notebook migrations follow (red-team RT-3): a row belonging to one user is
-- physically incapable of hanging off another user's state.
--
-- Three decisions are load-bearing here.
--
--  1. `evidence_refs` is THE evidence table. A gate reads it and nothing else:
--     a baseline typed into a free-text box is a claim, and a claim is not
--     allowed to open a gate. The row points at something the product already
--     recorded — an attempt, a card, a note, a report, a message — by kind and
--     id. The id cannot carry a foreign key (it names five different tables),
--     so ownership is checked by the application on every write and every
--     read resolves the target WITH the owner's id, which makes a planted
--     foreign id resolve to nothing rather than to someone else's row.
--
--  2. Suggestions live in the same table as accepted evidence, with a status.
--     The nightly job proposes, the person accepts or dismisses, and a dismissed
--     row stays so the job does not propose it again tomorrow. Gates count
--     `accepted` only.
--
--  3. Red-team RT-14: there is no `never_upload` and no enforced data boundary.
--     The product cannot enforce either, so it does not pretend to; document
--     provenance is `documents.processed_by`. `ai_task_briefs.data_boundary_note`
--     is free text a person writes for themselves and nothing reads it as a
--     rule.
--
-- The "arrays" the plan writes as jsonb[] are single jsonb values holding an
-- array, CHECKed to be one. A Postgres array of jsonb cannot be indexed into,
-- patched or validated the way one jsonb array can, and every reader here reads
-- the whole list at once.

-- ──────────────────────────────────────────────────────────── learning_states

-- learning_states — one goal a person is working towards, and everything a
-- fresh collaborator (a human, or a model in a new chat) would need to pick it
-- up: what "done" looks like in twelve weeks, what AI may and may not do, what
-- has been measured, what has been shown to work, and what is only suspected.
CREATE TABLE learning_states (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    goal          text NOT NULL CHECK (length(btrim(goal)) BETWEEN 1 AND 500),
    real_scenario text NOT NULL DEFAULT '' CHECK (length(real_scenario) <= 2000),
    outcome_12w   text NOT NULL DEFAULT '' CHECK (length(outcome_12w) <= 2000),

    -- {"ai_may": ["…"], "human_must_confirm": ["…"]}
    ai_boundaries jsonb NOT NULL DEFAULT '{"ai_may": [], "human_must_confirm": []}'::jsonb
        CHECK (jsonb_typeof(ai_boundaries) = 'object'),
    -- [{"what": "…", "measure": "…", "at": "…"}] — descriptions of what was
    -- measured. They do NOT open a gate; an accepted `baseline` evidence ref does.
    baselines         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(baselines) = 'array'),
    validated_methods jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validated_methods) = 'array'),
    -- [{"claim": …, "next_test": …, "stop_condition": …, "confidence": …, "week": …}]
    -- Weekly-review writeback appends here.
    hypotheses        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(hypotheses) = 'array'),

    -- The note a new chat starts from. Only a validated paste-back or the
    -- person's own edit writes it.
    handover_md text NOT NULL DEFAULT '' CHECK (length(handover_md) <= 20000),

    next_task         text NOT NULL DEFAULT '' CHECK (length(next_task) <= 1000),
    -- The smallest version of next_task that still counts. "I got interrupted"
    -- swaps it in rather than letting the plan lapse.
    next_task_minimum text NOT NULL DEFAULT '' CHECK (length(next_task_minimum) <= 1000),

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT learning_states_id_user_unique UNIQUE (id, user_id)
);

CREATE INDEX learning_states_user_idx ON learning_states (user_id, updated_at DESC);

-- chat_sessions.learning_state_id has existed since phase 6 with nothing
-- behind it. It gains its foreign key here, composite like every other, so a
-- conversation cannot be linked to another person's state; deleting the state
-- unlinks the conversation rather than deleting it.
ALTER TABLE chat_sessions
    ADD CONSTRAINT chat_sessions_learning_state_fk
        FOREIGN KEY (learning_state_id, user_id)
        REFERENCES learning_states (id, user_id) ON DELETE SET NULL (learning_state_id);

CREATE INDEX chat_sessions_learning_state_idx ON chat_sessions (user_id, learning_state_id)
    WHERE learning_state_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────── cycles

-- cycles — ninety days, in three phases. The phase only moves forward, and only
-- through POST /v1/cycles/{id}/advance, which evaluates the gate in Go
-- (internal/learning/loop/gates.go) against evidence_refs and records what it
-- saw in gate_evidence.
CREATE TABLE cycles (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state_id uuid NOT NULL,

    started_at timestamptz NOT NULL DEFAULT now(),
    phase      text NOT NULL DEFAULT 'calibrate' CHECK (phase IN ('calibrate', 'stack', 'deliver')),

    -- [{"from": "calibrate", "to": "stack", "at": …, "ref_ids": [...], "reviews": 2}]
    -- The evidence each advance was granted on, frozen at the moment it was
    -- granted: a later edit to a ref must not rewrite why a gate opened.
    gate_evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(gate_evidence) = 'array'),

    -- Twelve slots at most, one question per week:
    -- [{"question": "…", "capacity": "full" | "reduced" | "minimum"}]
    weekly_questions jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(weekly_questions) = 'array' AND jsonb_array_length(weekly_questions) <= 12),

    -- [{"at": …, "note": "…", "prior_task": "…"}]
    interruptions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(interruptions) = 'array'),

    day90_review_md text NOT NULL DEFAULT '' CHECK (length(day90_review_md) <= 20000),

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT cycles_state_fk FOREIGN KEY (state_id, user_id)
        REFERENCES learning_states (id, user_id) ON DELETE CASCADE,
    CONSTRAINT cycles_id_user_unique UNIQUE (id, user_id)
);

CREATE INDEX cycles_state_idx ON cycles (user_id, state_id, started_at DESC);

-- ─────────────────────────────────────────────────────────── weekly_reviews

-- weekly_reviews — four checks scored 0–2, the mistakes of the week, and the
-- ONE variable to change next week. The scores are NULL until scored: "not yet
-- scored" and "scored zero" are different facts and a default of 0 would erase
-- the difference.
CREATE TABLE weekly_reviews (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cycle_id uuid NOT NULL,

    -- 90 days is twelve weeks and six days; week 13 holds the tail.
    week_no smallint NOT NULL CHECK (week_no BETWEEN 1 AND 13),

    completion smallint CHECK (completion BETWEEN 0 AND 2),
    quality    smallint CHECK (quality BETWEEN 0 AND 2),
    retention  smallint CHECK (retention BETWEEN 0 AND 2),
    transfer   smallint CHECK (transfer BETWEEN 0 AND 2),

    -- [{"evidence": …, "cause": …, "confidence": …, "next_test": …, "stop_condition": …}]
    errors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(errors) = 'array'),

    energy              text NOT NULL DEFAULT '' CHECK (length(energy) <= 1000),
    one_variable_change text NOT NULL DEFAULT '' CHECK (length(one_variable_change) <= 1000),

    -- Set once, by POST /v1/weekly-reviews/{id}/writeback, in the same
    -- transaction that appends to the state. A second writeback would append
    -- the same hypotheses twice.
    writeback_done   boolean NOT NULL DEFAULT false,
    written_back_at  timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT weekly_reviews_cycle_fk FOREIGN KEY (cycle_id, user_id)
        REFERENCES cycles (id, user_id) ON DELETE CASCADE,
    CONSTRAINT weekly_reviews_id_user_unique UNIQUE (id, user_id),
    -- One review per week of a cycle. The suggestion job creates the current
    -- week's row with ON CONFLICT DO NOTHING, which needs this to be a
    -- constraint rather than a convention.
    CONSTRAINT weekly_reviews_cycle_week_unique UNIQUE (cycle_id, week_no)
);

CREATE INDEX weekly_reviews_cycle_idx ON weekly_reviews (user_id, cycle_id, week_no);

-- ────────────────────────────────────────────────────────── evidence_chains

-- evidence_chains — one question ("can I explain X without notes?") followed
-- through four timepoints: baseline, immediately after, days later, and in a
-- different setting. `split` keeps what was observed apart from what it is
-- taken to mean.
CREATE TABLE evidence_chains (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state_id uuid NOT NULL,

    question text NOT NULL CHECK (length(btrim(question)) BETWEEN 1 AND 1000),
    -- {"fact": "…", "interpretation": "…", "hypothesis": "…"}
    split jsonb NOT NULL DEFAULT '{"fact": "", "interpretation": "", "hypothesis": ""}'::jsonb
        CHECK (jsonb_typeof(split) = 'object'),

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT evidence_chains_state_fk FOREIGN KEY (state_id, user_id)
        REFERENCES learning_states (id, user_id) ON DELETE CASCADE,
    CONSTRAINT evidence_chains_id_user_unique UNIQUE (id, user_id)
);

CREATE INDEX evidence_chains_state_idx ON evidence_chains (user_id, state_id, created_at DESC);

-- ──────────────────────────────────────────────────────────── evidence_refs

CREATE TABLE evidence_refs (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    review_id uuid,
    chain_id  uuid,

    timepoint text CHECK (timepoint IN ('baseline', 'immediate', 'delayed', 'transfer')),
    -- The list is repeated in Go as loop.EvidenceKinds(); a test compares them.
    -- `research_report` names phase 9's table, which the suggestion job reads
    -- once that phase is merged (see suggest_job.go).
    kind   text NOT NULL CHECK (kind IN
               ('question_attempt', 'kp_state', 'note', 'research_report', 'chat_message')),
    ref_id uuid NOT NULL,
    note   text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),

    status       text NOT NULL DEFAULT 'accepted' CHECK (status IN ('suggested', 'accepted', 'dismissed')),
    suggested_by text NOT NULL DEFAULT 'user' CHECK (suggested_by IN ('user', 'job')),

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT evidence_refs_review_fk FOREIGN KEY (review_id, user_id)
        REFERENCES weekly_reviews (id, user_id) ON DELETE CASCADE,
    CONSTRAINT evidence_refs_chain_fk FOREIGN KEY (chain_id, user_id)
        REFERENCES evidence_chains (id, user_id) ON DELETE CASCADE,
    -- Evidence about nothing is not evidence.
    CONSTRAINT evidence_refs_has_parent CHECK (review_id IS NOT NULL OR chain_id IS NOT NULL),
    -- A point on a chain is a point IN TIME; a chain ref with no timepoint
    -- would be a column the chain view cannot place.
    CONSTRAINT evidence_refs_chain_has_timepoint CHECK (chain_id IS NULL OR timepoint IS NOT NULL)
);

-- The same thing proposed twice for one review is one proposal. The job relies
-- on this for ON CONFLICT DO NOTHING; so does "accept", which upserts.
CREATE UNIQUE INDEX evidence_refs_review_unique ON evidence_refs (review_id, kind, ref_id)
    WHERE review_id IS NOT NULL AND chain_id IS NULL;
CREATE UNIQUE INDEX evidence_refs_chain_unique ON evidence_refs (chain_id, timepoint, kind, ref_id)
    WHERE chain_id IS NOT NULL;
CREATE INDEX evidence_refs_review_idx ON evidence_refs (user_id, review_id) WHERE review_id IS NOT NULL;
CREATE INDEX evidence_refs_chain_idx ON evidence_refs (user_id, chain_id) WHERE chain_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────── ai_task_briefs

-- ai_task_briefs — written BEFORE handing a task to a model: what the task is,
-- how the output will be judged, what the model may do, where a human must
-- sign off, what it costs to undo, and how to hand it back.
CREATE TABLE ai_task_briefs (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state_id uuid NOT NULL,

    task               text NOT NULL CHECK (length(btrim(task)) BETWEEN 1 AND 2000),
    -- Free text for the author's own use. Not a rule; see the header (RT-14).
    data_boundary_note text NOT NULL DEFAULT '' CHECK (length(data_boundary_note) <= 2000),
    output_eval        text NOT NULL DEFAULT '' CHECK (length(output_eval) <= 2000),
    ai_scope           text NOT NULL DEFAULT '' CHECK (length(ai_scope) <= 2000),
    human_gates        text NOT NULL DEFAULT '' CHECK (length(human_gates) <= 2000),
    cost_reversibility text NOT NULL DEFAULT '' CHECK (length(cost_reversibility) <= 2000),
    failure_rollback   text NOT NULL DEFAULT '' CHECK (length(failure_rollback) <= 2000),
    handover           text NOT NULL DEFAULT '' CHECK (length(handover) <= 4000),
    -- {"<check key>": true|false}
    pre_start_check    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(pre_start_check) = 'object'),

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ai_task_briefs_state_fk FOREIGN KEY (state_id, user_id)
        REFERENCES learning_states (id, user_id) ON DELETE CASCADE,
    CONSTRAINT ai_task_briefs_id_user_unique UNIQUE (id, user_id)
);

CREATE INDEX ai_task_briefs_state_idx ON ai_task_briefs (user_id, state_id, created_at DESC);

-- ──────────────────────────────────────────────────────────── ai_learning_logs

-- ai_learning_logs — the three-way comparison: the task done without AI, with
-- AI, and again alone some days later. The third column is the one that says
-- whether anything was learned or only delegated.
--
-- Each of the three is {"<metric>": {"value": number|null, "note": "…"}};
-- `metrics` says how each metric is measured: {"<metric>": "…"}. The metric
-- keys are fixed in Go (loop.LogMetrics()).
CREATE TABLE ai_learning_logs (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brief_id uuid NOT NULL,

    baseline_noai       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(baseline_noai) = 'object'),
    assisted            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(assisted) = 'object'),
    delayed_independent jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(delayed_independent) = 'object'),
    metrics             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metrics) = 'object'),

    next_cycle_decision text NOT NULL DEFAULT '' CHECK (length(next_cycle_decision) <= 2000),

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ai_learning_logs_brief_fk FOREIGN KEY (brief_id, user_id)
        REFERENCES ai_task_briefs (id, user_id) ON DELETE CASCADE,
    CONSTRAINT ai_learning_logs_id_user_unique UNIQUE (id, user_id)
);

CREATE INDEX ai_learning_logs_brief_idx ON ai_learning_logs (user_id, brief_id, created_at DESC);
