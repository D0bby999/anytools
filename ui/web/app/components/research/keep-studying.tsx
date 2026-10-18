import { Form, Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";

/** What the report route's "to-kb" intent answers. */
export type ToKnowledgeResult =
  | {
      ok: true;
      kbId: string;
      kbName: string;
      reportAdded: boolean;
      sourcesAdded: number;
      sourcesAlready: number;
      sourcesFailed: number;
    }
  | { ok: false; error: string };

/**
 * After a report: put it where studying happens. Adding it to a knowledge base
 * makes it a document, and every study surface already works on documents —
 * so "quiz me on it" and "ask about it" are ordinary quiz and chat, pointed at
 * that knowledge base.
 */
export function KeepStudying({ kbs, hasWebSources }: { kbs: { id: string; name: string }[]; hasWebSources: boolean }) {
  const { t } = useTranslation("research");
  const fetcher = useFetcher<ToKnowledgeResult>();
  const result = fetcher.data;
  const busy = fetcher.state !== "idle";
  const field = "mt-1 min-h-11 w-full rounded-md border border-control-border bg-background px-3 text-sm";

  return (
    <section aria-labelledby="lp-keep-studying" className="rounded-lg border bg-card p-4">
      <h2 id="lp-keep-studying" className="lp-kicker">
        {t("keep.title")}
      </h2>
      <p className="mt-2 text-sm leading-prose text-muted-foreground">{t("keep.body")}</p>

      {kbs.length === 0 ? (
        <p className="mt-3 text-sm">
          {t("keep.noKbs")}{" "}
          <Link to="/knowledge" className="text-primary underline underline-offset-4">
            {t("keep.createKb")}
          </Link>
        </p>
      ) : (
        <fetcher.Form method="post" className="mt-3 grid gap-3 sm:max-w-md">
          <input type="hidden" name="intent" value="to-kb" />
          <label className="text-sm font-medium">
            {t("keep.kb")}
            <select name="kb_id" required className={field}>
              {kbs.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {kb.name}
                </option>
              ))}
            </select>
          </label>
          {hasWebSources && (
            <label className="flex min-h-11 items-start gap-2 text-sm">
              <input type="checkbox" name="include_sources" value="1" defaultChecked className="mt-1" />
              <span>
                {t("keep.includeSources")}
                <span className="block text-xs text-muted-foreground">{t("keep.includeSourcesHint")}</span>
              </span>
            </label>
          )}
          <div>
            <Button type="submit" variant="outline" disabled={busy}>
              {busy ? t("keep.adding") : t("keep.add")}
            </Button>
          </div>
        </fetcher.Form>
      )}

      {result && !result.ok && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {result.error}
        </p>
      )}
      {result && result.ok && (
        <div role="status" className="mt-3 space-y-2 text-sm">
          <p>{result.reportAdded ? t("keep.added", { kb: result.kbName }) : t("keep.already", { kb: result.kbName })}</p>
          {result.sourcesAdded + result.sourcesAlready + result.sourcesFailed > 0 && (
            <p className="text-muted-foreground">
              {t("keep.pages", {
                added: result.sourcesAdded,
                already: result.sourcesAlready,
                failed: result.sourcesFailed,
              })}
            </p>
          )}
          <div className="flex flex-wrap gap-3 pt-1">
            <Button asChild variant="outline" size="sm">
              <Link to={`/quiz?kb=${encodeURIComponent(result.kbId)}`}>{t("keep.quiz")}</Link>
            </Button>
            <Form method="post">
              <input type="hidden" name="intent" value="ask" />
              <input type="hidden" name="kb_id" value={result.kbId} />
              <Button type="submit" variant="outline" size="sm">
                {t("keep.chat")}
              </Button>
            </Form>
          </div>
        </div>
      )}
    </section>
  );
}

/** Gaps the search still saw: each one a prefilled research question. */
export function OpenQuestions({ questions }: { questions: string[] }) {
  const { t } = useTranslation("research");
  if (questions.length === 0) return null;
  return (
    <section aria-labelledby="lp-open-questions" className="rounded-lg border bg-card p-4">
      <h2 id="lp-open-questions" className="lp-kicker">
        {t("open.title")}
      </h2>
      <p className="mt-2 text-sm leading-prose text-muted-foreground">{t("open.body")}</p>
      <ul className="mt-2 flex flex-col gap-2">
        {questions.map((q) => (
          <li key={q} className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-2 text-sm first:border-t-0">
            <span className="leading-prose">{q}</span>
            <Link to={`/research?q=${encodeURIComponent(q)}`} className="text-primary underline underline-offset-4">
              {t("open.research")}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
