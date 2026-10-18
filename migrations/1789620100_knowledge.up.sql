-- 1789620100_knowledge — knowledge bases, documents, chunks.
--
-- Three decisions here were made by measurement, not by taste. Spike D
-- (reports/spike-stream-retrieval.md) ran them against 50 000 rows on this
-- machine's pgvector 0.8.2:
--
--  1. `halfvec(3072)` + `dims smallint`, with shorter vectors ZERO-PADDED at
--     write time. halfvec(3072) really does reject a 1536-dim vector
--     ("expected 3072 dimensions, not 1536"), and padding costs nothing
--     semantically — identical top-40 ordering, max |cosine delta| exactly 0 —
--     at 2x storage.
--  2. NO global HNSW index. A single HNSW post-filtered by kb_id returned
--     recall 0/40 = 0.000 for a 40-row KB inside 50k rows. The partial HNSW
--     per kb_id created alongside each KB gives 1.000 at 1.29 ms and builds in
--     0.04 s versus 214 s. Partial-per-dims does NOT fix it (0.625). The
--     per-KB indexes are therefore created by internal/store/pg/chunks.go when
--     a KB is created, not here; what this file owns is the btree that makes
--     the planner's exact path cheap (recall 1.000, 1.33 ms) and the GIN index
--     for the full-text arm.
--  3. `to_tsvector('english', ...)`, not 'simple'. 20 morphological probes:
--     english won 14, simple won 0, 6 ties, every tie an irregular lemma.
--
-- Red-team RT-3: every table carries user_id, and the composite foreign keys
-- below make a row physically incapable of pointing at another user's parent.

-- ─────────────────────────────────────────────────────────── knowledge_bases

CREATE TABLE knowledge_bases (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name     text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),

    -- The embed route is PINNED per KB. Mixing two embedding models in one
    -- index compares vectors from different spaces, which produces confident
    -- nonsense rather than an error. Empty until the first document is
    -- embedded; changing it afterwards sets needs_reembed.
    embedding_model text     NOT NULL DEFAULT '',
    dims            smallint NOT NULL DEFAULT 0 CHECK (dims IN (0, 256, 384, 512, 768, 1024, 1536, 3072)),

    -- fts_config is stored per KB because the retrieval SQL reads it, but it is
    -- CHECKed to 'english' on purpose: `chunks.tsv` is a GENERATED column, and
    -- a generated expression must be immutable, so the dictionary is baked into
    -- the stored vector. A KB claiming 'simple' here would have its queries
    -- parsed by one dictionary and matched against a vector built by another —
    -- silently wrong results. Supporting a second config means a second
    -- generated column and a migration, not a different value in this row.
    fts_config text NOT NULL DEFAULT 'english' CHECK (fts_config = 'english'),

    -- Set when the embed route changes. While true, POST /v1/kb/{id}/query
    -- refuses with 409 rather than ranking old vectors against a new query
    -- space. Cleared by POST /v1/kb/{id}/reindex.
    needs_reembed boolean NOT NULL DEFAULT false,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    -- The target of every child's composite foreign key. Redundant with the
    -- primary key by itself; load-bearing as the thing (id, user_id) points at.
    CONSTRAINT knowledge_bases_id_user_unique UNIQUE (id, user_id)
);

CREATE INDEX knowledge_bases_user_id_idx ON knowledge_bases (user_id);

-- ────────────────────────────────────────────────────────────────── documents

