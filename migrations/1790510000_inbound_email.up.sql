-- learning-tool-connections phase 4: email in. Each learner has one address,
-- <token>@in.anytools.world; mail sent or forwarded there becomes documents.
--
-- token_hash is SHA-256 of the address's local part, for the lookup a
-- delivery makes; token_enc is the token itself, encrypted, so Learning apps
-- can show the address again. kb_id is where messages go (NULL until the
-- first message creates "Study inbox", or the learner picks one).
CREATE TABLE inbound_addresses (
    user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    token_enc  text  NOT NULL,
    kb_id      uuid REFERENCES knowledge_bases(id) ON DELETE SET NULL,

    -- Gmail's forwarding confirmation, shown on the card, never imported.
    confirm_code text NOT NULL DEFAULT '',
    confirm_link text NOT NULL DEFAULT '',
    confirm_at   timestamptz,

    created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per message received, keyed by its Message-ID: a message Gmail
-- delivers twice is filed once, and the rows are the daily count.
CREATE TABLE inbound_messages (
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id text NOT NULL CHECK (length(message_id) <= 1000),
    subject    text NOT NULL DEFAULT '' CHECK (length(subject) <= 1000),
    sender     text NOT NULL DEFAULT '' CHECK (length(sender) <= 1000),
    status     text NOT NULL CHECK (status IN ('imported', 'confirmation', 'empty', 'failed')),
    documents  integer NOT NULL DEFAULT 0,
    skipped    integer NOT NULL DEFAULT 0,
    kb_id      uuid REFERENCES knowledge_bases(id) ON DELETE SET NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, message_id)
);

CREATE INDEX inbound_messages_recent_idx ON inbound_messages (user_id, received_at DESC);
