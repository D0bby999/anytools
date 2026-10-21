/**
 * repeated-resistance.tsx
 * Shown on a learning state when its last three interruptions named the same
 * resistance. up's advice for that case (docs/en/templates/90-day-cycle.md §6;
 * rhythm-and-compounding.md §6) is to change the conditions rather than ask
 * for more force, and to record capacity and resistance in the rhythm ledger.
 * AnyTools' ledger is the cycle's weekly capacity, so that is where it links.
 * The life toolkit's recovery reset (phase 9) is the secondary link: a
 * private worksheet for changing the conditions after a hard stretch.
 *
 * A tinted box with a full outline, no alert styling: this is advice, not a
 * warning.
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useResistanceLabels } from "~/components/loop/interruption-list";
import type { Resistance } from "~/lib/loop-types";

export function RepeatedResistance({ resistance, cycleId }: { resistance: Resistance; cycleId: string }) {
  const { t } = useTranslation("loop");
  const label = useResistanceLabels();
  return (
    <div role="note" aria-labelledby="lp-repeated-title" className="my-6 rounded-lg border bg-muted px-[18px] py-3">
      <div id="lp-repeated-title" className="font-semibold">
        {t("repeated.title")}
      </div>
      <p className="my-1! text-sm text-muted-foreground">
        {t("repeated.body", { resistance: label[resistance].toLowerCase() })}
      </p>
      <Link
        to={`/loop/cycle/${cycleId}#lp-cycle-questions`}
        className="inline-flex min-h-11 items-center text-sm"
      >
        {t("repeated.capacity")}
      </Link>
      <Link
        to="/toolkit/new?kind=recovery_reset"
        className="ml-4 inline-flex min-h-11 items-center text-sm"
      >
        {t("repeatedRecovery")}
      </Link>
    </div>
  );
}
