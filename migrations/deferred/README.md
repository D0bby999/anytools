# Deferred migrations

Contract halves of expand/contract changes. `longplay migrate up` never reads
this directory (golang-migrate reads only the top level of `migrations/`).

A file here ships in a LATER release than its expand half, once no running
code depends on what it removes. To ship one, move it into `migrations/` with
the next free timestamp. golang-migrate never applies a version lower than the
database's current one, so it must sort after every applied migration.

| File | Expand half | Removes | Safe once |
|---|---|---|---|
| `practice_contract.*.sql` | `1789780000_practice_expand` | the three-column `error_records_open_unique` index | every running build uses `ON CONFLICT (user_id, question_id)` (learning-depth phase 1) |
