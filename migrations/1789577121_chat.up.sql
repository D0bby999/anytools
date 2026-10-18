-- 1789577121_chat — grounded chat: sessions, linear messages, turns with
-- leases, and the per-turn event log the SSE stream replays from.
--
-- Four tables, four `user_id` columns. Red-team Security 5 / Assumption 7: the
-- isolation rule "every table carries user_id" was being read as "every ROOT
-- table", which quietly exempted child tables reachable only through a parent.
-- A child row is exactly where a mis-scoped join leaks, so every table here
-- carries the owner directly and every read filters on it — even when the
-- parent's id alone would have been enough.

-- chat_sessions — one conversation. kb_ids names the knowledge bases the model
-- may search; ownership of each is validated on WRITE (phase 6 `chatapi`) and
-- again per tool call (`internal/tools` authz gate), because a row written
-- before an unshare must not keep working.
CREATE TABLE chat_sessions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title             text        NOT NULL DEFAULT '',
    kb_ids            uuid[]      NOT NULL DEFAULT '{}',
    model_hint        text        NOT NULL DEFAULT '',
    -- "allow web in this session". No network tool exists until phase 9; this
    -- column is the gate they will be mounted behind, and it defaults to off so
    -- adding such a tool cannot silently enable it for existing sessions.
    allow_web         boolean     NOT NULL DEFAULT false,
    learning_state_id uuid,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_sessions_user_updated_idx ON chat_sessions (user_id, updated_at DESC);

-- chat_messages — LINEAR history. No parent_message_id: edit-branching is a
-- DeepTutor feature that is not in this product's contract, and a nullable
-- parent pointer nobody sets is a tree that every reader must still handle.
-- Recorded as backlog in phase-06, not built here.
CREATE TABLE chat_messages (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id  uuid        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role        text        NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content     text        NOT NULL DEFAULT '',
    capability  text        NOT NULL DEFAULT '',
    attachments jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_messages_session_idx ON chat_messages (session_id, created_at, id);

-- turns — one run of the orchestrator loop.
--
-- The lease is what makes a crash recoverable (red-team Security 9,
-- Assumption 6). A worker claims a turn by writing lease_expires_at into the
-- future and refreshes it every 10 s; a process that dies stops refreshing, and
-- the recovery sweeper fails the turn with WORKER_LOST once the lease is stale.
-- Without it a killed API leaves `running` rows and open browsers waiting for a
-- stream that will never produce another byte.
CREATE TABLE turns (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id           uuid        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    capability           text        NOT NULL DEFAULT 'chat',
    status               text        NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued', 'running', 'waiting_user', 'done', 'failed', 'cancelled')),
    failure_code         text        NOT NULL DEFAULT '',
    retryable            boolean     NOT NULL DEFAULT false,
    lease_expires_at     timestamptz,
    heartbeat_at         timestamptz,
    attempt              integer     NOT NULL DEFAULT 0,
    error                text        NOT NULL DEFAULT '',
    provider             text        NOT NULL DEFAULT '',
    model                text        NOT NULL DEFAULT '',
    usage                jsonb       NOT NULL DEFAULT '{}'::jsonb,
    -- No assistant_message_id. DeepTutor's turns table carries one
    -- (sqlite_store.py:283) and it was copied here before anything read or
    -- wrote it. A column with no reader is a column that will be wrong when
    -- someone finally trusts it; phase 8 can add it, with the code that
    -- maintains it, in the same change.
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    finished_at          timestamptz
);

CREATE INDEX turns_session_idx ON turns (session_id, created_at DESC);

-- The sweeper's only query. Partial, because the rows it looks for are a tiny
-- slice of the table and every other status is dead weight in the index.
-- waiting_user is included: a turn parked on ask_user keeps its lease
-- refreshed while its worker lives, so a stale lease there means the same thing
-- it means for `running` — nobody is coming back for it.
CREATE INDEX turns_expired_lease_idx ON turns (lease_expires_at)
    WHERE status IN ('running', 'waiting_user');

-- turn_events — the per-turn append-only log the SSE endpoint replays from.
--
-- (turn_id, seq) is the primary key, which IS the unique(turn_id, seq) the
-- phase requires: seq is the client's resume cursor, and two rows sharing one
-- would make `after_seq` ambiguous — the client would either skip an event or
-- receive it twice, which is precisely the property Spike D measured to zero.
CREATE TABLE turn_events (
    turn_id    uuid        NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seq        bigint      NOT NULL CHECK (seq > 0),
    type       text        NOT NULL,
    source     text        NOT NULL DEFAULT '',
    stage      text        NOT NULL DEFAULT '',
    content    text        NOT NULL DEFAULT '',
    metadata   jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (turn_id, seq)
);

CREATE INDEX turn_events_user_idx ON turn_events (user_id);
