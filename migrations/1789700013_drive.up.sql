-- 1789700013_drive — the Google Drive connector (phase 13).
--
-- Three tables and one column, all shaped by reports/spike-drive.md.
--
--  1. drive_connections — one Google grant per user. The refresh token is the
--     whole connector: without it the access token expires in an hour and the
--     15-minute sync job stops working with no user-visible cause. It is
--     written through internal/store/pg/encrypt_helper.go's encryptOrFail, so
--     a process booted with no encryption key REFUSES the write rather than
--     storing a live Google credential in the clear.
--
--  2. drive_grants — what the user actually handed this app through the
--     Picker. Under the `drive.file` scope the app can only see files the user
--     opened with it, so this table is not a cache: it is the authoritative
--     list of what may be read at all. A picked FOLDER is recorded as one row,
--     and each child found at pick time is recorded as its own `file` row
--     pointing back at it — because the spike could not establish that a file
--     added to that folder LATER is visible under this scope (capability
--     table row 2, UNKNOWN leaning NO), so nothing here assumes it is.
--
--  3. drive_sync_state — the per-user `changes.list` checkpoint. One token per
--     USER, not per KB, because Drive's change feed is account-wide.
--
-- Red-team RT-3, unchanged: every table carries user_id, and the composite
-- foreign keys make a row physically incapable of pointing at another user's
-- knowledge base or document.

-- ────────────────────────────────────────────────────────── drive_connections

CREATE TABLE drive_connections (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    -- Google's stable subject id and the address the user consented with, so
    -- Settings can say WHICH account is connected. Neither is a secret.
    google_sub text NOT NULL DEFAULT '',
    email      text NOT NULL DEFAULT '',

    -- Both encrypted at rest by encryptOrFail. `refresh_enc` is NOT NULL
    -- without a default on purpose: a row with no refresh token is a connector
    -- that will stop working within the hour, and it should be impossible to
    -- create one by forgetting a column.
    refresh_enc text NOT NULL,
    access_enc  text NOT NULL DEFAULT '',
    expires_at  timestamptz,

    -- The scope Google actually granted, recorded verbatim. If a future
    -- consent screen hands back less than drive.file, the connector must be
    -- able to say so rather than fail one API call at a time.
    scope text NOT NULL DEFAULT '',

    -- Set when Google refuses the refresh token (invalid_grant: revoked in the
    -- user's account settings, password changed, consent withdrawn). While
    -- true the readiness matrix reads "Drive: reconnect needed" and no sync is
    -- attempted, because every attempt would burn a request to learn the same
    -- thing.
    needs_reconnect boolean NOT NULL DEFAULT false,
    last_error      text    NOT NULL DEFAULT '',

    connected_at timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────── drive_grants

CREATE TABLE drive_grants (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kb_id   uuid NOT NULL,

    -- Google's file id. Text, not uuid: Drive ids are opaque strings.
    file_id text NOT NULL CHECK (length(file_id) BETWEEN 1 AND 512),
    kind    text NOT NULL CHECK (kind IN ('file', 'folder')),

    -- For a child discovered by expanding a picked folder, the folder's id.
    -- Empty for a directly picked file. It is what lets the UI group a folder
    -- with the files it contributed, and what a "Pick more" run compares
    -- against so an unchanged folder does not duplicate its children.
    parent_file_id text NOT NULL DEFAULT '',

    name text NOT NULL DEFAULT '',
    mime text NOT NULL DEFAULT '',

    -- The two change signals, and they are not interchangeable. A Google-native
    -- Doc has NO md5Checksum (verified against the recorded files.list
    -- fixture), so comparing md5 alone would make every Doc look changed on
    -- every poll; comparing modifiedTime alone would re-import a binary whose
    -- timestamp moved without its content. The sync compares md5 when present
    -- and falls back to modifiedTime.
    md5           text NOT NULL DEFAULT '',
    modified_time text NOT NULL DEFAULT '',

    -- 'active'  — in scope, synced.
    -- 're-pick' — Google answered 403 insufficientFilePermissions: this app no
    --             longer has this file, and the ONLY fix is the user picking it
    --             again. The spike proved this classifies as Forbidden and not
    --             as Gone, so it must never trigger a change-feed re-baseline.
    -- 'removed' — trashed or deleted in Drive.
    state      text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 're-pick', 'removed')),
    last_error text NOT NULL DEFAULT '',

    -- The document this grant produced, when it produced one. A folder row
    -- never has one; a file row that failed to import does not either.
    document_id uuid,

    granted_at  timestamptz NOT NULL DEFAULT now(),
    synced_at   timestamptz,
    updated_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT drive_grants_kb_same_owner
        FOREIGN KEY (kb_id, user_id) REFERENCES knowledge_bases (id, user_id) ON DELETE CASCADE,

    -- ON DELETE SET NULL (document_id) — the column list form, Postgres 15+.
    -- A plain SET NULL would try to null user_id too, which is NOT NULL, and
    -- the constraint would fail at delete time rather than at migrate time.
    CONSTRAINT drive_grants_document_same_owner
        FOREIGN KEY (document_id, user_id) REFERENCES documents (id, user_id)
        ON DELETE SET NULL (document_id),

    -- One grant per file per knowledge base. Picking the same file twice
    -- refreshes the row instead of creating a second one that would sync the
    -- same document twice.
    CONSTRAINT drive_grants_user_kb_file_unique UNIQUE (user_id, kb_id, file_id)
);

CREATE INDEX drive_grants_user_id_idx ON drive_grants (user_id);
CREATE INDEX drive_grants_kb_id_idx   ON drive_grants (kb_id);
-- The sync's own lookup: "of this user's active file grants, which ones does
-- this page of changes mention?"
CREATE INDEX drive_grants_user_file_idx ON drive_grants (user_id, file_id)
    WHERE kind = 'file' AND state = 'active';

-- ─────────────────────────────────────────────────────────── drive_sync_state

CREATE TABLE drive_sync_state (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    -- The changes.list checkpoint. Empty means "never baselined": the next
    -- sync calls changes.getStartPageToken and reports nothing, which is the
    -- honest answer — it has no history to compare against.
    start_page_token text NOT NULL DEFAULT '',

    last_sync_at timestamptz,
    last_error   text NOT NULL DEFAULT '',

    -- Bumped every time a 410 forces a fresh baseline. Not decoration: a
    -- connector re-baselining repeatedly is one whose polls are further apart
    -- than Drive keeps history, and nothing else in the system would show that.
    rebaselines integer NOT NULL DEFAULT 0 CHECK (rebaselines >= 0),

    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────────────────────────────────── documents.drive_file_id

-- documents.source_kind already accepts 'drive' (the knowledge migration wrote
-- the CHECK that way so this phase would not have to rewrite a constraint).
-- What was missing is the identity: which Drive file a document came from.
ALTER TABLE documents ADD COLUMN drive_file_id text NOT NULL DEFAULT '';

-- A drive_file_id only means something on a drive document. Without this, a
-- bug that set the column on an uploaded file would make the sync re-import a
-- document the user uploaded by hand.
ALTER TABLE documents ADD CONSTRAINT documents_drive_file_id_needs_drive_source
    CHECK (drive_file_id = '' OR source_kind = 'drive');

-- One document per Drive file per knowledge base. This is what makes the
-- re-import an UPDATE of the existing row (new version, back to `queued`)
-- rather than a second document the user now sees twice.
CREATE UNIQUE INDEX documents_kb_drive_file_unique
    ON documents (kb_id, drive_file_id) WHERE drive_file_id <> '';
