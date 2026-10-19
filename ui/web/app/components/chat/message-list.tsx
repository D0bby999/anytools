import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, RotateCcw } from "lucide-react";
import type { Source } from "~/hooks/use-turn-stream";
import { RichText } from "~/components/rich-text";
import { Button } from "~/components/ui/button";
import { DrawIt, useDiagramRepair } from "~/components/diagram/draw-it";
import { OwnVersionShown } from "~/components/chat/own-version-fields";
import { RetellBox } from "~/components/chat/retell-box";
import { CopyText } from "~/components/ui/copy-text";
import { FollowUps } from "~/components/chat/follow-ups";
import { WorkRow } from "~/components/chat/work-row";
import type { FollowUp, WorkView } from "~/lib/chat-work";
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
    <ol className="flex flex-col gap-6">
      {turns.map((turn, i) => (
        <li key={turn.id} className="max-w-(--lp-measure-read)">
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
        className="rounded-(--lp-radius-card) bg-sunken px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (text === "") return;
          setEditing(false);
          onEdit(text);
        }}
      >
        <label htmlFor={`lp-edit-${turn.id}`} className="lp-kicker">
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
    <div className="group/q rounded-(--lp-radius-card) bg-sunken px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="lp-kicker">{label}</p>
        {onEdit ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="-mt-1 -mr-2 h-8 px-2 text-xs"
            onClick={() => {
              setDraft(turn.content);
              setEditing(true);
            }}
          >
            <Pencil aria-hidden="true" />
            {t("chat.edit.open")}
          </Button>
        ) : null}
      </div>
      <p className="mt-1 text-base leading-prose whitespace-pre-wrap">{turn.content}</p>
      {turn.ownVersion ? (
        <div className="mt-3 border-t pt-3">
          <OwnVersionShown value={turn.ownVersion} />
        </div>
      ) : null}
    </div>
  );
}

function AssistantMessage({
  turn,
  onRegenerate,
  followUps,
}: {
  turn: ChatTurnView;
  onRegenerate?: () => void;
  followUps?: (prompt: string) => void;
}) {
  const { t } = useTranslation("common");
  const isDiagram = turn.capability === "visualize";
  const settled = turn.capability !== undefined && !turn.streaming && turn.content !== "";

  const actions = settled ? (
    <>
      <CopyText text={turn.content} markdown />
      {onRegenerate ? (
        <Button type="button" size="sm" variant="ghost" className="mt-1 h-8 px-2 text-xs" onClick={onRegenerate}>
          <RotateCcw aria-hidden="true" />
          {t("chat.regenerate")}
        </Button>
      ) : null}
      {turn.incomplete ? null : <DrawIt messageId={turn.id} />}
    </>
  ) : undefined;

  return (
    <div>
      <p className="lp-kicker">{t("app.name")}</p>
      <div className="mt-1">
        {turn.work ? <WorkRow work={turn.work} live={turn.streaming} /> : null}
        {/* The model's Markdown and math, rendered; the safety rules are in
            RichText. The learner's own message above stays plain text. */}
        {isDiagram ? (
          <DiagramMessage turn={turn} />
        ) : turn.ownVersion && settled && !turn.incomplete ? (
          <RetellBox messageId={turn.id} ownVersion={turn.ownVersion} saved={turn.retell}>
            <RichText text={turn.content} sources={turn.sources} actions={actions} />
          </RetellBox>
        ) : (
          <RichText text={turn.content} sources={turn.sources} streaming={turn.streaming} actions={actions} />
        )}
        {turn.incomplete ? (
          <p className="mt-2 w-fit rounded-md border border-warning/40 bg-warning-soft px-2 py-1 text-xs leading-ui">
            {t("chat.incomplete")}
          </p>
        ) : null}
        {followUps && turn.followUps && turn.followUps.length > 0 ? (
          <FollowUps kinds={turn.followUps} onPick={followUps} />
        ) : null}
      </div>
    </div>
  );
}

function DiagramMessage({ turn }: { turn: ChatTurnView }) {
  const repair = useDiagramRepair(turn.id);
  return <RichText text={turn.content} sources={turn.sources} onDiagramError={repair} />;
}
