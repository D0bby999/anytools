/**
 * files.tsx
 * Mine → My files: every file the learner uploaded, from every knowledge
 * base, in one table (owner, 2026-10-21: the files lived only inside each
 * base). Uploading is its own page, /upload.
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/files";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { listMineOf } from "~/lib/mine.server";
import { PageHeader } from "~/components/ui/page-header";
import { Button } from "~/components/ui/button";
import { MineTable } from "~/components/mine/mine-table";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "My files") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return listMineOf(user.id, "files");
}

export default function Files({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const { documents } = loaderData;
  return (
    <div>
      <PageHeader
        title={t("mine.files.title")}
        lede={t("mine.files.lead", { count: documents.length })}
        actions={
          <Button asChild>
            <Link to="/upload">{t("mine.files.upload")}</Link>
          </Button>
        }
      />
      <section aria-labelledby="lp-files-all" className="mt-8">
        <h2 id="lp-files-all" className="sr-only">
          {t("mine.files.title")}
        </h2>
        {documents.length > 0 ? (
          <MineTable documents={documents} kind="files" caption={t("mine.files.title")} />
        ) : (
          <p className="lp-empty">{t("mine.files.empty")}</p>
        )}
      </section>
    </div>
  );
}
