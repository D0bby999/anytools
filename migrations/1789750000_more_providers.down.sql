-- Connections to the added providers are removed; their route entries go with
-- them through the foreign key.
DELETE FROM provider_connections WHERE provider IN ('deepseek', 'xai', 'mistral', 'groq', 'qwen', 'zai');
ALTER TABLE provider_connections DROP CONSTRAINT provider_connections_provider_known;
ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_provider_known CHECK (
    provider IN ('openai', 'gemini', 'anthropic', 'openrouter', 'openai_compat',
                 'chatgpt_relay', 'gemini_code_assist'));
