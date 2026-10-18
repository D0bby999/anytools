-- 1789630800_notebook_reading — the notebook (user- and agent-written notes)
-- and the immersive reading workspace (per-document progress and highlights).
--
-- Six tables, six `user_id` columns (red-team RT-3). The rule that was nearly
-- lost in phase 6 and is restated here: a CHILD table is exactly where a
-- mis-scoped join leaks, so `note_category_links` and `reading_highlights`
-- carry the owner directly even though their parents alone would identify it.
-- Every child also points at its parent with a COMPOSITE foreign key on
-- (id, user_id), which makes a cross-tenant row physically impossible rather
-- than merely forbidden.

-- ──────────────────────────────────────────────────────────────── notebooks

CREATE TABLE notebooks (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name    text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),

    -- Exactly one notebook per user is the default: it is where `write_note`
    -- puts an agent's note and where "save to notebook" lands when the user
    -- has not chosen one. A partial unique index rather than a boolean with a
    -- trigger — the database enforces "at most one", so a race between two
    -- concurrent first-saves cannot produce two defaults.
    is_default boolean NOT NULL DEFAULT false,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT notebooks_id_user_unique UNIQUE (id, user_id)
);

CREATE UNIQUE INDEX notebooks_one_default_idx ON notebooks (user_id) WHERE is_default;
CREATE INDEX notebooks_user_updated_idx ON notebooks (user_id, updated_at DESC);

-- ───────────────────────────────────────────────────────────── note_categories

CREATE TABLE note_categories (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notebook_id uuid NOT NULL,
    name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT note_categories_notebook_same_owner
        FOREIGN KEY (notebook_id, user_id) REFERENCES notebooks (id, user_id) ON DELETE CASCADE,
    CONSTRAINT note_categories_id_user_unique UNIQUE (id, user_id),
    -- Two categories called "Formulas" in one notebook are a UI bug, not a
    -- feature. Scoped to the notebook, so two notebooks may each have one.
    CONSTRAINT note_categories_notebook_name_unique UNIQUE (notebook_id, name)
);

CREATE INDEX note_categories_notebook_idx ON note_categories (notebook_id, name);

-- ──────────────────────────────────────────────────────────────────── notes

CREATE TABLE notes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notebook_id uuid NOT NULL,

    title   text NOT NULL DEFAULT '' CHECK (length(title) <= 300),
    body_md text NOT NULL DEFAULT '',

    -- Where the note came from: {"kind": "document", "id": "<uuid>", "page": 14}.
    --
    -- jsonb rather than three nullable columns because the kinds do not share a
    -- shape — a reading note has a page, a session note does not — and because
    -- phases 9 and 10 add kinds this phase cannot name. The CHECK pins the one
    -- field every reader depends on: `kind` is present and is one this product
    -- knows, so a renderer never has to guess.
    source jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (
            source = '{}'::jsonb
            OR (source ? 'kind' AND source->>'kind' IN ('session', 'question', 'document', 'reading'))
        ),

    -- Who wrote it. The agent's notes are visibly the agent's: a notebook that
    -- blurred the two would make "my own notes" an unanswerable question, and
    -- the 90-day evidence loop (phase 10) reads this column to tell evidence
    -- the user produced from evidence a model produced.
    created_by text NOT NULL DEFAULT 'user' CHECK (created_by IN ('user', 'agent')),

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT notes_notebook_same_owner
        FOREIGN KEY (notebook_id, user_id) REFERENCES notebooks (id, user_id) ON DELETE CASCADE,
    CONSTRAINT notes_id_user_unique UNIQUE (id, user_id)
);

CREATE INDEX notes_notebook_idx ON notes (notebook_id, updated_at DESC);
CREATE INDEX notes_user_idx ON notes (user_id, updated_at DESC);
-- "Which notes came from this document?" — the reading pane's own query, and
-- the one phase 10 asks when it looks for evidence attached to a source.
CREATE INDEX notes_source_idx ON notes USING gin (source jsonb_path_ops);

