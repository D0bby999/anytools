-- 1789710000_research — phase 9: stored research reports.
--
-- One table. A report is what a research turn produced: the question, the mode
-- it ran in, the Markdown it wrote, and the sources its citations resolve to.
-- The transcript already holds the same text as an assistant message; this row
-- exists because a report is a thing a person comes back to by itself — a list
-- of reports is a list of these rows, not a scan of every chat message.

CREATE TABLE research_reports (
    id      uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- The session the research ran in. Deleting that conversation must not
    -- delete the report, which is study material in its own right, so only
    -- the session column is nulled: SET NULL on the whole composite key would
    -- try to null user_id too, and user_id is NOT NULL.
    session_id uuid,
    -- The turn that wrote it, for tracing a report back to its event log.
    turn_id uuid REFERENCES turns(id) ON DELETE SET NULL,

    query     text NOT NULL CHECK (length(btrim(query)) BETWEEN 1 AND 4000),
    mode      text NOT NULL CHECK (mode IN ('quick', 'deep')),
    report_md text NOT NULL DEFAULT '',
    -- [{"kind":"chunk"|"url", "id":…, "title":…, "url":…, "document_id":…, "page":…}]
    -- exactly as internal/citations.Source serialises. Every marker left in
    -- report_md resolves to one entry here; the validator dropped the rest.
    sources   jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- Whether the web took part. A report written from the knowledge base
    -- alone says so, with the reason, rather than looking like it searched.
    kb_only        boolean NOT NULL DEFAULT false,
    kb_only_reason text    NOT NULL DEFAULT ''
        CHECK (kb_only_reason IN ('', 'no_search_key', 'web_off_with_documents', 'search_failed')),

    -- The notebook entry the report was saved as, when the notebook exists.
    -- Text rather than a foreign key: phase 8 owns that table and is not on
    -- this branch.
    note_id text NOT NULL DEFAULT '',

    created_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (id),
    CONSTRAINT research_reports_id_user_unique UNIQUE (id, user_id),
    CONSTRAINT research_reports_session_fk FOREIGN KEY (session_id, user_id)
        REFERENCES chat_sessions (id, user_id) ON DELETE SET NULL (session_id),
    CONSTRAINT research_reports_kb_only_reason
        CHECK (kb_only = (kb_only_reason <> ''))
);

CREATE INDEX research_reports_user_idx ON research_reports (user_id, created_at DESC);
