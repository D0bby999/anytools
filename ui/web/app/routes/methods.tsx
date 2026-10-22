/**
 * methods.tsx
 * Learning methods (the private design notes): the three things
 * that matter most, every method grouped by how strong its evidence is, and
 * videos on the science of studying.
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/methods";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { saveVideo } from "~/lib/methods.server";
import { EVIDENCE, EVIDENCE_ORDER, METHOD_SLUGS, searchURL, videosFor } from "~/lib/methods";
import { VideoList } from "~/components/methods/video-list";
import { PageHeader } from "~/components/ui/page-header";

const LINK = "text-primary underline underline-offset-4";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Learning methods") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  return saveVideo(user.id, user.language, await request.formData());
}

export default function Methods() {
  const { t, i18n } = useTranslation("methods");
  // In the page's own language, which the app layout chose.
  const ui = i18n.language;
  const steps = t("start.steps", { returnObjects: true }) as string[];

  return (
    <div className="lp-doc">
      <PageHeader title={t("title")} lede={t("lede")} />

      <section aria-labelledby="lp-methods-start" className="rounded border border-border bg-card p-4">
        <h2 id="lp-methods-start" className="font-semibold">
          {t("start.title")}
        </h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="mt-2 text-sm text-muted-foreground">{t("start.note")}</p>
      </section>

      {EVIDENCE_ORDER.map((level) => (
        <section key={level} aria-labelledby={`lp-methods-${level}`} className="mt-10">
          <h2 id={`lp-methods-${level}`} className="lp-section">
            {t(`evidence.${level}`)}
          </h2>
          <ul className="mt-3 space-y-4">
            {METHOD_SLUGS.filter((m) => EVIDENCE[m] === level).map((m) => (
              <li key={m}>
                <Link to={`/methods/${m}`} className={`${LINK} font-medium`}>
                  {t(`methods.${m}.name`)}
                </Link>
                <p className="mt-1 max-w-[64ch] text-sm text-muted-foreground">{t(`methods.${m}.short`)}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="mt-6 max-w-[64ch] text-sm text-muted-foreground">{t("evidence.note")}</p>

      <section aria-labelledby="lp-methods-videos" className="mt-10">
        <h2 id="lp-methods-videos" className="lp-section">
          {t("overview.videos")}
        </h2>
        <VideoList videos={videosFor("overview", ui)} ui={ui} search={searchURL(t("overview.search"))} />
      </section>
    </div>
  );
}
