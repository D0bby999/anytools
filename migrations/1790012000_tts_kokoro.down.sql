-- The deleted Gemini routes are not restored: nothing would serve them.
DROP TABLE tts_usage;

ALTER TABLE audio_overviews
    DROP COLUMN tts_voices,
    DROP COLUMN tts_model,
    DROP COLUMN tts_engine;
