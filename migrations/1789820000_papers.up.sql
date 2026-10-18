-- Papers (learning-depth phase 6): an optional OpenAlex key, the cached
-- related-papers list, and the per-user share of the keyless OpenAlex budget.

-- An OpenAlex key is a search_connections row but NOT a web-search key:
-- byok.SearchFor and readiness read only byok.SearchProviders() (Tavily,
-- Brave); byok.PaperKeyFor reads this one.
ALTER TABLE search_connections DROP CONSTRAINT search_connections_provider_known;
ALTER TABLE search_connections ADD CONSTRAINT search_connections_provider_known
    CHECK (provider IN ('tavily', 'brave', 'openalex'));

-- A knowledge base's related papers, per normalised focus, for a day: a
-- revisit costs no model call and no search.
CREATE TABLE related_paper_cache (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kb_id   uuid NOT NULL,
    focus   text NOT NULL CHECK (length(focus) <= 80),
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, kb_id, focus),
    CONSTRAINT related_paper_cache_kb_fk FOREIGN KEY (kb_id, user_id)
        REFERENCES knowledge_bases (id, user_id) ON DELETE CASCADE
);

-- Keyless OpenAlex searches spent per user per UTC day. Without a key every
-- user shares one allowance per server IP (about 100 a day), so one user may
-- not spend all of it (red team SF-6).
CREATE TABLE paper_search_usage (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day     date NOT NULL,
    count   int  NOT NULL DEFAULT 0 CHECK (count >= 0),
    PRIMARY KEY (user_id, day)
);
