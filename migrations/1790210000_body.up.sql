-- 1790210000_body — Body: a training log beside the learning
-- (the private design notes).
--
-- Behaviour after openGym, rewritten (internal/body). Every weight is in the
-- learner's unit (body_profiles.unit); switching the unit converts every row
-- in one transaction (pg.BodyStore.ConvertUnit).
--
-- Plans and logs are jsonb arrays: a routine's exercises and a workout's
-- entries are read and written whole, and their shapes are validated in Go
-- (body.CleanPlanExercise, cleanEntries). The ids inside them are exercise
-- library keys ("0025"), never row ids. The CHECKs pin the shape and a size.

CREATE TABLE body_profiles (
    user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    unit        text NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg', 'lb')),
    goal_weight numeric(6,1) CHECK (goal_weight IS NULL OR goal_weight > 0),
    rest_sec    integer NOT NULL DEFAULT 90 CHECK (rest_sec BETWEEN 15 AND 600),
    -- The coach's last intake, so its form opens filled in.
    intake      jsonb CHECK (intake IS NULL OR (jsonb_typeof(intake) = 'object' AND length(intake::text) <= 8000)),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE body_routines (
    id         uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
    prog       text NOT NULL DEFAULT '' CHECK (prog IN ('', 'off', 'linear', 'double', 'time')),
    why        text NOT NULL DEFAULT '' CHECK (length(why) <= 400),
    exercises  jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(exercises) = 'array' AND length(exercises::text) <= 64000),
    position   integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (id, user_id)
);
CREATE INDEX body_routines_user_idx ON body_routines (user_id, position);

-- The weekly schedule: one row per training weekday (0 = Sunday). A weekday
-- with no row is a rest day; deleting a routine rests its days.
CREATE TABLE body_week (
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    weekday    smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    routine_id uuid NOT NULL,
    PRIMARY KEY (user_id, weekday),
    CONSTRAINT body_week_routine_same_owner
        FOREIGN KEY (routine_id, user_id) REFERENCES body_routines (id, user_id) ON DELETE CASCADE
);

CREATE TABLE body_workouts (
    id           uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The routine it was started from; the name is kept so history still
    -- reads after the routine is deleted. Column-list SET NULL: a plain SET
    -- NULL would null user_id too (see 1789830000_vocabulary.up.sql).
    routine_id   uuid,
    routine_name text NOT NULL DEFAULT '' CHECK (length(routine_name) <= 60),
    -- The learner's calendar day it was started on (learning.LocalDay).
    day          date NOT NULL,
    started_at   timestamptz NOT NULL,
    finished_at  timestamptz,
    bodyweight   numeric(6,1) CHECK (bodyweight IS NULL OR bodyweight > 0),
    entries      jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(entries) = 'array' AND length(entries::text) <= 200000),
    note         text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (id, user_id),
    CONSTRAINT body_workouts_routine_same_owner
        FOREIGN KEY (routine_id, user_id) REFERENCES body_routines (id, user_id)
        ON DELETE SET NULL (routine_id)
);
CREATE INDEX body_workouts_user_day_idx ON body_workouts (user_id, day) WHERE finished_at IS NOT NULL;
-- At most one workout open at a time.
CREATE UNIQUE INDEX body_workouts_one_open ON body_workouts (user_id) WHERE finished_at IS NULL;

-- One weigh-in per calendar day.
CREATE TABLE body_weights (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day     date NOT NULL,
    weight  numeric(6,1) NOT NULL CHECK (weight > 0),
    PRIMARY KEY (user_id, day)
);

-- The coach's answers. `plan` is the proposed plan (body.CoachPlan);
-- `previous` is what accepting it replaced, kept for a revert.
CREATE TABLE body_proposals (
    id         uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       text NOT NULL CHECK (kind IN ('plan', 'review')),
    status     text NOT NULL DEFAULT 'proposed'
        CHECK (status IN ('proposed', 'accepted', 'declined', 'replaced', 'reverted')),
    intake     jsonb CHECK (intake IS NULL OR jsonb_typeof(intake) = 'object'),
    request    text NOT NULL DEFAULT '' CHECK (length(request) <= 1000),
    plan       jsonb CHECK (plan IS NULL OR (jsonb_typeof(plan) = 'object' AND length(plan::text) <= 200000)),
    changes    jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(changes) = 'array'),
    notes      jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(notes) = 'array'),
    nochange   boolean NOT NULL DEFAULT false,
    reading    text NOT NULL DEFAULT '' CHECK (length(reading) <= 1200),
    previous   jsonb CHECK (previous IS NULL OR (jsonb_typeof(previous) = 'object' AND length(previous::text) <= 200000)),
    created_at timestamptz NOT NULL DEFAULT now(),
    decided_at timestamptz,
    PRIMARY KEY (id),
    UNIQUE (id, user_id)
);
CREATE INDEX body_proposals_user_idx ON body_proposals (user_id, created_at DESC);
