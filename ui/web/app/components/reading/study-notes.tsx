import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { formatClock, type KBDocument } from "~/lib/kb-types";
import { NOTE_LANGUAGES, type VideoNotes } from "~/lib/video-notes-types";
import { SaveToDrive } from "~/components/storage/save-to-drive";

/**
 * study-notes.tsx
 * A video's study notes beside its player: the video in sections, each with a
 * summary and the key points, every time a button that plays that moment.
 *
 * Written only when the learner asks (one call to their reading model), then
 * kept. Notes written from a transcript that has since been replaced say so.
 * Every string is a model's, or the video creator's for chapter titles, and
 * React renders it as text.
 */

type ActionData = { notesMade?: boolean; notesErrorDetail?: string };

/** "vi" → "Vietnamese", in the UI's language; the code when unknown. */
export function languageLabel(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function baseLanguage(code: string | undefined): string {
  return (code ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
}

export function StudyNotes({
  document: doc,
  notes,
  onSeek,
}: {
  document: KBDocument;
  notes: VideoNotes[];
  onSeek: (seconds: number) => void;
}) {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher<ActionData>();
  const busy = fetcher.state !== "idle";
  const videoLanguage = baseLanguage(doc.media?.language) || "en";

  const languages = useMemo(
    () => Array.from(new Set([videoLanguage, ...NOTE_LANGUAGES])),
    [videoLanguage],
  );
  const [shown, setShown] = useState(notes[0]?.language ?? "");
  const [wanted, setWanted] = useState(videoLanguage);
  const [lastPosted, setLastPosted] = useState("");
  // Notes just written are the ones to show.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.notesMade && lastPosted) setShown(lastPosted);
  }, [fetcher.state, fetcher.data, lastPosted]);

  const current = notes.find((n) => n.language === shown) ?? notes[0];

  const write = (language: string) => {
    setLastPosted(language);
    fetcher.submit({ intent: "study-notes", language }, { method: "post" });
  };

  const error = fetcher.state === "idle" ? fetcher.data?.notesErrorDetail : undefined;

  return (
    <div className="space-y-4">
      {busy ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("video.notes.writing")}
        </p>
      ) : null}
      {error !== undefined ? (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft p-3 text-sm leading-snug">
          {error || t("video.notes.failed")}
        </p>
      ) : null}

      {!current ? (
        <div className="space-y-3">
          <p className="text-sm leading-prose text-muted-foreground">{t("video.notes.lead")}</p>
          <LanguageAndWrite
            languages={languages}
            value={wanted}
            onChange={setWanted}
            disabled={busy}
            label={t("video.notes.make")}
            onWrite={write}
          />
          <p className="text-xs text-muted-foreground">{t("video.notes.cost")}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {notes.length > 1 ? (
              <div role="group" aria-label={t("video.notes.languages")} className="flex gap-1">
                {notes.map((n) => (
                  <button
                    key={n.language}
                    type="button"
                    aria-pressed={n.language === current.language}
                    onClick={() => setShown(n.language)}
                    className="inline-flex min-h-11 items-center rounded-md border border-control-border px-3 transition-colors hover:bg-primary-soft aria-pressed:bg-selected aria-pressed:text-selected-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                  >
                    {languageLabel(n.language)}
                  </button>
                ))}
              </div>
            ) : null}
            <a
              href={`/documents/${encodeURIComponent(doc.id)}/study-notes.md?language=${encodeURIComponent(current.language)}`}
              download
              className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
            >
              {t("video.notes.export")}
            </a>
            <SaveToDrive kind="study_notes" id={doc.id} language={current.language} />
            <button
              type="button"
              disabled={busy}
              onClick={() => write(current.language)}
              className="inline-flex min-h-11 items-center text-primary underline underline-offset-4 disabled:opacity-50"
            >
              {t("video.notes.again")}
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            {current.from_chapters
              ? t("video.notes.byChapters", { model: current.model })
              : t("video.notes.byModel", { model: current.model })}
          </p>
          {current.stale ? (
            <p role="note" className="rounded-md border border-warning bg-warning-soft p-3 text-sm leading-snug">
              {t("video.notes.stale")}
            </p>
          ) : null}

          <ol className="space-y-6">
            {current.sections.map((s) => (
              <li key={s.start}>
                <section aria-label={s.title} className="space-y-2">
                  <h3 className="flex items-baseline gap-3 text-base font-medium">
                    <TimeButton at={s.start} onSeek={onSeek} />
                    <span>{s.title}</span>
                  </h3>
                  {s.summary ? <p className="text-sm leading-prose">{s.summary}</p> : null}
                  {s.points.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-5 text-sm leading-snug">
                      {s.points.map((p, i) => (
                        <li key={i}>
                          {p.text}
                          {p.at !== undefined ? (
                            <>
                              {" "}
                              <TimeButton at={p.at} onSeek={onSeek} />
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              </li>
            ))}
          </ol>

          <div className="space-y-2 border-t pt-4">
            <p className="text-sm text-muted-foreground">{t("video.notes.another")}</p>
            <LanguageAndWrite
              languages={languages.filter((l) => !notes.some((n) => n.language === l))}
              value={wanted}
              onChange={setWanted}
              disabled={busy}
              label={t("video.notes.make")}
              onWrite={write}
            />
          </div>
        </>
      )}
    </div>
  );
}

function TimeButton({ at, onSeek }: { at: number; onSeek: (seconds: number) => void }) {
  const { t } = useTranslation("knowledge");
  return (
    <button
      type="button"
      onClick={() => onSeek(at)}
      aria-label={t("video.seek", { time: formatClock(at) })}
      className="inline-flex min-h-8 items-center rounded px-1 font-mono text-2xs tabular-nums text-primary underline underline-offset-4 hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
    >
      {formatClock(at)}
    </button>
  );
}

function LanguageAndWrite({
  languages,
  value,
  onChange,
  disabled,
  label,
  onWrite,
}: {
  languages: string[];
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  label: string;
  onWrite: (language: string) => void;
}) {
  const { t } = useTranslation("knowledge");
  if (languages.length === 0) return null;
  const selected = languages.includes(value) ? value : languages[0]!;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-sm">
        <span>{t("video.notes.language")}</span>
        <select
          value={selected}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-11 rounded-md border border-control-border bg-card px-3"
        >
          {languages.map((l) => (
            <option key={l} value={l}>
              {languageLabel(l)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onWrite(selected)}
        className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:opacity-50"
      >
        {label}
      </button>
    </div>
  );
}
