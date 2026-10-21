/**
 * diagnostic-prompt.tsx
 * "Start with an English diagnostic" (up methods, phase 1): shown in the
 * Loop's card list and its new-card form for a goal that has, or is creating,
 * a language card and has no English diagnostic yet. up starts language work
 * from that four-skill baseline.
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { DIAGNOSTIC_KIND, LANGUAGE_CARD_KINDS } from "~/lib/english-diagnostic";

/** The goal a card list belongs to, and whether it still lacks an English diagnostic. */
export type DiagnosticNeed = { stateId: string; missing: boolean };

/** "Start with an English diagnostic", for a goal that has none. */
export function DiagnosticPrompt({ stateId }: { stateId: string }) {
  const { t } = useTranslation("toolkit");
  const params = new URLSearchParams({ kind: DIAGNOSTIC_KIND, state: stateId });
  return (
    <p className="text-sm text-muted-foreground">
      <Link to={`/toolkit/new?${params.toString()}`} className="inline-flex min-h-11 items-center font-medium">
        {t("diagnostic.start")}
      </Link>
      <span className="block">{t("diagnostic.startLead")}</span>
    </p>
  );
}

/** Whether a goal with cards of these kinds should be pointed to a diagnostic. */
export function needsDiagnostic(need: DiagnosticNeed | undefined, kinds: string[]): boolean {
  return Boolean(need?.missing) && kinds.some((k) => LANGUAGE_CARD_KINDS.has(k));
}
