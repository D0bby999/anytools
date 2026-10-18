import { useCallback, useRef } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Shapes } from "lucide-react";
import { Button } from "~/components/ui/button";
import { RichText } from "~/components/rich-text";
import type { DiagramActionData } from "~/routes/app.api.diagram";

const ACTION = "/app/api/diagram";

/**
 * "Draw it" under an answer or a solution: one diagram of it, appended to the
 * conversation. Nothing is drawn unless the learner asks.
 *
 * In a transcript the page's revalidation shows the new message; `inline`
 * shows it here instead, for a page that is not a transcript (Solve).
 */
export function DrawIt({ messageId, inline = false }: { messageId: string; inline?: boolean }) {
  const { t } = useTranslation("common");
  const fetcher = useFetcher<DiagramActionData>();
  const busy = fetcher.state !== "idle";
  const failed = fetcher.data && !fetcher.data.ok ? fetcher.data : null;

  return (
    <div className="mt-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => void fetcher.submit({ intent: "draw", messageId }, { method: "post", action: ACTION })}
      >
        <Shapes aria-hidden="true" className="size-4" />
        {busy ? t("diagram.drawing") : t("diagram.drawIt")}
      </Button>
      {failed ? (
        <p role="alert" className="mt-1 text-xs leading-snug text-destructive">
          {failed.error}
        </p>
      ) : null}
      {inline && fetcher.data?.ok ? <InlineDiagram message={fetcher.data.message} /> : null}
    </div>
  );
}

function InlineDiagram({ message }: { message: { id: string; content: string } }) {
  const repairFetcher = useFetcher<DiagramActionData>();
  const sent = useRef(false);
  const repaired = repairFetcher.data?.ok ? repairFetcher.data.message.content : null;
  const repair = (error: string) => {
    if (sent.current) return;
    sent.current = true;
    void repairFetcher.submit({ intent: "repair", diagramId: message.id, error }, { method: "post", action: ACTION });
  };
  return (
    <div className="mt-3">
      <RichText text={repaired ?? message.content} sources={[]} onDiagramError={repaired ? undefined : repair} />
    </div>
  );
}

/**
 * The repair a "Draw it" diagram gets when the browser's Mermaid cannot parse
 * it: sent once per mount, and the API refuses any after the first anyway.
 */
export function useDiagramRepair(diagramId: string): (error: string) => void {
  const fetcher = useFetcher<DiagramActionData>();
  const sent = useRef(false);
  const { submit } = fetcher;
  return useCallback(
    (error: string) => {
      if (sent.current) return;
      sent.current = true;
      void submit({ intent: "repair", diagramId, error }, { method: "post", action: ACTION });
    },
    [diagramId, submit],
  );
}
