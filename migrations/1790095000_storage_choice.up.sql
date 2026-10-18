-- 1790095000_storage_choice — where a learner's own files are kept
-- (plans/261017-1828-drive-user-storage, phase 2).
--
--  1. users.file_storage — 'server' or 'drive'. Drive storage is opt-in
--     (owner decision 2): connecting Drive never changes it; only the
--     learner's own switch in Settings → Storage does. New writes go to the
--     chosen place; reads follow each file's drive_files row, so a learner
--     part way through a move reads both.
--
--  2. One move at a time per learner. A storage_move job plans its files
--     when it is enqueued, and two running at once would race each other's
--     units. The partial unique index makes the second enqueue fail instead
--     of relying on a check-then-insert in the handler.

ALTER TABLE users ADD COLUMN file_storage text NOT NULL DEFAULT 'server'
    CHECK (file_storage IN ('server', 'drive'));

CREATE UNIQUE INDEX jobs_one_storage_move_per_user
    ON jobs (user_id)
 WHERE kind = 'storage_move' AND status IN ('queued', 'running');
