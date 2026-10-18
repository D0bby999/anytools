-- 1789561500_init — Longplay foundation schema.
--
-- Migration files are named <unix-timestamp>_<slug> rather than a zero-padded
-- sequence: phases 2..13 are developed in parallel and a shared counter makes
-- every concurrent branch collide on the same next number (postclaw carries 252
-- such pairs and the collisions were manual merges every time).

-- pgvector: created here so phase 5's embedding tables never have to guess
-- whether the extension exists. citext: `users.email` must compare
-- case-insensitively at the database layer, not only in Go — postclaw keyed
-- accounts by a raw email string and "Chau@Gmail.com" silently became a second
-- workspace from "chau@gmail.com".
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;

-- users — the single subject of every later table's user_id foreign key.
-- The id is a uuid, never the email: an email can change, can collide on case,
-- and cannot be revoked.
CREATE TABLE users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           citext      NOT NULL,
    email_verified_at timestamptz,
    display_name    text        NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

-- A soft-deleted account releases its address so the person can sign up again;
-- a partial unique index gives that without losing the collision guarantee for
-- live accounts.
CREATE UNIQUE INDEX users_email_unique_live ON users (email) WHERE deleted_at IS NULL;

-- user_identities — one row per (provider, subject). A user may hold several.
-- unique(provider, subject) is what makes a repeat login an update rather than
-- a new account, and what stops a second Google account from being silently
-- absorbed into someone else's user row.
CREATE TABLE user_identities (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider     text        NOT NULL,
    subject      text        NOT NULL,
    email        citext      NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_identities_provider_subject_unique UNIQUE (provider, subject),
    CONSTRAINT user_identities_provider_known CHECK (provider IN ('google', 'github'))
);

CREATE INDEX user_identities_user_id_idx ON user_identities (user_id);

-- app_sentinel — one row holding a known plaintext encrypted under the
-- configured key. Boot decrypts it and refuses to start on a mismatch.
-- Without this, starting with the wrong LONGPLAY_ENCRYPTION_KEY succeeds and
-- the failure only surfaces later as unreadable BYOK credentials, by which
-- point new rows have been written under the wrong key.
CREATE TABLE app_sentinel (
    id         smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    ciphertext text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
