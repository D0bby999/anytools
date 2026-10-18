import { useTranslation } from "react-i18next";
import type { Source } from "~/hooks/use-turn-stream";
import { RichText } from "~/components/rich-text";
import { DrawIt, useDiagramRepair } from "~/components/diagram/draw-it";
import { OwnVersionShown } from "~/components/chat/own-version-fields";
import { RetellBox } from "~/components/chat/retell-box";
import type { OwnVersion, Retell } from "~/lib/own-version";

/** One rendered message. */
export type ChatTurnView = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
  /** True while the assistant's text is still arriving. */
  streaming?: boolean;
  /**
   * The stored message's capability, when the view is of a stored message.
   * A stored answer can be drawn ("Draw it"); a stored `visualize` message is
   * a diagram, which may ask for its one repair.
   */
  capability?: string;
  /**
   * The learner's own version (up-methods phase 11). On a user message, the
   * lines it was sent with; on a stored answer, the lines of the question it
   * answers, which is what offers "Close it and retell".
   */
  ownVersion?: OwnVersion;
  /** A stored answer's saved retell. */
  retell?: Retell;
};

/**
 * The transcript.
 *
 * Two deliberate shapes:
 *
 * - The assistant's text holds the reading measure (780px, DESIGN.md) even
 *   though the workspace is wider. That gap is the world.
 * - A citation renders INLINE, where the claim was made, rather than as a
 *   footnote list at the end. The claim and its evidence being adjacent is the
 *   product's whole argument; separating them turns a citation into a
 *   bibliography nobody reads.
 */
export function MessageList({ turns }: { turns: ChatTurnView[] }) {
  const { t } = useTranslation("common");

  if (turns.length === 0) {
    return (
      <p className="max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
        {t("chat.empty")}
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-6">
      {turns.map((turn) => (
        <li key={turn.id} className="max-w-(--lp-measure-read)">
          {turn.role === "user" ? (
            <UserMessage content={turn.content} label={t("chat.you")} ownVersion={turn.ownVersion} />
          ) : (
            <AssistantMessage turn={turn} />
          )}
        </li>
      ))}
    </ol>
  );
}

function UserMessage({ content, label, ownVersion }: { content: string; label: string; ownVersion?: OwnVersion }) {
  return (
    <div className="rounded-(--lp-radius-card) bg-sunken px-4 py-3">
      <p className="lp-kicker">{label}</p>
      <p className="mt-1 text-base leading-prose whitespace-pre-wrap">{content}</p>
      {ownVersion ? (
        <div className="mt-3 border-t pt-3">
          <OwnVersionShown value={ownVersion} />
        </div>
      ) : null}
    </div>
  );
}

function AssistantMessage({ turn }: { turn: ChatTurnView }) {
  const { t } = useTranslation("common");
  const isDiagram = turn.capability === "visualize";
  return (
    <div>
      <p className="lp-kicker">{t("app.name")}</p>
      {/* The model's Markdown and math, rendered; the safety rules are in
          RichText. The learner's own message above stays plain text. */}
      <div className="mt-1">
        {isDiagram ? (
          <DiagramMessage turn={turn} />
        ) : turn.ownVersion && turn.capability !== undefined && !turn.streaming && turn.content !== "" ? (
          <RetellBox messageId={turn.id} ownVersion={turn.ownVersion} saved={turn.retell}>
            <RichText text={turn.content} sources={turn.sources} />
          </RetellBox>
        ) : (
          <RichText text={turn.content} sources={turn.sources} streaming={turn.streaming} />
        )}
      </div>
      {turn.capability !== undefined && !isDiagram && !turn.streaming && turn.content !== "" ? (
        <DrawIt messageId={turn.id} />
      ) : null}
    </div>
  );
}

function DiagramMessage({ turn }: { turn: ChatTurnView }) {
  const repair = useDiagramRepair(turn.id);
  return <RichText text={turn.content} sources={turn.sources} onDiagramError={repair} />;
}
