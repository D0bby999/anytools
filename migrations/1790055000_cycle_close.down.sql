DROP INDEX IF EXISTS worksheets_cycle_unique;

ALTER TABLE worksheets
    DROP CONSTRAINT worksheets_cycle_kind,
    DROP CONSTRAINT worksheets_cycle_owner,
    DROP COLUMN cycle_id;
