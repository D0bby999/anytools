/**
 * toolkit.index.tsx
 * The Toolkit: up's worksheets, grouped as up groups them (language,
 * projects, life), each kind with the learner's own worksheets of it and a
 * way to start one, and what is due to revisit today.
 *
 * The kinds are whatever the API serves; this page has no list of its own.
 *
 * Laid out as up's Toolkit Overview (P11, plan 261020-2246 phase 12): "First
 * ask: where am I stuck?" as a table into the three groups, what is due, the
 * learner's latest worksheets as a dated list, then every kind by group.
 */
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/toolkit.index";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import * as worksheets from "~/lib/worksheets.server";
import type { DueReview } from "~/lib/worksheet-types";
import { DueReviewList, WorksheetList } from "~/components/worksheet/worksheet-list";
import { groupKinds, ToolkitGroups, useGroupTitles } from "~/components/worksheet/toolkit-groups";
import { PageHeader } from "~/components/ui/page-header";
import { RefTable } from "~/components/doc/ref-table";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Toolkit") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const [kinds, list, due] = await Promise.all([
    worksheets.listKinds(user.id),
    worksheets.listWorksheets(user.id),
    worksheets.dueWorksheets(user.id).then((d) => d.due).catch((): DueReview[] => []),
  ]);
  return { kinds, list, due };
}

export default function ToolkitIndex({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("toolkit");
  const groupTitle = useGroupTitles();
  const { kinds, list, due } = loaderData;
  const names = Object.fromEntries(kinds.map((k) => [k.kind, k.name]));
  const recent = [...list].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "")).slice(0, 10);
  return (
    <div>
      <PageHeader title={t("index.title")} lede={t("index.lead")} />
      <div className="lp-doc">
        {kinds.length > 0 ? (
          <section aria-labelledby="tk-first-ask">
            <h2 id="tk-first-ask">{t("up.index.firstAsk")}</h2>
            <RefTable
              caption={t("up.index.firstAsk")}
              columns={[t("up.index.ifYou"), t("up.index.use")]}
              rows={groupKinds(kinds).map(({ group }) => [
                t(`up.index.when.${group}`),
                <a key="use" href={`#tk-${group}`}>
                  {groupTitle[group]}
                </a>,
              ])}
            />
          </section>
        ) : null}

        <section aria-labelledby="tk-due">
          <h2 id="tk-due">{t("due.title")}</h2>
          <DueReviewList due={due} />
        </section>

        <section aria-labelledby="tk-yours">
          <h2 id="tk-yours">{t("up.index.yours")}</h2>
          {recent.length === 0 ? (
            <p className="text-muted-foreground">{t("up.index.noneYet")}</p>
          ) : (
            <WorksheetList worksheets={recent} kindNames={names} />
          )}
        </section>

        <section aria-labelledby="tk-all">
          <h2 id="tk-all">{t("up.index.all")}</h2>
          <ToolkitGroups kinds={kinds} list={list} />
        </section>
      </div>
    </div>
  );
}
