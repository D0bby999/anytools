-- Reverse of 1790050000_media_sources.
--
-- Refuses rather than deletes, like 1789810000's down: the old schema cannot
-- represent an uploaded recording. An operator who really wants the rollback
-- deletes them first (through the app, so their files go too):
--
--     DELETE FROM documents WHERE source_kind = 'media';
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM documents WHERE source_kind = 'media') THEN
        RAISE EXCEPTION 'media documents exist; delete documents with source_kind media before rolling back 1790050000_media_sources';
    END IF;
END
$$;

DROP INDEX IF EXISTS documents_kb_media_unique;

ALTER TABLE documents DROP CONSTRAINT documents_media_bytes_bounded;
ALTER TABLE documents DROP CONSTRAINT documents_media_mime_known;
ALTER TABLE documents DROP CONSTRAINT documents_media_sha256_hex;
ALTER TABLE documents DROP CONSTRAINT documents_media_file;

ALTER TABLE documents
    DROP COLUMN media_bytes,
    DROP COLUMN media_mime,
    DROP COLUMN media_sha256;

ALTER TABLE documents DROP CONSTRAINT documents_needs_transcript_youtube;
ALTER TABLE documents ADD CONSTRAINT documents_needs_transcript_youtube
    CHECK (status <> 'needs_transcript' OR source_kind = 'youtube');

ALTER TABLE documents DROP CONSTRAINT documents_transcript_source_check;
ALTER TABLE documents ADD CONSTRAINT documents_transcript_source_check
    CHECK (transcript_source IS NULL
           OR (source_kind = 'youtube' AND transcript_source IN ('captions', 'ai_transcript', 'learner')));

ALTER TABLE documents DROP CONSTRAINT documents_source_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_source_kind_check
    CHECK (source_kind IN ('upload', 'drive', 'web', 'youtube', 'site_page', 'repo_file'));
