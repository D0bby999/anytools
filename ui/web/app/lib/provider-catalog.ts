/**
 * The Providers page's logic, kept apart from its components so it can be
 * tested without rendering (plan 261021-1100 phase 4, after postclaw's
 * settings-providers): filtering the catalog, and sorting a connection's
 * models into kinds.
 */
import type { CatalogEntry, ProviderServe } from "~/lib/byok.types";
import { fold } from "~/lib/chat-search";

/** How a provider is reached: a key, a free tier, a sign-in, or an address the learner brings. */
export type AccessFilter = "all" | "api_key" | "free" | "sign_in" | "custom";
export type ServeFilter = "all" | ProviderServe;

export type ProviderFilter = { query: string; access: AccessFilter; serves: ServeFilter; connected: boolean };

export const NO_FILTER: ProviderFilter = { query: "", access: "all", serves: "all", connected: false };

/** The catalog narrowed by a search and the filters, in catalog order. */
export function filterProviders(
  entries: CatalogEntry[],
  filter: ProviderFilter,
  connectedCount: (type: string) => number,
): CatalogEntry[] {
  const query = fold(filter.query.trim());
  return entries.filter((e) => {
    if (query && !fold(`${e.label} ${e.type}`).includes(query)) return false;
    if (filter.connected && connectedCount(e.type) === 0) return false;
    if (filter.serves !== "all" && !e.serves.includes(filter.serves)) return false;
    switch (filter.access) {
      case "api_key":
        return e.auth === "api_key";
      case "free":
        return !!e.free_tier;
      case "sign_in":
        return e.auth === "sign_in";
      case "custom":
        return e.auth === "custom";
      default:
        return true;
    }
  });
}

/** What a model is for, read from its id: providers list them all together. */
export type ModelKind = "chat" | "embed" | "stt" | "tts" | "image" | "other";

export const MODEL_KINDS: ModelKind[] = ["chat", "embed", "stt", "tts", "image", "other"];

const KIND_RULES: [ModelKind, RegExp][] = [
  ["embed", /embed|bge-|e5-|gte-|nomic-embed|voyage/],
  ["stt", /whisper|transcri|speech-to-text|(^|[-/_])stt($|[-/_])|(^|[-/_])asr($|[-/_])|scribe/],
  ["tts", /(^|[-/_])tts($|[-/_])|text-to-speech|-audio-preview|voice|sonic|playai/],
  ["image", /dall-e|gpt-image|imagen|(^|[-/_])flux|stable-diffusion|sdxl|seedream|image-gen|midjourney/],
  ["other", /moderation|guard|rerank|(^|[-/_])video|veo-|sora|kling/],
];

export function modelKind(id: string): ModelKind {
  const name = id.toLowerCase();
  for (const [kind, rule] of KIND_RULES) if (rule.test(name)) return kind;
  return "chat";
}

/** Models grouped by kind, each group sorted, empty groups left out, chat first. */
export function groupModels(ids: string[]): { kind: ModelKind; models: string[] }[] {
  const groups = new Map<ModelKind, string[]>();
  for (const id of new Set(ids)) {
    const kind = modelKind(id);
    groups.set(kind, [...(groups.get(kind) ?? []), id]);
  }
  return MODEL_KINDS.filter((k) => groups.has(k)).map((kind) => ({
    kind,
    models: groups.get(kind)!.sort((a, b) => a.localeCompare(b)),
  }));
}
