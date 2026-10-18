-- Audio overviews (learning-depth phase 10): a two-voice script over a
-- knowledge base or a research report, spoken on the learner's own TTS key.

-- ───────────────────────────────────────────────────── the `tts` function
-- byok.AllFunctions() is the single definition; functions_migration_test.go
-- reads the LAST definition of this constraint across the migrations.
ALTER TABLE function_routes DROP CONSTRAINT function_routes_function_known;
ALTER TABLE function_routes ADD CONSTRAINT function_routes_function_known CHECK (
    "function" IN ('chat', 'parse', 'embed', 'quiz', 'mastery', 'reading',
                   'solve', 'research', 'rerank', 'tts'));

-- ────────────────────────────────────────────────────────── audio_overviews
CREATE TABLE audio_overviews (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kb_id     uuid,
    report_id uuid,

    title    text NOT NULL DEFAULT '' CHECK (length(title) <= 200),
    language text NOT NULL CHECK (language IN ('en', 'vi')),
    minutes  int  NOT NULL CHECK (minutes BETWEEN 3 AND 15),
    -- The learner's optional topic, narrowing a knowledge base's overview.
    topic    text NOT NULL DEFAULT '' CHECK (length(topic) <= 200),
    -- '' until the sources are read: then the learner's choice, or theirs.
    language_choice text NOT NULL DEFAULT '' CHECK (language_choice IN ('', 'en', 'vi')),

    -- scripting → synthesizing → ready; script_only when there is no tts
    -- route (the browser speaks it); failed with an error otherwise.
    status text NOT NULL DEFAULT 'scripting'
           CHECK (status IN ('scripting', 'synthesizing', 'ready', 'script_only', 'failed')),
    error  text NOT NULL DEFAULT '' CHECK (length(error) <= 2000),

    -- {title, segments[{speaker, text, source_ids[]}]} — validated in Go.
    script  jsonb,
    -- S1…Sn: what each source id names, for the transcript's chips.
    sources jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- {document_id: version} of every cited document, so the transcript can
    -- say "sources changed" after a re-index (red team SF-13).
    source_versions jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- The synthesised chunks, in order: the resume point for a retried job.
    chunks_done  int    NOT NULL DEFAULT 0,
    chunks_total int    NOT NULL DEFAULT 0,
    audio_bytes  bigint NOT NULL DEFAULT 0,
    duration_seconds real NOT NULL DEFAULT 0,
    job_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT audio_overviews_one_source CHECK ((kb_id IS NULL) <> (report_id IS NULL)),
    CONSTRAINT audio_overviews_kb_fk FOREIGN KEY (kb_id, user_id)
        REFERENCES knowledge_bases (id, user_id) ON DELETE CASCADE,
    CONSTRAINT audio_overviews_report_fk FOREIGN KEY (report_id, user_id)
        REFERENCES research_reports (id, user_id) ON DELETE CASCADE,
    CONSTRAINT audio_overviews_id_user_unique UNIQUE (id, user_id)
);

CREATE INDEX audio_overviews_kb_idx ON audio_overviews (user_id, kb_id, created_at DESC) WHERE kb_id IS NOT NULL;
CREATE INDEX audio_overviews_report_idx ON audio_overviews (user_id, report_id, created_at DESC) WHERE report_id IS NOT NULL;
