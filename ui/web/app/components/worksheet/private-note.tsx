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
 *
 * Drawn as up's blockquote with its full outline (plan 261020-2246, phase
 * 12): a tinted box under the worksheet's actions, not a section of its own.
 */
import { useTranslation } from "react-i18next";
import type { WorksheetKind } from "~/lib/worksheet-types";

/** One line of the notice; the article's 18px paragraph gap is too wide in a box. */
const line = "my-2! text-sm leading-prose";

/** Kinds whose notice puts the safety lines before everything else. */
const SAFETY_FIRST = new Set(["recovery_reset"]);

export function PrivateNote({ kind }: { kind?: Pick<WorksheetKind, "kind" | "group"> }) {
  const { t, i18n } = useTranslation("toolkit");
  const life = kind?.group === "life";
  const safetyKey = `life.safety.${kind?.kind ?? ""}`;
  const kindSafety = life && i18n.exists(safetyKey, { ns: "toolkit" }) ? t(safetyKey) : null;

  const safety = (
    <>
      <p className={`${line} font-medium`}>{t("private.danger")}</p>
      {kindSafety ? <p className={`${line} font-medium`}>{kindSafety}</p> : null}
    </>
  );
  const first = kind ? SAFETY_FIRST.has(kind.kind) : false;
  return (
    <aside aria-labelledby="ws-private" className="my-6 rounded-lg border bg-muted px-4 py-3">
      <div id="ws-private" className="text-sm font-semibold">
        {t("private.title")}
      </div>
      {first ? safety : null}
      {life ? <p className={line}>{t("life.record")}</p> : null}
      <p className={line}>{t("private.body")}</p>
      <p className={line}>{t("private.leaveOut")}</p>
      {first ? null : safety}
    </aside>
  );
}
