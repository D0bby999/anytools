// Package providers is AnyTools' chat seam: one Provider interface over the
// OpenAI-compatible wire (OpenAI, OpenRouter, Groq, any base URL the user
// pastes), Google's OpenAI shim for Gemini keys, and the Anthropic wire.
//
// Selectively ported from postclaw internal/providers (scout §3), through the
// phase-2 spike that proved each lane compiles and streams
// (reports/spike-providers.md). Three deliberate differences from the source:
//
//  1. system_guard.go is NOT here. It is a billing entitlement guard for
//     postclaw's byok_only plans, not a safety control (red-team RT-4), and
//     AnyTools has no billing. registry.go therefore drops the `guard
//     SystemAccessFunc` field the original wraps every Get in — the "copy
//     wholesale" list was not import-clean as written.
//  2. Every client's HTTP transport is security.SafeBYOKClient, never
//     http.DefaultClient: an api_base is user-supplied text, and the connect-
//     time address guard is the only thing between it and the metadata service.
//  3. This package knows nothing about users, connections, routes or the
//     database. It takes a key and a base URL and speaks a protocol; internal/byok
//     owns which key, whose, and what to do when it fails.
package providers
