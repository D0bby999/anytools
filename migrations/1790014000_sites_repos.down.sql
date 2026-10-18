-- Reverse of 1790014000_sites_repos.
--
-- Refuses rather than deletes, like 1789810000's down: the old schema cannot
-- represent a site page or a repository file. An operator who really wants
-- the rollback deletes them first:
--
--     DELETE FROM sites; DELETE FROM repos;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM documents WHERE source_kind IN ('site_page', 'repo_file')) THEN
        RAISE EXCEPTION 'site pages or repository files exist; delete every row of sites and repos before rolling back 1790014000_sites_repos';
    END IF;
END
$$;

DELETE FROM search_connections WHERE provider = 'github';
ALTER TABLE search_connections DROP CONSTRAINT search_connections_provider_known;
ALTER TABLE search_connections ADD CONSTRAINT search_connections_provider_known
    CHECK (provider IN ('tavily', 'brave', 'openalex'));

DROP TABLE site_pages;

ALTER TABLE documents DROP CONSTRAINT documents_link_has_url;
ALTER TABLE documents ADD CONSTRAINT documents_link_has_url
    CHECK ((source_kind IN ('web', 'youtube')) = (source_url <> ''));

DROP INDEX IF EXISTS documents_repo_idx;
DROP INDEX IF EXISTS documents_site_idx;

ALTER TABLE documents
    DROP CONSTRAINT documents_line_unit_repo,
    DROP CONSTRAINT documents_removed_grouped,
    DROP CONSTRAINT documents_repo_file_has_path,
    DROP CONSTRAINT documents_repo_file_has_repo,
    DROP CONSTRAINT documents_site_page_has_site,
    DROP CONSTRAINT documents_repo_same_owner,
    DROP CONSTRAINT documents_site_same_owner,
    DROP COLUMN page_unit,
    DROP COLUMN removed_at,
    DROP COLUMN source_path,
    DROP COLUMN repo_id,
    DROP COLUMN site_id;

ALTER TABLE documents DROP CONSTRAINT documents_source_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_source_kind_check
    CHECK (source_kind IN ('upload', 'drive', 'web', 'youtube'));

DROP TABLE repos;
DROP TABLE sites;
