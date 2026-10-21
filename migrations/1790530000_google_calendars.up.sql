-- learning-tool-connections phase 3: the AnyLearn calendar a learner keeps in
-- Google Calendar (scope calendar.app.created). event_ids are the events
-- AnyLearn wrote last time, so one that no longer belongs can be deleted.
CREATE TABLE google_calendars (
    user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    calendar_id text NOT NULL CHECK (length(calendar_id) BETWEEN 1 AND 1024),
    event_ids   text[] NOT NULL DEFAULT '{}',
    synced_at   timestamptz,
    last_error  text NOT NULL DEFAULT '' CHECK (length(last_error) <= 2000),
    created_at  timestamptz NOT NULL DEFAULT now()
);
