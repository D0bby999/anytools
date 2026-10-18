DELETE FROM evidence_refs WHERE kind = 'worksheet';
ALTER TABLE evidence_refs DROP CONSTRAINT evidence_refs_kind_check;
ALTER TABLE evidence_refs ADD CONSTRAINT evidence_refs_kind_check CHECK (kind IN
    ('question_attempt', 'kp_state', 'note', 'research_report', 'chat_message',
     'explain_back', 'card_entry'));

DROP TABLE IF EXISTS worksheets;