CREATE TABLE documents (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kb_id   uuid NOT NULL,

    source_kind text NOT NULL CHECK (source_kind IN ('upload', 'drive')),
    title       text NOT NULL,
    mime        text NOT NULL,
    bytes       bigint NOT NULL CHECK (bytes >= 0),
    sha256      text   NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    page_count  integer NOT NULL DEFAULT 0 CHECK (page_count >= 0),

    status text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'parsing', 'indexing', 'ready', 'failed')),
    error  text NOT NULL DEFAULT '',

    -- {"parser": "gemini", "model": "gemini-3.6-flash", "downgraded": true}.
    -- RT-14: the BYOK chain silently re-sending a document to the next provider
    -- is the thing the user most needs to see, so which provider actually read
    -- the file is a stored fact and a UI badge, not a log line.
    processed_by jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- Bumped on re-parse. The parsed Markdown is written to a path that
    -- includes the version, so a failed re-parse never overwrites the copy the
    -- viewer is currently serving.
    version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    parsed_markdown_path text    NOT NULL DEFAULT '',

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    -- A document cannot be attached to another user's KB. Not "must not":
    -- cannot. An application bug that passes the wrong kb_id gets a foreign key
    -- violation instead of a cross-tenant write.
    CONSTRAINT documents_kb_same_owner
        FOREIGN KEY (kb_id, user_id) REFERENCES knowledge_bases (id, user_id) ON DELETE CASCADE,

    CONSTRAINT documents_id_user_unique UNIQUE (id, user_id),

    -- A terminal failure must say why; a ready document must not carry an error.
    CONSTRAINT documents_failed_has_error CHECK (status <> 'failed' OR error <> ''),

    -- The same file uploaded twice into one KB is one document.
    CONSTRAINT documents_kb_sha_unique UNIQUE (kb_id, sha256)
);

CREATE INDEX documents_kb_id_idx   ON documents (kb_id);
CREATE INDEX documents_user_id_idx ON documents (user_id);
-- Feeds the "is anything still working?" poll without scanning finished rows.
CREATE INDEX documents_active_idx  ON documents (kb_id, updated_at)
    WHERE status IN ('queued', 'parsing', 'indexing');

-- ───────────────────────────────────────────────────────────────────── chunks

CREATE TABLE chunks (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kb_id       uuid NOT NULL,
    document_id uuid NOT NULL,

    ord          integer NOT NULL CHECK (ord >= 0),
    heading_path text    NOT NULL DEFAULT '',
    page_start   integer NOT NULL CHECK (page_start >= 1),
    page_end     integer NOT NULL CHECK (page_end >= 1),
    text         text    NOT NULL,

    -- 'english' is baked in: see knowledge_bases.fts_config above for why the
    -- per-KB column cannot vary while this column exists.
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,

    -- One column, one width. Vectors shorter than 3072 are zero-padded by
    -- internal/rag/embed/pad.go before they get here; `dims` records the true
    -- width so a query can refuse to compare across embedding spaces.
    embedding halfvec(3072),
    dims      smallint NOT NULL CHECK (dims IN (256, 384, 512, 768, 1024, 1536, 3072)),

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chunks_pages_ordered CHECK (page_end >= page_start),

    CONSTRAINT chunks_kb_same_owner
        FOREIGN KEY (kb_id, user_id) REFERENCES knowledge_bases (id, user_id) ON DELETE CASCADE,
    CONSTRAINT chunks_document_same_owner
        FOREIGN KEY (document_id, user_id) REFERENCES documents (id, user_id) ON DELETE CASCADE,

    CONSTRAINT chunks_document_ord_unique UNIQUE (document_id, ord)
);

-- The full-text arm.
CREATE INDEX chunks_tsv_idx ON chunks USING gin (tsv);

-- The btree Spike D says to keep. With it the planner does btree + exact sort
-- for a small KB (recall 1.000, 1.33 ms) and never touches HNSW at that size,
-- which is the correct outcome, not a fallback.
CREATE INDEX chunks_kb_id_idx ON chunks (kb_id);

CREATE INDEX chunks_user_id_idx     ON chunks (user_id);
CREATE INDEX chunks_document_id_idx ON chunks (document_id);

-- NOTE: there is deliberately NO `CREATE INDEX ... USING hnsw` in this file.
-- The per-KB partial HNSW is created with its KB (internal/store/pg/chunks.go,
-- CreateKBVectorIndex) because a global one measured recall 0.000 on the case
-- that matters — a small KB inside a large table.
