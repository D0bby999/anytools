-- 1790050000_media_sources — audio and video files as knowledge-base
-- documents (the private design notes, phase 15).
--
-- Back up the database before running this: it replaces CHECK constraints on
-- documents, and the down migration refuses to run while media documents
-- exist.
--
-- A media document is an uploaded recording (a podcast, a class, a meeting).
-- Like a YouTube video it rests in needs_transcript until the learner gives
-- it a transcript, and its sha256/mime/bytes then describe that transcript,
-- which is what parse_document reads. The recording itself stays: the viewer
-- plays it, and a transcription reads it. So it is named by its own columns,
-- media_sha256/media_mime/media_bytes, and is an original like any other
-- (content-addressed, deleted once no document of the user names it).

-- ───────────────────────────────────────────────────── kinds and statuses

-- The full list, restated from 1789810000_link_sources and 1790014000_sites_repos.
ALTER TABLE documents DROP CONSTRAINT documents_source_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_source_kind_check
    CHECK (source_kind IN ('upload', 'drive', 'web', 'youtube', 'site_page', 'repo_file', 'media'));

ALTER TABLE documents DROP CONSTRAINT documents_transcript_source_check;
ALTER TABLE documents ADD CONSTRAINT documents_transcript_source_check
    CHECK (transcript_source IS NULL
           OR (source_kind IN ('youtube', 'media')
               AND transcript_source IN ('captions', 'ai_transcript', 'learner')));

ALTER TABLE documents DROP CONSTRAINT documents_needs_transcript_youtube;
ALTER TABLE documents ADD CONSTRAINT documents_needs_transcript_youtube
    CHECK (status <> 'needs_transcript' OR source_kind IN ('youtube', 'media'));

-- ──────────────────────────────────────────────────────── the recording

ALTER TABLE documents
    ADD COLUMN media_sha256 text NOT NULL DEFAULT '',
    -- The type sniffed from the file's own bytes at upload (connectors/media),
    -- from a closed list: it is the Content-Type the file is served with.
    ADD COLUMN media_mime text NOT NULL DEFAULT '',
    ADD COLUMN media_bytes bigint NOT NULL DEFAULT 0;

ALTER TABLE documents ADD CONSTRAINT documents_media_file
    CHECK ((source_kind = 'media') = (media_sha256 <> ''));
ALTER TABLE documents ADD CONSTRAINT documents_media_sha256_hex
    CHECK (media_sha256 = '' OR media_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE documents ADD CONSTRAINT documents_media_mime_known
    CHECK ((source_kind = 'media') = (media_mime <> '')
           AND media_mime IN ('', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm',
                              'video/mp4', 'video/webm', 'video/quicktime', 'video/mpeg'));
-- knowledge.MaxMediaBytes, 500 MB.
ALTER TABLE documents ADD CONSTRAINT documents_media_bytes_bounded
    CHECK (media_bytes >= 0 AND media_bytes <= 524288000);

-- The same recording twice in one knowledge base is the same document, which
-- is what knowledge.IsDuplicateDocument reports.
CREATE UNIQUE INDEX documents_kb_media_unique
    ON documents (kb_id, media_sha256) WHERE source_kind = 'media';
