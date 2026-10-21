-- learning-tool-connections phase 6: a Google Classroom class brought into a
-- knowledge base. seen holds the keys of the items imported (or offered and
-- confirmed), so a later look lists only what is new; new_count is what the
-- daily check found.
CREATE TABLE classroom_links (
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id   text NOT NULL CHECK (length(course_id) BETWEEN 1 AND 200),
    course_name text NOT NULL DEFAULT '' CHECK (length(course_name) <= 500),
    kb_id       uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    seen        text[] NOT NULL DEFAULT '{}',
    new_count   integer NOT NULL DEFAULT 0,
    checked_at  timestamptz,
    last_error  text NOT NULL DEFAULT '' CHECK (length(last_error) <= 2000),
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, course_id)
);
