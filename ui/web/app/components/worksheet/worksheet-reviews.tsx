/**
 * worksheet-reviews.tsx
 * A worksheet's review dates, as its kind names them. A review counted from
 * an event (the first pass, the delivery) says "not scheduled" until that
 * event is written down. A scheduled date can be moved later, never earlier
 * than up's delay allows — the API refuses that, and says why.
 *
 * Folded (I7) at the foot of the worksheet: the dates matter on the day,
 * not while the page is being filled in.
 */
import { Details } from "~/components/doc/details";
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import type { ReviewDate, WorksheetKind } from "~/lib/worksheet-types";
import { Button } from "~/components/ui/button";
import { inputBox } from "~/components/worksheet/field-input";

export function WorksheetReviews({
  kind,
  reviews,
  revision,
  busy,
}: {
  kind: WorksheetKind;
  reviews: Record<string, ReviewDate>;
  revision: string;
  busy: boolean;
}) {
  const { t } = useTranslation("toolkit");
  const list = kind.reviews ?? [];
  if (list.length === 0) return null;
  return (
    <Details summary={t("reviews.title")}>
      <ul className="m-0! list-none! border-t p-0!">
        {list.map((r) => {
          const date = reviews[r.key];
          return (
            <li key={r.key} className="m-0! border-b py-3">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-sm font-medium">{r.label}</span>
                {date ? (
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {date.due}
                    {date.done ? ` · ${t("reviews.done")}` : ""}
                  </span>
                ) : (
                  <span className="text-xs text-faint">{t("reviews.notScheduled")}</span>
                )}
              </div>
              {date && !date.done ? (
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  <Form method="post" className="flex items-end gap-2">
                    <input type="hidden" name="intent" value="moveReview" />
                    <input type="hidden" name="review" value={r.key} />
                    <input type="hidden" name="revision" value={revision} />
                    <label className="text-xs text-muted-foreground">
                      {t("reviews.move")}
                      <input
                        type="date"
                        name="due"
                        min={date.earliest}
                        defaultValue={date.due}
                        className={`${inputBox} mt-1 max-w-48`}
                      />
                    </label>
                    <Button type="submit" variant="outline" size="sm" disabled={busy}>
                      {t("reviews.save")}
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="reviewDone" />
                    <input type="hidden" name="review" value={r.key} />
                    <input type="hidden" name="revision" value={revision} />
                    <Button type="submit" variant="ghost" size="sm" disabled={busy}>
                      {t("reviews.markDone")}
                    </Button>
                  </Form>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Details>
  );
}
