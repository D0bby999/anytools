import { useTranslation } from "react-i18next";
import type { Week } from "~/lib/vocab-types";

/**
 * up's "five to eight per cycle" (vocabulary chapter §3), shown after a word
 * becomes one to learn: guidance from the sixth of the learner's week, a
 * stronger note from the ninth. Neither stops the save; up says "select
 * only", not "refuse".
 */
export function WeekNotice({ week }: { week: Week }) {
  const { t } = useTranslation("vocab");
  if (!week.notice) return null;
  return (
    <p role="note" className="mt-2 rounded-md border bg-muted px-3 py-2 text-xs leading-snug text-muted-foreground">
      {t(`week.${week.notice}`, { count: week.learning })}
    </p>
  );
}
