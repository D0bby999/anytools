DROP TABLE paper_search_usage;
DROP TABLE related_paper_cache;

DELETE FROM search_connections WHERE provider = 'openalex';
ALTER TABLE search_connections DROP CONSTRAINT search_connections_provider_known;
ALTER TABLE search_connections ADD CONSTRAINT search_connections_provider_known
    CHECK (provider IN ('tavily', 'brave'));
