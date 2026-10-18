-- Phase 22 (up methods): Kokoro instead of Gemini TTS.
--
-- 1. Gemini no longer speaks. Its `tts` route entries would only fail now,
--    so they go; the learner routes an OpenAI key or their own
--    OpenAI-compatible speech server instead, or uses the built-in voices.
-- 2. Each overview records who spoke it: the engine ('builtin', 'openai',
--    'openai_compat'), the model and the two voices. Finished audio is left
--    as it is; an overview spoken before this phase has an empty engine.
-- 3. tts_usage meters the server's built-in Kokoro, as stt_usage meters its
--    Whisper: seconds of speech per learner per LOCAL day, spent in one
--    statement (pg.EngineUsage).

DELETE FROM function_routes fr
 USING provider_connections c
 WHERE fr."function" = 'tts'
   AND c.id = fr.connection_id AND c.user_id = fr.user_id
   AND c.provider IN ('gemini', 'gemini_code_assist');

-- Who spoke each overview.
ALTER TABLE audio_overviews
    ADD COLUMN tts_engine text NOT NULL DEFAULT ''
        CHECK (tts_engine IN ('', 'builtin', 'openai', 'openai_compat')),
    ADD COLUMN tts_model  text NOT NULL DEFAULT '' CHECK (length(tts_model) <= 200),
    -- {"host": "af_heart", "expert": "am_michael"}
    ADD COLUMN tts_voices jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE tts_usage (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day     date NOT NULL,
    seconds int  NOT NULL DEFAULT 0 CHECK (seconds >= 0),
    PRIMARY KEY (user_id, day)
);
