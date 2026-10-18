-- 1789620000_jobs — the Postgres job queue every background phase runs on.
--
-- Red-team RT-8 / Assumption 6: the plan's first draft ran "in-process job
-- workers without lease/heartbeat/reaper", which means an API restart leaves a
-- document stuck in `parsing` forever with no row anywhere saying so. Every
-- column below exists to make that failure recoverable rather than invisible.

CREATE TABLE jobs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- user_id on EVERY table, including this one. A job payload names a
    -- document; without the owner on the row, a worker resolving that payload
    -- has to trust the payload for authorization. RT-3.
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    kind        text        NOT NULL,
    payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,

    status      text        NOT NULL DEFAULT 'queued'
                            CHECK (status IN ('queued', 'running', 'done', 'failed')),

    -- run_after is both the schedule and the backoff: a reaped job comes back
    -- with run_after in the future so a permanently-poisonous payload cannot
    -- spin the worker pool.
    run_after   timestamptz NOT NULL DEFAULT now(),

    -- The lease. locked_by names the worker; lease_expires_at is the deadline
    -- it must beat with a heartbeat. A worker that dies stops heartbeating and
    -- the reaper takes the row back — no distributed lock service, no
    -- assumption that a process exits cleanly.
    locked_by        text,
    lease_expires_at timestamptz,

    attempts     integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
    last_error   text    NOT NULL DEFAULT '',

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    -- A running row without a lease is unreapable: it would be claimed and then
    -- invisible to the sweeper forever. Make that state unrepresentable.
    CONSTRAINT jobs_running_has_lease CHECK (
        status <> 'running' OR (locked_by IS NOT NULL AND lease_expires_at IS NOT NULL)
    )
);

-- The claim query's index. Partial on the only status it ever reads, so its
-- size is the size of the backlog rather than the size of history.
CREATE INDEX jobs_claimable_idx ON jobs (run_after, created_at) WHERE status = 'queued';

-- The reaper's index, likewise partial.
CREATE INDEX jobs_expired_lease_idx ON jobs (lease_expires_at) WHERE status = 'running';

CREATE INDEX jobs_user_id_idx ON jobs (user_id);
