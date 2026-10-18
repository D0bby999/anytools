-- 1789810000_link_sources — web pages and YouTube videos as knowledge-base
-- documents (plans/260926-2301-learning-depth, phase 4).
--
-- Back up the database before running this: it replaces a uniqueness
-- constraint on documents, and the down migration refuses to run while link
-- documents exist.
--
-- A link document is identified by its URL, not by its bytes. Red team SF-12 /
-- AS-4: two blocked videos have no content to hash, and two URLs can return the
-- same cookie wall or paywall stub. Under UNIQUE (kb_id, sha256) the second one
-- of either could never be added, and a nightly re-sync landing on another
-- document's bytes would fail every night. So content-hash uniqueness now
-- applies to FILES only, and links are unique by (kb, kind, URL).

-- ───────────────────────────────────────────────────── kinds and statuses

ALTER TABLE documents DROP CONSTRAINT documents_source_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_source_kind_check
    CHECK (source_kind IN ('upload', 'drive', 'web', 'youtube'));

-- needs_transcript is a RESTING state, like ready and failed: nothing is
-- working on the document, and it waits for the learner (a subtitle file, a
-- pasted transcript, or an AI transcript they asked for).
ALTER TABLE documents DROP CONSTRAINT documents_status_check;
ALTER TABLE documents ADD CONSTRAINT documents_status_check
    CHECK (status IN ('queued', 'parsing', 'indexing', 'ready', 'failed', 'needs_transcript'));

-- ──────────────────────────────────────────────────────────── link columns

ALTER TABLE documents
    -- The canonical URL: the page, or https://www.youtube.com/watch?v=<id>.
    ADD COLUMN source_url text NOT NULL DEFAULT '',
    -- Web pages only: re-fetch on a schedule, re-index only on change.
    ADD COLUMN auto_sync boolean NOT NULL DEFAULT false,
    ADD COLUMN last_synced_at timestamptz,
    -- Consecutive syncs that found changed content. At 3 the page drops to a
    -- weekly re-sync, so a page that rotates a timestamp does not re-embed
    -- every night on the learner's key. Reset by an unchanged sync.
    ADD COLUMN sync_changes smallint NOT NULL DEFAULT 0 CHECK (sync_changes >= 0),
    -- Why the last sync did not happen. Recorded per document, so one broken
    -- page never stops the rest of the pass.
    ADD COLUMN sync_error text NOT NULL DEFAULT '',
    -- Videos: page N of the transcript covers [timeline[N-1][0], timeline[N-1][1]]
    -- seconds. What turns a citation's page into a point in the video.
    ADD COLUMN timeline jsonb,
    -- Videos: the 11-character YouTube id.
    ADD COLUMN media_id text NOT NULL DEFAULT '',
    -- Videos: channel, duration, available caption tracks, and why the server
    -- could not fetch captions. Display facts, never a URL the page loads.
    ADD COLUMN media jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Videos: whose transcript this is. An AI transcript can mishear and its
    -- times are approximate, so the viewer and the citation chips say so.
    ADD COLUMN transcript_source text;

ALTER TABLE documents ADD CONSTRAINT documents_link_has_url
    CHECK ((source_kind IN ('web', 'youtube')) = (source_url <> ''));
ALTER TABLE documents ADD CONSTRAINT documents_media_id_youtube
    CHECK (media_id = '' OR (source_kind = 'youtube' AND media_id ~ '^[A-Za-z0-9_-]{11}$'));
ALTER TABLE documents ADD CONSTRAINT documents_youtube_has_media_id
    CHECK (source_kind <> 'youtube' OR media_id <> '');
ALTER TABLE documents ADD CONSTRAINT documents_transcript_source_check
    CHECK (transcript_source IS NULL
           OR (source_kind = 'youtube' AND transcript_source IN ('captions', 'ai_transcript', 'learner')));
ALTER TABLE documents ADD CONSTRAINT documents_auto_sync_web
    CHECK (NOT auto_sync OR source_kind = 'web');
ALTER TABLE documents ADD CONSTRAINT documents_needs_transcript_youtube
    CHECK (status <> 'needs_transcript' OR source_kind = 'youtube');

-- ──────────────────────────────────────────────────────────── uniqueness

-- One document per link per knowledge base. The same URL added twice is the
-- same document, which is what knowledge.IsDuplicateDocument reports.
CREATE UNIQUE INDEX documents_kb_link_unique
    ON documents (kb_id, source_kind, source_url) WHERE source_url <> '';

-- Same NAME as the constraint it replaces, on purpose: IsDuplicateDocument and
-- every error message that names it keep meaning "this file is already here".
ALTER TABLE documents DROP CONSTRAINT documents_kb_sha_unique;
CREATE UNIQUE INDEX documents_kb_sha_unique
    ON documents (kb_id, sha256) WHERE source_kind IN ('upload', 'drive');

-- The sync job's scan: only auto-syncing pages, oldest sync first.
CREATE INDEX documents_auto_sync_idx
    ON documents (last_synced_at NULLS FIRST) WHERE auto_sync;
