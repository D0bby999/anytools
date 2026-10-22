-- 1790700000_public_profiles — a learner's public profile at /u/<handle>
-- (the private design notes).
--
-- One row a learner. Nothing is public until `published`. The page's look is
-- `design`, a versioned JSON document of a theme and blocks that
-- internal/showcase validates; the database only holds it, so a new block
-- type or theme option needs no migration.
--
-- The handle is stored lower-case and is unique; the learner's numbers are
-- never stored here, they are counted when the page is read.

CREATE TABLE public_profiles (
    user_id      uuid        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    handle       text        NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9]([a-z0-9-]{1,28})[a-z0-9]$' AND handle NOT LIKE '%--%'),
    display_name text        NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 60),
    headline     text        NOT NULL DEFAULT '' CHECK (char_length(headline) <= 120),
    published    boolean     NOT NULL DEFAULT false,
    design       jsonb       NOT NULL CHECK (jsonb_typeof(design) = 'object' AND pg_column_size(design) <= 32768),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
