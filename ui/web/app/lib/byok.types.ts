/**
 * byok.types.ts
 * The BYOK shapes, split out of byok.server.ts so a COMPONENT can import them.
 *
 * Not a stylistic split: a structural test (app/test/structural-guards.test.ts)
 * fails any component importing a `.server` module, because doing so pulls the
 * gateway token and OAuth client secrets into the client bundle. Types are
 * erased at build time and carry nothing, so they live here instead.
 */
export type ReadinessStatus = "green" | "warn" | "blocked";

export type Connection = {
  id: string;
  provider: string;
  kind: "api_key" | "oauth_relay" | "oauth_gemini_sub";
  name: string;
  api_base: string;
  has_secret: boolean;
  verified_at?: string;
  verified_model?: string;
  last_error?: string;
  cooldown_until?: string;
  cooldown_reason?: string;
  dims?: number;
  needs_reconnect?: boolean;
  created_at: string;
};

export type RouteEntry = { connection_id: string; model: string; dims?: number };

export type SearchConnection = {
  id: string;
  provider: string;
  verified_at?: string;
  last_error?: string;
};

export type ReadinessEntry = {
  connection_id: string;
  name: string;
  provider: string;
  model: string;
  status: ReadinessStatus;
  note?: string;
  cooldown_until?: string;
};

export type FunctionReadiness = {
  function: string;
  status: ReadinessStatus;
  reason: string;
  entries: ReadinessEntry[];
};

export type Readiness = {
  functions: FunctionReadiness[];
  /** The aggregate verdict across `core_functions`. */
  core: ReadinessStatus;
  /** Which functions nothing else works without. Defined once, in Go. */
  core_functions: string[];
  /** Functions a learner may leave unrouted (speech, transcription). */
  optional_functions?: string[];
  lanes_enabled: boolean;
};

/** A started GitHub Copilot device sign-in: the code to enter on GitHub. */
export type CopilotStart = { session_id: string; user_code: string; verification_uri: string };

/** A started Claude sign-in: the page to approve on, and the handle. */
export type ClaudeStart = { session_id: string; authorize_url: string };
