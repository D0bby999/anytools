-- 1789576769_byok — BYOK connections, function routes, search keys, OAuth tokens.
--
-- Free + BYOK only. There is no platform key of any kind, LLM or search, so
-- every row here belongs to exactly one user and nothing runs for a user who
-- has connected nothing.

-- provider_connections — one credential the user pasted or authorised.
--
-- `settings` carries the chain's own state (cooldown_until, backoff_level,
-- verify_status) rather than separate columns, because that state is written on
-- the hot failure path and read on the hot serve path: one jsonb round-trip
-- beats five column writes, and phases 5-9 will add fields to it without a
-- migration each time. postclaw dropped api_base and settings from the plan's
-- version of this table and lost both SSRF validation and cooldown persistence
-- with them (red-team RT-11).
CREATE TABLE provider_connections (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider    text        NOT NULL,
    kind        text        NOT NULL DEFAULT 'api_key',
    name        text        NOT NULL,
    api_base    text        NOT NULL DEFAULT '',
    secret_enc  text        NOT NULL DEFAULT '',
    settings    jsonb       NOT NULL DEFAULT '{}'::jsonb,
    verified_at timestamptz,
    last_error  text        NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    -- The provider list is closed. An unknown value would reach a client that
    -- does not exist and fail at serve time instead of at write time.
    CONSTRAINT provider_connections_provider_known CHECK (
        provider IN ('openai', 'gemini', 'anthropic', 'openrouter', 'openai_compat',
                     'chatgpt_relay', 'gemini_code_assist')),

    -- api_key holds a pasted secret; the two oauth kinds hold their tokens in
    -- oauth_credentials instead and leave secret_enc empty.
    CONSTRAINT provider_connections_kind_known CHECK (
        kind IN ('api_key', 'oauth_relay', 'oauth_gemini_sub')),

    -- The name is what the routes UI shows, so two connections cannot share one.
    CONSTRAINT provider_connections_name_unique UNIQUE (user_id, name),

    -- Not redundant with the primary key: it is the target of the composite
    -- foreign keys below, which is what makes "a route may only point at a
    -- connection belonging to the same user" a database guarantee rather than a
    -- rule every handler has to remember.
    CONSTRAINT provider_connections_user_scoped_id UNIQUE (user_id, id)
);

CREATE INDEX provider_connections_user_id_idx ON provider_connections (user_id);

-- function_routes — the user's ordered fallback chain for one capability.
--
-- The function list is generated from ONE Go constant list
-- (internal/byok.AllFunctions) and pinned to this CHECK by
-- internal/byok/functions_migration_test.go. Red-team RT-13 found the plan's
-- earlier enum missing `mastery` and `reading` precisely because the list lived
-- in two places.
CREATE TABLE function_routes (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "function"    text        NOT NULL,
    position      int         NOT NULL,
    connection_id uuid        NOT NULL,
    model         text        NOT NULL DEFAULT '',
    -- dims is the embedding width this entry resolved to on verify. Only the
    -- `embed` function sets it; readiness warns when a knowledge base was built
    -- at a different width (phase 5 owns the re-embed).
    dims          int,
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT function_routes_function_known CHECK (
        "function" IN ('chat', 'parse', 'embed', 'quiz', 'mastery', 'reading',
                       'solve', 'research', 'rerank')),

    -- Chain length 5. A longer chain means a single failing turn can spend five
    -- provider timeouts before answering, which is already the outer bound of
    -- what a user will wait.
    CONSTRAINT function_routes_position_range CHECK (position >= 0 AND position < 5),
    CONSTRAINT function_routes_order_unique UNIQUE (user_id, "function", position),

    -- Cross-user isolation, enforced by the database rather than by a WHERE
    -- clause somebody might forget: the pair (user_id, connection_id) must name
    -- a connection that user owns.
    CONSTRAINT function_routes_connection_same_user
        FOREIGN KEY (user_id, connection_id)
        REFERENCES provider_connections (user_id, id) ON DELETE CASCADE
);

CREATE INDEX function_routes_user_function_idx ON function_routes (user_id, "function", position);
CREATE INDEX function_routes_connection_idx ON function_routes (connection_id);

-- search_connections — web-search keys, deliberately NOT a function_routes row.
--
-- A Tavily key is not an LLM connection: it has no model, no chain position and
-- no cooldown curve, and the plan's earlier shape overloaded `research` with
-- both (red-team RT-13). There is no platform search key either: with no key,
-- research runs KB-only and readiness says so.
CREATE TABLE search_connections (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider    text        NOT NULL,
    secret_enc  text        NOT NULL,
    verified_at timestamptz,
    last_error  text        NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT search_connections_provider_known CHECK (provider IN ('tavily', 'brave')),
    CONSTRAINT search_connections_one_per_provider UNIQUE (user_id, provider)
);

CREATE INDEX search_connections_user_id_idx ON search_connections (user_id);

-- oauth_credentials — the token pair for a subscription-lane connection.
--
-- Split from provider_connections so that reading a connection to build a chat
-- client does not pull an access token into memory it has no use for, and so a
-- refresh writes one narrow row. Both columns go through encryptOrFail; a
-- refresh token for the Gemini Code Assist lane carries `cloud-platform` scope,
-- which makes it a full GCP credential for that user rather than an AI quota
-- (spike A, "Impersonation + ToS exposure").
CREATE TABLE oauth_credentials (
    connection_id uuid PRIMARY KEY,
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_enc    text        NOT NULL DEFAULT '',
    refresh_enc   text        NOT NULL DEFAULT '',
    expires_at    timestamptz,
    rotated_at    timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT oauth_credentials_connection_same_user
        FOREIGN KEY (user_id, connection_id)
        REFERENCES provider_connections (user_id, id) ON DELETE CASCADE
);

CREATE INDEX oauth_credentials_user_id_idx ON oauth_credentials (user_id);
