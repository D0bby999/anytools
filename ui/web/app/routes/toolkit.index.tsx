/**
 * toolkit.index.tsx
 * The Toolkit: up's worksheets, grouped as up groups them (language,
 * projects, life), each kind with the learner's own worksheets of it and a
 * way to start one. What is due to revisit today comes first.
 *
 * The kinds are whatever the API serves; this page has no list of its own.
 */
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/toolkit.index";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import * as worksheets from "~/lib/worksheets.server";
import type { DueReview } from "~/lib/worksheet-types";
import { DueReviewList } from "~/components/worksheet/worksheet-list";
import { ToolkitGroups } from "~/components/worksheet/toolkit-groups";
import { PageHeader } from "~/components/ui/page-header";

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
  const { kinds, list, due } = loaderData;
  return (
    <div className="lp-measure">
      <PageHeader title={t("index.title")} lede={t("index.lead")} />
      <section aria-labelledby="tk-due" className="mt-8">
        <h2 id="tk-due" className="lp-section">
          {t("due.title")}
        </h2>
        <DueReviewList due={due} />
      </section>
      <ToolkitGroups kinds={kinds} list={list} />
    </div>
  );
}
