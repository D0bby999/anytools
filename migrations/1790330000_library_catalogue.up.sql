-- The Library in Postgres (the private design notes). The
-- catalogue is the same for every learner: the API loads it from its
-- embedded export (internal/library/catalogue.json.gz) when the version
-- stored here differs, so nothing in these tables belongs to a user.

-- The version loaded: one row. sequence grows with each new export, so a
-- server built before it does not load its older catalogue over it.
CREATE TABLE library_catalogue (
    id          BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    version     TEXT NOT NULL CHECK (version ~ '^[0-9a-f]{64}$'),
    sequence    INTEGER NOT NULL CHECK (sequence > 0),
    items       INTEGER NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Where items come from, and what pins each source's data.
CREATE TABLE library_sources (
    name    TEXT PRIMARY KEY,
    url     TEXT NOT NULL,
    licence TEXT NOT NULL DEFAULT '',
    pin     TEXT NOT NULL DEFAULT '',
    read    TEXT NOT NULL DEFAULT '',
    items   INTEGER NOT NULL DEFAULT 0
);

-- One row an item, a column for each fact the page filters, sorts or shows.
CREATE TABLE library_items (
    id                TEXT PRIMARY KEY,
    position          INTEGER NOT NULL UNIQUE,
    source            TEXT NOT NULL REFERENCES library_sources (name),
    kind              TEXT NOT NULL CHECK (kind IN ('deck', 'words', 'questions', 'course', 'textbook', 'book')),
    subject           TEXT NOT NULL CHECK (subject IN ('business', 'economics', 'law', 'health', 'engineering',
                          'programming', 'science', 'maths', 'social', 'humanities', 'education', 'media',
                          'languages', 'skills', 'general', 'fitness')),
    language          TEXT NOT NULL,
    -- 0 English, 1 many languages, 2 the rest: English always comes first.
    language_rank     SMALLINT NOT NULL CHECK (language_rank BETWEEN 0 AND 2),
    name              TEXT NOT NULL,
    name_key          TEXT NOT NULL DEFAULT '',
    about             TEXT NOT NULL DEFAULT '',
    about_key         TEXT NOT NULL DEFAULT '',
    section           TEXT NOT NULL DEFAULT '',
    author            TEXT NOT NULL DEFAULT '',
    url               TEXT NOT NULL,
    licence           TEXT NOT NULL,
    reusable          BOOLEAN NOT NULL,
    credit            TEXT NOT NULL DEFAULT '',
    credit_text       TEXT NOT NULL DEFAULT '',
    size              INTEGER,
    unit              TEXT NOT NULL DEFAULT '',
    video             BOOLEAN NOT NULL DEFAULT FALSE,
    level             TEXT NOT NULL DEFAULT '' CHECK (level IN ('', 'beginner', 'intermediate', 'advanced')),
    hours             NUMERIC(8, 2) CHECK (hours > 0),
    year              SMALLINT,
    certificate       TEXT NOT NULL DEFAULT '' CHECK (certificate IN ('', 'free', 'badge', 'paid')),
    certificate_name  TEXT NOT NULL DEFAULT '',
    certificate_min   NUMERIC(9, 2),
    certificate_max   NUMERIC(9, 2),
    certificate_currency TEXT NOT NULL DEFAULT '',
    rating            NUMERIC(3, 2) CHECK (rating BETWEEN 0 AND 5),
    rating_count      INTEGER NOT NULL DEFAULT 0,
    popularity        BIGINT,
    popularity_kind   TEXT NOT NULL DEFAULT '' CHECK (popularity_kind IN ('', 'views', 'downloads')),
    accessibility     TEXT[] NOT NULL DEFAULT '{}',
    action            JSONB NOT NULL,
    -- Name, about, section and author, folded (lower case, no accents).
    search            TEXT NOT NULL
);

CREATE INDEX library_items_subject ON library_items (subject, language_rank, position);
CREATE INDEX library_items_kind ON library_items (kind, language_rank, position);
CREATE INDEX library_items_certificate ON library_items (certificate) WHERE certificate <> '';

-- A textbook's reviews, each criterion's average from 1 to 5.
CREATE TABLE library_item_scores (
    item      TEXT NOT NULL REFERENCES library_items (id) ON DELETE CASCADE,
    criterion TEXT NOT NULL,
    score     NUMERIC(3, 2) NOT NULL CHECK (score BETWEEN 1 AND 5),
    PRIMARY KEY (item, criterion)
);
