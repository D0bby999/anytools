import { DownloadGrid } from "~/components/doc/download-grid";
/**
 * decks.tsx
 * Mastery → Decks' three lists (the private design notes, phase 5; ux/05-decks.md): the learner's decks, the library of ready
 * decks, and a deck brought from a file. A file is read here, in the browser
 * (lib/anki/read.ts, only the entry it needs), mapped to fronts and backs,
 * and sent in batches; the server never sees the file.
 */
import { useMemo, useState } from "react";
import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { DECK_CARD_LIMIT, GEOGRAPHY, LIBRARY, LICENCE_TEXT, librarySource, type LibraryDeck, type LicenceKind } from "~/lib/deck-library";
import { languageName } from "~/lib/languages";
import type { AnkiDeck, CardMap, mapCards as MapCards } from "~/lib/anki/read";

type Deck = {
  id: string;
  name: string;
  source: string;
  licence: string;
  source_url: string;
  cards: number;
  due: number;
  new: number;
  last_new?: string;
};

const LINK = "text-primary underline underline-offset-4";
const field = "mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm text-foreground";

/** sql.js's wasm, as the tools stage it. */
const SQLJS_WASM_BASE = "/tool-runtime/sql.js@1.14.2/";

export function DeckList({ decks }: { decks: Deck[] }) {
  return (
    <DownloadGrid cards={decks.map((d) => ({ id: d.id, title: d.name, action: <DeckRow deck={d} /> }))} />
  );
}

/** A licence's words in the learner's language, for a deck the library added. */
function useLicenceLabel() {
  const { t } = useTranslation("vocab");
  const labels: Record<LicenceKind, string> = {
    "public-domain": t("decks.licence.publicDomain"),
    "cc-by": t("decks.licence.ccBy"),
    "free-pictures": t("decks.licence.freePictures"),
    "cc-by-nc": t("decks.licence.ccByNc"),
    none: t("decks.licence.none"),
  };
  return {
    labels,
    of: (stored: string) => {
      const kind = (Object.entries(LICENCE_TEXT) as [LicenceKind, string][]).find(([, v]) => v === stored)?.[0];
      return kind ? labels[kind] : stored;
    },
  };
}

function DeckRow({ deck }: { deck: Deck }) {
  const { t } = useTranslation("vocab");
  const licence = useLicenceLabel().of(deck.licence);
  const fetcher = useFetcher();
  const [confirming, setConfirming] = useState(false);
  const busy = fetcher.state !== "idle";
  return (
    <div>
      <p className="mt-1 text-sm leading-prose text-muted-foreground">
        {t("decks.counts", { count: deck.cards, due: deck.due })}
        {deck.new > 0 && deck.last_new ? ` · ${t("decks.toCome", { count: deck.new, day: deck.last_new })}` : ""}
        {deck.licence ? " · " : ""}
        {deck.licence && deck.source_url ? (
          <a href={deck.source_url} target="_blank" rel="noopener noreferrer" className={LINK}>
            {licence}
          </a>
        ) : (
          licence
        )}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link to="#lp-decks-due" className="lp-download-action">
          {t("session.title")}
        </Link>
        {confirming ? (
          <>
            <span className="text-sm">{t("decks.deleteConfirm", { count: deck.cards })}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => fetcher.submit({ intent: "delete", id: deck.id }, { method: "post" })}
            >
              {t("decks.deleteYes")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              {t("decks.keep")}
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)} aria-label={t("decks.deleteOf", { name: deck.name })}>
            {t("decks.delete")}
          </Button>
        )}
      </div>
    </div>
  );
}

type AddedData = {
  added?: { name: string; created: number; over_limit?: number; first_day?: string; last_day?: string };
  errorKey?: string;
  errorDetail?: string;
};

