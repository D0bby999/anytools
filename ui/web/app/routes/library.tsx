/**
 * library.tsx
 * Library (the private design notes, phase 1): ready material
 * from open sources, filtered by kind, field and language, each with its
 * licence and source, and one action that puts it where it is used. What
 * AnyLearn may not copy is listed and opened at its source. With no field and
 * no search the page shows a few items of each field
 * (the private design notes). The catalogue is in Postgres and
 * answered by the API, sorted and filtered by rating, popularity, hours,
 * year, level, certificate, video and licence
 * (the private design notes).
 */
import { Fragment, useId } from "react";
import { Form, Link, data, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/library";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { isSupportedLng } from "~/lib/i18n";
import { addLibraryDeck } from "~/lib/decks.server";
import { addLink, createKB, listKBs } from "~/lib/kb.server";
import { addQuestionSet } from "~/lib/quiz.server";
import { findByField, findItems, libraryItem, type FieldGroup } from "~/lib/library/api.server";
import { addWordListLevel } from "~/lib/library/word-lists.server";
import {
  LIBRARY_KINDS,
  LIBRARY_LEVELS,
  LIBRARY_PAGE,
  LIBRARY_SORTS,
  LIBRARY_SUBJECTS,
  type LibraryFilter,
  type LibraryItem,
  type LibraryKind,
  type LibraryLevel,
  type LibrarySort,
  type LibrarySubject,
} from "~/lib/library/types";
import { languageName } from "~/lib/languages";
import { NOTE_JOIN } from "~/lib/sentence";
import { formatDate } from "~/components/ui/date-text";
import { FIELD } from "~/components/body/fields";
import { Details } from "~/components/doc/details";
import { StatusLine } from "~/components/doc/status-line";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Library") }, { name: "robots", content: "noindex, nofollow" }];
}

const LINK = "text-primary underline underline-offset-4";

const CERTIFICATES = ["any", "free", "paid"] as const;

/** One of a list's values, or undefined. */
function oneOf<T extends string>(list: readonly T[], value: string | null): T | undefined {
  return (list as readonly string[]).includes(value ?? "") ? (value as T) : undefined;
}

function filterOf(url: URL): LibraryFilter {
  const p = url.searchParams;
  return {
    kind: oneOf<LibraryKind>(LIBRARY_KINDS, p.get("kind")),
    subject: oneOf<LibrarySubject>(LIBRARY_SUBJECTS, p.get("subject")),
    lang: (p.get("lang") ?? "").slice(0, 12),
    q: (p.get("q") ?? "").trim().slice(0, 80),
    offset: Math.min(100_000, Math.max(0, Math.floor(Number(p.get("offset")) || 0))),
    sort: oneOf<LibrarySort>(LIBRARY_SORTS, p.get("sort")),
    level: oneOf<LibraryLevel>(LIBRARY_LEVELS, p.get("level")),
    certificate: oneOf(CERTIFICATES, p.get("certificate")),
    video: p.get("video") === "1",
    reusable: p.get("reusable") === "1",
  };
}

/** A filter as the page's URL, with a field and an offset of its own. */
function libraryURL(filter: LibraryFilter, subject: LibrarySubject | undefined, offset: number) {
  const p = new URLSearchParams();
  if (filter.kind) p.set("kind", filter.kind);
  if (subject) p.set("subject", subject);
  if (filter.lang) p.set("lang", filter.lang);
  if (filter.q) p.set("q", filter.q);
  if (filter.sort && filter.sort !== "featured") p.set("sort", filter.sort);
  if (filter.level) p.set("level", filter.level);
  if (filter.certificate) p.set("certificate", filter.certificate);
  if (filter.video) p.set("video", "1");
  if (filter.reusable) p.set("reusable", "1");
  if (offset) p.set("offset", String(offset));
  const s = p.toString();
  return s ? `/library?${s}` : "/library";
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const ui = isSupportedLng(user.language ?? "") ? user.language! : "en";
  const filter = filterOf(new URL(request.url));
  // The first screen is by field; a field or a search is one list.
  const byField = !filter.subject && !filter.q;
  let found: { total: number; items: LibraryItem[]; groups: FieldGroup[]; languages: string[]; notLoaded?: boolean };
  try {
    found = byField ? { ...(await findByField(user.id, filter, ui)), items: [] } : { ...(await findItems(user.id, filter, ui)), groups: [] };
  } catch (error) {
    // The API loads the catalogue as it starts; until it has, the page says so.
    if (!(error instanceof ApiError && error.code === "library_not_loaded")) throw error;
    found = { total: 0, items: [], groups: [], languages: [], notLoaded: true };
  }
  const shown = byField ? found.groups.flatMap((g) => g.items) : found.items;
  // Knowledge bases only when something on this page goes into one.
  const needsKB = shown.some((i) => i.action.type === "link" || i.action.type === "set");
  const kbs = needsKB ? (await listKBs(user.id)).knowledge_bases.map((k) => ({ id: k.kb.id, name: k.kb.name })) : [];
  return { ...found, filter, kbs };
}

