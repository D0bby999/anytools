/**
 * chain-columns.tsx
 * An evidence chain's four timepoints side by side: where it started, right
 * after, days later, somewhere new. A table of four columns (plan 261020-2246
 * phase 12, up's Evidence Chain Template), so the reading order is the
 * timeline; on a narrow screen it scrolls inside its own box.
 */
import { useTranslation } from "react-i18next";
import type { ChainDetail } from "~/lib/loop-types";
import { RefTable } from "~/components/doc/ref-table";
import { EvidenceLabel } from "~/components/loop/evidence-row";
import { useTimepointLabels } from "~/components/loop/timepoint-select";

export function ChainColumns({ chain }: { chain: ChainDetail }) {
  const { t } = useTranslation("loop");
  const labels = useTimepointLabels();
  return (
    <RefTable
      caption={t("chainPage.timeline")}
      rowHeaders={false}
      columns={chain.columns.map((col) => labels[col.timepoint])}
      rows={[
        chain.columns.map((col) =>
          col.refs.length === 0 ? (
            <span key={col.timepoint} className="text-muted-foreground">
              {t("chainPage.emptyColumn")}
            </span>
          ) : (
            <ul key={col.timepoint} className="m-0! pl-5">
              {col.refs.map((r) => (
                <li key={r.id}>
                  <EvidenceLabel item={r} />
                </li>
              ))}
            </ul>
          ),
        ),
      ]}
    />
  );
}
