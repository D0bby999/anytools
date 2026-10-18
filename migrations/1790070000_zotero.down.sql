-- Reverse of 1790070000_zotero.
--
-- Documents added from Zotero stay: they are ordinary uploads, and only the
-- item key that refused a second copy is dropped. The learner's Zotero key
-- is deleted, since the old constraint cannot hold it.
DROP INDEX IF EXISTS documents_kb_zotero_unique;
ALTER TABLE documents DROP COLUMN zotero_key;

DELETE FROM search_connections WHERE provider = 'zotero';
ALTER TABLE search_connections DROP CONSTRAINT search_connections_provider_known;
ALTER TABLE search_connections ADD CONSTRAINT search_connections_provider_known
    CHECK (provider IN ('tavily', 'brave', 'openalex', 'github'));
