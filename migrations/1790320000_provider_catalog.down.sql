DROP TABLE IF EXISTS provider_custom_models;

-- Connections to providers the old list does not know cannot stay.
DELETE FROM provider_connections WHERE provider NOT IN (
    'openai', 'gemini', 'anthropic', 'openrouter', 'openai_compat',
    'deepseek', 'xai', 'mistral', 'groq', 'qwen', 'zai',
    'chatgpt_relay', 'gemini_code_assist', 'github_copilot', 'claude_sub');
ALTER TABLE provider_connections DROP CONSTRAINT provider_connections_provider_known;
ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_provider_known CHECK (
    provider IN ('openai', 'gemini', 'anthropic', 'openrouter', 'openai_compat',
                 'deepseek', 'xai', 'mistral', 'groq', 'qwen', 'zai',
                 'chatgpt_relay', 'gemini_code_assist', 'github_copilot', 'claude_sub'));
