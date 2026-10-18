import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { BookmarkPlus } from "lucide-react";
import type { Source } from "~/hooks/use-turn-stream";
import { MessageList, type ChatTurnView } from "~/components/chat/message-list";
import { Button } from "~/components/ui/button";
import { WordPicker } from "~/components/vocab/word-picker";
import { transcriptSelection } from "~/lib/vocab-types";

export type TutorExchange = {
  id: string;
  question: string;
  answer: string;
  sources: Source[];
  page: number;
  streaming?: boolean;
  /** The stored answer's id and capability, once it is stored ("Draw it"). */
  answerId?: string;
  answerCapability?: string;
};

/**
 * The tutor's side of the reader: each selection action and its answer, newest
 * last, rendered with chat's own message list so citations and streaming look
 * identical to chat. Every finished answer can be saved to the notebook with
 * the page its question was about.
 */
export function TutorPane({
  exchanges,
  failure,
  sessionId,
}: {
  exchanges: TutorExchange[];
  failure?: string | null;
  sessionId?: string;
}) {
  const { t } = useTranslation("reading");

  if (exchanges.length === 0 && !failure) {
    return <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("tutor.empty")}</p>;
  }

  return (
    <div className="mt-3 space-y-6">
      {exchanges.map((ex) => {
        const turns: ChatTurnView[] = [
          { id: `${ex.id}-q`, role: "user", content: ex.question, sources: [] },
        ];
        if (ex.answer || ex.streaming) {
          turns.push({
            id: ex.answerId ?? `${ex.id}-a`,
            role: "assistant",
            content: ex.answer,
            sources: ex.sources,
            streaming: ex.streaming,
            capability: ex.answerId ? ex.answerCapability : undefined,
          });
        }
        return (
          <div key={ex.id} className="text-sm">
            <MessageList turns={turns} />
            {!ex.streaming && ex.answer ? <SaveAnswer exchange={ex} /> : null}
            {!ex.streaming && ex.answer && ex.question.startsWith(t("actionLabels.vocab")) ? (
              <WordPicker selection={transcriptSelection(ex.question)} page={ex.page} />
            ) : null}
          </div>
        );
      })}
      {failure ? (
        <p role="alert" className="rounded-md bg-destructive-soft px-3 py-2 text-sm leading-prose">
          {failure}
        </p>
      ) : null}
      {sessionId ? (
        <a href={`/chat/${sessionId}`} className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4">
          {t("tutor.openInChat")}
        </a>
      ) : null}
    </div>
  );
}

function SaveAnswer({ exchange }: { exchange: TutorExchange }) {
  const { t } = useTranslation("reading");
  const fetcher = useFetcher<{ saved?: boolean; errorKey?: string }>();
  const saved = fetcher.data?.saved;

  return (
    <div className="mt-2">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={fetcher.state !== "idle" || saved}
        onClick={() =>
          fetcher.submit(
            {
              intent: "capture",
              from: "tutor",
              title: exchange.question.split("\n")[0]?.slice(0, 120) ?? "",
              body_md: exchange.answer,
              page: String(exchange.page),
            },
            { method: "post" },
          )
        }
      >
        <BookmarkPlus aria-hidden="true" />
        {saved ? t("tutor.saved") : t("tutor.save")}
      </Button>
      {fetcher.data?.errorKey ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {t(fetcher.data.errorKey)}
        </p>
      ) : null}
    </div>
  );
}
