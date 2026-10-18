Fixtures for the speech synthesizer tests.

- `openai_pcm.raw`, `kokoro_pcm.raw`: half a second of 24 kHz, 16-bit, mono
  little-endian PCM, the `pcm` format OpenAI's `POST /v1/audio/speech` and
  Kokoro-FastAPI v0.9.0's return. Made with ffmpeg (lavfi sine), not
  recorded: no live key or Kokoro server was available on 2026-10-16. The
  test servers send Kokoro-FastAPI's content type, `audio/pcm` (from its
  source), and `application/octet-stream` for OpenAI, whose reference does
  not name one; the client accepts any type that is not JSON or text.
- `openai_401.json`: OpenAI's refusal of a bad key, which echoes the key.
- `kokoro_400.json`: Kokoro-FastAPI's validation error shape
  (`api/src/routers/openai_compatible.py`).
