DROP TABLE stt_usage;

DELETE FROM function_routes WHERE "function" = 'stt';
ALTER TABLE function_routes DROP CONSTRAINT function_routes_function_known;
ALTER TABLE function_routes ADD CONSTRAINT function_routes_function_known CHECK (
    "function" IN ('chat', 'parse', 'embed', 'quiz', 'mastery', 'reading',
                   'solve', 'research', 'rerank', 'tts'));
