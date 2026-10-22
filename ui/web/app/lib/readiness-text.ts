/**
 * readiness-text.ts
 * The readiness matrix's sentences in the learner's language. The API sends
 * each reason and note in English with a code beside it (internal/byok/
 * readiness.go); the code picks the translation, and the English sentence is
 * the fallback for a code this build does not know.
 */
import type { TFunction } from "i18next";
import type { FunctionReadiness, ReadinessEntry } from "~/lib/byok.types";
import { providerName } from "~/lib/provider-names";

function functionName(t: TFunction, fn: string): string {
  return t(`settings.functions.${fn}` as never, { defaultValue: fn });
}

/** One connection's note: why it is resting, refused or unverified. */
export function entryNote(t: TFunction, row: FunctionReadiness, entry: ReadinessEntry): string {
  if (!entry.note_code) return entry.note ?? "";
  return t(`readinessText.${entry.note_code}` as never, {
    defaultValue: entry.note ?? "",
    function: functionName(t, row.function),
    provider: providerName(t, entry.provider),
    detail: entry.detail ?? "",
  });
}

/** An optional function nobody routed: not a failure, so not red. */
export function isUnsetOptional(row: FunctionReadiness, optional: readonly string[]): boolean {
  return optional.includes(row.function) && row.reason_code === "no_route" && row.entries.length === 0;
}

/**
 * A row's reason: what keeps this function from being plainly ready. On the
 * Routes page (`onRoutesPage`) a missing route points at the row's own Edit
 * below, not at the page the learner is already on.
 */
export function rowReason(t: TFunction, row: FunctionReadiness, onRoutesPage = false): string {
  if (!row.reason_code) return row.reason;
  if (onRoutesPage && row.reason_code === "no_route") {
    return t("readinessText.no_route_here", { defaultValue: row.reason, function: functionName(t, row.function) });
  }
  // A warning row borrows its first warning entry's note, code and all.
  const entry = row.entries.find((e) => e.note_code === row.reason_code);
  if (entry) return entryNote(t, row, entry);
  const unusable = row.entries.filter((e) => e.status === "blocked").length;
  return t(`readinessText.${row.reason_code}` as never, {
    defaultValue: row.reason,
    function: functionName(t, row.function),
    unusable,
    total: row.entries.length,
  });
}
