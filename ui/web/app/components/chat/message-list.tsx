import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import type { Source } from "~/hooks/use-turn-stream";
import { RichText } from "~/components/rich-text";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/doc/badge";
import { ListenButton } from "~/components/vocab/listen-button";
import { DrawIt, useDiagramRepair } from "~/components/diagram/draw-it";
import { OwnVersionShown } from "~/components/chat/own-version-fields";
import { RetellBox } from "~/components/chat/retell-box";
import { CopyText } from "~/components/ui/copy-text";
import { FollowUps } from "~/components/chat/follow-ups";
import { ProcessRow, processFoldKeys } from "~/components/chat/process-row";
import { FeedbackDialog } from "~/components/chat/feedback-dialog";
import { useFolds } from "~/components/chat/folds";
import type { ChatFeedbackController } from "~/hooks/use-chat-feedback";
import type { FollowUp, WorkView } from "~/lib/chat-work";
import { cn } from "~/lib/utils";
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
  /** How the answer was found (lib/chat-work.ts). */
  work?: WorkView | null;
  /** The model's reasoning, while the answer streams. */
  thinking?: string;
  /** Next steps the server offered for this answer. */
  followUps?: FollowUp[];
  /** The text streamed before the turn failed or was stopped. */
  incomplete?: boolean;
};

