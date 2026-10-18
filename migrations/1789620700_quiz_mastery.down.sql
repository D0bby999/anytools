-- Reverse of 1789620700_quiz_mastery.
--
-- Dropped child-first rather than relying on CASCADE, so that a table this
-- migration did NOT create can never be taken down by a dependency it acquired
-- later. The one ALTER this migration made to a phase-6 table is undone last.

DROP TABLE IF EXISTS mastery_events;
DROP TABLE IF EXISTS error_records;
DROP TABLE IF EXISTS question_attempts;
DROP TABLE IF EXISTS questions;
DROP TABLE IF EXISTS kp_state;
DROP TABLE IF EXISTS knowledge_points;
DROP TABLE IF EXISTS mastery_modules;
DROP TABLE IF EXISTS mastery_paths;

ALTER TABLE chat_sessions
    DROP CONSTRAINT IF EXISTS chat_sessions_id_user_unique;
