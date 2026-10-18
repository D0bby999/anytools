/**
 * state-worksheets.tsx
 * A learning state's worksheets (up methods, phase 0): the ones attached to
 * this goal, and "New worksheet", which offers the kinds that attach to a
 * learning state. The whole toolkit is a link away too (phase 14), since the
 * life kinds attach to nothing and are not offered here.
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { WorksheetSummary } from "~/lib/worksheet-types";
import { WorksheetList } from "~/components/worksheet/worksheet-list";

export function StateWorksheets({ stateId, worksheets }: { stateId: string; worksheets: WorksheetSummary[] }) {
  const { t } = useTranslation("toolkit");
  return (
    <section aria-labelledby="lp-state-worksheets" className="mt-10">
      <h2 id="lp-state-worksheets" className="lp-section">
        {t("state.title")}
      </h2>
      {worksheets.length === 0 ? (
        <p className="mt-3 lp-empty">{t("state.none")}</p>
      ) : (
        <WorksheetList worksheets={worksheets} />
      )}
      <div className="mt-2 flex flex-wrap gap-x-4">
        <Link
          to={`/toolkit/new?state=${encodeURIComponent(stateId)}`}
          className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
        >
          {t("state.new")}
        </Link>
        <Link to="/toolkit" className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4">
          {t("loop.open")}
        </Link>
      </div>
    </section>
  );
}
