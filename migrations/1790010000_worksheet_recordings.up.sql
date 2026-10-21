-- 1790010000_worksheet_recordings — the learner's own voice on a worksheet
-- (the private design notes, phase 7): the raw recordings up's speaking
-- evidence card keeps — baselines, shadowing levels, delayed retests.
--
-- The audio is a blob.ObjectStore object in namespace `recordings`, keyed by
-- the row id, as audio overviews are. Objects go before rows: the worksheet
-- store deletes a recording's file first, then its row; a worksheet, a
-- document or a knowledge base deletes its recordings' files before its own
-- rows cascade here (knowledge.RecordingCleaner). Account deletion removes the
-- user's whole objects directory.

CREATE TABLE worksheet_recordings (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    worksheet_id     uuid NOT NULL,
    mime             text NOT NULL CHECK (mime IN ('audio/webm', 'audio/ogg', 'audio/mp4')),
    -- 10 MB and ten minutes per recording, checked by the API first.
    bytes            int  NOT NULL CHECK (bytes BETWEEN 1 AND 10485760),
    duration_seconds int  NOT NULL CHECK (duration_seconds BETWEEN 0 AND 600),
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT worksheet_recordings_id_user_unique UNIQUE (id, user_id),
    CONSTRAINT worksheet_recordings_worksheet_owner FOREIGN KEY (worksheet_id, user_id)
        REFERENCES worksheets (id, user_id) ON DELETE CASCADE
);

CREATE INDEX worksheet_recordings_worksheet_idx ON worksheet_recordings (worksheet_id, created_at);
-- The 500 MB per-user quota is a sum over this index.
CREATE INDEX worksheet_recordings_user_idx ON worksheet_recordings (user_id);