export type LibraryActionResult =
  | { id: string; deck: { name: string; created: number; duplicates: number; overLimit: number } }
  | { id: string; link: { kbId: string; kbName: string; feed: boolean } }
  | { id: string; words: { created: number; duplicates: number; firstDay?: string; lastDay?: string; language: string } }
  | { id: string; set: { added: number; already: number; kbId: string; kbName: string } }
  | { id: string; errorKey: string; errorDetail?: string };

// budget: one deck or one word list level (in batches of 200), or one link import, per tap.
export async function action({ request }: Route.ActionArgs): Promise<LibraryActionResult> {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const item = id ? await libraryItem(user.id, id) : null;
  if (!item) throw data(null, { status: 404 });
  try {
    switch (String(form.get("intent") ?? "")) {
      case "add-deck": {
        if (item.action.type !== "deck") break;
        const added = await addLibraryDeck(user.id, item.action.slug);
        if (!added) break;
        const { totals } = added;
        return { id, deck: { name: added.deck.name, created: totals.created, duplicates: totals.duplicates, overLimit: totals.over_limit ?? 0 } };
      }
      case "add-words": {
        if (item.action.type !== "words") break;
        const added = await addWordListLevel(user.id, item.action.list, String(form.get("level") ?? ""));
        if (!added) break;
        return { id, words: { created: added.created, duplicates: added.duplicates, firstDay: added.firstDay, lastDay: added.lastDay, language: added.language } };
      }
      case "add-set": {
        if (item.action.type !== "set") break;
        const part = String(form.get("part") ?? "");
        if (!item.action.parts.some((p) => p.id === part)) break;
        const kb = await chosenKB(user.id, String(form.get("kb") ?? ""), item.name);
        if (!kb) return { id, errorKey: "library:errors.chooseKB" };
        const res = await addQuestionSet(user.id, kb.id, item.action.set, part);
        return { id, set: { added: res.added, already: res.already, kbId: kb.id, kbName: kb.name } };
      }
      case "add-link": {
        if (item.action.type !== "link") break;
        const kb = await chosenKB(user.id, String(form.get("kb") ?? ""), item.name);
        if (!kb) return { id, errorKey: "library:errors.chooseKB" };
        const res = await addLink(user.id, kb.id, item.action.url, false);
        return { id, link: { kbId: kb.id, kbName: kb.name, feed: Boolean(res.feed) } };
      }
    }
  } catch (error) {
    return { id, errorKey: "library:errors.failed", errorDetail: error instanceof ApiError ? error.message : "" };
  }
  return { id, errorKey: "library:errors.failed" };
}

/** The knowledge base chosen in the form, or a new one named after the item ("new"). */
async function chosenKB(userId: string, choice: string, name: string) {
  if (choice === "new") {
    const kb = await createKB(userId, name.slice(0, 120));
    return { id: kb.id, name: kb.name };
  }
  if (!choice) return null;
  const kb = (await listKBs(userId)).knowledge_bases.find((k) => k.kb.id === choice)?.kb;
  return kb ? { id: kb.id, name: kb.name } : null;
}

