# Upstream Attribution: json-formatter

- Strict parsing + serialization: native `JSON.parse` / `JSON.stringify`.
- Forgiving mode (comments, trailing commas, single quotes): [`json5`](https://github.com/json5/json5) — MIT.

We add line:col error reporting (native JSON.parse only gives byte position).
