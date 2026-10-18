ALTER TABLE mastery_paths DROP COLUMN IF EXISTS explain_gate;
ALTER TABLE kp_state DROP COLUMN IF EXISTS explain_passed_at;

-- Back to the groundwork stub: the attempts go (they cannot exist without
-- their columns), the table and its evidence kind stay.
DELETE FROM explain_back_attempts;
DROP INDEX IF EXISTS explain_back_attempts_kp_idx;
ALTER TABLE explain_back_attempts
    DROP CONSTRAINT IF EXISTS explain_back_attempts_override_shape,
    DROP CONSTRAINT IF EXISTS explain_back_attempts_request_unique,
    DROP CONSTRAINT IF EXISTS explain_back_attempts_path_fk,
    DROP CONSTRAINT IF EXISTS explain_back_attempts_kp_fk,
    DROP COLUMN IF EXISTS judged_at,
    DROP COLUMN IF EXISTS kp_before,
    DROP COLUMN IF EXISTS overridden_at,
    DROP COLUMN IF EXISTS override_passed,
    DROP COLUMN IF EXISTS model,
    DROP COLUMN IF EXISTS sources,
    DROP COLUMN IF EXISTS feedback,
    DROP COLUMN IF EXISTS misconceptions,
    DROP COLUMN IF EXISTS gaps,
    DROP COLUMN IF EXISTS passed,
    DROP COLUMN IF EXISTS verdict,
    DROP COLUMN IF EXISTS explanation,
    DROP COLUMN IF EXISTS request_id,
    DROP COLUMN IF EXISTS path_id,
    DROP COLUMN IF EXISTS kp_id;

DROP TABLE IF EXISTS kp_explanations;
