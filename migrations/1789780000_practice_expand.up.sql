-- Practice your mistakes (learning-depth phase 1), EXPAND half.
--
-- Every wrong answer now opens a mistake, with or without a knowledge point,
-- so an open mistake is unique per (user, question) rather than per (user,
-- question, knowledge point). `longplay migrate up` is a separate command from
-- `serve`, so old code runs on this schema for a while and a rollback runs new
-- code on the old one. This migration therefore ADDS the new index beside the
-- old; 1789785000_practice_contract drops the old one a release later.

-- 1. Merge duplicate open records first, or the new index cannot be built.
--    The oldest record survives, holding every duplicate's retries in time
--    order and the most recently updated record's state.
WITH ranked AS (
    SELECT id, user_id, question_id, created_at, updated_at,
           first_value(id) OVER w_created AS keep_id,
           first_value(id) OVER w_updated AS latest_id
      FROM error_records
     WHERE status <> 'graduated'
    WINDOW w_created AS (PARTITION BY user_id, question_id ORDER BY created_at, id),
           w_updated AS (PARTITION BY user_id, question_id ORDER BY updated_at DESC, id DESC)
), groups AS (
    SELECT keep_id, latest_id, array_agg(id) AS ids
      FROM ranked
     GROUP BY keep_id, latest_id
    HAVING count(*) > 1
), merged AS (
    SELECT g.keep_id,
           (SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'at')::timestamptz), '[]'::jsonb)
              FROM error_records r, jsonb_array_elements(r.retry_history) e
             WHERE r.id = ANY(g.ids)) AS history,
           l.status, l.error_type, l.self_attribution, l.ai_confirmation, l.updated_at
      FROM groups g
      JOIN error_records l ON l.id = g.latest_id
)
UPDATE error_records r
   SET retry_history = m.history,
       status = m.status,
       error_type = m.error_type,
       self_attribution = m.self_attribution,
       ai_confirmation = m.ai_confirmation,
       updated_at = m.updated_at
  FROM merged m
 WHERE r.id = m.keep_id;

DELETE FROM error_records r
 USING (
    SELECT id, first_value(id) OVER (PARTITION BY user_id, question_id ORDER BY created_at, id) AS keep_id
      FROM error_records
     WHERE status <> 'graduated'
 ) d
 WHERE r.id = d.id AND d.id <> d.keep_id;

-- 2. The new arbiter, next to the old one.
CREATE UNIQUE INDEX error_records_open_q_unique
    ON error_records (user_id, question_id)
    WHERE status <> 'graduated';

-- 3. The practice queue reads open mistakes by status and age.
CREATE INDEX error_records_practice_idx ON error_records (user_id, status, updated_at);

-- 4. first_correct_at is when the mistake moved to `review`. The second
--    correct answer graduates it only on a LATER calendar day, in the
--    learner's zone (learning.LocalDay), decided in Go.
ALTER TABLE error_records ADD COLUMN first_correct_at timestamptz;

-- 5. error_before is the question's open mistake as it stood before this
--    attempt: {"open": null} or {"open": {...}}. An override restores it for
--    every attempt, not only knowledge-point ones. NULL means the attempt
--    predates this column, and an override then leaves the mistake alone.
ALTER TABLE question_attempts ADD COLUMN error_before jsonb;
