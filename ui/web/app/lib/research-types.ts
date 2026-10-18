/**
 * research-types.ts
 *
 * Wire shapes for phase 9's solve and research endpoints. A plain module, not
 * `.server.ts`, so components can import the types without pulling the API
 * client into the browser bundle (app/test/structural-guards.test.ts).
 */
import type { Source } from "~/hooks/use-turn-stream";

/** Stages a solve turn moves through, in order (Go: internal/capabilities/solve). */
export const SOLVE_STAGES = ["plan", "reason", "write"] as const;

/** Stages a research turn moves through, in order (Go: internal/capabilities/research). */
export const RESEARCH_STAGES = ["rephrase", "decompose", "gather", "synthesize", "verify"] as const;

export type ResearchMode = "quick" | "deep";

/** Why a report was written without the web; research_reports.kb_only_reason. */
export type KBOnlyReason = "" | "no_search_key" | "web_off_with_documents" | "search_failed";

/** What POST /v1/solve and POST /v1/research return. */
export type StartedTurn = {
  session_id: string;
  turn_id: string;
  status: string;
  mode?: ResearchMode;
  web_available?: boolean;
  /** The web is reached through the keyless DuckDuckGo fallback. */
  web_keyless?: boolean;
};

/** One checked claim (Go: research.Claim). */
export type Claim = {
  claim: string;
  cites: string[];
  verdict: "supported" | "partial" | "unsupported" | "uncited";
  note?: string;
};

/** The claim check stored with a report (Go: research.Verification). */
export type Verification = {
  status: "checked" | "unavailable";
  total: number;
  supported: number;
  partial: number;
  unsupported: number;
  uncited: number;
  claims: Claim[];
};

/** A report in the list: everything but the body. */
export type ReportSummary = {
  id: string;
  query: string;
  mode: ResearchMode;
  kb_only: boolean;
  kb_only_reason?: KBOnlyReason;
  sources: number;
  note_id?: string;
  session_id?: string;
  created_at: string;
};

/** One stored report. */
export type Report = {
  id: string;
  session_id?: string;
  query: string;
  mode: ResearchMode;
  report_md: string;
  sources: Source[];
  kb_only: boolean;
  kb_only_reason?: KBOnlyReason;
  note_id?: string;
  /** Absent on reports written before the check existed. */
  verification?: Verification;
  open_questions?: string[];
  /** "key" (your Tavily/Brave), "duckduckgo" (keyless), or "" (no web). */
  engine?: "" | "key" | "duckduckgo";
  created_at: string;
};

/** Maps the kb_only_reason to its i18n key in the `research` namespace. */
export function kbOnlyReasonKey(reason: string | undefined): string {
  switch (reason) {
    case "no_search_key":
      return "kbOnly.noSearchKey";
    case "web_off_with_documents":
      return "kbOnly.webOff";
    case "search_failed":
      return "kbOnly.searchFailed";
    default:
      return "kbOnly.generic";
  }
}
