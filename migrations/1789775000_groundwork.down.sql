ALTER TABLE jobs
    DROP COLUMN progress,
    DROP COLUMN cancel_requested;

ALTER TABLE users
    DROP COLUMN timezone_set_at,
    DROP COLUMN timezone;

DELETE FROM evidence_refs WHERE kind IN ('explain_back', 'card_entry');
ALTER TABLE evidence_refs DROP CONSTRAINT evidence_refs_kind_check;
ALTER TABLE evidence_refs ADD CONSTRAINT evidence_refs_kind_check CHECK (kind IN
    ('question_attempt', 'kp_state', 'note', 'research_report', 'chat_message'));

DROP TABLE card_entries;
DROP TABLE explain_back_attempts;
