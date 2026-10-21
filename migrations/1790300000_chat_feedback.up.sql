-- 1790300000_chat_feedback — Like / Dislike on one answer (after postclaw's
-- chat_message_feedback). One rating per learner and answer: rating again
-- overwrites, retracting deletes. The answer's id is the key: AnyTools'
-- messages have stable ids, and a rewind that deletes the answer deletes its
-- rating with it. provider and model are copied server-side from the stored
-- answer (attachments.served), never taken from the client, and no message
-- text is copied here.
CREATE TABLE chat_feedback (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id  uuid        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    message_id  uuid        NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    rating      text        NOT NULL CHECK (rating IN ('good', 'bad')),
    category    text,
    comment     text        CHECK (comment IS NULL OR char_length(comment) <= 2000),
    provider    text        NOT NULL DEFAULT '',
    model       text        NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, message_id)
);

CREATE INDEX chat_feedback_session_idx ON chat_feedback (user_id, session_id);
-- The operator's query (docs/deployment.md): ratings per model over a window.
CREATE INDEX chat_feedback_model_idx ON chat_feedback (model, rating, created_at DESC);
