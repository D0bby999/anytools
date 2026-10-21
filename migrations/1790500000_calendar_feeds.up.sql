-- learning-tool-connections phase 2: the study calendar as a subscription
-- feed, /cal/<token>.ics. One feed per learner.
--
-- token_hash is SHA-256 of the token and is how a calendar app's request is
-- matched; token_enc is the token itself, encrypted like every other secret,
-- so Learning apps can show the URL again. Rotating replaces both.
CREATE TABLE calendar_feeds (
    user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    token_enc  text  NOT NULL,

    -- Off by default: generic titles, so a leaked URL names no goal.
    named boolean NOT NULL DEFAULT false,
    include_review boolean NOT NULL DEFAULT true,
    include_loop   boolean NOT NULL DEFAULT true,
    include_body   boolean NOT NULL DEFAULT true,

    created_at      timestamptz NOT NULL DEFAULT now(),
    last_fetched_at timestamptz
);
