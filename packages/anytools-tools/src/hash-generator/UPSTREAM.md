# Upstream Attribution: hash-generator

- SHA-1/256/384/512 + HMAC: native [`crypto.subtle.digest`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto) and `crypto.subtle.sign` — no third-party dep.
- MD5: [`js-md5`](https://github.com/emn178/js-md5) — MIT — because MD5 is intentionally not in WebCrypto (it's broken for security).

We expose `hashText`, `hashFile`, `hmac` — the three operations users actually want. Everything else (HMAC-MD5 with raw-buffer key, streaming digest for huge files) is intentionally omitted to keep the surface small.
