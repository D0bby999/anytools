import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { detectLang } from "~/lib/speech";
import type { AnkiDeck, FieldMap, MappedNote, mapNotes as MapNotes } from "~/lib/anki/read";

/**
 * anki-decks.tsx
 * Anki decks in and out, in Mastery → Vocabulary (the private design notes, phase 3). The deck is read and written here, in the browser;
 * the server only receives the mapped words, in batches, and sends back the
 * words being learned for the export.
 *
 * Import: pick an .apkg, say which field is the word, which the meaning and
 * (optionally) which an example sentence, check the first ten, import. The
 * words come up twenty a day; the page says over which days.
 */

/** The API's largest batch. */
const BATCH = 200;
/** How many imported words come up each day: vocab.ImportPerDay. */
const PER_DAY = 20;
/** sql.js's wasm, as the tools stage it. */
const SQLJS_WASM_BASE = "/tool-runtime/sql.js@1.14.2/";

const field = "mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm text-foreground";

async function sqlJs() {
  const { loadSqlJs } = await import("~/tools/sql-playground/logic");
  return loadSqlJs(SQLJS_WASM_BASE);
}

type Totals = { created: number; duplicates: number; invalid: number; first?: string; last?: string };

type Phase =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "mapping"; deck: AnkiDeck; maps: Record<string, FieldMap | null>; lang: string; mapNotes: typeof MapNotes }
  | { kind: "importing"; done: number; total: number }
  | { kind: "done"; totals: Totals; skipped: number }
  | { kind: "failed"; message: string };

