-- Two more experimental subscription lanes: GitHub Copilot (device sign-in)
-- and Claude Pro/Max (pasted code). Both keep their tokens in
-- oauth_credentials like the existing lanes.
ALTER TABLE provider_connections DROP CONSTRAINT provider_connections_provider_known;
ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_provider_known CHECK (
    provider IN ('openai', 'gemini', 'anthropic', 'openrouter', 'openai_compat',
                 'deepseek', 'xai', 'mistral', 'groq', 'qwen', 'zai',
                 'chatgpt_relay', 'gemini_code_assist', 'github_copilot', 'claude_sub'));

ALTER TABLE provider_connections DROP CONSTRAINT provider_connections_kind_known;
ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_kind_known CHECK (
    kind IN ('api_key', 'oauth_relay', 'oauth_gemini_sub', 'oauth_copilot', 'oauth_claude_sub'));
