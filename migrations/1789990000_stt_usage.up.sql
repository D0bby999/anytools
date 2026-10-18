-- Phase 21 (up methods): transcription engines.
--
-- 1. `stt` becomes a routable BYOK function: the learner's own OpenAI, Groq,
--    Gemini or OpenAI-compatible speech-to-text key.
-- 2. stt_usage meters the server's built-in Whisper engine, the one approved
--    piece of platform compute: seconds of audio per learner per LOCAL day
--    (learning.LocalDay), spent in one statement (pg.EngineUsage).

ALTER TABLE function_routes DROP CONSTRAINT function_routes_function_known;
ALTER TABLE function_routes ADD CONSTRAINT function_routes_function_known CHECK (
    "function" IN ('chat', 'parse', 'embed', 'quiz', 'mastery', 'reading',
                   'solve', 'research', 'rerank', 'tts', 'stt'));

CREATE TABLE stt_usage (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day     date NOT NULL,
    seconds int  NOT NULL DEFAULT 0 CHECK (seconds >= 0),
    PRIMARY KEY (user_id, day)
);