/** What the learner can do to the end of the conversation. */
export type TranscriptActions = {
  /** Ask the question again; the id is the question's. */
  onRegenerate?: (questionId: string) => void;
  /** Replace the question and ask the new one. */
  onEdit?: (questionId: string, text: string) => void;
  /** Send a follow-up's words as the next message. */
  onFollowUp?: (prompt: string) => void;
  /** A turn is running or starting: nothing that starts one is offered. */
  busy?: boolean;
  /** Like / Dislike on stored answers (hooks/use-chat-feedback.ts). */
  feedback?: ChatFeedbackController;
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
 *
 * Only the END of the conversation can be changed: the last question can be
 * edited and the last answer asked again, because the history is linear and
 * changing an earlier question would orphan everything after it.
 */
export function MessageList({ turns, actions = {} }: { turns: ChatTurnView[]; actions?: TranscriptActions }) {
  const { t } = useTranslation("common");

  if (turns.length === 0) {
    return (
      <p className="max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
        {t("chat.empty")}
      </p>
    );
  }

  let lastUser = -1;
  turns.forEach((x, i) => {
    if (x.role === "user") lastUser = i;
  });
  const last = turns.length - 1;
  const question = lastUser >= 0 ? turns[lastUser] : undefined;
  // Stored ids only: a live or just-settled view has a synthetic id the API
  // has never seen.
  const stored = (id: string) => !id.startsWith("live-") && !id.startsWith("settled-");

  return (
    <ol className="flex flex-col gap-8">
      {turns.map((turn, i) => (
        <li key={turn.id} className={turn.role === "user" ? "flex justify-end" : undefined}>
          {turn.role === "user" ? (
            <UserMessage
              turn={turn}
              label={t("chat.you")}
              onEdit={
                i === lastUser && stored(turn.id) && !actions.busy && actions.onEdit
                  ? (text) => actions.onEdit?.(turn.id, text)
                  : undefined
              }
            />
          ) : (
            <AssistantMessage
              turn={turn}
              onRegenerate={
                i === last && question && lastUser < i && stored(question.id) && !actions.busy && actions.onRegenerate
                  ? () => actions.onRegenerate?.(question.id)
                  : undefined
              }
              followUps={i === last && !actions.busy ? actions.onFollowUp : undefined}
              feedback={stored(turn.id) ? actions.feedback : undefined}
            />
          )}
        </li>
      ))}
    </ol>
  );
}

function UserMessage({
  turn,
  label,
  onEdit,
}: {
  turn: ChatTurnView;
  label: string;
  onEdit?: (text: string) => void;
}) {
  const { t } = useTranslation("common");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(turn.content);

  if (editing && onEdit) {
    return (
      <form
        className="w-full max-w-[80%] rounded-lg bg-sunken px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (text === "") return;
          setEditing(false);
          onEdit(text);
        }}
      >
        <label htmlFor={`lp-edit-${turn.id}`} className="text-sm font-medium text-muted-foreground">
          {t("chat.edit.label")}
        </label>
        <textarea
          id={`lp-edit-${turn.id}`}
          value={draft}
          rows={3}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
          className="mt-1 w-full resize-y rounded-md border border-control-border bg-card px-3 py-2 text-base leading-prose focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <p className="mt-1 text-xs leading-ui text-muted-foreground">{t("chat.edit.help")}</p>
        <div className="mt-2 flex gap-2">
          <Button type="submit" size="sm" disabled={draft.trim() === ""}>
            {t("chat.edit.submit")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
            {t("chat.edit.cancel")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    // The learner's question is a block of its own, never a heading: it is
    // what they typed, not a section of the page, and an outline or a screen
    // reader's heading list must not fill up with it. Right-aligned, at most
    // 80% wide, on the sunken fill, so the page reads as a chapter of answers
    // with the questions set apart.
    <div className="max-w-[80%] min-w-0 rounded-lg bg-sunken px-4 py-3">
      <p className="sr-only">{label}</p>
      <p data-chat-searchable className="text-base leading-[1.6] font-medium whitespace-pre-wrap break-words">
        {turn.content}
      </p>
      {turn.ownVersion ? (
        <div className="mt-3 border-t pt-3">
          <OwnVersionShown value={turn.ownVersion} />
        </div>
      ) : null}
      {onEdit ? (
        <button
          type="button"
          className={TEXT_ACTION + " mt-1"}
          onClick={() => {
            setDraft(turn.content);
            setEditing(true);
          }}
        >
          {t("chat.edit.open")}
        </button>
      ) : null}
    </div>
  );
}

function AssistantMessage({
  turn,
  onRegenerate,
  followUps,
  feedback,
}: {
  turn: ChatTurnView;
  onRegenerate?: () => void;
  followUps?: (prompt: string) => void;
  feedback?: ChatFeedbackController;
}) {
  const { t } = useTranslation("common");
  const folds = useFolds();
  const isDiagram = turn.capability === "visualize";
  const settled = turn.capability !== undefined && !turn.streaming && turn.content !== "";
  const hasWork = (turn.work?.steps.length ?? 0) > 0;

  // The answer's actions: Listen · Copy · Ask again · Draw it, as text links
  // under it (up has no toolbars). Listen is drawn here rather than by
  // RichText so the four read as one line.
  // A diagram has none: it is drawn already, and asks for its own repair.
  const actions =
    !isDiagram && !turn.streaming && turn.content !== "" ? (
      <AnswerActions>
        <span>
          <ListenButton text={turn.content} />
        </span>
        {settled ? (
          <span>
            <CopyText text={turn.content} markdown className={TEXT_ACTION} />
          </span>
        ) : null}
        {settled && onRegenerate ? (
          <span>
            <button type="button" className={TEXT_ACTION} onClick={onRegenerate}>
              {t("chat.regenerate")}
            </button>
          </span>
        ) : null}
        {settled && !turn.incomplete ? (
          <span>
            <DrawIt messageId={turn.id} />
          </span>
        ) : null}
        {settled && hasWork ? (
          <span>
            <button
              type="button"
              className={TEXT_ACTION}
              onClick={() => folds.openAll(processFoldKeys(turn.id, turn.work))}
            >
              {t("chat.expandAll")}
            </button>
          </span>
        ) : null}
        {settled && feedback ? (
          <span>
            <Ratings messageId={turn.id} feedback={feedback} />
          </span>
        ) : null}
      </AnswerActions>
    ) : undefined;

  return (
    <div>
      <p className="sr-only">{t("app.name")}</p>
      {turn.work || turn.thinking ? (
        <ProcessRow
          turnId={turn.id}
          work={turn.work}
          thinking={turn.thinking}
          state={turn.streaming ? "running" : turn.incomplete ? "interrupted" : "done"}
        />
      ) : null}
      {/* The model's Markdown and math, rendered in the article's prose; the
          safety rules are in RichText. The learner's own message stays plain. */}
      <div className="lp-doc" data-chat-searchable>
        {isDiagram ? (
          <DiagramMessage turn={turn} />
        ) : turn.ownVersion && settled && !turn.incomplete ? (
          <RetellBox messageId={turn.id} ownVersion={turn.ownVersion} saved={turn.retell}>
            <RichText text={turn.content} sources={turn.sources} listen={false} />
          </RetellBox>
        ) : (
          <RichText text={turn.content} sources={turn.sources} streaming={turn.streaming} listen={false} />
        )}
      </div>
      {actions}
      {turn.incomplete ? (
        <p className="mt-2 w-fit">
          <Badge type="warning">{t("chat.incomplete")}</Badge>
        </p>
      ) : null}
      {followUps && turn.followUps && turn.followUps.length > 0 ? (
        <FollowUps kinds={turn.followUps} onPick={followUps} />
      ) : null}
    </div>
  );
}

/**
 * Like and Dislike, as two small icon buttons at the end of the action row.
 * A Like records at once; a Dislike asks why (FeedbackDialog); pressing the
 * recorded one again retracts it. The recorded one is filled and pressed. A
 * refused write rolls back and says so under the row.
 */
function Ratings({ messageId, feedback }: { messageId: string; feedback: ChatFeedbackController }) {
  const { t } = useTranslation("common");
  const [asking, setAsking] = useState(false);
  const current = feedback.ratingOf(messageId);
  const button = (rating: "good" | "bad") => {
    const Icon = rating === "good" ? ThumbsUp : ThumbsDown;
    const on = current === rating;
    return (
      <button
        type="button"
        aria-pressed={on}
        aria-label={t(rating === "good" ? "chat.feedback.like" : "chat.feedback.dislike")}
        title={t(rating === "good" ? "chat.feedback.like" : "chat.feedback.dislike")}
        onClick={() => {
          if (on) void feedback.retract(messageId);
          else if (rating === "good") void feedback.rate(messageId, "good");
          else setAsking(true);
        }}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-md transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          on ? "text-primary" : "text-muted-foreground hover:text-primary",
        )}
      >
        <Icon aria-hidden="true" className="size-4" fill={on ? "currentColor" : "none"} />
      </button>
    );
  };
  return (
    <span className="inline-flex items-center">
      {button("good")}
      {button("bad")}
      {feedback.failed(messageId) ? (
        <span role="alert" className="ml-2 text-sm text-destructive">
          {t("chat.feedback.failed")}
        </span>
      ) : null}
      <FeedbackDialog
        open={asking}
        onClose={() => setAsking(false)}
        onSubmit={(details) => feedback.rate(messageId, "bad", details)}
      />
    </span>
  );
}