export function DeckLibrary({ decks }: { decks: Deck[] }) {
  const { t, i18n } = useTranslation("vocab");
  const fetcher = useFetcher<AddedData>();
  const ui = i18n.language;
  const have = new Set(decks.map((d) => d.source));
  // Ultimate Geography's three decks (capitals, flags, maps) share one
  // language choice, on the first: the learner's own when it exists, English
  // otherwise.
  const geographyLangs = [...new Set(LIBRARY.filter((d) => d.slug.startsWith(GEOGRAPHY)).map((d) => d.language))];
  const [geoLang, setGeoLang] = useState(geographyLangs.includes(ui) ? ui : "en");
  const shown = LIBRARY.filter((d) => !d.slug.startsWith(GEOGRAPHY) || d.language === geoLang);
  const subjects = [...new Set(shown.map((d) => d.subject))];
  const busy = fetcher.state !== "idle";
  const added = fetcher.data?.added;
  return (
    <div className="mt-3">
      <p className="text-sm leading-prose text-muted-foreground">{t("decks.library.lead")}</p>
      {subjects.map((subject) => (
        <div key={subject} className="mt-5">
          <h3 className="text-sm font-semibold">{t(`decks.library.subjects.${subject}`)}</h3>
          <ul className="mt-2 border-t">
            {shown
              .filter((d) => d.subject === subject)
              .map((d) => (
                <LibraryRow
                  key={d.slug}
                  deck={d}
                  added={have.has(librarySource(d.slug))}
                  busy={busy}
                  languages={d.slug === `${GEOGRAPHY}${geoLang}` ? geographyLangs : null}
                  onLanguage={setGeoLang}
                  onAdd={() => fetcher.submit({ intent: "library", slug: d.slug }, { method: "post" })}
                />
              ))}
          </ul>
        </div>
      ))}
      {busy ? (
        <p role="status" className="mt-3 text-sm">
          {t("decks.adding")}
        </p>
      ) : added ? (
        <p role="status" className="mt-3 text-sm leading-prose">
          {t("decks.added", { count: added.created, name: added.name })}{" "}
          {added.first_day && added.last_day
            ? added.first_day === added.last_day
              ? t("decks.paceOneDay", { day: added.first_day })
              : t("decks.pace", { first: added.first_day, last: added.last_day, perDay: 20 })
            : null}
          {added.over_limit ? (
            <>
              {" "}
              {t("decks.overLimit", { count: added.over_limit, limit: DECK_CARD_LIMIT.toLocaleString(i18n.language) })}
            </>
          ) : null}
        </p>
      ) : fetcher.data?.errorKey ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {t("decks.failed")} {fetcher.data.errorDetail}
        </p>
      ) : null}
    </div>
  );
}

