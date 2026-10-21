-- 1789880000_video_notes — study notes of a YouTube video: the video's
-- sections, each with a summary and its key points, every one tied to a
-- second of the video (the private design notes).
--
-- One set of notes per video and language. The notes record the transcript
-- they were written from (its sha256), so a transcript replaced later shows
-- its notes as out of date instead of silently citing times that moved.

CREATE TABLE video_notes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id uuid NOT NULL,
    language    text NOT NULL CHECK (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
    transcript_sha256 text NOT NULL CHECK (transcript_sha256 ~ '^[0-9a-f]{64}$'),
    -- Validated by the engine before it is stored (videonotes.Validate).
    sections    jsonb NOT NULL CHECK (jsonb_typeof(sections) = 'array'),
    -- Creator chapters were the section boundaries (not the model's).
    from_chapters boolean NOT NULL DEFAULT false,
    model       text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT video_notes_document_owner
        FOREIGN KEY (document_id, user_id) REFERENCES documents (id, user_id) ON DELETE CASCADE,
    CONSTRAINT video_notes_one_per_language UNIQUE (user_id, document_id, language)
);

CREATE INDEX video_notes_document_idx ON video_notes (document_id);
