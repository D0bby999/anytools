-- 1790180000_chat_summary — the chat agent upgrade (plan 261019-1015).
--
-- summary, summary_through_id: a turn sends the model the newest messages that
-- fit a token budget. The ones that fall out are summarised once, with the
-- learner's own chat route, and the summary is sent in their place.
-- summary_through_id is the newest message the summary covers; history after
-- it is sent as it is. No foreign key: rewinding a conversation deletes
-- messages, and the store clears the summary in the same transaction when the
-- message it ends on is one of them.
--
-- connection_id: the connection the learner picked for this conversation in
-- the composer. It is tried first; the rest of their chat route stays behind it
-- as the fallback. Deleting the connection unpins the conversation.
ALTER TABLE chat_sessions
    ADD COLUMN summary            text NOT NULL DEFAULT '',
    ADD COLUMN summary_through_id uuid,
    ADD COLUMN connection_id      uuid REFERENCES provider_connections(id) ON DELETE SET NULL;
