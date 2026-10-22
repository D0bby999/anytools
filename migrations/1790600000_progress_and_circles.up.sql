-- 1790600000_progress_and_circles — study days, a streak with rest days, a
-- weekly goal, milestones, and study circles (the private design notes).
--
--  1. users.week_goal — study days a week the learner aims for.
--     users.rest_days — missed days a week that keep the streak.
--     users.study_counted_on — the local day study_days was last counted
--     through; days before the one before it are frozen.
--     users.study_refreshed_at — when it was last counted, so a read within
--     a short while (a circle's page, Home, the reminder) does not count again.
--
--  2. study_days — one row a local day with any study, and how much of each
--     kind. Counted from the activity tables when progress is read, so a
--     deleted deck does not unmake the days it was studied.
--
--  3. progress_milestones — the day each milestone was first reached.
--
--  4. study_circles, study_circle_members, study_cheers — friends studying
--     together. A member is seen by the name they gave the circle, never by
--     their account. The earliest member is the owner.

ALTER TABLE users
    ADD COLUMN week_goal smallint NOT NULL DEFAULT 4 CHECK (week_goal BETWEEN 1 AND 7),
    ADD COLUMN rest_days smallint NOT NULL DEFAULT 1 CHECK (rest_days BETWEEN 0 AND 2),
    ADD COLUMN study_counted_on date,
    ADD COLUMN study_refreshed_at timestamptz;

CREATE TABLE study_days (
    user_id    uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day        date    NOT NULL,
    reviews    integer NOT NULL DEFAULT 0 CHECK (reviews >= 0),
    questions  integer NOT NULL DEFAULT 0 CHECK (questions >= 0),
    explains   integer NOT NULL DEFAULT 0 CHECK (explains >= 0),
    workouts   integer NOT NULL DEFAULT 0 CHECK (workouts >= 0),
    recordings integer NOT NULL DEFAULT 0 CHECK (recordings >= 0),
    highlights integer NOT NULL DEFAULT 0 CHECK (highlights >= 0),
    skill      integer NOT NULL DEFAULT 0 CHECK (skill >= 0),
    PRIMARY KEY (user_id, day)
);

CREATE TABLE progress_milestones (
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key        text NOT NULL CHECK (key ~ '^[a-z]+:[0-9]{1,6}$'),
    reached_on date NOT NULL,
    PRIMARY KEY (user_id, key)
);

CREATE TABLE study_circles (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
    invite_code text NOT NULL UNIQUE CHECK (invite_code ~ '^[A-Z2-9]{10}$'),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE study_circle_members (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    circle_id uuid NOT NULL REFERENCES study_circles(id) ON DELETE CASCADE,
    user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname  text NOT NULL CHECK (length(btrim(nickname)) BETWEEN 1 AND 40),
    joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (circle_id, user_id)
);

CREATE INDEX study_circle_members_user ON study_circle_members (user_id);

-- Two members of a circle never go by the same name.
CREATE UNIQUE INDEX study_circle_members_nickname ON study_circle_members (circle_id, lower(nickname));

-- A circle goes with its last member, whether they left or deleted their
-- account (the cascade from users), so no empty circle keeps an invite code.
CREATE FUNCTION study_circles_drop_empty() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM study_circles c
     WHERE c.id IN (SELECT circle_id FROM gone)
       AND NOT EXISTS (SELECT 1 FROM study_circle_members m WHERE m.circle_id = c.id);
    RETURN NULL;
END $$;

CREATE TRIGGER study_circles_drop_empty
    AFTER DELETE ON study_circle_members
    REFERENCING OLD TABLE AS gone
    FOR EACH STATEMENT EXECUTE FUNCTION study_circles_drop_empty();

CREATE TABLE study_cheers (
    from_member uuid NOT NULL REFERENCES study_circle_members(id) ON DELETE CASCADE,
    to_member   uuid NOT NULL REFERENCES study_circle_members(id) ON DELETE CASCADE,
    day         date NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (from_member, to_member, day),
    CHECK (from_member <> to_member)
);

CREATE INDEX study_cheers_to ON study_cheers (to_member, created_at DESC);
