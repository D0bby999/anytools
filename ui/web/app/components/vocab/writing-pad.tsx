/**
 * writing-pad.tsx
 * The writing card's pad (plans/261020-1535-beyond-english-learning-areas,
 * phase 3; ux/03-writing.md): the word is drawn one character at a time,
 * each stroke checked as it is drawn by hanzi-writer (MIT, a lazy chunk),
 * from stroke data served by /strokes/<zh|ja>/<character>.
 *
 * A wrong stroke fades; after three misses the stroke's start is hinted. No
 * stroke is ever forced right, so the count of mistakes is honest, and it is
 * what the rating is suggested from (writingRating). "Show the character"
 * draws it and counts as a miss. A character with no stroke data, or a Latin
 * letter in the term, is shown rather than drawn.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type HanziWriter from "hanzi-writer";
import { drawable, type Rating } from "~/lib/vocab-types";
import { Button } from "~/components/ui/button";

/** drawn: the characters the learner drew; one with no stroke data is only shown. */
export type Written = { mistakes: number; shown: boolean; drawn?: number };

/**
 * No mistakes: Good; one to three: Hard; more, or a character shown: Again.
 * Nothing drawn (no character had stroke data): no suggestion.
 */
export function writingRating({ mistakes, shown, drawn }: Written): Rating | null {
  if (drawn === 0 && !shown) return null;
  if (shown || mistakes > 3) return "again";
  return mistakes > 0 ? "hard" : "good";
}

/** The stroke data's language: Japanese for ja, Chinese otherwise. */
function dataLang(lang: string): "ja" | "zh" {
  return lang.split("-")[0] === "ja" ? "ja" : "zh";
}

