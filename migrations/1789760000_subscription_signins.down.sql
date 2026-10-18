DELETE FROM provider_connections WHERE provider IN ('github_copilot', 'claude_sub');
ALTER TABLE provider_connections DROP CONSTRAINT provider_connections_kind_known;
ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_kind_known CHECK (
    kind IN ('api_key', 'oauth_relay', 'oauth_gemini_sub'));
ALTER TABLE provider_connections DROP CONSTRAINT provider_connections_provider_known;
ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_provider_known CHECK (
    provider IN ('openai', 'gemini', 'anthropic', 'openrouter', 'openai_compat',
                 'deepseek', 'xai', 'mistral', 'groq', 'qwen', 'zai',
                 'chatgpt_relay', 'gemini_code_assist'));
