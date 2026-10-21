-- 1790014000_sites_repos — documentation sites and GitHub repositories as
-- knowledge-base sources (the private design notes, phase 18).
--
-- Back up the database before running this: it widens CHECK constraints on
-- documents, and the down migration refuses to run while site pages or
-- repository files exist.
--
-- A site or a repository is a GROUP of ordinary documents. Each crawled page
-- is a `site_page` document with its own URL, and each imported file a
-- `repo_file` document with its own path, so a citation names the page or the
-- file, never the group. Deleting the group deletes its documents (and their
-- chunks) by cascade; the service removes their files first.

-- ──────────────────────────────────────────────────────────────── sites

CREATE TABLE sites (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kb_id   uuid NOT NULL,

    -- The canonical https start URL. Links are followed only on its origin
    -- and under path_prefix (the start URL's directory).
    start_url   text NOT NULL CHECK (start_url ~ '^https://' AND length(start_url) <= 2048),
    path_prefix text NOT NULL CHECK (path_prefix ~ '^/' AND length(path_prefix) <= 2048),
    -- DeepTutor's limits, lowered for a learner's key: depth 0-3, at most
    -- 200 pages.
    max_depth smallint NOT NULL CHECK (max_depth BETWEEN 0 AND 3),
    max_pages smallint NOT NULL CHECK (max_pages BETWEEN 1 AND 200),

    title  text NOT NULL DEFAULT '' CHECK (length(title) <= 300),
    status text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'crawling', 'ready', 'failed', 'cancelled')),
    error  text NOT NULL DEFAULT '' CHECK (length(error) <= 500),
    -- The crawl job in flight or last run, for cancel and progress.
    job_id uuid,
    -- robots.txt as read once at the start of the current crawl, so a
    -- resumed crawl obeys the same rules it started with. NULL: the site has
    -- none (everything allowed).
    robots_txt text CHECK (robots_txt IS NULL OR length(robots_txt) <= 524288),
    -- Each crawl is a generation; a page not reached by a finished generation
    -- is gone from the site.
    generation integer NOT NULL DEFAULT 0 CHECK (generation >= 0),
    last_crawled_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT sites_id_user_unique UNIQUE (id, user_id),
    CONSTRAINT sites_kb_same_owner
        FOREIGN KEY (kb_id, user_id) REFERENCES knowledge_bases (id, user_id) ON DELETE CASCADE,
    CONSTRAINT sites_kb_start_unique UNIQUE (kb_id, start_url),
    CONSTRAINT sites_failed_has_error CHECK (status <> 'failed' OR error <> '')
);

CREATE INDEX sites_user_id_idx ON sites (user_id);
-- The weekly re-sync's scan.
CREATE INDEX sites_due_idx ON sites (last_crawled_at) WHERE status IN ('ready', 'failed');

-- ─────────────────────────────────────────────────────────── repositories

CREATE TABLE repos (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kb_id   uuid NOT NULL,

    owner text NOT NULL CHECK (owner ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$'),
    name  text NOT NULL CHECK (name ~ '^[A-Za-z0-9._-]{1,100}$' AND name NOT IN ('.', '..')),
    -- '' follows the repository's default branch; resolved_branch is what
    -- the last sync found it to be.
    branch          text NOT NULL DEFAULT '' CHECK (length(branch) <= 255),
    resolved_branch text NOT NULL DEFAULT '' CHECK (length(resolved_branch) <= 255),
    -- '' is the root; otherwise a relative path without a trailing slash.
    path_prefix text NOT NULL DEFAULT '' CHECK (length(path_prefix) <= 512),
    -- File types imported, lowercase with the dot: ['.md', '.mdx', ...].
    extensions  text[] NOT NULL CHECK (cardinality(extensions) BETWEEN 1 AND 40),
    -- The learner's own .gitignore-style patterns, on top of the defaults.
    ignore_paths text[] NOT NULL DEFAULT '{}' CHECK (cardinality(ignore_paths) <= 50),

    status text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'syncing', 'ready', 'failed')),
    error  text NOT NULL DEFAULT '' CHECK (length(error) <= 500),
    -- A one-line note on what the last import left out (the file cap).
    note   text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
    job_id uuid,
    -- The commit the documents reflect. A re-sync whose latest commit is
    -- this one does no work.
    commit_sha text NOT NULL DEFAULT '' CHECK (commit_sha = '' OR commit_sha ~ '^[0-9a-f]{40}$'),
    file_count integer NOT NULL DEFAULT 0 CHECK (file_count >= 0),
    last_synced_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT repos_id_user_unique UNIQUE (id, user_id),
    CONSTRAINT repos_kb_same_owner
        FOREIGN KEY (kb_id, user_id) REFERENCES knowledge_bases (id, user_id) ON DELETE CASCADE,
    CONSTRAINT repos_kb_source_unique UNIQUE (kb_id, owner, name, branch, path_prefix),
    CONSTRAINT repos_failed_has_error CHECK (status <> 'failed' OR error <> '')
);