/** A token's colour as the page resolves it now, for hanzi-writer's SVG attributes. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

type Phase = "loading" | "drawing" | "between" | "done" | "failed";

export function WritingPad({ term, lang, onDone }: { term: string; lang: string; onDone: (w: Written) => void }) {
  const { t } = useTranslation("vocab");
  const chars = [...term];
  const target = useRef<HTMLDivElement>(null);
  const writer = useRef<HanziWriter | null>(null);
  const [at, setAt] = useState(() => chars.findIndex(drawable));
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState("");
  const [missing, setMissing] = useState(false);
  const tally = useRef<Written>({ mistakes: 0, shown: false, drawn: 0 });
  const [mistakes, setMistakes] = useState(0);
  const [size, setSize] = useState(280);
  const outer = useRef<HTMLDivElement>(null);

  const finish = () => {
    setPhase("done");
    setStatus(t("write.done", { count: tally.current.mistakes }));
    onDone({ ...tally.current });
  };

  const nextIndex = (from: number) => chars.findIndex((c, i) => i > from && drawable(c));

  // One quiz per character; the writer is reused, its character swapped.
  // The first is set again too: that is how a character with no stroke data
  // is told (the second fetch is the browser's cache).
  const quiz = (index: number) => {
    const w = writer.current;
    const char = chars[index];
    if (!w || !char) return;
    setMissing(false);
    setPhase("loading");
    w.setCharacter(char)
      .then(() => {
        setPhase("drawing");
        w.quiz({
          onCorrectStroke: (d) => setStatus(t("write.strokeRight", { n: d.strokeNum + 1, total: d.strokeNum + 1 + d.strokesRemaining })),
          onMistake: () => {
            tally.current.mistakes++;
            setMistakes(tally.current.mistakes);
            setStatus(t("write.strokeWrong"));
          },
          onComplete: () => {
            tally.current.drawn = (tally.current.drawn ?? 0) + 1;
            setStatus(t("write.charDone"));
            const next = nextIndex(index);
            if (next < 0) finish();
            else {
              setAt(next);
              quiz(next);
            }
          },
        });
      })
      .catch(() => {
        // No stroke data for this one: it is shown, and the learner moves on.
        setMissing(true);
        setPhase("between");
      });
  };

  useEffect(() => {
    const first = chars.findIndex(drawable);
    if (first < 0) {
      setPhase("failed");
      return;
    }
    let cancelled = false;
    // The card's width, at most 320 and at least 240 (a 360 px phone less its padding).
    const px = Math.max(240, Math.min(320, outer.current?.clientWidth ?? 280));
    setSize(px);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    import("hanzi-writer")
      .then(({ default: HW }) => {
        if (cancelled || !target.current) return;
        writer.current = HW.create(target.current, chars[first]!, {
          width: px,
          height: px,
          padding: 12,
          showCharacter: false,
          showOutline: false,
          strokeColor: token("--color-foreground"),
          outlineColor: token("--color-border"),
          drawingColor: token("--color-foreground"),
          highlightColor: token("--color-primary"),
          drawingWidth: 18,
          showHintAfterMisses: 3,
          highlightOnComplete: !reduced,
          strokeAnimationSpeed: reduced ? 1000 : 1,
          delayBetweenStrokes: reduced ? 0 : 300,
          renderer: "svg",
          charDataLoader: (char, onLoad, onError) => {
            fetch(`/strokes/${dataLang(lang)}/${encodeURIComponent(char)}`)
              .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
              .then(onLoad, onError);
          },
        });
        setAt(first);
        quiz(first);
      })
      .catch(() => {
        if (!cancelled) setPhase("failed");
      });
    return () => {
      cancelled = true;
      writer.current?.cancelQuiz();
      writer.current = null;
      target.current?.replaceChildren();
    };
    // The pad is keyed by the card: a new term is a new pad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const show = () => {
    const w = writer.current;
    if (!w) return;
    w.cancelQuiz();
    tally.current.mistakes++;
    tally.current.shown = true;
    setMistakes(tally.current.mistakes);
    void w.showCharacter();
    setPhase("between");
  };

  const onward = () => {
    const next = nextIndex(at);
    if (next < 0) finish();
    else {
      setAt(next);
      quiz(next);
    }
  };

  if (phase === "failed") {
    return (
      <div className="mt-3">
        <p role="status" className="text-sm leading-prose">
          {t("write.failed")}
        </p>
        <p className="mt-2 font-serif text-3xl" lang={lang}>
          {term}
        </p>
        <Button type="button" className="mt-3" onClick={() => onDone({ mistakes: 0, shown: true })}>
          {t("write.rateNow")}
        </Button>
      </div>
    );
  }

  return (
    <div ref={outer} className="mt-3">
      <ol aria-label={t("write.slots")} className="flex flex-wrap gap-1.5" lang={lang}>
        {chars.map((c, i) => {
          const done = phase === "done" || i < at || !drawable(c);
          return (
            <li
              key={i}
              aria-current={i === at && phase !== "done" ? "step" : undefined}
              className={`flex size-9 items-center justify-center rounded-md border text-lg ${
                i === at && phase !== "done" ? "border-primary-line bg-selected" : "border-control-border"
              }`}
            >
              {done ? c : <span className="sr-only">{t("write.slotEmpty", { n: i + 1 })}</span>}
            </li>
          );
        })}
      </ol>
      <div className="relative mt-3 w-fit">
        {/* The 田 grid, as characters are practised on paper. */}
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full text-border" viewBox="0 0 100 100" preserveAspectRatio="none">
          <rect x="0.5" y="0.5" width="99" height="99" fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1="50" y1="0" x2="50" y2="100" stroke="currentColor" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        </svg>
        <div
          ref={target}
          role="img"
          aria-label={t("write.pad", { n: at + 1, total: chars.length })}
          className="touch-none rounded-md bg-card"
          style={{ width: size, height: size }}
        />
      </div>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm text-muted-foreground">
        {phase === "loading" ? t("write.loading") : missing ? t("write.noData", { char: chars[at] ?? "" }) : status}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{t("write.keyboard")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="text-sm tabular-nums">{t("write.mistakes", { count: mistakes })}</span>
        {/* One button that changes, not two that swap: a keyboard's focus stays on it. */}
        {phase !== "done" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={phase === "loading" || undefined}
            onClick={phase === "drawing" ? show : phase === "between" ? onward : undefined}
          >
            {phase === "between" ? (nextIndex(at) < 0 ? t("write.finish") : t("write.next")) : t("write.show")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
