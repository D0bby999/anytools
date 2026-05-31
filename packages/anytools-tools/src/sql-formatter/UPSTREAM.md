# Upstream Attribution: sql-formatter

- [`sql-formatter`](https://github.com/sql-formatter-org/sql-formatter) — MIT — multi-dialect SQL formatter, the de-facto standard in JS land. Used by JetBrains DataGrip, BigQuery console, etc.

We expose `formatSql` (wraps their API) + a minimal `minifySql` helper. Dialect list curated to the 10 most common; library supports a few more.
