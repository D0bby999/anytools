-- Reverse of 1789810000_link_sources.
--
-- Refuses rather than deletes. The old schema cannot represent a web or
-- YouTube document at all (its source_kind CHECK names only files), and two
-- link documents may legitimately share a sha256, which the restored
-- UNIQUE (kb_id, sha256) would reject. Silently deleting a learner's links,
-- their chunks and their reading workspaces to make a rollback succeed is the
-- wrong default; an operator who really wants that deletes them first:
--
--     DELETE FROM documents WHERE source_kind IN ('web', 'youtube');
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM documents WHERE source_kind IN ('web', 'youtube')) THEN
        RAISE EXCEPTION 'link documents exist; delete documents with source_kind web or youtube before rolling back 1789810000_link_sources';
    END IF;
END
$$;

DROP INDEX IF EXISTS documents_auto_sync_idx;

-- Files were already unique by (kb_id, sha256) under the partial index, and no
-- link rows remain, so the full constraint is satisfied by construction.
DROP INDEX IF EXISTS documents_kb_sha_unique;
ALTER TABLE documents ADD CONSTRAINT documents_kb_sha_unique UNIQUE (kb_id, sha256);

DROP INDEX IF EXISTS documents_kb_link_unique;

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_needs_transcript_youtube;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_auto_sync_web;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_transcript_source_check;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_youtube_has_media_id;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_media_id_youtube;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_link_has_url;

ALTER TABLE documents
    DROP COLUMN transcript_source,
    DROP COLUMN media,
    DROP COLUMN media_id,
    DROP COLUMN timeline,
    DROP COLUMN sync_error,
    DROP COLUMN sync_changes,
    DROP COLUMN last_synced_at,
    DROP COLUMN auto_sync,
    DROP COLUMN source_url;

ALTER TABLE documents DROP CONSTRAINT documents_status_check;
ALTER TABLE documents ADD CONSTRAINT documents_status_check
    CHECK (status IN ('queued', 'parsing', 'indexing', 'ready', 'failed'));

ALTER TABLE documents DROP CONSTRAINT documents_source_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_source_kind_check
    CHECK (source_kind IN ('upload', 'drive'));
