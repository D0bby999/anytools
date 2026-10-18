/**
 * chain-columns.tsx
 * An evidence chain's four timepoints side by side: where it started, right
 * after, days later, somewhere new. Four columns from `md` up, stacked in the
 * same order below it, so the reading order is the timeline on every screen.
 */
import { useTranslation } from "react-i18next";
import type { ChainDetail } from "~/lib/loop-types";
import { EvidenceRow } from "~/components/loop/evidence-row";
import { useTimepointLabels } from "~/components/loop/timepoint-select";

export function ChainColumns({ chain }: { chain: ChainDetail }) {
  const { t } = useTranslation("loop");
  const labels = useTimepointLabels();
  return (
    <div className="mt-3 grid gap-6 md:grid-cols-4 md:gap-4">
      {chain.columns.map((col) => (
        <section key={col.timepoint} aria-labelledby={`lp-col-${col.timepoint}`}>
          <h3 id={`lp-col-${col.timepoint}`} className="lp-kicker border-b pb-2">
            {labels[col.timepoint]}
          </h3>
          {col.refs.length === 0 ? (
            <p className="mt-2 text-xs text-faint">{t("chainPage.emptyColumn")}</p>
          ) : (
            <ul>
              {col.refs.map((r) => (
                <EvidenceRow key={r.id} item={r} editable={false} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
