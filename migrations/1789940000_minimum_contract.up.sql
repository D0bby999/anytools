-- 1789940000_minimum_contract — the bad-day minimum contract on a learning
-- state (up-methods phase 13).
--
-- Structure from up's rhythm chapter, §6 "A Minimum Contract for Bad Days"
-- (docs/en/threads/part-4/rhythm-and-compounding.md): three answers, written
-- before the bad day arrives —
--
--   downshift_when       when to shrink the task instead of forcing it;
--   still_worth_keeping  the smallest action still worth doing after that
--                        (next_task_minimum stays the concrete minimum task);
--   ask_for_help_when    when to ask for help, or hand the problem to someone
--                        qualified.
--
-- One jsonb object rather than three columns: the three are read and written
-- together, and their limits (1000 characters each) are validated in Go
-- (loop.MinimumContract.Validate). The CHECK only pins the shape and a total
-- size generous enough for three escaped 1000-character answers.
--
-- ask_for_help_when is private in the sense of plan principle 5: it may hold
-- health and safety triggers, so loop.RenderState — the text a state-linked
-- chat sends with every turn — never reads it.
--
-- The interruption record's new lines (fact, resistance, within_24h,
-- not_repaying, review_on) live in cycles.interruptions, which is already a
-- jsonb array; they need no DDL.
ALTER TABLE learning_states
    ADD COLUMN minimum_contract jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(minimum_contract) = 'object' AND length(minimum_contract::text) <= 32000);
