/**
 * private-note.tsx
 * The notice a private worksheet shows (plan principle 5). Written fresh
 * from the warning that opens up's life practice toolkit
 * (docs/en/templates/life-practice-toolkit.md): what to leave out, and that
 * danger needs qualified people, not a worksheet.
 *
 * A life worksheet (phase 9) adds up's "a private record, not a daily score"
 * and its own safety line from the chapter it follows (decision,
 * relationships, recovery), keyed `life.safety.<kind>`. The recovery reset
 * opens with safety, as up's worksheet does, so its notice does too.
 * Nothing here claims encryption: these are stored like notes (owner
 * decision 3, 2026-10-01).
 */
import { useTranslation } from "react-i18next";
import type { WorksheetKind } from "~/lib/worksheet-types";

/** Kinds whose notice puts the safety lines before everything else. */
const SAFETY_FIRST = new Set(["recovery_reset"]);

export function PrivateNote({ kind }: { kind?: Pick<WorksheetKind, "kind" | "group"> }) {
  const { t, i18n } = useTranslation("toolkit");
  const life = kind?.group === "life";
  const safetyKey = `life.safety.${kind?.kind ?? ""}`;
  const kindSafety = life && i18n.exists(safetyKey, { ns: "toolkit" }) ? t(safetyKey) : null;

  const safety = (
    <>
      <p className="mt-2 text-sm leading-prose font-medium">{t("private.danger")}</p>
      {kindSafety ? <p className="mt-2 text-sm leading-prose font-medium">{kindSafety}</p> : null}
    </>
  );
  const first = kind ? SAFETY_FIRST.has(kind.kind) : false;
  return (
    <aside aria-labelledby="ws-private" className="mt-4 rounded-lg border bg-muted p-4">
      <h2 id="ws-private" className="lp-kicker">
        {t("private.title")}
      </h2>
      {first ? safety : null}
      {life ? <p className="mt-2 text-sm leading-prose">{t("life.record")}</p> : null}
      <p className="mt-2 text-sm leading-prose">{t("private.body")}</p>
      <p className="mt-2 text-sm leading-prose">{t("private.leaveOut")}</p>
      {first ? null : safety}
    </aside>
  );
}
