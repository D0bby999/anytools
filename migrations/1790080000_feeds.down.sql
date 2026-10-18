-- 1790080000_feeds, reversed. The documents feeds added stay: they are
-- ordinary documents. The learner's YouTube Data API keys are deleted.

DELETE FROM search_connections WHERE provider = 'youtube_data';
ALTER TABLE search_connections DROP CONSTRAINT search_connections_provider_known;
ALTER TABLE search_connections ADD CONSTRAINT search_connections_provider_known
    CHECK (provider IN ('tavily', 'brave', 'openalex', 'github', 'zotero'));

DROP TABLE feed_entries;
DROP TABLE feeds;