function LibraryRow({
  deck,
  added,
  busy,
  languages,
  onLanguage,
  onAdd,
}: {
  deck: LibraryDeck;
  added: boolean;
  busy: boolean;
  languages: string[] | null;
  onLanguage: (l: string) => void;
  onAdd: () => void;
}) {
  const { t, i18n } = useTranslation("vocab");
  const licence = useLicenceLabel().labels;
  const lang = languageName(deck.language, i18n.language);
  return (
    <li className="border-b py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
        <h4 className="font-sans text-base font-medium">
          {deck.name} <span className="text-sm font-normal text-muted-foreground">({lang})</span>
        </h4>
        {deck.bundled ? (
          added ? (
            <span className="text-sm text-muted-foreground">{t("decks.library.alreadyAdded")}</span>
          ) : (
            <Button type="button" size="sm" disabled={busy} onClick={onAdd} aria-label={t("decks.library.addOf", { name: `${deck.name} (${lang})` })}>
              {t("decks.library.add")}
            </Button>
          )
        ) : (
          <Button asChild size="sm" variant="outline">
            <a href={deck.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={t("decks.library.getOf", { name: deck.name })}>
              {t("decks.library.get")}
            </a>
          </Button>
        )}
      </div>
      <p className="mt-1 text-sm leading-prose text-muted-foreground">{t(`decks.library.about.${deck.about}`)}</p>
      <p className="mt-1 text-sm leading-prose">
        {deck.cards ? `${t("decks.cards", { count: deck.cards })} · ` : ""}
        {licence[deck.licence]} ·{" "}
        <a href={deck.sourceUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
          {t("decks.library.source")}
        </a>
        {deck.bundled ? null : <span className="block text-muted-foreground">{t("decks.library.thenFile")}</span>}
      </p>
      {languages ? (
        <label className="mt-2 flex items-center gap-2 text-sm">
          {t("decks.library.language")}
          <select
            value={deck.language}
            onChange={(e) => onLanguage(e.target.value)}
            className="min-h-11 rounded-md border border-control-border bg-card px-2 text-sm text-foreground"
          >
            {languages.map((l) => (
              <option key={l} value={l}>
                {languageName(l, i18n.language)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </li>
  );
}

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; size: number }
  | { kind: "mapping"; deck: AnkiDeck; maps: Record<string, CardMap>; name: string; mapCards: typeof MapCards }
  | { kind: "importing"; done: number; total: number }
  | { kind: "done"; created: number; duplicates: number; skipped: number; overLimit: number; first?: string; last?: string; name: string }
  | { kind: "failed"; message: string };

export function DeckImport() {
  const { t, i18n } = useTranslation("vocab");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const pick = async (file: File) => {
    setPhase({ kind: "reading", size: file.size });
    try {
      const [{ readDeck, guessCardMap, mapCards }, { loadSqlJs }] = await Promise.all([
        import("~/lib/anki/read"),
        import("~/tools/sql-playground/logic"),
      ]);
      const deck = await readDeck(file, await loadSqlJs(SQLJS_WASM_BASE));
      if (deck.notes.length === 0 || deck.types.length === 0) {
        setPhase({ kind: "failed", message: t("anki.empty") });
        return;
      }
      const maps = Object.fromEntries(deck.types.map((ty) => [ty.id, guessCardMap(ty)]));
      const name = deck.name || file.name.replace(/\.(apkg|colpkg|zip)$/i, "");
      setPhase({ kind: "mapping", deck, maps, name, mapCards });
    } catch (e) {
      const code = (e as { code?: string }).code;
      setPhase({ kind: "failed", message: code === "not_a_deck" ? t("decks.file.notADeck") : t("anki.unreadable") });
    }
  };

  const run = async (cards: { front: string; back: string }[], name: string, skipped: number) => {
    let deckId = "";
    let created = 0;
    let duplicates = 0;
    let overLimit = 0;
    let first: string | undefined;
    let last: string | undefined;
    setPhase({ kind: "importing", done: 0, total: cards.length });
    for (let i = 0; i < cards.length; i += 200) {
      const res = await fetch("/mastery/decks/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deck_id: deckId || undefined, name, source: name, cards: cards.slice(i, i + 200) }),
      }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as
        | {
            deck_id: string;
            created: number;
            duplicates: number;
            invalid: number;
            over_limit?: number;
            first_day?: string;
            last_day?: string;
            error?: string;
          }
        | null;
      if (!res?.ok || !data || data.error) {
        setPhase({ kind: "failed", message: data?.error || t("decks.file.failed", { count: created }) });
        return;
      }
      deckId = data.deck_id;
      created += data.created;
      duplicates += data.duplicates;
      skipped += data.invalid;
      first ??= data.first_day;
      last = data.last_day ?? last;
      if (data.over_limit) {
        // The limit is reached: the cards not yet sent would not be added either.
        overLimit = data.over_limit + Math.max(0, cards.length - i - 200);
        break;
      }
      setPhase({ kind: "importing", done: Math.min(cards.length, i + 200), total: cards.length });
    }
    setPhase({ kind: "done", created, duplicates, skipped, overLimit, first, last, name });
  };

  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm leading-prose text-muted-foreground">
        {t("decks.file.lead")}{" "}
        <Link to="/mastery/vocabulary#lp-vocab-anki" className={LINK}>
          {t("decks.file.vocabulary")}
        </Link>
      </p>
      {phase.kind === "idle" || phase.kind === "failed" || phase.kind === "done" ? (
        <label className="block text-sm">
          <span className="font-medium">{t("decks.file.pick")}</span>
          <input
            type="file"
            accept=".apkg,.zip"
            className="mt-1 lp-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pick(file);
              e.target.value = "";
            }}
          />
        </label>
      ) : null}
      {phase.kind === "reading" ? (
        <p role="status" className="text-sm">
          {t("decks.file.reading", { size: (phase.size / 1024 / 1024).toFixed(1) })}
        </p>
      ) : null}
      {phase.kind === "failed" ? (
        <p role="alert" className="text-sm text-destructive">
          {phase.message}
        </p>
      ) : null}
      {phase.kind === "mapping" ? <CardMapping phase={phase} onChange={setPhase} onImport={run} /> : null}
      {phase.kind === "importing" ? (
        <p role="status" className="text-sm">
          {t("decks.file.importing", { done: phase.done, total: phase.total })}
        </p>
      ) : null}
      {phase.kind === "done" ? (
        <div role="status" className="space-y-1 text-sm leading-prose">
          <p className="font-medium">{t("decks.added", { count: phase.created, name: phase.name })}</p>
          {phase.created > 0 && phase.first && phase.last ? (
            <p>
              {phase.first === phase.last
                ? t("decks.paceOneDay", { day: phase.first })
                : t("decks.pace", { first: phase.first, last: phase.last, perDay: 20 })}
            </p>
          ) : null}
          {phase.duplicates > 0 ? <p>{t("decks.file.duplicates", { count: phase.duplicates })}</p> : null}
          {phase.skipped > 0 ? <p>{t("decks.file.skipped", { count: phase.skipped })}</p> : null}
          {phase.overLimit > 0 ? (
            <p>{t("decks.overLimit", { count: phase.overLimit, limit: DECK_CARD_LIMIT.toLocaleString(i18n.language) })}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CardMapping({
  phase,
  onChange,
  onImport,
}: {
  phase: Extract<Phase, { kind: "mapping" }>;
  onChange: (p: Phase) => void;
  onImport: (cards: { front: string; back: string }[], name: string, skipped: number) => void;
}) {
  const { t } = useTranslation("vocab");
  const { deck, maps, name, mapCards } = phase;
  const mapped = useMemo(() => mapCards(deck, Object.values(maps)), [mapCards, deck, maps]);
  const set = (typeId: string, key: "front" | "back" | "extra", value: number) =>
    onChange({ ...phase, maps: { ...maps, [typeId]: { ...maps[typeId]!, [key]: value } } });
  return (
    <div className="space-y-4 rounded-md border p-4">
      <label className="block text-sm font-medium">
        {t("decks.file.name")}
        <input value={name} maxLength={200} onChange={(e) => onChange({ ...phase, name: e.target.value })} className={field} />
      </label>
      {deck.types.map((type) => {
        const m = maps[type.id]!;
        const select = (key: "front" | "back" | "extra", label: string, optional: boolean) => (
          <label className="block text-sm">
            {label}
            <select value={m[key]} onChange={(e) => set(type.id, key, Number(e.target.value))} className={field}>
              {optional ? <option value={-1}>{t("decks.file.none")}</option> : null}
              {type.fields.map((f, i) => (
                <option key={i} value={i}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        );
        return (
          <fieldset key={type.id} className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-1 text-sm font-semibold">{type.name}</legend>
            {select("front", t("decks.file.front"), false)}
            {select("back", t("decks.file.back"), false)}
            {select("extra", t("decks.file.extra"), true)}
          </fieldset>
        );
      })}
      {deck.media > 0 ? <p className="text-sm text-muted-foreground">{t("anki.media", { count: deck.media })}</p> : null}
      <>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t("decks.file.preview")}</caption>
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-1 pr-3 font-medium">{t("decks.file.front")}</th>
                <th className="py-1 font-medium">{t("decks.file.back")}</th>
              </tr>
            </thead>
            <tbody>
              {mapped.cards.slice(0, 10).map((c, i) => (
                <tr key={i} className="border-b align-top">
                  <td className="py-1 pr-3" dir="auto">{c.front}</td>
                  <td className="py-1 whitespace-pre-line" dir="auto">{c.back}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button type="button" disabled={mapped.cards.length === 0 || !name.trim()} onClick={() => onImport(mapped.cards, name.trim(), mapped.skipped)}>
            {t("decks.file.import", { count: mapped.cards.length })}
          </Button>
        </>
    </div>
  );
}
