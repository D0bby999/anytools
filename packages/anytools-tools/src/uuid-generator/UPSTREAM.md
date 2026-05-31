# Upstream Attribution: uuid-generator

This tool wraps:

- **Library:** [`uuid`](https://github.com/uuidjs/uuid)
- **License:** MIT
- **Why chosen:** The de-facto standard JS UUID library. Supports v1/v4/v7 in a single small package, used by millions of projects.

We expose v1, v4, v7 — the most common versions. Validation uses the library's `validate` + `version` helpers.

MIT requires preserving copyright; npm metadata in `node_modules/uuid` carries it.
