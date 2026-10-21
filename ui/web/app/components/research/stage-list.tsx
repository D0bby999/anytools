import { useTranslation } from "react-i18next";

/**
 * The staged progress list solve and research share.
 *
 * It reads the turn's own stage_start / stage_end events (useTurnStream's
 * `stage` and `stagesDone`) rather than a timer or a guess from event order:
 * a stage is "done" because the server said it ended, not because the next one
 * began. The state is carried by text as well as the dot, so it survives a
 * colour-blind read and forced high-contrast mode.
 *
 * Drawn as up would (phase 09): an ordered list in the browser's own numbers,
 * the running stage in the body ink at 600, a finished one led by a ✓. The
 * tick is CSS content, so the list's text stays the stage and its state word.
 */
export function StageList({
  ns,
  stages,
  current,
  done,
  finished,
}: {
  /** The i18n namespace holding `stages.<name>` labels: "solve" or "research". */
  ns: "solve" | "research";
  stages: readonly string[];
  current: string | null;
  done: readonly string[];
  finished: boolean;
}) {
  const { t } = useTranslation(ns);

  return (
    <section aria-labelledby={`lp-${ns}-stages`}>
      <h3 id={`lp-${ns}-stages`} data-outline-ignore className="text-sm leading-8 font-semibold">
        {t("stages.title")}
      </h3>
      <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5 text-sm leading-6 marker:text-muted-foreground" aria-live="polite">
        {stages.map((stage) => {
          const state = done.includes(stage)
            ? "done"
            : stage === current && !finished
              ? "running"
              : "pending";
          return (
            <li key={stage} data-state={state}>
              <span
                className={
                  state === "running"
                    ? "font-semibold text-foreground"
                    : state === "done"
                      ? "text-foreground before:mr-1 before:text-primary before:content-['✓']"
                      : "text-muted-foreground"
                }
              >
                {t(`stages.${stage}`)}
              </span>
              <span className="sr-only">{t(`stages.${state}`)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
