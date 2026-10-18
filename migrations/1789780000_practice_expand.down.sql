-- Drops only what the expand half added. Merged duplicates stay merged: the
-- old three-column index accepts one record where it accepted two.
ALTER TABLE question_attempts DROP COLUMN error_before;
ALTER TABLE error_records DROP COLUMN first_correct_at;
DROP INDEX error_records_practice_idx;
DROP INDEX error_records_open_q_unique;
