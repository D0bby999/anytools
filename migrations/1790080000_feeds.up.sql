-- 1790080000_feeds — podcast feeds and YouTube playlists and channels as
-- knowledge-base sources (plans/260930-0915-up-methods, phase 17).
--
-- Back up the database before running this: it replaces a CHECK constraint
-- on search_connections.
--
-- A feed is a LIST the learner picks from, not a group of documents. Each
-- entry picked becomes an ordinary document: a podcast episode a `media`
-- document (up-methods phase 15), a YouTube video a `youtube` document
-- (learning-depth phase 4). Deleting a feed keeps the documents it added.

-- ──────────────────────────────────────────────────────────────── feeds

CREATE TABLE feeds (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kb_id   uuid NOT NULL,

    kind  text NOT NULL CHECK (kind IN ('podcast', 'youtube')),
    -- The feed's own URL: the podcast feed as the learner gave it, or
    -- YouTube's keyless feed of the playlist or channel.
    url   text NOT NULL CHECK (url ~ '^https?://' AND length(url) <= 2048),
    title text NOT NULL DEFAULT '' CHECK (length(title) <= 300),

    last_checked_at timestamptz,
    -- The last check's failure, in a sentence written for the learner; ''
    -- when it worked.
    check_error text NOT NULL DEFAULT '' CHECK (length(check_error) <= 500),
    -- New entries become documents by themselves, at most 5 a day, and are
    -- never transcribed by themselves.
    auto_add boolean NOT NULL DEFAULT false,
    -- What the last listing read: the keyless feed (a YouTube one lists only
    -- the latest 15 videos) or, for a playlist with the learner's key, the
    -- YouTube Data API (up to 500).
    listed_by text NOT NULL DEFAULT 'feed' CHECK (listed_by IN ('feed', 'data_api')),

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT feeds_id_user_unique UNIQUE (id, user_id),
    CONSTRAINT feeds_kb_same_owner
        FOREIGN KEY (kb_id, user_id) REFERENCES knowledge_bases (id, user_id) ON DELETE CASCADE,
    CONSTRAINT feeds_kb_url_unique UNIQUE (kb_id, url),
    CONSTRAINT feeds_data_api_youtube CHECK (listed_by = 'feed' OR kind = 'youtube')
);

CREATE INDEX feeds_user_id_idx ON feeds (user_id);
-- The daily check's scan.
CREATE INDEX feeds_due_idx ON feeds (last_checked_at);

-- ─────────────────────────────────────────────────────────────── entries

-- One row per episode or video a listing found, at most 500 per feed (the
-- service keeps the newest).
CREATE TABLE feed_entries (
    feed_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- A YouTube video id, or a digest of a podcast episode's guid.
    entry_key text NOT NULL CHECK (entry_key ~ '^[A-Za-z0-9_-]{1,64}$'),
    -- The entry's place in the latest listing (newest first, or playlist
    -- order).
    position integer NOT NULL DEFAULT 0 CHECK (position >= 0),

    title text NOT NULL CHECK (length(title) <= 300),
    published_at timestamptz,
    -- 0: the feed does not say.
    duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
    -- A podcast episode's enclosure. It is fetched once, when the episode is
    -- added, and never played from its host.
    media_url   text NOT NULL DEFAULT '' CHECK (media_url = '' OR (media_url ~ '^https?://' AND length(media_url) <= 2048)),
    media_type  text NOT NULL DEFAULT '' CHECK (length(media_type) <= 100),
    media_bytes bigint NOT NULL DEFAULT 0 CHECK (media_bytes >= 0),
    -- A YouTube entry's video.
    video_id text NOT NULL DEFAULT '' CHECK (video_id = '' OR video_id ~ '^[A-Za-z0-9_-]{11}$'),

    -- Found by a daily check after the feed's first listing, and not yet
    -- added or marked seen.
    is_new boolean NOT NULL DEFAULT false,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    -- Adding: '' (at rest), queued, or failed with a sentence.
    add_status text NOT NULL DEFAULT '' CHECK (add_status IN ('', 'queued', 'failed')),
    add_error  text NOT NULL DEFAULT '' CHECK (length(add_error) <= 300),
    -- When auto_add queued it: the daily cap counts these.
    auto_added_at timestamptz,
    -- The document the entry became. A document the learner deletes is
    -- forgotten here, and the entry can be added again.
    document_id uuid,

    PRIMARY KEY (feed_id, entry_key),
    CONSTRAINT feed_entries_feed_same_owner
        FOREIGN KEY (feed_id, user_id) REFERENCES feeds (id, user_id) ON DELETE CASCADE,
    CONSTRAINT feed_entries_document_same_owner
        FOREIGN KEY (document_id, user_id) REFERENCES documents (id, user_id) ON DELETE SET NULL (document_id),
    -- An entry is an episode or a video, never both.
    CONSTRAINT feed_entries_one_source CHECK ((media_url <> '') <> (video_id <> '')),
    CONSTRAINT feed_entries_failed_has_error CHECK (add_status <> 'failed' OR add_error <> '')
);

CREATE INDEX feed_entries_user_id_idx ON feed_entries (user_id);
CREATE INDEX feed_entries_document_idx ON feed_entries (document_id) WHERE document_id IS NOT NULL;
CREATE INDEX feed_entries_new_idx ON feed_entries (feed_id) WHERE is_new;

-- ─────────────────────────────────────────────── a YouTube Data API key

-- The learner's own YouTube Data API key lists a whole playlist. Like an
-- OpenAlex key or a GitHub token it is a search_connections row (one per
-- user, encrypted) but not a web-search key.
ALTER TABLE search_connections DROP CONSTRAINT search_connections_provider_known;
ALTER TABLE search_connections ADD CONSTRAINT search_connections_provider_known
    CHECK (provider IN ('tavily', 'brave', 'openalex', 'github', 'zotero', 'youtube_data'));
