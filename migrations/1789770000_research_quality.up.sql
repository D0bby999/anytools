-- Research quality: the claim check, the questions still open after the last
-- search round, and which web engine was used (the user's key, or the keyless
-- DuckDuckGo fallback).
ALTER TABLE research_reports
    ADD COLUMN verification   jsonb,
    ADD COLUMN open_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN engine         text  NOT NULL DEFAULT ''
        CONSTRAINT research_reports_engine_known CHECK (engine IN ('', 'key', 'duckduckgo'));
