import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Source, ToolActivity as Activity } from "~/hooks/use-turn-stream";
import { CitationChip } from "~/components/chat/citation-chip";

/**
 * The activity panel's contents: what the model is doing, and what it found.
 *
 * Sources come first. The panel is the product's thesis as furniture
 * (DESIGN.md), and the thesis is about evidence, not about machinery — the tool
 * log is the smaller, quieter half underneath.
 *
 * Thinking is collapsed by default. It is genuinely useful when an answer is
 * wrong and pure noise the rest of the time, and a panel that streams reasoning
 * at full volume trains people to ignore the panel.
 */
export function ToolActivityPanel({
  sources,
  tools,
  thinking,
  stage,
}: {
  sources: Source[];
  tools: Activity[];
  thinking: string;
  stage: string | null;
}) {
  const { t } = useTranslation("common");
  const [showThinking, setShowThinking] = useState(false);

  const hasAnything = sources.length > 0 || tools.length > 0 || thinking !== "";
  if (!hasAnything) return null;

  return (
    <div className="mt-3 flex flex-col gap-5">
      {sources.length > 0 && (
        <ol className="flex flex-col gap-2">
          {sources.map((source, i) => (
            <li key={`${source.kind}:${source.id}`}>
              <CitationChip source={source} index={i + 1} />
            </li>
          ))}
        </ol>
      )}

      {(tools.length > 0 || stage) && (
        <section aria-labelledby="lp-activity-heading">
          <h3 id="lp-activity-heading" className="lp-kicker">
            {t("chat.activity.title")}
          </h3>
          <ol className="mt-2 flex flex-col gap-1">
            {tools.map((tool) => (
              <li key={tool.callId} className="flex items-baseline gap-2 text-xs leading-ui">
                <span
                  aria-hidden="true"
                  className={
                    "mt-1 size-1.5 shrink-0 rounded-full " +
                    (tool.status === "error"
                      ? "bg-destructive"
                      : tool.status === "done"
                        ? "bg-primary"
                        : "bg-muted-foreground")
                  }
                />
                <span className="font-mono">{tool.name}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {tool.status === "running" ? t("chat.activity.running") : (tool.detail ?? "")}
                </span>
                {/* Colour alone never carries the state. */}
                <span className="sr-only">{t(`chat.activity.status.${tool.status}`)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {thinking !== "" && (
        <section>
          <button
            type="button"
            onClick={() => setShowThinking((v) => !v)}
            aria-expanded={showThinking}
            className="lp-kicker text-left underline-offset-4 hover:underline"
          >
            {showThinking ? t("chat.thinking.hide") : t("chat.thinking.show")}
          </button>
          {showThinking && (
            <p className="mt-2 text-xs leading-prose whitespace-pre-wrap text-muted-foreground">
              {thinking}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
