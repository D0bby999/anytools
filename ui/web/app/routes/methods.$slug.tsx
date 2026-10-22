/**
 * methods.$slug.tsx
 * One learning method (the private design notes): how strong the
 * evidence is, what it is, why it works, how to do it, the usual mistake,
 * one thing to try today, where AnyLearn does it, the studies, and videos.
 */
import { Link, data } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/methods.$slug";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { saveVideo } from "~/lib/methods.server";
import { DO_IT, EVIDENCE, SOURCES, VIDEOS_CHECKED, isMethodSlug, searchURL, videosFor } from "~/lib/methods";
import { dayLabel } from "~/lib/day-label";
import { VideoList } from "~/components/methods/video-list";
import { PageHeader } from "~/components/ui/page-header";

const LINK = "text-primary underline underline-offset-4";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Learning methods") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request);
  if (!isMethodSlug(params.slug)) throw data(null, { status: 404 });
  return { slug: params.slug };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  return saveVideo(user.id, user.language, await request.formData());
}

export default function Method({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation("methods");
  const { slug } = loaderData;
  const ui = i18n.language;
  const k = (key: string) => `methods.${slug}.${key}`;
  const steps = t(k("steps"), { returnObjects: true }) as string[];

  return (
    <div className="lp-doc">
      <p className="text-sm">
        <Link to="/methods" className={LINK}>
          {t("back")}
        </Link>
      </p>
      <PageHeader title={t(k("name"))} lede={t(k("short"))}>
        <p className="mt-3">
          <span className="inline-block rounded border border-border bg-card px-2 py-0.5 text-sm">{t(`evidence.${EVIDENCE[slug]}`)}</span>
        </p>
      </PageHeader>

      <section aria-labelledby="lp-method-what">
        <h2 id="lp-method-what" className="lp-section">
          {t("what")}
        </h2>
        <p className="mt-2 max-w-[64ch]">{t(k("what"))}</p>
      </section>

      <section aria-labelledby="lp-method-why" className="mt-8">
        <h2 id="lp-method-why" className="lp-section">
          {t("why")}
        </h2>
        <p className="mt-2 max-w-[64ch]">{t(k("why"))}</p>
      </section>

      <section aria-labelledby="lp-method-how" className="mt-8">
        <h2 id="lp-method-how" className="lp-section">
          {t("how")}
        </h2>
        <ol className="mt-2 max-w-[64ch] list-decimal space-y-1 pl-5">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <h3 className="mt-5 font-semibold">{t("mistake")}</h3>
        <p className="mt-1 max-w-[64ch]">{t(k("mistake"))}</p>
        <h3 className="mt-5 font-semibold">{t("today")}</h3>
        <p className="mt-1 max-w-[64ch]">{t(k("today"))}</p>
      </section>

      <section aria-labelledby="lp-method-app" className="mt-8">
        <h2 id="lp-method-app" className="lp-section">
          {t("inApp")}
        </h2>
        <ul className="mt-2 space-y-1">
          {DO_IT[slug].map((d) => (
            <li key={d.to + d.labelKey}>
              <Link to={d.to} className={LINK}>
                {t(`do.${d.labelKey}`)}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="lp-method-videos" className="mt-8">
        <h2 id="lp-method-videos" className="lp-section">
          {t("videos.title")}
        </h2>
        <p className="mt-2 max-w-[64ch] text-sm text-muted-foreground">{t("videos.lede")}</p>
        <VideoList videos={videosFor(slug, ui)} ui={ui} search={searchURL(t(k("search")))} />
        <p className="mt-1 text-xs text-muted-foreground">{t("videos.checked", { date: dayLabel(VIDEOS_CHECKED, i18n.language) })}</p>
      </section>

      <section aria-labelledby="lp-method-sources" className="mt-8">
        <h2 id="lp-method-sources" className="lp-section">
          {t("sources")}
        </h2>
        <ul className="mt-2 space-y-2 text-sm">
          {SOURCES[slug].map((s) => (
            <li key={s.doi}>
              {s.cite}. <span lang="en">{s.title}</span>.{" "}
              <a href={`https://doi.org/${s.doi}`} target="_blank" rel="noopener noreferrer" className={LINK}>
                doi:{s.doi}
                {" "}
          <span className="sr-only">{t("newTab")}</span>
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">{t("sourcesNote")}</p>
      </section>
    </div>
  );
}