export function AnkiImport({ langs }: { langs: string[] }) {
  const { t } = useTranslation("vocab");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const pick = async (file: File) => {
    setPhase({ kind: "reading" });
    try {
      const [{ readDeck, guessMap, mapNotes }, SQL] = await Promise.all([import("~/lib/anki/read"), sqlJs()]);
      // Only the collection is read from the file, never its media.
      const deck = await readDeck(file, SQL);
      if (deck.notes.length === 0 || deck.types.length === 0) {
        setPhase({ kind: "failed", message: t("anki.empty") });
        return;
      }
      const maps = Object.fromEntries(deck.types.map((ty) => [ty.id, guessMap(ty)]));
      // The language the words are in, by their script, as a default.
      const sample = deck.notes.slice(0, 50).map((n) => n.fields[maps[n.typeId]?.term ?? 0] ?? "").join(" ");
      setPhase({ kind: "mapping", deck, maps, lang: detectLang(sample) || "en", mapNotes });
    } catch (e) {
      const code = (e as { code?: string }).code;
      setPhase({ kind: "failed", message: code === "not_a_deck" ? t("anki.notADeck") : t("anki.unreadable") });
    }
  };

  const run = async (notes: MappedNote[], lang: string, skipped: number) => {
    const totals: Totals = { created: 0, duplicates: 0, invalid: 0 };
    setPhase({ kind: "importing", done: 0, total: notes.length });
    for (let i = 0; i < notes.length; i += BATCH) {
      const res = await fetch("/mastery/vocabulary/anki", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang, notes: notes.slice(i, i + BATCH) }),
      }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as
        | { created: number; duplicates: number; invalid: number; first_day?: string; last_day?: string; error?: string }
        | null;
      if (!res?.ok || !data || data.error) {
        setPhase({ kind: "failed", message: data?.error || t("anki.failed", { count: totals.created }) });
        return;
      }
      totals.created += data.created;
      totals.duplicates += data.duplicates;
      totals.invalid += data.invalid;
      totals.first ??= data.first_day;
      totals.last = data.last_day ?? totals.last;
      setPhase({ kind: "importing", done: Math.min(notes.length, i + BATCH), total: notes.length });
    }
    setPhase({ kind: "done", totals, skipped });
  };

  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm leading-prose text-muted-foreground">{t("anki.importLead")}</p>
      {phase.kind === "idle" || phase.kind === "failed" || phase.kind === "done" ? (
        <label className="block text-sm">
          <span className="font-medium">{t("anki.pick")}</span>
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
      {phase.kind === "reading" ? <p role="status" className="text-sm">{t("anki.reading")}</p> : null}
      {phase.kind === "failed" ? (
        <p role="alert" className="text-sm text-destructive">
          {phase.message}
        </p>
      ) : null}
      {phase.kind === "mapping" ? <Mapping phase={phase} langs={langs} onChange={setPhase} onImport={run} /> : null}
      {phase.kind === "importing" ? (
        <p role="status" className="text-sm">
          {t("anki.importing", { done: phase.done, total: phase.total })}
        </p>
      ) : null}
      {phase.kind === "done" ? (
        <div role="status" className="space-y-1 text-sm leading-prose">
          <p className="font-medium">{t("anki.created", { count: phase.totals.created })}</p>
          {phase.totals.created > 0 && phase.totals.first ? (
            <p>
              {phase.totals.first === phase.totals.last
                ? t("anki.paceOneDay", { day: phase.totals.first })
                : t("anki.pace", { first: phase.totals.first, last: phase.totals.last, perDay: PER_DAY })}
            </p>
          ) : null}
          {phase.totals.duplicates > 0 ? <p>{t("anki.duplicates", { count: phase.totals.duplicates })}</p> : null}
          {phase.skipped + phase.totals.invalid > 0 ? (
            <p>{t("anki.skipped", { count: phase.skipped + phase.totals.invalid })}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Mapping({
  phase,
  langs,
  onChange,
  onImport,
}: {
  phase: Extract<Phase, { kind: "mapping" }>;
  langs: string[];
  onChange: (p: Phase) => void;
  onImport: (notes: MappedNote[], lang: string, skipped: number) => void;
}) {
  const { t } = useTranslation("vocab");
  const { deck, maps, lang, mapNotes } = phase;
  const mapped = useMemo(
    () => mapNotes(deck, Object.values(maps).filter((m): m is FieldMap => m !== null)),
    [mapNotes, deck, maps],
  );
  const update = (next: Partial<Extract<Phase, { kind: "mapping" }>>) => onChange({ ...phase, ...next });
  const setMap = (typeId: string, key: "term" | "meaning" | "sentence", value: number) => {
    const current = maps[typeId];
    if (current) update({ maps: { ...maps, [typeId]: { ...current, [key]: value } } });
  };
  const languages = [...new Set([lang, ...langs, "en", "vi", "es", "pt", "fr", "de", "ja", "zh", "ko"])];

  return (
    <div className="space-y-4">
      <p className="text-sm">
        {t("anki.found", { count: deck.notes.length })}
        {deck.media > 0 ? ` ${t("anki.media", { count: deck.media })}` : ""}
      </p>
      {deck.types.map((ty) => {
        const m = maps[ty.id];
        const options = (none: boolean) => (
          <>
            {none ? <option value={-1}>{t("anki.none")}</option> : null}
            {ty.fields.map((f, i) => (
              <option key={i} value={i}>
                {f}
              </option>
            ))}
          </>
        );
        return (
          <fieldset key={ty.id} className="rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">
              {ty.name} · {t("anki.notes", { count: deck.notes.filter((n) => n.typeId === ty.id).length })}
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={m !== null}
                onChange={(e) => update({ maps: { ...maps, [ty.id]: e.target.checked ? { typeId: ty.id, term: 0, meaning: ty.fields.length > 1 ? 1 : -1, sentence: -1 } : null } })}
              />
              {t("anki.include")}
            </label>
            {m ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <label className="text-xs text-muted-foreground">
                  {t("anki.term")}
                  <select className={field} value={m.term} onChange={(e) => setMap(ty.id, "term", Number(e.target.value))}>
                    {options(false)}
                  </select>
                </label>
                <label className="text-xs text-muted-foreground">
                  {t("anki.meaning")}
                  <select className={field} value={m.meaning} onChange={(e) => setMap(ty.id, "meaning", Number(e.target.value))}>
                    {options(true)}
                  </select>
                </label>
                <label className="text-xs text-muted-foreground">
                  {t("anki.sentence")}
                  <select className={field} value={m.sentence} onChange={(e) => setMap(ty.id, "sentence", Number(e.target.value))}>
                    {options(true)}
                  </select>
                </label>
              </div>
            ) : null}
          </fieldset>
        );
      })}
      <label className="block max-w-48 text-xs text-muted-foreground">
        {t("anki.lang")}
        <select className={field} value={lang} onChange={(e) => update({ lang: e.target.value })}>
          {languages.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t("anki.preview")}</caption>
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">{t("anki.term")}</th>
                  <th className="py-1 pr-3 font-medium">{t("anki.meaning")}</th>
                  <th className="py-1 font-medium">{t("anki.sentence")}</th>
                </tr>
              </thead>
              <tbody>
                {mapped.notes.slice(0, 10).map((n, i) => (
                  <tr key={i} className="border-t align-top">
                    <td className="py-1 pr-3" lang={lang}>{n.term}</td>
                    <td className="py-1 pr-3">{n.meaning}</td>
                    <td className="py-1 text-muted-foreground" lang={lang}>{n.sentence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm">
            {t("anki.ready", { count: mapped.notes.length })}
            {mapped.skipped > 0 ? ` ${t("anki.willSkip", { count: mapped.skipped })}` : ""}{" "}
            {t("anki.paceNote", { perDay: PER_DAY })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={mapped.notes.length === 0} onClick={() => onImport(mapped.notes, lang, mapped.skipped)}>
              {t("anki.import", { count: mapped.notes.length })}
            </Button>
            <Button type="button" variant="ghost" onClick={() => onChange({ kind: "idle" })}>
              {t("anki.cancel")}
            </Button>
          </div>
      </>
    </div>
  );
}

/** "Download as an Anki deck": the words being learned, as an .apkg. */
export function AnkiExport() {
  const { t } = useTranslation("vocab");
  const [state, setState] = useState<"idle" | "busy" | "empty" | "failed">("idle");
  const download = async () => {
    setState("busy");
    try {
      const res = await fetch("/mastery/vocabulary/anki");
      if (!res.ok) throw new Error(String(res.status));
      const { words } = (await res.json()) as { words: import("~/lib/anki/write").ExportWord[] };
      if (words.length === 0) {
        setState("empty");
        return;
      }
      const [{ writeApkg }, SQL] = await Promise.all([import("~/lib/anki/write"), sqlJs()]);
      const bytes = await writeApkg(words, SQL);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "anylearn-vocabulary.apkg";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setState("idle");
    } catch {
      setState("failed");
    }
  };
  return (
    <div className="mt-3 space-y-2">
      <p className="text-sm leading-prose text-muted-foreground">{t("anki.exportLead")}</p>
      <Button type="button" variant="outline" disabled={state === "busy"} onClick={download}>
        {state === "busy" ? t("anki.exporting") : t("anki.export")}
      </Button>
      {state === "empty" ? <p role="status" className="text-sm">{t("anki.exportEmpty")}</p> : null}
      {state === "failed" ? (
        <p role="alert" className="text-sm text-destructive">
          {t("anki.exportFailed")}
        </p>
      ) : null}
    </div>
  );
}