-- ────────────────────────────────────────────────────────── note_category_links

CREATE TABLE note_category_links (
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note_id     uuid NOT NULL,
    category_id uuid NOT NULL,

    PRIMARY KEY (note_id, category_id),

    CONSTRAINT note_category_links_note_same_owner
        FOREIGN KEY (note_id, user_id) REFERENCES notes (id, user_id) ON DELETE CASCADE,
    CONSTRAINT note_category_links_category_same_owner
        FOREIGN KEY (category_id, user_id) REFERENCES note_categories (id, user_id) ON DELETE CASCADE
);

CREATE INDEX note_category_links_category_idx ON note_category_links (category_id);
CREATE INDEX note_category_links_user_idx ON note_category_links (user_id);

-- ────────────────────────────────────────────────────────── reading_workspaces

CREATE TABLE reading_workspaces (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id uuid NOT NULL,

    -- {"page": 14, "percent": 0.42}. Two numbers rather than one because a PDF
    -- knows its page and an EPUB knows its percentage, and converting either
    -- into the other is a lie about precision.
    progress jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- The chat session the tutor pane's turns run on.
    --
    -- A turn needs a session (turns.session_id is NOT NULL), and a session per
    -- ACTION would litter the sidebar with one conversation per click. One
    -- session per workspace makes "explain, then quiz me on the same passage"
    -- a conversation rather than four amnesiac exchanges.
    --
    -- The foreign key names only the id, not (id, user_id): chat_sessions has
    -- no (id, user_id) unique constraint and adding one belongs to the phase
    -- that owns that table. The application checks the owner on every read;
    -- ON DELETE SET NULL means deleting the conversation empties the pane
    -- rather than deleting the reading progress with it.
    session_id uuid REFERENCES chat_sessions(id) ON DELETE SET NULL,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT reading_workspaces_document_same_owner
        FOREIGN KEY (document_id, user_id) REFERENCES documents (id, user_id) ON DELETE CASCADE,
    CONSTRAINT reading_workspaces_id_user_unique UNIQUE (id, user_id),
    -- One workspace per document per user. "Resume where I left off" has no
    -- meaning if a second GET can create a second row with its own progress.
    CONSTRAINT reading_workspaces_user_document_unique UNIQUE (user_id, document_id)
);

CREATE INDEX reading_workspaces_user_updated_idx ON reading_workspaces (user_id, updated_at DESC);

-- ────────────────────────────────────────────────────────── reading_highlights

CREATE TABLE reading_highlights (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL,

    page  integer NOT NULL CHECK (page >= 1),
    text  text    NOT NULL CHECK (length(btrim(text)) BETWEEN 1 AND 10000),
    -- A NAME from the world's palette, never a hex value. A colour literal
    -- stored in the database is a colour the design tokens cannot restyle, and
    -- it is the same drift app/test/no-raw-colour.test.ts exists to stop on the
    -- client side.
    color text NOT NULL DEFAULT 'yellow' CHECK (color IN ('yellow', 'green', 'blue', 'pink')),

    -- The note this highlight was saved into, if any. SET NULL rather than
    -- CASCADE: deleting a note is not a request to lose the highlight that
    -- produced it.
    note_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT reading_highlights_workspace_same_owner
        FOREIGN KEY (workspace_id, user_id) REFERENCES reading_workspaces (id, user_id) ON DELETE CASCADE,
    CONSTRAINT reading_highlights_note_same_owner
        FOREIGN KEY (note_id, user_id) REFERENCES notes (id, user_id) ON DELETE SET NULL (note_id),
    CONSTRAINT reading_highlights_id_user_unique UNIQUE (id, user_id)
);

CREATE INDEX reading_highlights_workspace_idx ON reading_highlights (workspace_id, page, created_at);
CREATE INDEX reading_highlights_user_idx ON reading_highlights (user_id);