/** A text action: 14/500 in the secondary ink, the action ink on hover. */
const TEXT_ACTION =
  "inline-flex min-h-8 items-center rounded-[4px] text-sm font-medium text-muted-foreground transition-colors " +
  "hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";

/**
 * The row the actions sit in, joined by " · ". Each action is wrapped in a
 * span; an empty one (Listen without speech synthesis) is hidden and takes
 * its separator with it. The child selectors restyle the shared buttons
 * (Listen's, Draw it's) as text links without reaching into the read-aloud
 * bar, which is fixed to the screen and sits deeper.
 */
function AnswerActions({ children }: { children: ReactNode }) {
  return <div className={ACTION_ROW}>{children}</div>;
}

// Written out in full: Tailwind finds classes by reading the source, so a
// class built from a template string would never be generated. The second
// line is for a button inside a div (Draw it's), the first for one straight
// in the span.
const ACTION_ROW = [
  "mt-1 flex flex-wrap items-center gap-y-1 text-sm text-muted-foreground",
  "[&>span:empty]:hidden [&>span]:inline-flex [&>span]:items-center [&>span>div]:mt-0",
  "[&>span:not(:last-child)]:after:mx-2 [&>span:not(:last-child)]:after:content-['·']",
  "[&>span>button]:h-8 [&>span>button]:bg-transparent [&>span>button]:px-0 [&>span>button]:text-sm [&>span>button]:font-medium [&>span>button]:text-muted-foreground [&>span>button:hover]:bg-transparent [&>span>button:hover]:text-primary [&>span>button_svg]:hidden",
  "[&>span>div>button]:h-8 [&>span>div>button]:bg-transparent [&>span>div>button]:px-0 [&>span>div>button]:text-sm [&>span>div>button]:font-medium [&>span>div>button]:text-muted-foreground [&>span>div>button:hover]:bg-transparent [&>span>div>button:hover]:text-primary [&>span>div>button_svg]:hidden",
].join(" ");

function DiagramMessage({ turn }: { turn: ChatTurnView }) {
  const repair = useDiagramRepair(turn.id);
  return <RichText text={turn.content} sources={turn.sources} onDiagramError={repair} />;
}
