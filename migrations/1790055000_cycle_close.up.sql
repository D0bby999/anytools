-- The structured day-90 close (plans/260930-0915-up-methods, phase 10).
--
-- A cycle_close worksheet (internal/learning/worksheet/kinds_cycle_close.go)
-- may name the cycle it closes. One close per cycle: the unique index refuses
-- a second. Deleting the cycle keeps the close, unattached from it, as
-- deleting a learning state keeps its worksheets.
--
-- The composite key resolves the cycle with the worksheet's owner, so another
-- user's cycle can never be named even if a caller forgot to check. That the
-- cycle belongs to the worksheet's learning state is checked in Go
-- (worksheet.Service.Create), which answers it with 400.

ALTER TABLE worksheets
    ADD COLUMN cycle_id uuid,
    ADD CONSTRAINT worksheets_cycle_owner FOREIGN KEY (cycle_id, user_id)
        REFERENCES cycles (id, user_id) ON DELETE SET NULL (cycle_id),
    -- Only the kind that closes a cycle names one.
    ADD CONSTRAINT worksheets_cycle_kind CHECK (cycle_id IS NULL OR kind = 'cycle_close');

CREATE UNIQUE INDEX worksheets_cycle_unique ON worksheets (cycle_id) WHERE cycle_id IS NOT NULL;
