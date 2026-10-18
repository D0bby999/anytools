/**
 * artifact-extras.tsx
 * What up's artifact brief shows beyond its served kind (up methods, phase 8):
 *   - §3: a quality gate whose evidence location is empty reads "unverified",
 *     as up writes a pass that has no evidence (artifact-brief.md §3). The
 *     rule itself is the evidence column's help, listed under the table.
 *   - §5: once the delivery line is saved and the brief is attached to a
 *     learning state, "Add to evidence" puts the brief on one of that state's
 *     evidence chains at the transfer timepoint (phase 0's worksheet
 *     evidence).
 */
import { Form, Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Worksheet, WorksheetKind, WorksheetSection } from "~/lib/worksheet-types";
import type { Chain } from "~/lib/loop-types";
import type { FormExtras } from "~/components/worksheet/worksheet-form";
import { Button } from "~/components/ui/button";

export const ARTIFACT_BRIEF = "artifact_brief";
// The kind's keys, as internal/learning/worksheet/kinds_projects.go names them.
const GATES = "gates";
const DELIVERY = "delivery";
const DELIVERED_ON = "date_version";

const filledText = (v: unknown) => typeof v === "string" && v.trim() !== "";

/** The brief's gate cells, or undefined for any other kind. */
export function useArtifactExtras(kind: WorksheetKind): FormExtras | undefined {
  const { t } = useTranslation("toolkit");
  if (kind.kind !== ARTIFACT_BRIEF) return undefined;
  return (section, field) =>
    section === GATES && field.key === GATES
      ? {
          labelCell: (column, row) =>
            column.key === "check" ? (
              <span className="text-muted-foreground">
                {column.text?.[row.row] ?? ""}
                {/* The row's current, unsaved evidence decides it. */}
                {filledText(row.cells.evidence) ? null : (
                  <span className="mt-1 block font-mono text-xs uppercase tracking-wide text-warning">
                    {t("artifact.unverified")}
                  </span>
                )}
              </span>
            ) : undefined,
        }
      : undefined;
}

/** "Add to evidence" under §5, or undefined for any other kind. */
export function artifactSectionExtra(kind: WorksheetKind, worksheet: Worksheet, chains: Chain[]) {
  if (kind.kind !== ARTIFACT_BRIEF) return undefined;
  return (section: WorksheetSection) =>
    section.key === DELIVERY ? <AddToEvidence worksheet={worksheet} chains={chains} /> : null;
}

function AddToEvidence({ worksheet, chains }: { worksheet: Worksheet; chains: Chain[] }) {
  const { t } = useTranslation("toolkit");
  // The saved delivery line: the brief that goes on the chain is what the
  // server holds.
  const delivered = filledText(worksheet.answers[DELIVERY]?.[DELIVERED_ON]);
  if (!delivered || !worksheet.state_id) return null;
  const [only, ...more] = chains;
  return (
    <section aria-labelledby="ws-artifact-evidence" className="mt-6 rounded-md border bg-muted px-4 py-3">
      <h3 id="ws-artifact-evidence" className="lp-kicker">
        {t("artifact.evidenceTitle")}
      </h3>
      <p className="mt-1 text-sm leading-prose text-muted-foreground">{t("artifact.evidenceLead")}</p>
      {!only ? (
        <p className="mt-2 text-sm">
          {t("artifact.noChain")}{" "}
          <Link to={`/loop/state/${worksheet.state_id}`} className="text-primary underline underline-offset-4">
            {t("artifact.openState")}
          </Link>
        </p>
      ) : (
        <Form method="post" className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="intent" value="addToEvidence" />
          {more.length === 0 ? (
            <input type="hidden" name="chain_id" value={only.id} />
          ) : (
            <label className="block grow text-sm font-medium">
              {t("artifact.chain")}
              <select
                name="chain_id"
                className="mt-1 block min-h-11 w-full rounded-md border border-control-border bg-background px-3 text-sm"
              >
                {chains.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.question}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button type="submit" variant="outline">
            {t("artifact.addToEvidence")}
          </Button>
        </Form>
      )}
    </section>
  );
}
