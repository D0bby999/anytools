-- More API-key providers: OpenAI-compatible services at a known address
-- (internal/byok/presets.go). The provider list stays closed; this widens it.
ALTER TABLE provider_connections DROP CONSTRAINT provider_connections_provider_known;
ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_provider_known CHECK (
    provider IN ('openai', 'gemini', 'anthropic', 'openrouter', 'openai_compat',
                 'deepseek', 'xai', 'mistral', 'groq', 'qwen', 'zai',
                 'chatgpt_relay', 'gemini_code_assist'));
