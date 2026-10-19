-- 1790190000_push_reminders — the daily review reminder, sent as a web push
-- (plans/261019-1215-anylearn-pwa-reminders).
--
--  1. push_vapid — the server's one VAPID key pair, made on first use. The
--     private key is encrypted under ANYTOOLS_ENCRYPTION_KEY like every other
--     secret. One row, like app_sentinel: a second pair would orphan every
--     subscription made under the first.
--
--  2. push_subscriptions — one row per browser that turned reminders on. The
--     endpoint is the push service's URL for that browser; it is unique across
--     users because a browser that signs in as someone else re-subscribes and
--     the row moves with it.
--
--  3. users.reminder_hour — the learner's local hour for the reminder.
--     users.reminder_sent_on — the learner's local day it last went out, so
--     an hourly job sends at most one a day, across restarts.

CREATE TABLE push_vapid (
    id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    public_key  text        NOT NULL,
    private_key_enc text    NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_subscriptions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   text        NOT NULL UNIQUE CHECK (length(endpoint) <= 2048),
    p256dh     text        NOT NULL CHECK (length(p256dh) <= 256),
    auth       text        NOT NULL CHECK (length(auth) <= 64),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id);

ALTER TABLE users
    ADD COLUMN reminder_hour smallint NOT NULL DEFAULT 7
        CHECK (reminder_hour BETWEEN 0 AND 23),
    ADD COLUMN reminder_sent_on date;
