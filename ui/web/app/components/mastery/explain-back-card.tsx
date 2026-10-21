import { Details } from "~/components/doc/details";
import { Field } from "~/components/doc/field";
import { useId, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, CircleHelp, X } from "lucide-react";
import type { ExplainBackAttempt, ExplainBackResult } from "~/lib/study-types";
import { Button } from "~/components/ui/button";
import { RichText } from "~/components/rich-text";

type ActionData = { verdict?: ExplainBackResult; errorKey?: string; errorDetail?: string };

/** The API's bounds on an explanation (mastery.ExplainMinChars/MaxChars). */
export const EXPLAIN_MIN = 20;
export const EXPLAIN_MAX = 4000;

function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * The Feynman check: the learner explains a concept or design point in their
 * own words, and the verdict comes back with the gaps that stop it passing,
 * each citing the passage that closes it.
 *
 * Each submission carries a request id made in the browser, so a double
 * click or a retried post returns the first verdict instead of paying for a
 * second. "Try again" starts a new id: that is a new explanation.
 *
 * "Judged wrong?" is offered only once there is a verdict to dispute, and is
 * recorded as the learner's, beside the judge's — never as a system pass.
 */
export function ExplainBackCard({
  pointId,
  pointName,
  prompt,
  lastAttempt,
  onContinue,
}: {
  pointId: string;
  pointName: string;
  prompt: string;
  lastAttempt?: ExplainBackAttempt;
  onContinue?: () => void;
}) {
  const { t } = useTranslation("study");
  const ids = useId();
  const fetcher = useFetcher<ActionData>();
  const overrideFetcher = useFetcher<ActionData>();
  const [text, setText] = useState("");
  const [dismissed, setDismissed] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const action = `/mastery/points/${pointId}`;

  const judged = overrideFetcher.data?.verdict ?? fetcher.data?.verdict;
  const result = judged && judged.attempt.id !== dismissed ? judged : undefined;
  const error = overrideFetcher.data?.errorKey ? overrideFetcher.data : fetcher.data;
  const submitting = fetcher.state !== "idle";
  const length = text.trim().length;

  return (
    <article aria-labelledby={`${ids}-title`} className="rounded-lg border bg-card p-4 sm:p-5">
      <p className="text-xs font-semibold text-faint">{t("explain.label")}</p>
      <h3 id={`${ids}-title`} className="mt-2 font-serif text-lg leading-snug">
        {pointName}
      </h3>
      <p className="mt-2 text-sm leading-prose text-muted-foreground">{prompt}</p>

      {lastAttempt && !result && lastAttempt.gaps.length > 0 ? (
        <section aria-labelledby={`${ids}-last`} className="mt-4 border-t pt-3">
          <h4 id={`${ids}-last`} className="text-xs font-semibold text-faint">
            {t("explain.lastTime")}
          </h4>
          <Findings items={lastAttempt.gaps} sources={lastAttempt.sources} />
        </section>
      ) : null}

      {!result ? (
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (submitting || length < EXPLAIN_MIN) return;
            requestId.current ??= newRequestId();
            fetcher.submit({ intent: "explain", text, request_id: requestId.current }, { method: "post", action });
          }}
        >
          <Field label={t("explain.yourWords")}>
          <textarea
            id={`${ids}-text`}
            name="text"
            required
            rows={6}
            minLength={EXPLAIN_MIN}
            maxLength={EXPLAIN_MAX}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              // Edited text is a new explanation, with a new key.
              requestId.current = null;
            }}
            className="w-full rounded-md border border-control-border bg-card px-3 py-2 text-sm leading-prose focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          />
          </Field>
          <p className="text-xs text-faint tabular-nums">
            {t("explain.count", { count: length, min: EXPLAIN_MIN, max: EXPLAIN_MAX })}
          </p>
          <Button type="submit" disabled={submitting || length < EXPLAIN_MIN}>
            {submitting ? t("explain.judging") : t("explain.submit")}
          </Button>
        </form>
      ) : (
        <Verdict
          result={result}
          overriding={overrideFetcher.state !== "idle"}
          override={() =>
            overrideFetcher.submit({ intent: "override", attemptId: result.attempt.id }, { method: "post", action })
          }
          tryAgain={() => {
            setDismissed(result.attempt.id);
            requestId.current = null;
          }}
          onContinue={onContinue}
        />
      )}

      {error?.errorKey ? (
        <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
          {t(error.errorKey)}
          {error.errorDetail ? ` ${error.errorDetail}` : ""}
        </p>
      ) : null}
    </article>
  );
}

