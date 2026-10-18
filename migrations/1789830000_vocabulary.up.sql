-- Vocabulary notes and their cards (plans/260926-2301-learning-depth, phase 7).
--
-- The Anki shape: one NOTE per term and language holds the fields, and it owns
-- CARDS, each with its own FSRS schedule. Two card kinds exist today —
-- recognition (term + context → meaning) and cloze (context with a blank →
-- term). The production card (meaning → term) is deferred by the owner's
-- decision of 2026-09-27; phase 11 widens the kind CHECK with `flash`, which is
-- why the CHECK is a named constraint of its own.

-- ─────────────────────────────────────────────────────────────── vocab_notes
CREATE TABLE vocab_notes (
    id      uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    term    text NOT NULL CHECK (length(btrim(term)) BETWEEN 1 AND 120),
    -- A BCP 47 primary tag with an optional region: en, vi, pt-BR.
    lang    text NOT NULL CHECK (lang ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
    reading text NOT NULL DEFAULT '' CHECK (length(reading) <= 120),
    pos     text NOT NULL DEFAULT '' CHECK (length(pos) <= 40),
    meaning text NOT NULL CHECK (length(btrim(meaning)) BETWEEN 1 AND 1000),

    -- The sentences the term was met in, newest first:
    -- [{sentence, document_id, page, chunk_id, added_at}]. The ids in here are
    -- resolved with the owner's user_id when saved AND when read back
    -- (internal/store/pg/vocab.go), because a jsonb id has no foreign key.
    contexts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(contexts) = 'array'),

    -- Where the term was first saved from. Nullable so a note outlives its
    -- source document: vocabulary is the learner's, not the document's.
    source_document_id uuid,
    source_page        integer CHECK (source_page IS NULL OR source_page >= 0),

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (id),
    UNIQUE (id, user_id),

    -- ON DELETE SET NULL (source_document_id) — the column-list form. A plain
    -- SET NULL would null user_id as well, which is NOT NULL, so deleting the
    -- document (or its knowledge base, or the account) would fail at delete
    -- time (see 1789700013_drive.up.sql, drive_grants_document_same_owner).
    CONSTRAINT vocab_notes_document_same_owner
        FOREIGN KEY (source_document_id, user_id) REFERENCES documents (id, user_id)
        ON DELETE SET NULL (source_document_id)
);

-- One note per term and language: saving the term again adds a context.
CREATE UNIQUE INDEX vocab_notes_user_lang_term_key ON vocab_notes (user_id, lang, lower(term));
CREATE INDEX vocab_notes_user_idx ON vocab_notes (user_id, updated_at DESC);
CREATE INDEX vocab_notes_document_idx ON vocab_notes (source_document_id) WHERE source_document_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────── vocab_cards
-- fsrs_card is the go-fsrs Card serialized whole, as in kp_state. due_at is
-- the QUEUE's date: Card.Due, except for a buried sibling, whose due_at is
-- pushed to the start of the learner's tomorrow while its FSRS state is left
-- alone (burying hides a card for a day; it is not a review).
CREATE TABLE vocab_cards (
    id      uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note_id uuid NOT NULL,

    kind text NOT NULL,

    fsrs_card jsonb NOT NULL DEFAULT '{}'::jsonb,
    due_at    timestamptz NOT NULL,
    reps      integer NOT NULL DEFAULT 0 CHECK (reps >= 0),
    lapses    integer NOT NULL DEFAULT 0 CHECK (lapses >= 0),
    suspended boolean NOT NULL DEFAULT false,
    last_reviewed_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (id),
    UNIQUE (id, user_id),
    UNIQUE (note_id, kind),

    -- Named on its own so phase 11 can widen it with `flash` without
    -- rewriting anything else. The list is repeated in Go as vocab.CardKinds().
    CONSTRAINT vocab_cards_kind_check CHECK (kind IN ('recognition', 'cloze')),

    CONSTRAINT vocab_cards_note_same_owner
        FOREIGN KEY (note_id, user_id) REFERENCES vocab_notes (id, user_id) ON DELETE CASCADE
);

-- The review queue and the due count: WHERE user_id = $1 AND NOT suspended
-- AND due_at < $2 ORDER BY due_at.
CREATE INDEX vocab_cards_due_idx ON vocab_cards (user_id, due_at) WHERE NOT suspended;

-- ───────────────────────────────────────────────────────────── vocab_reviews
-- One row per review. request_id is the client's idempotency key: a review
-- sent twice (a double tap, a retried request) schedules the card once.
CREATE TABLE vocab_reviews (
    id         uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id    uuid NOT NULL,
    request_id uuid NOT NULL,
    rating     text NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
    -- The typed answer of a cloze card; empty for recognition.
    answer     text NOT NULL DEFAULT '' CHECK (length(answer) <= 200),
    -- Whether a cloze answer matched the term, accents ignored. NULL for a
    -- recognition card, which has no typed answer to match.
    matched    boolean,
    created_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (id),
    UNIQUE (user_id, request_id),

    CONSTRAINT vocab_reviews_card_same_owner
        FOREIGN KEY (card_id, user_id) REFERENCES vocab_cards (id, user_id) ON DELETE CASCADE
);

CREATE INDEX vocab_reviews_card_idx ON vocab_reviews (card_id, created_at DESC);
CREATE INDEX vocab_reviews_user_idx ON vocab_reviews (user_id, created_at DESC);
