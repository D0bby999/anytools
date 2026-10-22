import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { EXPLANATION_VARIANTS, type Explanation } from "~/lib/study-types";
import { languageNameInSentence } from "~/lib/languages";
import { Button } from "~/components/ui/button";
import { RichText } from "~/components/rich-text";

type ActionData = { explanation?: Explanation; errorKey?: string; errorDetail?: string };

/**
 * A knowledge point taught before it is tested (mastery/learn.go).
 *
 * The explanation is the model's text written from the learner's documents,
 * rendered through RichText so its citations are chips that open the page
 * they came from. It is cached per point, so reopening it costs nothing;
 * "Explain it differently" asks for the next angle, which is one model call
 * the first time and free after that.
 *
 * A stale explanation — a document it cites was re-parsed or re-synced — is
 * shown with a notice and a rewrite button rather than silently regenerated:
 * rewriting spends a call on the learner's key.
 *
 * "Explain in …" (the private design notes, phase 4) switches between
 * the learner's own language and the documents', one lesson each, cached.
 */
export function LearnCard({
  pointId,
  pointName,
  explanation: initial,
  onContinue,
}: {
  pointId: string;
  pointName: string;
  explanation: Explanation;
  onContinue?: () => void;
}) {
  const { t, i18n } = useTranslation("study");
  const fetcher = useFetcher<ActionData>();
  const explanation = fetcher.data?.explanation ?? initial;
  const busy = fetcher.state !== "idle";
  const action = `/mastery/points/${pointId}`;
  const ui = (i18n.language || "en").slice(0, 2);
  // The lesson's language ("" followed the documents), and the other one.
  const current = explanation.lang === undefined ? null : explanation.lang || "source";
  const other = current === null ? null : current === "source" ? ui : "source";

  const ask = (variant: number, refresh = false, lang = current ?? "") =>
    fetcher.submit(
      { intent: "learn", variant: String(variant), refresh: String(refresh), lang },
      { method: "post", action },
    );

  return (
    <article aria-labelledby={`lp-learn-${pointId}`} className="lp-doc max-w-[780px]">
      <p className="text-xs font-semibold text-faint">{t("learn.label")}</p>
      <h3 id={`lp-learn-${pointId}`} className="mt-2 font-serif text-lg leading-snug">
        {pointName}
      </h3>

      {explanation.stale ? (
        <div role="note" className="mt-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm leading-snug">
          <p>{t("learn.stale")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={busy}
            onClick={() => ask(explanation.variant, true)}
          >
            {t("learn.rewrite")}
          </Button>
        </div>
      ) : null}

      <div className="mt-3 text-sm leading-prose" aria-busy={busy}>
        <RichText text={explanation.body_md} sources={explanation.sources} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
        {onContinue ? (
          <Button type="button" size="sm" onClick={onContinue} disabled={busy}>
            {t("learn.testMe")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => ask((explanation.variant + 1) % EXPLANATION_VARIANTS)}
        >
          {busy ? t("learn.writing") : t("learn.differently")}
        </Button>
        {other ? (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => ask(explanation.variant, false, other)}>
            {other === "source"
              ? t("learn.inSource")
              : t("learn.inLanguage", { language: languageNameInSentence(other, i18n.language) })}
          </Button>
        ) : null}
      </div>

      {fetcher.data?.errorKey ? (
        <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
          {t(fetcher.data.errorKey)}
          {fetcher.data.errorDetail ? ` ${fetcher.data.errorDetail}` : ""}
        </p>
      ) : null}
    </article>
  );
}

/**
 * "Teach me this": a question card's way into the same explanation, asked
 * for only when the learner presses it.
 */
export function TeachMeThis({ pointId, pointName }: { pointId: string; pointName: string }) {
  const { t } = useTranslation("study");
  const fetcher = useFetcher<ActionData>();
  const explanation = fetcher.data?.explanation;

  if (explanation) {
    return <LearnCard pointId={pointId} pointName={pointName} explanation={explanation} />;
  }
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={fetcher.state !== "idle"}
        onClick={() =>
          fetcher.submit({ intent: "learn", variant: "0" }, { method: "post", action: `/mastery/points/${pointId}` })
        }
      >
        {fetcher.state !== "idle" ? t("learn.writing") : t("learn.teachMe")}
      </Button>
      {fetcher.data?.errorKey ? (
        <p role="alert" className="mt-2 text-sm leading-snug text-destructive">
          {t(fetcher.data.errorKey)}
          {fetcher.data.errorDetail ? ` ${fetcher.data.errorDetail}` : ""}
        </p>
      ) : null}
    </div>
  );
}
