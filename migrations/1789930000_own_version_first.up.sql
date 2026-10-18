-- 1789930000_own_version_first — "write your own version first"
-- (plans/260930-0915-up-methods, phase 11; up: docs/en/threads/part-3/
-- 3-attention-and-judgment.md §3).
--
-- With the switch on, a chat turn or a solve is refused until the learner has
-- written their three lines. The lines themselves live on the user message's
-- attachments, and the retell on the answer's; neither needs a table.

ALTER TABLE users ADD COLUMN own_version_first boolean NOT NULL DEFAULT false;
