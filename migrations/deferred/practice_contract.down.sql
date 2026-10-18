CREATE UNIQUE INDEX error_records_open_unique
    ON error_records (user_id, question_id, kp_id)
    WHERE status <> 'graduated';
