/**
 * links.tsx
 * Mine → Study links: save a web page, a YouTube video or a feed to learn
 * from, and see every link saved, whichever knowledge base holds it. The form
 * is the knowledge base page's own (AddLink posts to that base's action), so
 * the server's checks and the feed-following answer are the same.
 */
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/links";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { listMineOf } from "~/lib/mine.server";
import { PageHeader } from "~/components/ui/page-header";
import { AddLink } from "~/components/knowledge/add-link";
import { KBTarget } from "~/components/mine/kb-target";
import { MineTable } from "~/components/mine/mine-table";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Study links") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return listMineOf(user.id, "links");
}

export default function Links({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const { kbs, documents } = loaderData;
  return (
    <div>
      <PageHeader title={t("mine.links.title")} lede={t("mine.links.lead")} />
      <section aria-labelledby="lp-links-add" className="mt-8">
        <h2 id="lp-links-add">{t("mine.links.add")}</h2>
        <KBTarget kbs={kbs} label={t("mine.pickKbLink")}>
          {(kbId) => <AddLink kbId={kbId} />}
        </KBTarget>
      </section>
      <section aria-labelledby="lp-links-all" className="mt-10">
        <h2 id="lp-links-all">{t("mine.links.saved", { count: documents.length })}</h2>
        {documents.length > 0 ? (
          <MineTable documents={documents} kind="links" caption={t("mine.links.title")} />
        ) : (
          <p className="lp-empty">{t("mine.links.empty")}</p>
        )}
      </section>
    </div>
  );
}
