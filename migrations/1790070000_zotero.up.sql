-- 1790070000_zotero — a learner's Zotero library as a knowledge-base source
-- (plans/260930-0915-up-methods, phase 20).
--
-- Back up the database before running this: it widens a CHECK constraint on
-- search_connections and adds a column and an index to documents.

-- ───────────────────────────────────────────────────────── a Zotero key

-- A Zotero key reads the learner's own library. Like a GitHub token it is a
-- search_connections row (one per user, encrypted) but not a web-search key:
-- byok.SearchFor and readiness read only byok.SearchProviders(). The
-- encrypted secret holds the library's numeric user id and the key together
-- ("<user id>:<key>"), so neither is ever stored or shown in clear.
ALTER TABLE search_connections DROP CONSTRAINT search_connections_provider_known;
ALTER TABLE search_connections ADD CONSTRAINT search_connections_provider_known
    CHECK (provider IN ('tavily', 'brave', 'openalex', 'github', 'zotero'));

-- ───────────────────────────────────────────── documents: the item's key

-- A document added from Zotero (its stored PDF, or a Markdown note of its
-- metadata) remembers the item it came from, so adding the same item to the
-- same knowledge base twice is refused. Zotero item keys are eight
-- characters of [23456789ABCDEFGHIJKLMNPQRSTUVWXYZ].
ALTER TABLE documents
    ADD COLUMN zotero_key text CHECK (zotero_key IS NULL OR zotero_key ~ '^[0-9A-Z]{8}$');

CREATE UNIQUE INDEX documents_kb_zotero_unique ON documents (kb_id, zotero_key)
    WHERE zotero_key IS NOT NULL;
