/**
 * upload.tsx
 * Mine → Upload: one place to add a file, whichever knowledge base it goes
 * into. The dropzone is the knowledge base page's own (it posts to that
 * base's routes), so limits, photo pages and Drive copies behave the same.
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/upload";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { listMineOf } from "~/lib/mine.server";
import { PageHeader } from "~/components/ui/page-header";
import { UploadDropzone } from "~/components/knowledge/upload-dropzone";
import { KBTarget } from "~/components/mine/kb-target";
import { MineTable } from "~/components/mine/mine-table";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Upload") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return listMineOf(user.id, "files");
}

/** The latest few, so an upload is seen landing without leaving the page. */
const RECENT = 5;

export default function Upload({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const { kbs, documents } = loaderData;
  const recent = documents.slice(0, RECENT);
  return (
    <div>
      <PageHeader title={t("mine.upload.title")} lede={t("mine.upload.lead")} />
      <section aria-labelledby="lp-upload-form" className="mt-8">
        <h2 id="lp-upload-form" className="sr-only">
          {t("mine.upload.title")}
        </h2>
        <KBTarget kbs={kbs} label={t("mine.pickKb")}>
          {(kbId) => <UploadDropzone kbId={kbId} />}
        </KBTarget>
      </section>
      {recent.length > 0 ? (
        <section aria-labelledby="lp-upload-recent" className="mt-10">
          <h2 id="lp-upload-recent">{t("mine.upload.recent")}</h2>
          <MineTable documents={recent} kind="files" caption={t("mine.upload.recent")} />
          <p className="mt-3 text-sm">
            <Link to="/files" className="font-medium text-primary underline underline-offset-4">
              {t("mine.upload.all")}
            </Link>
          </p>
        </section>
      ) : null}
    </div>
  );
}
