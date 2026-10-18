/**
 * own-version.ts
 * "Write your own version first" (up-methods phase 11; up's attention
 * chapter §3). Shared by the composers, the transcript and the actions that
 * forward the lines to the API (internal/learning/ownversion).
 */

/** The three lines, in up's order. */
export type OwnVersion = { understanding: string; uncertain: string; proof: string };

/** A "close it and retell" saved under an answer. */
export type Retell = { text: string; written_at: string };

/** The API's caps, in characters. */
export const MAX_LINE = 500;
export const MAX_RETELL = 4000;

export const OWN_VERSION_KEYS = ["understanding", "uncertain", "proof"] as const;

export const emptyOwnVersion: OwnVersion = { understanding: "", uncertain: "", proof: "" };

/** Each line is 1–500 characters once trimmed. */
export function ownVersionComplete(v: OwnVersion): boolean {
  return OWN_VERSION_KEYS.every((k) => {
    const n = [...v[k].trim()].length;
    return n > 0 && n <= MAX_LINE;
  });
}

/** The form field each line posts under. */
export function fieldName(key: (typeof OWN_VERSION_KEYS)[number]): string {
  return `own_${key}`;
}

/**
 * Reads the lines an action received. Undefined when none were written, so a
 * learner with the switch off sends no `own_version` at all; the API decides
 * whether that is allowed.
 */
export function readOwnVersion(form: FormData): OwnVersion | undefined {
  const v: OwnVersion = {
    understanding: String(form.get(fieldName("understanding")) ?? "").trim(),
    uncertain: String(form.get(fieldName("uncertain")) ?? "").trim(),
    proof: String(form.get(fieldName("proof")) ?? "").trim(),
  };
  return OWN_VERSION_KEYS.some((k) => v[k] !== "") ? v : undefined;
}

/**
 * Reads the lines a stored message carries. A message's attachments default to
 * an array, so anything that is not an object with `own_version` has none.
 */
export function ownVersionOf(attachments: unknown): OwnVersion | undefined {
  if (!attachments || typeof attachments !== "object" || Array.isArray(attachments)) return undefined;
  const v = (attachments as { own_version?: unknown }).own_version;
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (OWN_VERSION_KEYS.some((k) => typeof o[k] !== "string")) return undefined;
  return { understanding: o.understanding as string, uncertain: o.uncertain as string, proof: o.proof as string };
}

/** Reads the retell an answer carries, in either attachments shape. */
export function retellOf(attachments: unknown): Retell | undefined {
  if (!attachments || typeof attachments !== "object" || Array.isArray(attachments)) return undefined;
  const r = (attachments as { retell?: unknown }).retell;
  if (!r || typeof r !== "object") return undefined;
  const o = r as Record<string, unknown>;
  return typeof o.text === "string" ? { text: o.text, written_at: String(o.written_at ?? "") } : undefined;
}

/**
 * The own version each stored message shows: a user message its own lines,
 * an answer the lines of its exchange — the user messages since the previous
 * answer. That is the API's rule for where a retell may go; an ask_user reply
 * is a user message too, and must not hide the question's lines.
 */
export function exchangeOwnVersions(
  messages: { id: string; role: string; attachments?: unknown }[],
): Map<string, OwnVersion> {
  const out = new Map<string, OwnVersion>();
  let exchange: OwnVersion | undefined;
  for (const m of messages) {
    if (m.role === "user") {
      const own = ownVersionOf(m.attachments);
      if (own) out.set(m.id, own);
      exchange = own ?? exchange;
    } else if (m.role === "assistant") {
      if (exchange) out.set(m.id, exchange);
      exchange = undefined;
    }
  }
  return out;
}
