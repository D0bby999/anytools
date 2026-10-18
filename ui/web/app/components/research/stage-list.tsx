import { useTranslation } from "react-i18next";

/**
 * The staged progress list solve and research share.
 *
 * It reads the turn's own stage_start / stage_end events (useTurnStream's
 * `stage` and `stagesDone`) rather than a timer or a guess from event order:
 * a stage is "done" because the server said it ended, not because the next one
 * began. The state is carried by text as well as the dot, so it survives a
 * colour-blind read and forced high-contrast mode.
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
      <h3 id={`lp-${ns}-stages`} className="lp-section">
        {t("stages.title")}
      </h3>
      <ol className="mt-2 flex flex-col gap-1.5" aria-live="polite">
        {stages.map((stage) => {
          const state = done.includes(stage)
            ? "done"
            : stage === current && !finished
              ? "running"
              : "pending";
          return (
            <li key={stage} className="flex items-baseline gap-2 text-sm leading-ui">
              <span
                aria-hidden="true"
                className={
                  "mt-1 size-2 shrink-0 rounded-full " +
                  (state === "done"
                    ? "bg-primary"
                    : state === "running"
                      ? "animate-pulse bg-muted-foreground"
                      : "border border-control-border")
                }
              />
              <span className={state === "pending" ? "text-muted-foreground" : ""}>
                {t(`stages.${stage}`)}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">{t(`stages.${state}`)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
