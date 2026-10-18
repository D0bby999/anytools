-- Reverse of 1789577121_chat. Dropped child-first: turn_events references both
-- turns and users, and turns references chat_messages, so the order matters
-- even with ON DELETE CASCADE (which governs rows, not DDL).
DROP TABLE IF EXISTS turn_events;
DROP TABLE IF EXISTS turns;
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_sessions;
