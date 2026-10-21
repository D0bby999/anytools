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

/** What a provider can do here, as the Providers page filters by it. */
export type ProviderServe = "chat" | "parse" | "embed" | "tts" | "stt";

/** One provider of the catalog (GET /v1/byok/catalog, internal/byok/catalog.go). */
export type CatalogEntry = {
  type: string;
  label: string;
  icon: string;
  auth: "api_key" | "sign_in" | "custom";
  free_tier?: boolean;
  key_url?: string;
  api_base?: string;
  /** A part ink name (read, ask, practise, reflect, tools, brand), never a colour. */
  hue: string;
  serves: ProviderServe[];
  /** No default model: a route on it names one from the live list. */
  needs_model?: boolean;
};

/** A connection's models: listed by the provider, and added by hand. */
export type ModelList = { models: string[]; custom: string[]; list_error?: string };

/** What /app/api/byok-models answers. */
export type ModelsData = ({ ok: true } & ModelList) | { ok: false; error: string };

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
  /** Names `note`, for wording it in the learner's language (readiness-text.ts). */
  note_code?: string;
  /** The provider's own words a note quotes (a rejected key). */
  detail?: string;
  cooldown_until?: string;
};

export type FunctionReadiness = {
  function: string;
  status: ReadinessStatus;
  reason: string;
  /** Names `reason`, for wording it in the learner's language (readiness-text.ts). */
  reason_code?: string;
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