function Findings({ items, sources }: { items: string[]; sources: ExplainBackAttempt["sources"] }) {
  return (
    <ul className="mt-2 border-t">
      {items.map((item, i) => (
        <li key={i} className="border-b py-2 text-sm leading-prose">
          <RichText text={item} sources={sources} />
        </li>
      ))}
    </ul>
  );
}

function Verdict({
  result,
  override,
  overriding,
  tryAgain,
  onContinue,
}: {
  result: ExplainBackResult;
  override: () => void;
  overriding: boolean;
  tryAgain: () => void;
  onContinue?: () => void;
}) {
  const { t } = useTranslation("study");
  const { attempt } = result;
  const disputed = attempt.override_passed !== undefined && attempt.override_passed !== null;
  const judged = attempt.verdict === "passed" || attempt.verdict === "failed";

  return (
    <div role="status" className="mt-4 space-y-3 border-t pt-4 text-sm leading-prose">
      {/* Icon and word both carry the verdict; colour is the third channel. */}
      {attempt.verdict === "passed" ? (
        <p className="flex items-center gap-2 font-medium text-primary">
          <Check aria-hidden="true" className="size-4" />
          {t("explain.passed")}
        </p>
      ) : attempt.verdict === "failed" ? (
        <p className="flex items-center gap-2 font-medium text-destructive">
          <X aria-hidden="true" className="size-4" />
          {t("explain.failed")}
        </p>
      ) : (
        <p className="flex items-center gap-2 font-medium text-muted-foreground">
          <CircleHelp aria-hidden="true" className="size-4" />
          {t("explain.unjudged")}
        </p>
      )}
      {disputed ? (
        <p className="text-muted-foreground">
          {attempt.override_passed ? t("explain.disputedPassed") : t("explain.disputedFailed")}
        </p>
      ) : null}

      {attempt.gaps.length > 0 ? (
        <section>
          <h4 className="text-xs font-semibold text-faint">{t("explain.gaps")}</h4>
          <Findings items={attempt.gaps} sources={attempt.sources} />
        </section>
      ) : null}
      {attempt.misconceptions.length > 0 ? (
        <section>
          <h4 className="text-xs font-semibold text-faint">{t("explain.misconceptions")}</h4>
          <Findings items={attempt.misconceptions} sources={attempt.sources} />
        </section>
      ) : null}
      {attempt.feedback ? <Details summary={t("practise.explanation")} open><RichText text={attempt.feedback} sources={attempt.sources} /></Details> : null}

      {result.graduated.map((m) => (
        <p key={m.module_id} className="text-muted-foreground">
          {t("explain.graduated", { name: m.name })}
        </p>
      ))}

      <div className="flex flex-wrap gap-2">
        {judged && !disputed ? (
          <Button type="button" variant="outline" size="sm" disabled={overriding} onClick={override}>
            {t("explain.judgedWrong")}
          </Button>
        ) : null}
        {attempt.verdict !== "passed" ? (
          <Button type="button" variant="outline" size="sm" onClick={tryAgain}>
            {t("explain.tryAgain")}
          </Button>
        ) : null}
        {onContinue ? (
          <Button type="button" size="sm" onClick={onContinue}>
            {t("explain.continue")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
