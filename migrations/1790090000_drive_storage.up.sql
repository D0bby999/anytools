-- 1790090000_drive_storage — a learner's own files kept in their Google Drive
-- (the private design notes, phase 1).
--
-- Two tables, both new; nothing existing changes.
--
--  1. drive_files — where each of a learner's files lives in their Drive. A
--     row exists only for a file Longplay wrote there itself, under the
--     `drive.file` scope it already holds. A file with no row is on the
--     server's disk, so a learner part way through a move reads both.
--
--  2. drive_folders — the "Longplay" folder and its subfolders, once created.
--     The folders also carry appProperties, so a reconnect finds them again
--     even if these rows are gone.
--
-- Neither table references drive_connections: disconnecting Drive must not
-- forget where the files are (phase 3 reconnects to the same ones). Both
-- cascade from users, and account deletion deletes no file in Drive (owner
-- decision 1): the folder stays the learner's.

-- ──────────────────────────────────────────────────────────────── drive_files

CREATE TABLE drive_files (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 'original' (an upload, addressed by its digest) or the object namespace
    -- of a per-row file ('recordings', 'audio', 'exam_papers', 'photopages').
    kind text NOT NULL CHECK (kind ~ '^[a-z0-9_]{1,32}$'),
    -- The digest of an original, or the id of the row an object belongs to.
    key  text NOT NULL,

    -- Google's file id: opaque, but never anything a URL path must escape.
    drive_file_id text NOT NULL CHECK (drive_file_id ~ '^[A-Za-z0-9_-]+$' AND length(drive_file_id) <= 512),
    -- What Longplay wrote, checked against every full read back.
    sha256 text   NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    bytes  bigint NOT NULL CHECK (bytes >= 0),
    mime   text   NOT NULL DEFAULT '' CHECK (length(mime) <= 200),

    created_at timestamptz NOT NULL DEFAULT now(),
    -- Set when Drive answered that the file is gone (the learner deleted or
    -- trashed it). Cleared when the file is written again.
    missing_at timestamptz,

    PRIMARY KEY (user_id, kind, key),
    CONSTRAINT drive_files_key_shape CHECK (
        (kind = 'original' AND key ~ '^[0-9a-f]{64}$') OR
        (kind <> 'original' AND key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
);

-- Settings' "space used in Drive" and dedup by content.
CREATE INDEX drive_files_user_sha_idx ON drive_files (user_id, sha256);

-- ────────────────────────────────────────────────────────────── drive_folders

CREATE TABLE drive_folders (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role    text NOT NULL CHECK (role IN ('root', 'uploads', 'recordings', 'audio', 'exam_papers', 'exports')),
    drive_folder_id text NOT NULL CHECK (drive_folder_id ~ '^[A-Za-z0-9_-]+$' AND length(drive_folder_id) <= 512),
    created_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, role)
);
