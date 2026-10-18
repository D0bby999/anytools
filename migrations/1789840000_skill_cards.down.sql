-- Back to the phase-0 stub: card_entries keeps id, user_id and created_at, so
-- the groundwork migration's OwnsTarget case still has a table to query.
DROP TRIGGER card_entries_no_update ON card_entries;
DROP FUNCTION card_entries_immutable();

DELETE FROM evidence_refs WHERE kind = 'card_entry';
DELETE FROM card_entries;

DROP INDEX card_entries_card_idx;
DROP INDEX card_entries_one_baseline;
ALTER TABLE card_entries
    DROP CONSTRAINT card_entries_card_fk,
    DROP COLUMN links,
    DROP COLUMN prompt_level,
    DROP COLUMN body,
    DROP COLUMN timepoint,
    DROP COLUMN card_id;

DROP TABLE skill_cards;
