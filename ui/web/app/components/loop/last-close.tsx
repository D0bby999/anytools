/**
 * last-close.tsx
 * "From the last close" on a new cycle's page (up methods, phase 10). While
 * week 1's question is empty and the state's previous cycle was closed, the
 * results it sent on — continue and transfer — are offered as week 1's
 * question; choosing one writes its next step there. Repair results are shown
 * as what to reduce first. Stopped results are never offered.
 */
import { Form, Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { PreviousClose } from "~/lib/cycle-close";
import { Button } from "~/components/ui/button";

export function LastClose({ previous, busy }: { previous: PreviousClose; busy: boolean }) {
  const { t } = useTranslation("loop");
  if (previous.offers.length === 0 && previous.reduce_first.length === 0) return null;
  return (
    <div>
      {previous.offers.length > 0 ? (
        <>
          <p className="text-muted-foreground">{t("cycleClose.fromLastLead")}</p>
          <ul>
            {previous.offers.map((o) => (
              <li key={o.row} className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 grow">
                  <strong>
                    {t(`cycleClose.destination.${o.destination}`, { defaultValue: o.destination })}
                    {o.result ? ` · ${o.result}` : ""}
                  </strong>
                  <span className="block">{o.next_step}</span>
                  {o.condition ? (
                    <span className="block text-sm text-muted-foreground">
                      {t("cycleClose.changed", { condition: o.condition })}
                    </span>
                  ) : null}
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="from-close" />
                  <input type="hidden" name="row" value={o.row} />
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={t("cycleClose.useLabel", { step: o.next_step })}
                  >
                    {t("cycleClose.use")}
                  </Button>
                </Form>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {previous.reduce_first.length > 0 ? (
        <div>
          <h4>{t("cycleClose.reduceFirst")}</h4>
          <ul>
            {previous.reduce_first.map((r) => (
              <li key={r.row}>
                {r.result}
                {r.next_step ? <span className="text-muted-foreground"> · {r.next_step}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Link to={`/toolkit/${previous.id}`} className="inline-flex min-h-11 items-center">
        {t("cycleClose.openLast")}
      </Link>
    </div>
  );
}
