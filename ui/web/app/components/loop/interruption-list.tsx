/**
 * interruption-list.tsx
 * A cycle's interruptions, each with the lines it was recorded with (up's
 * 90-day-cycle.md §6). Entries from before those lines existed have only a
 * note, shown as their fact and marked as an earlier record.
 */
import { useTranslation } from "react-i18next";
import type { Interruption, Resistance } from "~/lib/loop-types";

/** up's five resistances as the learner reads them. */
export function useResistanceLabels(): Record<Resistance, string> {
  const { t } = useTranslation("loop");
  return {
    time: t("interruption.resistanceLabel.time"),
    difficulty: t("interruption.resistanceLabel.difficulty"),
    energy: t("interruption.resistanceLabel.energy"),
    environment: t("interruption.resistanceLabel.environment"),
    responsibility: t("interruption.resistanceLabel.responsibility"),
  };
}

export function InterruptionList({ items }: { items: Interruption[] }) {
  const { t } = useTranslation("loop");
  const resistance = useResistanceLabels();
  return (
    <ul className="mt-3 border-t">
      {items.map((i) => {
        const lines = [
          { label: t("interruption.line.resistance"), value: i.resistance ? resistance[i.resistance] : "" },
          { label: t("interruption.line.reducedTo"), value: i.reduced_to ?? "" },
          { label: t("interruption.line.within24h"), value: i.within_24h ?? "" },
          { label: t("interruption.line.notRepaying"), value: i.not_repaying ?? "" },
          { label: t("interruption.line.reviewOn"), value: i.review_on ?? "" },
          { label: t("interruption.line.was"), value: i.prior_task },
        ].filter((l) => l.value);
        const fact = i.fact || i.note;
        return (
          <li key={i.at} className="border-b py-3 text-sm">
            <p>
              <span className="font-mono text-xs text-faint">{i.at.slice(0, 10)}</span>{" "}
              {fact || <span className="text-faint">{t("cycle.noNote")}</span>}
            </p>
            {!i.fact ? <p className="text-xs text-muted-foreground">{t("interruption.earlier")}</p> : null}
            {lines.length > 0 ? (
              <dl className="mt-1">
                {lines.map((l) => (
                  <div key={l.label} className="grid grid-cols-[9rem_1fr] gap-x-3 py-0.5">
                    <dt className="text-muted-foreground">{l.label}</dt>
                    <dd>{l.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
