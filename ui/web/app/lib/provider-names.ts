/**
 * provider-names.ts — the display name of a provider id.
 *
 * Provider ids are a database contract ("openai_compat", "zai"); people read
 * names. An id the locale does not know (a provider added to the API before
 * the UI) falls back to the id itself rather than to nothing.
 */
import type { TFunction } from "i18next";

export function providerName(t: TFunction, id: string): string {
  return t(`settings.providerNames.${id}`, { ns: "common", defaultValue: id });
}
