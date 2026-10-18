import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { Button } from "~/components/ui/button";
import { RichText } from "~/components/rich-text";
import { QuestionCard } from "~/components/quiz/question-card";
import {
  diagramMarkdown,
  type Block,
  type CalloutPayload,
  type DiagramPayload,
  type ExamplePayload,
  type MarkdownPayload,
} from "~/lib/book-types";

type ActionData = { errorKey?: string; errorDetail?: string; block?: string };

/**
 * One block of a chapter. Everything the model wrote is rendered through
 * RichText — the sanitised renderer that also draws a diagram fence through
 * an image and turns citation markers into chips — never as raw HTML.
 *
 * A block keeps showing its last good version while a new one is being
 * written, and a block that could not be written says why and offers a
 * retry; either way "Regenerate" is one call on the learner's key.
 */
export function BlockView({ block }: { block: Block }) {
  const { t } = useTranslation("book");
  const fetcher = useFetcher<ActionData>();
  const busy = fetcher.state !== "idle";
  const hasContent = block.version > 0;
  const heading = {
    text: "",
    callout: "",
    worked_example: t("block.example"),
    diagram: t("block.diagram"),
    quiz: t("block.quiz"),
    flash_cards: t("block.cards"),
    summary: t("block.summary"),
    note: t("block.note"),
  }[block.type];

  return (
    <article className="border-b py-6" aria-labelledby={`lp-block-${block.id}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`lp-block-${block.id}`} className="font-serif text-lg font-semibold">
          {heading && heading.toLowerCase() !== block.title.trim().toLowerCase() ? (
            <span className="lp-kicker mr-2 align-middle">{heading}</span>
          ) : null}
          {block.type === "note" ? null : block.title}
        </h3>
        {block.type !== "note" ? (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="regenerate" />
            <input type="hidden" name="blockId" value={block.id} />
            <Button type="submit" variant="ghost" size="sm" disabled={busy} title={t("block.regenerateCost")}>
              <RefreshCw aria-hidden="true" />
              {busy ? t("block.regenerating") : block.status === "error" ? t("block.retry") : t("block.regenerate")}
            </Button>
          </fetcher.Form>
        ) : null}
      </header>

      {block.status === "error" ? (
        <p role="status" className="mt-2 text-sm text-destructive">
          {t("block.failed", { reason: block.error ?? "" })}
        </p>
      ) : null}
      {block.status === "pending" ? (
        <p className="mt-2 text-sm text-muted-foreground">{hasContent ? t("block.updating") : t("block.notWritten")}</p>
      ) : null}
      {fetcher.data?.errorKey ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t("errors.regenerateFailed")}
          {fetcher.data.errorDetail ? ` ${fetcher.data.errorDetail}` : ""}
        </p>
      ) : null}

      {hasContent ? (
        <div className="mt-3">
          <BlockBody block={block} />
        </div>
      ) : null}
    </article>
  );
}

function BlockBody({ block }: { block: Block }) {
  const { t } = useTranslation("book");
  const p = block.payload;
  switch (block.type) {
    case "text":
    case "summary":
    case "note":
      return <RichText text={(p as MarkdownPayload).markdown ?? ""} sources={block.sources} />;
    case "callout": {
      const c = p as CalloutPayload;
      const label = { definition: t("block.definition"), warning: t("block.warning"), tip: t("block.tip") }[c.variant];
      return (
        <aside className="border-l-2 border-primary pl-4">
          <p className="lp-kicker">
            {label}
            {c.title ? ` · ${c.title}` : ""}
          </p>
          <RichText text={c.markdown ?? ""} sources={block.sources} />
        </aside>
      );
    }
    case "worked_example": {
      const e = p as ExamplePayload;
      return (
        <div>
          <RichText text={e.problem ?? ""} sources={block.sources} />
          <ol className="mt-3 list-decimal space-y-2 pl-6">
            {(e.steps ?? []).map((step, i) => (
              <li key={i}>
                <RichText text={step} sources={block.sources} />
              </li>
            ))}
          </ol>
          <div className="mt-3">
            <p className="lp-kicker">{t("block.answer")}</p>
            <RichText text={e.answer ?? ""} sources={block.sources} />
          </div>
        </div>
      );
    }
    case "diagram":
      return <RichText text={diagramMarkdown(p as DiagramPayload)} sources={[]} />;
    case "quiz":
      return (
        <div className="space-y-4">
          {(block.questions ?? []).map((q) => (
            <QuestionCard key={q.id} question={q} sources={block.sources} />
          ))}
          {(block.questions ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("block.noQuestions")}</p>
          ) : null}
        </div>
      );
    case "flash_cards":
      return <FlashCards block={block} />;
  }
}

/**
 * A flash-card block: its cards, each turned over on request, and whether
 * they are in the Book cards queue ("Add to review", on by default).
 */
function FlashCards({ block }: { block: Block }) {
  const { t } = useTranslation("book");
  const fetcher = useFetcher<ActionData>();
  const pending = fetcher.formData?.get("on");
  const on = pending !== undefined && pending !== null ? pending === "true" : block.in_review !== false;
  return (
    <div>
      <ul className="border-t">
        {(block.cards ?? []).map((c, i) => (
          <li key={i} className="border-b py-2">
            <details>
              <summary className="min-h-11 cursor-pointer py-2 text-base">{c.front}</summary>
              <p className="pb-2 text-sm leading-prose text-muted-foreground">{c.back}</p>
            </details>
          </li>
        ))}
      </ul>
      <fetcher.Form method="post" className="mt-3">
        <input type="hidden" name="intent" value="review" />
        <input type="hidden" name="blockId" value={block.id} />
        <input type="hidden" name="on" value={on ? "false" : "true"} />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => fetcher.submit(e.currentTarget.form)}
          />
          {t("block.addToReview")}
        </label>
      </fetcher.Form>
      <p className="text-xs text-muted-foreground">{t("block.addToReviewHint")}</p>
    </div>
  );
}
