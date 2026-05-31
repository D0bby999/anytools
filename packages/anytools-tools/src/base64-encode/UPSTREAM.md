# Upstream Attribution: base64-encode

This tool wraps:

- **Library:** [`js-base64`](https://github.com/dankogai/js-base64)
- **Author:** Dan Kogai
- **License:** BSD-3-Clause
- **Why chosen:** UTF-8 safe by default, ~4 KB minified, battle-tested for 10+ years, widely used (1.8k stars, depended on by JWT libraries).

## How we use it

- Direct npm dependency (not source-ported), so upstream's tests + maintenance carry through.
- We add a validation pre-check (`isValidBase64`, `isValidBase64Url`) to throw friendly errors instead of silently producing garbage on bad input.
- Our adapter exposes only the 4 entry points we ship (`encodeBase64`, `decodeBase64`, `encodeBase64Url`, `decodeBase64Url`); the broader js-base64 surface (URI-component variants, Yencoded, etc.) is intentionally hidden.

## License compliance

BSD-3-Clause requires preserving the copyright notice + license. Since js-base64 ships its `LICENSE` file inside `node_modules`, our `package.json` listing satisfies attribution. Tutorial credits the project by name.

We thank the upstream maintainers ❤️.
