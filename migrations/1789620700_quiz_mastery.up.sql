-- 1789620700_quiz_mastery — the question bank, the mastery path, and the
-- FSRS-6 card that decides when a knowledge point comes back.
--
-- Three red-team findings are load-bearing in this file and are the reason it
-- is shaped the way it is rather than the way DeepTutor's models.py is:
--
--  RT-8 / Scope 2 — `questions` and `question_attempts` in the earlier draft
--  carried no knowledge-point or module linkage, which makes module mastery and
--  per-KP scheduling uncomputable: you can tell that an answer was wrong and
--  nothing about what the learner does not know. Both tables carry
--  knowledge_point_id and module_id, and the attempt DENORMALIZES module_id at
--  write time rather than joining through the knowledge point, so that moving a
--  knowledge point between modules later cannot rewrite the history of which
--  module a past attempt was evidence about.
--
--  RT-8 — `ErrorRecord` had been folded away into a column on the attempt. It
--  is a table, because it has a LIFECYCLE (active → retrying → review →
--  graduated) that outlives the attempt that opened it, and because
--  retry_history is a list of later attempts against the same mistake.
--
--  RT-12 / Assumption 9 — due dates are computed ON READ (`due_at <= now()`),
--  never materialized by a nightly job. FSRS-6's relearning step is 10 MINUTES:
--  a nightly materializer with a 24-hour window cannot see a card that fails at
--  09:00 and is due again at 09:10, which is exactly the same-day relearning AC4
--  requires. `due_at` is a copy of the card's own Due, written in the same
--  statement as fsrs_card so the two cannot disagree, and it is indexed because
--  every session read filters on it.
--
-- And the rule that governs every table here: every one carries `user_id`, and
-- every child points at its parent through a COMPOSITE foreign key
-- `(parent_id, user_id)`, so a row belonging to one user is physically
-- incapable of referencing another user's parent (RT-3). The composite targets
-- need a UNIQUE (id, user_id) on each parent; those are declared inline below.

-- chat_sessions gains the composite target its children need. It is additive
-- and redundant with the primary key on its own; it exists so `questions`
-- cannot name a session belonging to someone else. Phase 6 owns the table, so
-- this is a constraint added beside it rather than an edit to its migration.
ALTER TABLE chat_sessions
    ADD CONSTRAINT chat_sessions_id_user_unique UNIQUE (id, user_id);

-- ────────────────────────────────────────────────────────── mastery_paths

-- mastery_paths — one goal a learner is working towards inside one knowledge
-- base. The modules underneath it are PROPOSED by a model and then approved or
-- edited by the person; a path with no modules is a proposal the user has not
-- accepted yet, which is a real and visible state rather than a broken row.
CREATE TABLE mastery_paths (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kb_id   uuid NOT NULL,

    goal   text NOT NULL CHECK (length(btrim(goal)) BETWEEN 1 AND 500),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT mastery_paths_kb_fk FOREIGN KEY (kb_id, user_id)
        REFERENCES knowledge_bases (id, user_id) ON DELETE CASCADE,
    CONSTRAINT mastery_paths_id_user_unique UNIQUE (id, user_id)
);

CREATE INDEX mastery_paths_user_idx ON mastery_paths (user_id, created_at DESC);

-- ──────────────────────────────────────────────────────── mastery_modules

-- mastery_modules — the ordered stages of a path. pass_threshold defaults to
-- 0.7, DeepTutor's value (models.py:89), and is per-module because a module of
-- pure recall and a module of design judgement are not the same bar.
CREATE TABLE mastery_modules (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path_id uuid NOT NULL,

    ord            integer NOT NULL CHECK (ord >= 0),
    name           text    NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    objective      text    NOT NULL DEFAULT '',
    pass_threshold real    NOT NULL DEFAULT 0.7 CHECK (pass_threshold > 0 AND pass_threshold <= 1),

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT mastery_modules_path_fk FOREIGN KEY (path_id, user_id)
        REFERENCES mastery_paths (id, user_id) ON DELETE CASCADE,
    CONSTRAINT mastery_modules_id_user_unique UNIQUE (id, user_id),
    -- Two modules at the same position in one path is an ordering nobody can
    -- render deterministically.
    CONSTRAINT mastery_modules_path_ord_unique UNIQUE (path_id, ord)
);

