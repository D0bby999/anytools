-- Reverse of 1789720000_learning_loop.
--
-- Child-first, and the one constraint this migration added to a phase-6 table
-- is dropped before the table it points at.

ALTER TABLE chat_sessions DROP CONSTRAINT IF EXISTS chat_sessions_learning_state_fk;
DROP INDEX IF EXISTS chat_sessions_learning_state_idx;

DROP TABLE IF EXISTS ai_learning_logs;
DROP TABLE IF EXISTS ai_task_briefs;
DROP TABLE IF EXISTS evidence_refs;
DROP TABLE IF EXISTS evidence_chains;
DROP TABLE IF EXISTS weekly_reviews;
DROP TABLE IF EXISTS cycles;
DROP TABLE IF EXISTS learning_states;
