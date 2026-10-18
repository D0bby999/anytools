/**
 * weekly-questions.tsx
 * The cycle's twelve weekly questions, each with the capacity that week can
 * really hold. Planning a reduced week in advance keeps a busy week inside the
 * cycle rather than a gap in it.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import type { WeeklyQuestion } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";

const WEEKS = Array.from({ length: 12 }, (_, i) => i);

export function WeeklyQuestions({ questions, busy }: { questions: WeeklyQuestion[]; busy: boolean }) {
  const { t } = useTranslation("loop");
  return (
    <Form method="post" className="mt-3">
      <input type="hidden" name="intent" value="questions" />
      <ol className="border-t">
        {WEEKS.map((i) => (
          <li key={i} className="grid grid-cols-[3rem_1fr_8rem] items-center gap-2 border-b py-2">
            <span className="font-mono text-xs text-faint">W{String(i + 1).padStart(2, "0")}</span>
            <input
              name="question"
              aria-label={t("cycle.questionFor", { week: i + 1 })}
              defaultValue={questions[i]?.question ?? ""}
              maxLength={1000}
              className="min-h-11 rounded-md border border-control-border bg-background px-2 text-sm"
            />
            <select
              name="capacity"
              aria-label={t("cycle.capacityFor", { week: i + 1 })}
              defaultValue={questions[i]?.capacity ?? "full"}
              className="min-h-11 rounded-md border border-control-border bg-background px-2 text-sm"
            >
              <option value="full">{t("cycle.full")}</option>
              <option value="reduced">{t("cycle.reduced")}</option>
              <option value="minimum">{t("cycle.minimum")}</option>
            </select>
          </li>
        ))}
      </ol>
      <Button type="submit" variant="outline" className="mt-3" disabled={busy}>
        {t("cycle.saveQuestions")}
      </Button>
    </Form>
  );
}