CREATE INDEX repos_user_id_idx ON repos (user_id);
CREATE INDEX repos_due_idx ON repos (last_synced_at) WHERE status IN ('ready', 'failed');

-- ─────────────────────────────────────────────────── documents: two kinds

ALTER TABLE documents DROP CONSTRAINT documents_source_kind_check;
ALTER TABLE documents ADD CONSTRAINT documents_source_kind_check
    CHECK (source_kind IN ('upload', 'drive', 'web', 'youtube', 'site_page', 'repo_file'));

ALTER TABLE documents
    ADD COLUMN site_id uuid,
    ADD COLUMN repo_id uuid,
    -- A repository file's path inside the repository.
    ADD COLUMN source_path text NOT NULL DEFAULT '' CHECK (length(source_path) <= 1024),
    -- Set when the page or file is no longer in its site or repository. The
    -- document stays (and stays citable) until the learner deletes it.
    ADD COLUMN removed_at timestamptz,
    -- What a chunk's page numbers count: pages, or lines of a code file.
    ADD COLUMN page_unit text NOT NULL DEFAULT 'page' CHECK (page_unit IN ('page', 'line')),
    ADD CONSTRAINT documents_site_same_owner
        FOREIGN KEY (site_id, user_id) REFERENCES sites (id, user_id) ON DELETE CASCADE,
    ADD CONSTRAINT documents_repo_same_owner
        FOREIGN KEY (repo_id, user_id) REFERENCES repos (id, user_id) ON DELETE CASCADE,
    ADD CONSTRAINT documents_site_page_has_site
        CHECK ((source_kind = 'site_page') = (site_id IS NOT NULL)),
    ADD CONSTRAINT documents_repo_file_has_repo
        CHECK ((source_kind = 'repo_file') = (repo_id IS NOT NULL)),
    ADD CONSTRAINT documents_repo_file_has_path
        CHECK ((source_kind = 'repo_file') = (source_path <> '')),
    ADD CONSTRAINT documents_removed_grouped
        CHECK (removed_at IS NULL OR source_kind IN ('site_page', 'repo_file')),
    ADD CONSTRAINT documents_line_unit_repo
        CHECK (page_unit = 'page' OR source_kind = 'repo_file');

-- Pages and files carry a URL, like links, and are unique by it per
-- knowledge base (documents_kb_link_unique already covers every row with a
-- URL).
ALTER TABLE documents DROP CONSTRAINT documents_link_has_url;
ALTER TABLE documents ADD CONSTRAINT documents_link_has_url
    CHECK ((source_kind IN ('web', 'youtube', 'site_page', 'repo_file')) = (source_url <> ''));

CREATE INDEX documents_site_idx ON documents (site_id) WHERE site_id IS NOT NULL;
CREATE INDEX documents_repo_idx ON documents (repo_id, source_path) WHERE repo_id IS NOT NULL;

-- ───────────────────────────────────────────────────────── crawl frontier

-- One row per URL a crawl found. A crawl job's unit i is the row whose
-- crawl_ord is i in the current generation, so a retried job resumes at the
-- first unfinished page and never fetches one twice.
CREATE TABLE site_pages (
    site_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url     text NOT NULL CHECK (url ~ '^https://' AND length(url) <= 2048),
    depth   smallint NOT NULL CHECK (depth BETWEEN 0 AND 3),
    -- NULL: known from an earlier generation, not (yet) reached by this one.
    crawl_ord smallint CHECK (crawl_ord IS NULL OR crawl_ord BETWEEN 0 AND 199),
    status text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'added', 'changed', 'unchanged', 'skipped', 'failed', 'removed')),
    reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 300),
    document_id uuid,
    updated_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (site_id, url),
    CONSTRAINT site_pages_ord_unique UNIQUE (site_id, crawl_ord),
    CONSTRAINT site_pages_site_same_owner
        FOREIGN KEY (site_id, user_id) REFERENCES sites (id, user_id) ON DELETE CASCADE,
    -- A page whose document the learner deleted forgets it, and a re-sync
    -- adds it again.
    CONSTRAINT site_pages_document_same_owner
        FOREIGN KEY (document_id, user_id) REFERENCES documents (id, user_id) ON DELETE SET NULL (document_id)
);

CREATE INDEX site_pages_user_id_idx ON site_pages (user_id);
CREATE INDEX site_pages_document_idx ON site_pages (document_id) WHERE document_id IS NOT NULL;

-- ───────────────────────────────────────────────────────── a GitHub token

-- A GitHub token reads private repositories. Like an OpenAlex key it is a
-- search_connections row (one per user, encrypted) but not a web-search key:
-- byok.SearchFor and readiness read only byok.SearchProviders().
ALTER TABLE search_connections DROP CONSTRAINT search_connections_provider_known;
ALTER TABLE search_connections ADD CONSTRAINT search_connections_provider_known
    CHECK (provider IN ('tavily', 'brave', 'openalex', 'github'));
