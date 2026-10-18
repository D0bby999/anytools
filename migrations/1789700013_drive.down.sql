-- Reverse of 1789700013_drive.
--
-- The documents column goes LAST here because drive_grants' composite foreign
-- key points at documents, not at the column; dropping the tables first keeps
-- the order symmetric with the up migration and independent of that detail.

DROP TABLE IF EXISTS drive_sync_state;
DROP TABLE IF EXISTS drive_grants;
DROP TABLE IF EXISTS drive_connections;

DROP INDEX IF EXISTS documents_kb_drive_file_unique;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_drive_file_id_needs_drive_source;
ALTER TABLE documents DROP COLUMN IF EXISTS drive_file_id;
