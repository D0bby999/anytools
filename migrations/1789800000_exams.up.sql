-- Exam mimic (learning-depth phase 3): a past paper becomes a reviewed
-- template; a mock exam generated from a knowledge base copies its structure;
-- every generated item is a normal question in the bank.

-- ──────────────────────────────────────────────── the `written` question type
-- An essay or calculation question, marked by rubric with partial credit.
-- quiz.AllTypes() is the Go list; types_test.go compares it with this CHECK
-- and with ui/web/app/lib/study-types.ts.
ALTER TABLE questions DROP CONSTRAINT questions_type_check;
ALTER TABLE questions ADD CONSTRAINT questions_type_check
    CHECK (type IN ('mcq', 'short', 'tf', 'cloze', 'written'));

-- [{"criterion": "…", "points": 2}, …]: 2–6 criteria whose points sum to the
-- item's. Only a written question has one, and every written question does.
ALTER TABLE questions ADD COLUMN rubric jsonb;
ALTER TABLE questions ADD CONSTRAINT questions_rubric_written
    CHECK ((type = 'written') = (rubric IS NOT NULL));

-- Partial credit, 0..1, for an answer marked by rubric; NULL for one marked
-- right or wrong. is_correct stays the verdict every schedule reads, and it
-- is score >= 0.7 (the module pass bar) whenever a score exists. Double
-- precision, not real: a real 0.7 compares below the literal 0.7.
ALTER TABLE question_attempts ADD COLUMN score double precision
    CHECK (score IS NULL OR score BETWEEN 0 AND 1);
ALTER TABLE question_attempts ADD CONSTRAINT question_attempts_score_bar
    CHECK (score IS NULL OR is_correct = (score >= 0.7));

-- The composite target exam_items.attempt_id needs.
ALTER TABLE question_attempts
    ADD CONSTRAINT question_attempts_id_user_unique UNIQUE (id, user_id);

-- ─────────────────────────────────────────────────────────── exam_templates
-- One uploaded paper. The file is a per-row object (blob.ObjectStore,
-- namespace exam_papers), never a knowledge-base original: originals are
-- shared by content hash (red team SF-10).
CREATE TABLE exam_templates (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    title    text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    filename text NOT NULL CHECK (length(filename) <= 255),
    -- pdf and image papers are stored as PDF and rendered by pdf.js in the
    -- browser; a docx or text paper has no pages to show.
    kind       text   NOT NULL CHECK (kind IN ('pdf', 'image', 'docx', 'text')),
    sha256     text   NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    bytes      bigint NOT NULL CHECK (bytes > 0),
    page_count int    NOT NULL CHECK (page_count BETWEEN 1 AND 40),

    status text NOT NULL DEFAULT 'queued'
           CHECK (status IN ('queued', 'parsing', 'extracting', 'review', 'ready', 'failed')),
    error  text NOT NULL DEFAULT '' CHECK (length(error) <= 2000),
    -- Who read the paper: "local:…" for a text layer, else provider/model.
    parsed_by text NOT NULL DEFAULT '' CHECK (length(parsed_by) <= 200),

    -- The reviewed questions, validated in Go (exam.ValidateItems). They name
    -- no rows: numbers, types, stems, options, points and pages only.
    items    jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Paper-level findings, e.g. a gap in the numbering.
    warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
    total_points       double precision NOT NULL DEFAULT 0 CHECK (total_points >= 0),
    time_limit_minutes int CHECK (time_limit_minutes BETWEEN 1 AND 600),

    job_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT exam_templates_id_user_unique UNIQUE (id, user_id)
);

CREATE INDEX exam_templates_user_idx ON exam_templates (user_id, created_at DESC);

-- One extraction batch (at most 8 pages) as the model returned it, stored as
-- it finishes so a retried job resumes at the first batch not yet stored.
CREATE TABLE exam_template_batches (
    template_id uuid NOT NULL,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    batch       int  NOT NULL CHECK (batch >= 0),
    items       jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (template_id, batch),
    CONSTRAINT exam_template_batches_template_fk FOREIGN KEY (template_id, user_id)
        REFERENCES exam_templates (id, user_id) ON DELETE CASCADE
);

-- ──────────────────────────────────────────────────────────────────── exams
-- A mock exam: the template's structure, generated from one knowledge base.
-- Deleting the template keeps the exams (column-list SET NULL, so user_id is
-- left alone); deleting the knowledge base removes them with its questions.
CREATE TABLE exams (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id uuid,
    kb_id       uuid NOT NULL,

    title  text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    status text NOT NULL DEFAULT 'generating'
           CHECK (status IN ('generating', 'ready', 'in_progress', 'submitted', 'failed')),
    error  text NOT NULL DEFAULT '' CHECK (length(error) <= 2000),

    -- The template items being generated, copied when the exam is created so
    -- a resumed job and a later template edit cannot disagree.
    blueprint jsonb NOT NULL DEFAULT '[]'::jsonb,
    requested int NOT NULL CHECK (requested BETWEEN 1 AND 60),
    generated int NOT NULL DEFAULT 0 CHECK (generated >= 0),
    -- [{"ord": 3, "number": "4", "reason": "…"}]: items given up on.
    dropped jsonb NOT NULL DEFAULT '[]'::jsonb,

    time_limit_minutes int CHECK (time_limit_minutes BETWEEN 1 AND 600),
    started_at   timestamptz,
    submitted_at timestamptz,
    score     double precision,
    max_score double precision,

    job_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT exams_template_fk FOREIGN KEY (template_id, user_id)
        REFERENCES exam_templates (id, user_id) ON DELETE SET NULL (template_id),
    CONSTRAINT exams_kb_fk FOREIGN KEY (kb_id, user_id)
        REFERENCES knowledge_bases (id, user_id) ON DELETE CASCADE,
    CONSTRAINT exams_id_user_unique UNIQUE (id, user_id)
);

CREATE INDEX exams_user_idx ON exams (user_id, created_at DESC);

-- One generated item of an exam: a bank question, its points, and the
-- learner's answer and mark.
CREATE TABLE exam_items (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exam_id     uuid NOT NULL,
    ord         int  NOT NULL CHECK (ord >= 0),
    question_id uuid NOT NULL,
    points      double precision NOT NULL CHECK (points > 0),
    template_number text NOT NULL DEFAULT '' CHECK (length(template_number) <= 20),

    answer      text NOT NULL DEFAULT '' CHECK (length(answer) <= 20000),
    answered_at timestamptz,
    -- Set when the item is marked: the attempt, and the share of its points.
    attempt_id uuid,
    score      double precision CHECK (score IS NULL OR score BETWEEN 0 AND 1),

    CONSTRAINT exam_items_exam_fk FOREIGN KEY (exam_id, user_id)
        REFERENCES exams (id, user_id) ON DELETE CASCADE,
    CONSTRAINT exam_items_question_fk FOREIGN KEY (question_id, user_id)
        REFERENCES questions (id, user_id) ON DELETE CASCADE,
    CONSTRAINT exam_items_attempt_fk FOREIGN KEY (attempt_id, user_id)
        REFERENCES question_attempts (id, user_id) ON DELETE SET NULL (attempt_id),
    CONSTRAINT exam_items_ord_unique UNIQUE (exam_id, ord),
    CONSTRAINT exam_items_id_user_unique UNIQUE (id, user_id)
);

CREATE INDEX exam_items_question_idx ON exam_items (user_id, question_id);