CREATE INDEX mastery_modules_path_idx ON mastery_modules (user_id, path_id, ord);

-- ──────────────────────────────────────────────────────── knowledge_points

-- knowledge_points — the atoms a card is scheduled against. `type` is
-- DeepTutor's KnowledgeType (models.py:24) and survives the port because the
-- SELECTION order uses it: a forgotten fact and a piece of design judgement do
-- not deserve the same urgency when several things are due at once
-- (scheduler.py:20).
CREATE TABLE knowledge_points (
    id        uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module_id uuid NOT NULL,

    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 300),
    type text NOT NULL DEFAULT 'concept'
              CHECK (type IN ('memory', 'concept', 'procedure', 'design')),

    created_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (id),
    CONSTRAINT knowledge_points_module_fk FOREIGN KEY (module_id, user_id)
        REFERENCES mastery_modules (id, user_id) ON DELETE CASCADE,
    CONSTRAINT knowledge_points_id_user_unique UNIQUE (id, user_id)
);

CREATE INDEX knowledge_points_module_idx ON knowledge_points (user_id, module_id);

-- ─────────────────────────────────────────────────────────────── kp_state

-- kp_state — one FSRS-6 card per knowledge point, plus the derived numbers the
-- session surface reads.
--
-- fsrs_card is the library's own Card serialized whole (go-fsrs/v4 Card has
-- json tags). Storing the struct rather than exploded columns is deliberate:
-- FSRS-6 carries 21 weights and a card shape that the library owns, and a
-- schema that mirrors it becomes wrong the first time the library adds a field.
-- What this table DOES own is `due_at`, copied out of the card on every write,
-- because that is the column queries filter and sort on and a jsonb extraction
-- in a WHERE clause is not indexable the way this needs to be.
CREATE TABLE kp_state (
    kp_id   uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    fsrs_card jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- A copy of fsrs_card->>'Due'. Written in the same UPDATE as fsrs_card, so
    -- the two cannot drift; see internal/store/pg/mastery.go.
    due_at timestamptz NOT NULL,

    -- 0..1, the running estimate the module-mastery roll-up averages.
    mastery_estimate real NOT NULL DEFAULT 0 CHECK (mastery_estimate >= 0 AND mastery_estimate <= 1),

    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'graduated')),

    reviews    integer NOT NULL DEFAULT 0 CHECK (reviews >= 0),
    lapses     integer NOT NULL DEFAULT 0 CHECK (lapses >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT kp_state_kp_fk FOREIGN KEY (kp_id, user_id)
        REFERENCES knowledge_points (id, user_id) ON DELETE CASCADE
);

-- THE index of this migration. Every session read and the Due widget are
-- `WHERE user_id = $1 AND status = 'active' AND due_at <= now() ORDER BY due_at`,
-- which is this index exactly.
CREATE INDEX kp_state_due_idx ON kp_state (user_id, due_at) WHERE status = 'active';

-- ────────────────────────────────────────────────────────────── questions

