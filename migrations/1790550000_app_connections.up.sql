-- learning-tool-connections phases 8 and 9: a learner's OAuth grant to a
-- learning tool outside Google (Canva, Notion). Tokens are encrypted at rest;
-- refresh tokens rotate, so each refresh rewrites both.
CREATE TABLE app_connections (
    user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('canva', 'notion')),
    refresh_enc text NOT NULL DEFAULT '',
    access_enc  text NOT NULL,
    expires_at  timestamptz,
    scope       text NOT NULL DEFAULT '' CHECK (length(scope) <= 2000),
    account_label text NOT NULL DEFAULT '' CHECK (length(account_label) <= 300),
    needs_reconnect boolean NOT NULL DEFAULT false,
    last_error  text NOT NULL DEFAULT '' CHECK (length(last_error) <= 500),
    connected_at timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, provider)
);

-- Phase 9: Notion pages and databases imported into a knowledge base, so a
-- change in Notion is imported again (last_edited is Notion's
-- last_edited_time) and a page no longer shared is marked gone.
CREATE TABLE notion_pages (
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page_id     text NOT NULL CHECK (length(page_id) BETWEEN 1 AND 64),
    kind        text NOT NULL CHECK (kind IN ('page', 'database')),
    title       text NOT NULL DEFAULT '' CHECK (length(title) <= 500),
    kb_id       uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
    last_edited text NOT NULL DEFAULT '',
    synced_at   timestamptz,
    gone        boolean NOT NULL DEFAULT false,
    last_error  text NOT NULL DEFAULT '' CHECK (length(last_error) <= 500),
    PRIMARY KEY (user_id, page_id)
);