export default function Library({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation("library");
  const { items, groups, total, filter, kbs, languages, notLoaded } = loaderData;
  const shown = groups.length ? groups.flatMap((g) => g.items) : items;
  const page = (offset: number, subject = filter.subject) => libraryURL(filter, subject, offset);

  return (
    <div className="lp-doc lp-measure">
      <PageHeader title={t("title")} lede={t("lead")} />

      {/* Two columns on a phone, so the results start sooner; one row as wide as there is room for. */}
      <Form method="get" role="search" className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
        <label className="col-span-2 min-w-0 flex-1 basis-56 text-xs text-muted-foreground">
          {t("filter.search")}
          <input type="search" name="q" defaultValue={filter.q} maxLength={80} className={FIELD} />
        </label>
        <label className="min-w-0 text-xs text-muted-foreground">
          {t("filter.kind")}
          <select name="kind" defaultValue={filter.kind ?? ""} className={FIELD}>
            <option value="">{t("filter.anyKind")}</option>
            {LIBRARY_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-xs text-muted-foreground">
          {t("filter.subject")}
          <select name="subject" defaultValue={filter.subject ?? ""} className={FIELD}>
            <option value="">{t("filter.anySubject")}</option>
            {LIBRARY_SUBJECTS.map((s) => (
              <option key={s} value={s}>
                {t(`subjects.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-xs text-muted-foreground">
          {t("filter.language")}
          <select name="lang" defaultValue={filter.lang} className={FIELD}>
            <option value="">{t("filter.myLanguages")}</option>
            <option value="all">{t("filter.allLanguages")}</option>
            {languages.map((l) => (
              <option key={l} value={l}>
                {languageName(l, i18n.language)}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-xs text-muted-foreground">
          {t("filter.sort")}
          <select name="sort" defaultValue={filter.sort ?? "featured"} className={FIELD}>
            {LIBRARY_SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sorts.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline" className="col-span-2 sm:col-auto">
          {t("filter.show")}
        </Button>
        {/* What narrows further, folded so a phone shows results first; open while one is in use. */}
        <Details
          summary={t("filter.more")}
          open={Boolean(filter.level || filter.certificate || filter.video || filter.reusable)}
          className="col-span-2 w-full"
        >
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="min-w-0 text-xs text-muted-foreground">
              {t("filter.level")}
              <select name="level" defaultValue={filter.level ?? ""} className={FIELD}>
                <option value="">{t("filter.anyLevel")}</option>
                {LIBRARY_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {t(`levels.${l}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 text-xs text-muted-foreground">
              {t("filter.certificate")}
              <select name="certificate" defaultValue={filter.certificate ?? ""} className={FIELD}>
                <option value="">{t("filter.anyCertificate")}</option>
                {CERTIFICATES.map((c) => (
                  <option key={c} value={c}>
                    {t(`filter.certificates.${c}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="video" value="1" defaultChecked={filter.video} className="size-4" />
              {t("filter.video")}
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="reusable" value="1" defaultChecked={filter.reusable} className="size-4" />
              {t("filter.reusable")}
            </label>
          </div>
        </Details>
      </Form>

      <p className="mt-4 text-sm text-muted-foreground" role="status">
        {notLoaded ? t("notLoaded") : total === 0 ? t("empty") : t("count", { count: total })}
      </p>

      {groups.length ? (
        groups.map((g) => (
          <section key={g.subject} aria-labelledby={`lp-library-${g.subject}`} className="mt-8">
            <h2 id={`lp-library-${g.subject}`} className="font-sans text-lg font-semibold">
              {t(`subjects.${g.subject}`)}
            </h2>
            {/* Each result is a heading to jump between, not an entry in the page's outline. */}
            <ol data-outline-ignore>
              {g.items.map((item) => (
                <ItemRow key={item.id} item={item} kbs={kbs} />
              ))}
            </ol>
            {g.total > g.items.length ? (
              <p className="mt-3 text-sm">
                <Link to={page(0, g.subject)} className={LINK}>
                  {t("allInField", { count: g.total, field: t(`subjects.${g.subject}`) })}
                </Link>
              </p>
            ) : null}
          </section>
        ))
      ) : (
        <section aria-labelledby="lp-library-results" className="mt-2">
          <h2 id="lp-library-results" className="sr-only">
            {t("results")}
          </h2>
          {/* Each result is a heading to jump between, not an entry in the page's outline. */}
          <ol data-outline-ignore>
            {items.map((item) => (
              <ItemRow key={item.id} item={item} kbs={kbs} />
            ))}
          </ol>
        </section>
      )}

      <div className="mt-4 flex gap-3">
        {!groups.length && filter.offset > 0 ? (
          <Button asChild variant="outline" size="sm">
            <Link to={page(Math.max(0, filter.offset - LIBRARY_PAGE))}>{t("previous")}</Link>
          </Button>
        ) : null}
        {!groups.length && filter.offset + LIBRARY_PAGE < total ? (
          <Button asChild variant="outline" size="sm">
            <Link to={page(filter.offset + LIBRARY_PAGE)}>{t("next")}</Link>
          </Button>
        ) : null}
      </div>
      {[...new Set(shown.map((i) => i.credit).filter(Boolean))].map((key) => (
        <p key={key} className="mt-6 text-xs leading-snug text-muted-foreground">
          {t(key!)}
        </p>
      ))}
      <p className="mt-6 text-xs leading-snug text-muted-foreground">{t("credit")}</p>
    </div>
  );
}

/** A translated name or line ("ns:key"), else the source's own words. */
function useText() {
  const { t } = useTranslation(["library", "vocab"]);
  return (key: string | undefined, raw: string | undefined) => (key ? t(key) : (raw ?? ""));
}

function ItemRow({ item, kbs }: { item: LibraryItem; kbs: { id: string; name: string }[] }) {
  const { t, i18n } = useTranslation("library");
  const text = useText();
  const name = text(item.nameKey, item.name);
  const about = text(item.aboutKey, item.about);
  const language = item.language === "mul" ? t("manyLanguages") : languageName(item.language, i18n.language);
  // Buttons name their item with its language: one deck comes in several.
  const label = item.language === "mul" ? name : `${name} (${language})`;
  const facts = [
    item.video ? t("kind.video") : t(`kind.${item.kind}`),
    language,
    item.count ? t(`units.${item.unit ?? "cards"}`, { count: item.count }) : null,
    item.section ?? null,
    item.author ?? null,
    t(`licence.${item.licence}`),
  ].filter(Boolean);
  const highlights = useHighlights(item);
  const internal = item.action.type === "page";
  return (
    <li className="border-b py-4">
      <h3 className="font-sans text-base font-medium">
        {internal ? (
          <Link to={item.url} className={LINK}>
            {name}
          </Link>
        ) : (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className={LINK}>
            {name}
            <span className="sr-only"> {t("newTab")}</span>
          </a>
        )}
      </h3>
      {about ? <p className="mt-1 text-sm leading-prose text-muted-foreground">{about}</p> : null}
      {item.creditText ? <p className="mt-1 text-xs leading-snug text-muted-foreground">{item.creditText}</p> : null}
      {highlights.length ? <p className="mt-1 text-sm font-medium leading-prose">{highlights.join(NOTE_JOIN)}</p> : null}
      <p className="mt-1 text-sm leading-prose">
        {facts.join(NOTE_JOIN)}
        {NOTE_JOIN}
        <a href={item.source.url} target="_blank" rel="noopener noreferrer" className={LINK}>
          {t("source", { name: item.source.name })}
        </a>
      </p>
      {item.rating?.scores ? <Scores item={item} /> : null}
      <ItemAction item={item} name={label} kbs={kbs} />
    </li>
  );
}

/**
 * What matters most when choosing (the private design notes):
 * the certificate, the rating, the level, the hours, the year, and how
 * often it is used, each where its source says.
 */
function useHighlights(item: LibraryItem): string[] {
  const { t, i18n } = useTranslation("library");
  const out: string[] = [];
  const c = item.certificate;
  if (c?.kind === "paid") {
    const money = new Intl.NumberFormat(i18n.language, { style: "currency", currency: c.currency ?? "USD", maximumFractionDigits: 0 });
    const fee =
      c.priceMin == null ? t("certificate.feeUnknown") : c.priceMax != null && c.priceMax !== c.priceMin ? `${money.format(c.priceMin)}–${money.format(c.priceMax)}` : money.format(c.priceMin);
    out.push(t("certificate.paid", { name: c.name ?? t("certificate.certificate"), fee }));
  } else if (c) {
    out.push(t(`certificate.${c.kind}`));
  }
  if (item.rating) {
    const value = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(item.rating.value);
    out.push(t("rated", { value, count: item.rating.count }));
  }
  if (item.level) out.push(t(`levels.${item.level}`));
  if (item.hours) out.push(item.hours < 1 ? t("minutes", { count: Math.round(item.hours * 60) }) : t("hours", { count: item.hours }));
  if (item.year) out.push(String(item.year));
  if (item.popularity) out.push(t(`popularity.${item.popularity.kind}`, { count: item.popularity.count }));
  return out;
}

/** A source's review criteria, each averaged out of 5, and where the reviews are. */
function Scores({ item }: { item: LibraryItem }) {
  const { t, i18n } = useTranslation("library");
  const number = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const scores = Object.entries(item.rating?.scores ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <Details summary={t("scores.title")} className="mt-2">
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        {scores.map(([criterion, score]) => (
          <Fragment key={criterion}>
            <dt>{t(`scores.${criterion}`, { defaultValue: criterion })}</dt>
            <dd className="text-right tabular-nums">{t("scores.outOf5", { value: number.format(score) })}</dd>
          </Fragment>
        ))}
      </dl>
      <p className="mt-2 text-sm">
        <a href={item.url} target="_blank" rel="noopener noreferrer" className={LINK}>
          {t("scores.readReviews", { name: item.source.name })}
          <span className="sr-only"> {t("newTab")}</span>
        </a>
      </p>
    </Details>
  );
}

function ItemAction({ item, name, kbs }: { item: LibraryItem; name: string; kbs: { id: string; name: string }[] }) {
  const { t } = useTranslation("library");
  const fetcher = useFetcher<LibraryActionResult>();
  const busy = fetcher.state !== "idle";
  const result = fetcher.data?.id === item.id ? fetcher.data : undefined;
  const selectId = useId();
  switch (item.action.type) {
    case "deck":
      return (
        <fetcher.Form method="post" className="mt-2">
          <input type="hidden" name="id" value={item.id} />
          <Button type="submit" name="intent" value="add-deck" size="sm" disabled={busy || Boolean(result && "deck" in result)} aria-label={t("addDeckOf", { name })}>
            {busy ? t("adding") : t("addDeck")}
          </Button>
          <Outcome result={result} />
        </fetcher.Form>
      );
    case "link":
      return (
        <Details summary={t("addToKB")} className="mt-2">
          <fetcher.Form method="post" className="mt-2 flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={item.id} />
            <KBSelect id={selectId} kbs={kbs} name={name} />
            <Button type="submit" name="intent" value="add-link" size="sm" disabled={busy} aria-label={t("addToKBOf", { name })}>
              {busy ? t("adding") : t("add")}
            </Button>
          </fetcher.Form>
          <Outcome result={result} />
        </Details>
      );
    case "words":
      return (
        <fetcher.Form method="post" className="mt-2 flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={item.id} />
          <label htmlFor={selectId} className="text-xs text-muted-foreground">
            {t("level")}
            <select id={selectId} name="level" className={FIELD}>
              {item.action.levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {t("levelOption", { name: l.name, count: l.count })}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" name="intent" value="add-words" size="sm" disabled={busy} aria-label={t("addWordsOf", { name })}>
            {busy ? t("adding") : t("addWords")}
          </Button>
          <p className="w-full text-xs text-muted-foreground">{t("wordsPace")}</p>
          <Outcome result={result} />
        </fetcher.Form>
      );
    case "set":
      return (
        <Details summary={t("addToQuiz")} className="mt-2">
          <fetcher.Form method="post" className="mt-2 flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={item.id} />
            <label htmlFor={`${selectId}-part`} className="text-xs text-muted-foreground">
              {t("part")}
              <select id={`${selectId}-part`} name="part" className={FIELD}>
                {item.action.parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t("partOption", { name: p.name, count: p.count })}
                  </option>
                ))}
              </select>
            </label>
            <KBSelect id={selectId} kbs={kbs} name={name} />
            <Button type="submit" name="intent" value="add-set" size="sm" disabled={busy} aria-label={t("addToQuizOf", { name })}>
              {busy ? t("adding") : t("add")}
            </Button>
          </fetcher.Form>
          <Outcome result={result} />
        </Details>
      );
    case "page":
      return (
        <p className="mt-2 text-sm">
          <Link to={item.action.to} className={LINK}>
            {t("openHere")}
          </Link>
        </p>
      );
    case "open":
      return (
        <p className="mt-2 text-sm text-muted-foreground">
          {t(`why.${item.action.why}`)}
          {item.action.pdf ? (
            <>
              {" "}
              <a href={item.action.pdf} target="_blank" rel="noopener noreferrer" className={LINK}>
                {t("pdf")}
                <span className="sr-only"> {t("newTab")}</span>
              </a>
            </>
          ) : null}
        </p>
      );
    default:
      return null;
  }
}

/** The knowledge base to add to: one of the learner's, or a new one named after the item. */
function KBSelect({ id, kbs, name }: { id: string; kbs: { id: string; name: string }[]; name: string }) {
  const { t } = useTranslation("library");
  return (
    <label htmlFor={id} className="text-xs text-muted-foreground">
      {t("kb")}
      <select id={id} name="kb" defaultValue={kbs[0]?.id ?? "new"} className={FIELD}>
        {kbs.map((k) => (
          <option key={k.id} value={k.id}>
            {k.name}
          </option>
        ))}
        <option value="new">{t("newKB", { name })}</option>
      </select>
    </label>
  );
}

function Outcome({ result }: { result?: LibraryActionResult }) {
  const { t, i18n } = useTranslation("library");
  if (!result) return <StatusLine />;
  if ("deck" in result) {
    const d = result.deck;
    return (
      <StatusLine>
        {d.created === 0 && d.overLimit > 0 ? t("deckFull") : t("deckAdded", { count: d.created, name: d.name })}
        {d.duplicates ? ` ${t("duplicates", { count: d.duplicates })}` : ""}{" "}
        <Link to="/mastery/decks" className={LINK}>
          {t("openDecks")}
        </Link>
      </StatusLine>
    );
  }
  if ("words" in result) {
    const w = result.words;
    return (
      <StatusLine>
        {w.created ? t("wordsAdded", { count: w.created }) : t("wordsNone")}
        {w.duplicates ? ` ${t("wordsHad", { count: w.duplicates })}` : ""}
        {w.created && w.firstDay && w.lastDay ? ` ${t("wordsDays", { first: formatDate(w.firstDay, false, i18n.language), last: formatDate(w.lastDay, false, i18n.language) })}` : ""}{" "}
        <Link to={`/languages/${w.language}`} className={LINK}>
          {t("openWords")}
        </Link>
      </StatusLine>
    );
  }
  if ("set" in result) {
    const s = result.set;
    return (
      <StatusLine>
        {s.added ? t("setAdded", { count: s.added, name: s.kbName }) : t("setNone")}
        {s.already ? ` ${t("setHad", { count: s.already })}` : ""}{" "}
        <Link to={`/quiz/bank?kb=${s.kbId}&answered=no`} className={LINK}>
          {t("openQuiz")}
        </Link>
      </StatusLine>
    );
  }
  if ("link" in result) {
    return (
      <StatusLine>
        {t(result.link.feed ? "feedAdded" : "linkAdded", { name: result.link.kbName })}{" "}
        <Link to={`/knowledge/${result.link.kbId}`} className={LINK}>
          {t("openKB")}
        </Link>
      </StatusLine>
    );
  }
  return (
    <StatusLine tone="error">
      {t(result.errorKey.replace(/^library:/, ""))}
      {result.errorDetail ? ` ${result.errorDetail}` : ""}
    </StatusLine>
  );
}
