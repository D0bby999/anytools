/**
 * body.library.tsx
 * Body → Library: 1,324 exercises by name, body part and equipment, and one
 * exercise's steps. Text only: the dataset's animations are © Gym visual and
 * not ours to serve (THIRD-PARTY-NOTICES.md).
 */
import { Form, Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useLibraryTerm } from "~/components/body/muscles";
import type { Route } from "./+types/body.library";
import { appTitle } from "~/lib/app-title";
import { requireUserId } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { getExercise, searchExercises } from "~/lib/body.server";
import { BodyTabs } from "~/components/body/body-tabs";
import { FIELD } from "~/components/body/fields";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "Exercise library") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

const PAGE = 40;

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 80);
  const bodyPart = url.searchParams.get("body_part") ?? "";
  const equipment = url.searchParams.get("equipment") ?? "";
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const id = url.searchParams.get("id") ?? "";
  const [list, detail] = await Promise.all([
    searchExercises(userId, { q, body_part: bodyPart, equipment, limit: PAGE, offset }),
    id
      ? getExercise(userId, id).then(
          (r) => r.exercise,
          (e: unknown) => {
            if (e instanceof ApiError && e.status === 404) return null;
            throw e;
          },
        )
      : Promise.resolve(null),
  ]);
  return { ...list, q, bodyPart, equipment, offset, detail };
}

export default function BodyLibrary({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("body");
  const term = useLibraryTerm();
  const { exercises, total, facets, q, bodyPart, equipment, offset, detail } = loaderData;
  const page = (o: number) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (bodyPart) p.set("body_part", bodyPart);
    if (equipment) p.set("equipment", equipment);
    if (o) p.set("offset", String(o));
    return `/body/library?${p}`;
  };

  return (
    <div className="lp-measure">
      <PageHeader title={t("library.title")} lede={t("library.lead")} />
      <BodyTabs />

      {detail ? (
        <section data-part="practise" aria-labelledby="lp-library-detail" className="lp-keybox mb-8 p-5 sm:p-6">
          <h2 id="lp-library-detail" className="font-serif text-2xl font-semibold first-letter:uppercase">
            {detail.name}
          </h2>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("library.target")}</dt>
            <dd>{term(detail.target)}</dd>
            {detail.secondary.length > 0 ? (
              <>
                <dt className="text-muted-foreground">{t("library.secondary")}</dt>
                <dd>{detail.secondary.map(term).join(", ")}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t("library.equipment")}</dt>
            <dd>{term(detail.equipment)}</dd>
          </dl>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-prose">
            {(detail.steps ?? []).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      ) : null}

      <Form method="get" role="search" className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 basis-56 text-xs text-muted-foreground">
          {t("library.search")}
          <input type="search" name="q" defaultValue={q} maxLength={80} className={FIELD} />
        </label>
        <label className="text-xs text-muted-foreground">
          {t("library.bodyPart")}
          <select name="body_part" defaultValue={bodyPart} className={FIELD}>
            <option value="">{t("library.any")}</option>
            {facets.body_parts.map((b) => (
              <option key={b} value={b}>
                {term(b)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          {t("library.equipment")}
          <select name="equipment" defaultValue={equipment} className={FIELD}>
            <option value="">{t("library.any")}</option>
            {facets.equipment.map((e) => (
              <option key={e} value={e}>
                {term(e)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline">
          {t("library.go")}
        </Button>
      </Form>

      <p className="mt-4 text-sm text-muted-foreground" role="status">
        {t("library.count", { count: total })}
      </p>
      <ul className="mt-2 divide-y border-y">
        {exercises.map((e) => (
          <li key={e.id}>
            <Link to={`${page(offset)}&id=${e.id}`} className="flex flex-wrap items-baseline gap-x-4 py-3 hover:bg-hover" preventScrollReset={false}>
              <span className="min-w-0 flex-1 font-medium first-letter:uppercase">{e.name}</span>
              <span className="text-xs text-muted-foreground">
                {term(e.target)} · {term(e.equipment)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-3">
        {offset > 0 ? (
          <Button asChild variant="outline" size="sm">
            <Link to={page(Math.max(0, offset - PAGE))}>{t("library.previous")}</Link>
          </Button>
        ) : null}
        {offset + PAGE < total ? (
          <Button asChild variant="outline" size="sm">
            <Link to={page(offset + PAGE)}>{t("library.next")}</Link>
          </Button>
        ) : null}
      </div>
      <p className="mt-8 text-xs leading-snug text-muted-foreground">{t("library.credit")}</p>
    </div>
  );
}
