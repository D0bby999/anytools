/**
 * weekly-questions.tsx
 * The cycle's twelve weekly questions, each with the capacity that week can
 * really hold. Planning a reduced week in advance keeps a busy week inside the
 * cycle rather than a gap in it.
 *
 * Twelve rows of up's input table (I2): the week, its question, its capacity.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import type { WeeklyQuestion } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";
import { ScrollBox } from "~/components/doc/scroll-box";

const WEEKS = Array.from({ length: 12 }, (_, i) => i);

export function WeeklyQuestions({ questions, busy }: { questions: WeeklyQuestion[]; busy: boolean }) {
  const { t } = useTranslation("loop");
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="questions" />
      <div className="lp-field-table">
        <ScrollBox>
          <table className="min-w-[30rem]">
            <caption className="sr-only">{t("cycle.questions")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("up.cycle.week")}</th>
                <th scope="col">{t("up.cycle.question")}</th>
                <th scope="col">{t("up.cycle.capacity")}</th>
              </tr>
            </thead>
            <tbody>
              {WEEKS.map((i) => (
                <tr key={i}>
                  <th scope="row" className="w-16">
                    W{String(i + 1).padStart(2, "0")}
                  </th>
                  <td>
                    <input
                      name="question"
                      aria-label={t("cycle.questionFor", { week: i + 1 })}
                      defaultValue={questions[i]?.question ?? ""}
                      maxLength={1000}
                    />
                  </td>
                  <td className="w-36">
                    <select
                      name="capacity"
                      aria-label={t("cycle.capacityFor", { week: i + 1 })}
                      defaultValue={questions[i]?.capacity ?? "full"}
                    >
                      <option value="full">{t("cycle.full")}</option>
                      <option value="reduced">{t("cycle.reduced")}</option>
                      <option value="minimum">{t("cycle.minimum")}</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      </div>
      <Button type="submit" variant="outline" disabled={busy}>
        {t("cycle.saveQuestions")}
      </Button>
    </Form>
  );
}
