-- 1790095000_storage_choice, reversed. Files already in learners' Drives stay
-- there and keep their drive_files rows; with the column gone every learner
-- writes to the server again. Move them back first (phase 2) if the Drive
-- backend is going away too.

DROP INDEX IF EXISTS jobs_one_storage_move_per_user;
ALTER TABLE users DROP COLUMN IF EXISTS file_storage;