-- questions — the bank. A question generated for a mastery path carries its
-- knowledge point and module; one generated straight from a knowledge base
-- carries neither, and both are the same row type so the bank screen can show
-- everything a person has ever been asked in one list.
CREATE TABLE questions (
    id      uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kb_id   uuid NOT NULL,

    -- The chat session a question was generated from, when it was. Nullable and
    -- ON DELETE SET NULL: deleting a conversation must not delete the questions
    -- it produced, which are study material in their own right.
    session_id uuid,

    knowledge_point_id uuid,
    module_id          uuid,

    prompt      text NOT NULL CHECK (length(btrim(prompt)) BETWEEN 1 AND 4000),
    type        text NOT NULL CHECK (type IN ('mcq', 'short', 'tf', 'cloze')),
    -- [{"label":"A","body":"…"}, …] for mcq, [] otherwise.
    options     jsonb NOT NULL DEFAULT '[]'::jsonb,
    answer      text  NOT NULL,
    explanation text  NOT NULL DEFAULT '',
    difficulty  text  NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),

    -- The chunks the generator was shown. These are what `[[cite:chunk:<id>]]`
    -- markers in the explanation are validated against, and what lets the bank
    -- link a question back to the page it came from.
    source_chunk_ids uuid[] NOT NULL DEFAULT '{}',

    created_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (id),
    CONSTRAINT questions_kb_fk FOREIGN KEY (kb_id, user_id)
        REFERENCES knowledge_bases (id, user_id) ON DELETE CASCADE,
    CONSTRAINT questions_session_fk FOREIGN KEY (session_id, user_id)
        REFERENCES chat_sessions (id, user_id) ON DELETE SET NULL,
    CONSTRAINT questions_kp_fk FOREIGN KEY (knowledge_point_id, user_id)
        REFERENCES knowledge_points (id, user_id) ON DELETE SET NULL,
    CONSTRAINT questions_module_fk FOREIGN KEY (module_id, user_id)
        REFERENCES mastery_modules (id, user_id) ON DELETE SET NULL,
    CONSTRAINT questions_id_user_unique UNIQUE (id, user_id),
    -- An mcq with no options is a question nothing can render or grade.
    CONSTRAINT questions_mcq_has_options
        CHECK (type <> 'mcq' OR jsonb_array_length(options) >= 2)
);

CREATE INDEX questions_user_kb_idx ON questions (user_id, kb_id, created_at DESC);
CREATE INDEX questions_kp_idx ON questions (user_id, knowledge_point_id) WHERE knowledge_point_id IS NOT NULL;

-- ─────────────────────────────────────────────────────── question_attempts

-- question_attempts — one answer, one judgement, one FSRS rating.
--
-- knowledge_point_id and module_id are copied from the question AT WRITE TIME
-- (RT-8). They are not a join: a knowledge point that is later moved to a
-- different module, or detached from a retired question, must not silently
-- rewrite what past attempts were evidence about.
CREATE TABLE question_attempts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id uuid NOT NULL,

    knowledge_point_id uuid,
    module_id          uuid,

    user_answer text    NOT NULL DEFAULT '',
    is_correct  boolean NOT NULL,

    -- The judge's own record: {"verdict":…,"reason":…,"rubric":[…],"model":…}
    -- for an LLM-judged answer, {"mode":"exact"} for mcq/tf. Kept so that a
    -- disputed verdict can be read back rather than re-litigated from memory.
    judge jsonb NOT NULL DEFAULT '{}'::jsonb,

    error_type       text NOT NULL DEFAULT '' CHECK (error_type IN
                          ('', 'concept', 'recall', 'application', 'careless', 'misread', 'unknown')),
    -- The learner's own account of the attempt, and the place a user's OVERRIDE
    -- of the judge is recorded ('disputed'). Deliberately the same column for
    -- both: "why I got this wrong" and "the grader is wrong" are the same act —
    -- the person telling the system something it could not see.
    self_attribution text NOT NULL DEFAULT '' CHECK (self_attribution IN
                          ('', 'confident', 'guessed', 'careless', 'misread', 'knowledge_gap', 'disputed')),

    rating text NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),

    -- Set when a later override replaced this attempt's verdict, so the bank can
    -- show what was originally judged as well as what the person said.
    overridden_at timestamptz,

    -- The knowledge point's kp_state row as it was BEFORE this attempt advanced
    -- it (NULL when the question has no knowledge point; {"fresh": true} when
    -- the attempt created the row). An override restores this and replays the
    -- corrected verdict, so the card is scheduled as if the judge had been right
    -- the first time — instead of stepping a second time on top of the lapse.
    kp_before jsonb,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT question_attempts_question_fk FOREIGN KEY (question_id, user_id)
        REFERENCES questions (id, user_id) ON DELETE CASCADE,
    CONSTRAINT question_attempts_kp_fk FOREIGN KEY (knowledge_point_id, user_id)
        REFERENCES knowledge_points (id, user_id) ON DELETE SET NULL,
    CONSTRAINT question_attempts_module_fk FOREIGN KEY (module_id, user_id)
        REFERENCES mastery_modules (id, user_id) ON DELETE SET NULL
);

