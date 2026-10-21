-- Plan 261021-1100 phase 4: the provider catalog and models a learner adds.
--
-- 1. The provider list grows to internal/byok/catalog.go's rows.
--    TestCatalogMatchesTheDatabaseCheck pins this list to that table.
-- 2. provider_custom_models: model ids a learner adds by hand to one of their
--    connections, for a provider whose list leaves one out or that publishes
--    none. Scoped to the owner through the (user_id, id) key, and gone with
--    the connection.

ALTER TABLE provider_connections DROP CONSTRAINT provider_connections_provider_known;
ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_provider_known CHECK (
    provider IN ('gemini', 'openai', 'anthropic', 'openrouter',
                 'deepseek', 'qwen', 'mistral', 'xai', 'groq', 'zai',
                 'agnes', 'api_airforce', 'atria', 'bai', 'baidu', 'bazaarlink', 'blackbox',
                 'bluesminds', 'cerebras', 'chutes', 'cohere', 'dahl', 'featherless', 'fireworks',
                 'hyperbolic', 'kilo_gateway', 'kimchi', 'llm7', 'minimax', 'morph', 'muse',
                 'nebius', 'nvidia', 'ollama_cloud', 'perplexity', 'poolside', 'sambanova',
                 'siliconflow', 'tencent', 'together', 'tokenharbor', 'tokenrouter', 'venice',
                 'vercel_ai_gateway', 'xiaomi_mimo', 'yescale',
                 'openai_compat',
                 'chatgpt_relay', 'gemini_code_assist', 'github_copilot', 'claude_sub'));

CREATE TABLE provider_custom_models (
    connection_id uuid        NOT NULL,
    user_id       uuid        NOT NULL,
    model         text        NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (connection_id, model),
    FOREIGN KEY (user_id, connection_id) REFERENCES provider_connections (user_id, id) ON DELETE CASCADE
);
