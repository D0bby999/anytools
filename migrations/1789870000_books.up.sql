-- Living books (plans/260926-2301-learning-depth, phase 11): a knowledge base
-- turned into a book the learner confirms outline-first, then reads chapter by
-- chapter as typed blocks written from their own material.
--
-- Two gates, as DeepTutor's Book has (findings §8): the proposal is edited and
-- CONFIRMED before any chapter exists, and a chapter is compiled only when the
-- learner asks. Its flash cards are `flash` rows in the vocabulary's own card
-- table, scheduled and reviewed by the same code (red team AS-14).

-- ─────────────────────────────────────────────────────────────────── books
CREATE TABLE books (
    id      uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kb_id   uuid NOT NULL,

    title  text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    goal   text NOT NULL DEFAULT '' CHECK (length(goal) <= 500),
    -- The length the learner asked for.
    length int  NOT NULL CHECK (length BETWEEN 4 AND 12),
    status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'archived')),

    -- {title, audience, chapters[{title, objectives[], prereqs[], anchors[]}],
    --  outline[{chunk_id, document_id, title, page, heading, snippet}]}.
    -- The anchors are chunk ids with no foreign key: they are resolved with
    -- the owner's user_id and kb_id when an edit is saved, when the book is
    -- confirmed, and again when a chapter is compiled (internal/store/pg/books.go).
    proposal jsonb NOT NULL CHECK (jsonb_typeof(proposal) = 'object'),

    -- Two provider failures in a row pause the book (DeepTutor's
    -- CONSECUTIVE_PAGE_FAILURE_LIMIT); '' when it is not paused. Asking for a
    -- chapter again clears both.
    consecutive_failures int  NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    paused_reason        text NOT NULL DEFAULT '' CHECK (length(paused_reason) <= 2000),
    -- The latest compile job, for progress and Cancel.
    job_id uuid,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (id),
    CONSTRAINT books_id_user_unique UNIQUE (id, user_id),
    CONSTRAINT books_kb_same_owner
        FOREIGN KEY (kb_id, user_id) REFERENCES knowledge_bases (id, user_id) ON DELETE CASCADE
);

CREATE INDEX books_kb_idx ON books (user_id, kb_id, created_at DESC);

-- ─────────────────────────────────────────────────────────── book_chapters
-- Created at confirmation, one per confirmed outline entry.
CREATE TABLE book_chapters (
    id      uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id uuid NOT NULL,

    ord   int  NOT NULL CHECK (ord >= 1),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    objectives jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(objectives) = 'array'),
    -- The ords of earlier chapters this one builds on.
    prereqs    jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(prereqs) = 'array'),
    -- Chunk ids, resolved with the owner's user_id and kb_id on every use.
    anchors    jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(anchors) = 'array'),

    status text NOT NULL DEFAULT 'pending'
           CHECK (status IN ('pending', 'compiling', 'ready', 'error', 'paused')),
    error  text NOT NULL DEFAULT '' CHECK (length(error) <= 2000),
    -- {document_id: version} of every document the chapter was written from,
    -- so the reader can say "sources changed since this was written".
    source_versions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_versions) = 'object'),
    compiled_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (id),
    CONSTRAINT book_chapters_id_user_unique UNIQUE (id, user_id),
    CONSTRAINT book_chapters_book_ord_unique UNIQUE (book_id, ord),
    CONSTRAINT book_chapters_book_same_owner
        FOREIGN KEY (book_id, user_id) REFERENCES books (id, user_id) ON DELETE CASCADE
);

-- ───────────────────────────────────────────────────────────── book_blocks
-- One typed block of a chapter. A planned block is `pending` until its own
-- call succeeds; a block whose output breaks its type's rules is `error`
-- with the reason, never an empty success. Regenerating replaces the payload
-- in place and bumps `version` only once the new one is valid, so the
-- previous version is what the reader sees until then.
CREATE TABLE book_blocks (
    id         uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chapter_id uuid NOT NULL,

    ord  int  NOT NULL CHECK (ord >= 1),
    type text NOT NULL CHECK (type IN ('text', 'callout', 'worked_example', 'diagram',
                                       'quiz', 'flash_cards', 'summary', 'note')),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'error')),
    -- What the chapter plan asked this block to do.
    title text NOT NULL DEFAULT '' CHECK (length(title) <= 200),
    brief text NOT NULL DEFAULT '' CHECK (length(brief) <= 1000),
    -- The validated block, by type (internal/capabilities/book/blocks.go).
    -- A quiz block's question ids are resolved with the owner's user_id on read.
    payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
    -- The chunks its citations resolved to: [{kind, id, title, page, document_id}].
    sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array'),
    error   text NOT NULL DEFAULT '' CHECK (length(error) <= 2000),
    version int  NOT NULL DEFAULT 0 CHECK (version >= 0),

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (id),
    CONSTRAINT book_blocks_id_user_unique UNIQUE (id, user_id),
    CONSTRAINT book_blocks_chapter_ord_unique UNIQUE (chapter_id, ord),
    CONSTRAINT book_blocks_chapter_same_owner
        FOREIGN KEY (chapter_id, user_id) REFERENCES book_chapters (id, user_id) ON DELETE CASCADE
);

-- ─────────────────────────────────────────── flash cards in vocab_cards
-- A book's concept card is not a vocabulary note: no term unique per
-- language, no context sentence, no source document. It is a `flash` card
-- with its own front and back, owned by the block that wrote it, and gone
-- with it (and so with its book, and its knowledge base).
ALTER TABLE vocab_cards ALTER COLUMN note_id DROP NOT NULL;
ALTER TABLE vocab_cards
    ADD COLUMN front text,
    ADD COLUMN back  text,
    ADD COLUMN book_block_id uuid;

ALTER TABLE vocab_cards DROP CONSTRAINT vocab_cards_kind_check;
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_kind_check
    CHECK (kind IN ('recognition', 'cloze', 'flash'));

-- A flash card has no note, and only a flash card has no note.
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_flash_has_no_note
    CHECK ((kind = 'flash') = (note_id IS NULL));
-- A flash card carries its own two faces and its block; a note's cards
-- carry neither.
ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_flash_fields CHECK (
    CASE WHEN kind = 'flash'
         THEN book_block_id IS NOT NULL AND front IS NOT NULL AND back IS NOT NULL
              AND length(btrim(front)) BETWEEN 1 AND 300
              AND length(btrim(back)) BETWEEN 1 AND 1000
         ELSE book_block_id IS NULL AND front IS NULL AND back IS NULL
    END);

ALTER TABLE vocab_cards ADD CONSTRAINT vocab_cards_block_same_owner
    FOREIGN KEY (book_block_id, user_id) REFERENCES book_blocks (id, user_id) ON DELETE CASCADE;

CREATE INDEX vocab_cards_block_idx ON vocab_cards (book_block_id) WHERE book_block_id IS NOT NULL;