CREATE INDEX question_attempts_question_idx ON question_attempts (user_id, question_id, created_at DESC);
CREATE INDEX question_attempts_kp_idx ON question_attempts (user_id, knowledge_point_id, created_at DESC)
    WHERE knowledge_point_id IS NOT NULL;
CREATE INDEX question_attempts_module_idx ON question_attempts (user_id, module_id, created_at DESC)
    WHERE module_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────── error_records

-- error_records — DeepTutor's ErrorRecord (models.py:136), kept as a table.
--
-- It is not a column on the attempt because a mistake has a life of its own: it
-- opens when an answer is wrong, accumulates the retries aimed at it, moves to
-- `review`, and graduates. Folded into the attempt, "have I fixed this yet?"
-- becomes a query over attempt history with no place to record the answer.
CREATE TABLE error_records (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id uuid NOT NULL,
    kp_id       uuid,
    module_id   uuid,

    error_type       text NOT NULL DEFAULT 'unknown' CHECK (error_type IN
                          ('concept', 'recall', 'application', 'careless', 'misread', 'unknown')),
    self_attribution text NOT NULL DEFAULT '',
    -- What the model said about the learner's self-attribution: agreement,
    -- disagreement, or '' when nothing was asked.
    ai_confirmation  text NOT NULL DEFAULT '',

    -- [{"attempt_id":…,"at":…,"is_correct":…}] — the retries aimed at this
    -- mistake, appended in order.
    retry_history jsonb NOT NULL DEFAULT '[]'::jsonb,

    status text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'retrying', 'review', 'graduated')),

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT error_records_question_fk FOREIGN KEY (question_id, user_id)
        REFERENCES questions (id, user_id) ON DELETE CASCADE,
    CONSTRAINT error_records_kp_fk FOREIGN KEY (kp_id, user_id)
        REFERENCES knowledge_points (id, user_id) ON DELETE CASCADE,
    CONSTRAINT error_records_module_fk FOREIGN KEY (module_id, user_id)
        REFERENCES mastery_modules (id, user_id) ON DELETE SET NULL
);

CREATE INDEX error_records_kp_idx ON error_records (user_id, kp_id, status);
-- At most ONE open record per (knowledge point, question): a second wrong answer
-- to the same question appends to the retry history rather than opening a
-- parallel mistake that graduates independently.
CREATE UNIQUE INDEX error_records_open_unique
    ON error_records (user_id, question_id, kp_id)
    WHERE status <> 'graduated';

-- ─────────────────────────────────────────────────────────── mastery_events

-- mastery_events — append-only, with a per-path revision. DeepTutor's
-- MasteryEvent (models.py:273). It is what the phase-10 evidence loop reads:
-- "this person graduated that module on that day" has to be a recorded fact,
-- not something recomputed from current state that a later edit can change.
CREATE TABLE mastery_events (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path_id  uuid NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),

    type    text  NOT NULL CHECK (length(btrim(type)) BETWEEN 1 AND 64),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT mastery_events_path_fk FOREIGN KEY (path_id, user_id)
        REFERENCES mastery_paths (id, user_id) ON DELETE CASCADE,
    -- The revision IS the ordering. Two events sharing one would make the log
    -- ambiguous in exactly the way turn_events.seq must not be.
    CONSTRAINT mastery_events_path_revision_unique UNIQUE (path_id, revision)
);

CREATE INDEX mastery_events_user_idx ON mastery_events (user_id, created_at DESC);
