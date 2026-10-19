-- 1790180000_chat_summary, reversed. Conversations go back to sending their
-- newest messages only and to the head of the chat route; nothing else reads
-- these columns.
ALTER TABLE chat_sessions
    DROP COLUMN IF EXISTS connection_id,
    DROP COLUMN IF EXISTS summary_through_id,
    DROP COLUMN IF EXISTS summary;
