import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import type { Source } from "~/hooks/use-turn-stream";
import { Button } from "~/components/ui/button";
import { Badge, type BadgeType } from "~/components/doc/badge";
import { DocSection } from "~/components/research/doc-section";
import { CitedBody } from "~/components/research/cited-body";
import { DrawIt } from "~/components/diagram/draw-it";
import { RetellBox } from "~/components/chat/retell-box";
import type { OwnVersion } from "~/lib/own-version";

/** What the route's follow-up actions return. */
export type FollowUpResult =
  | { ok: true; saved: "note" }
  | { ok: true; saved: "question" }
  | { ok: false; error: string };

const VERDICTS = ["correct", "incorrect", "partly", "unclear"] as const;

/** A verdict as a badge (I6): the word carries it, the tint repeats it. */
const VERDICT_BADGE: Record<(typeof VERDICTS)[number], BadgeType> = {
  correct: "tip",
  incorrect: "danger",
  partly: "warning",
  unclear: "info",
};

/**
 * A finished (or streaming) solution, and the two things a learner does with
 * one: keep it in the notebook, or file it as a question to be asked later.
 *
 * Both actions name the stored transcript message by id; the server reads the
 * solution from that row, so nothing the browser holds is trusted as content.
 */
export function SolutionView({
  text,
  sources,
  streaming,
  meta,
  sessionId,
  ownVersion,
}: {
  text: string;
  sources: Source[];
  streaming: boolean;
  meta: Record<string, unknown> | null;
  sessionId: string | null;
  /** The lines the solve was sent with; they offer "Close it and retell". */
  ownVersion?: OwnVersion;
}) {
  const { t } = useTranslation("solve");
  const followUp = useFetcher<FollowUpResult>();
  const messageId = typeof meta?.message_id === "string" ? meta.message_id : null;
  const verdict = typeof meta?.verdict === "string" ? meta.verdict : "";
  const finalAnswer = typeof meta?.final_answer === "string" ? meta.final_answer : "";
  const pending = followUp.state !== "idle";

  return (
    <DocSection n={2} title={t("result.worked")} id="lp-solve-result">
      {(VERDICTS as readonly string[]).includes(verdict) && (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{t("result.verdict")}:</span>
          <Badge type={VERDICT_BADGE[verdict as (typeof VERDICTS)[number]]}>{t(`result.verdicts.${verdict}`)}</Badge>
        </p>
      )}

      {/* The write-up's numbered steps are an ordered list in the model's
          Markdown, so the prose rules number them as up numbers a list. */}
      <div className="lp-doc mt-2">
        {ownVersion && messageId && !streaming ? (
          <RetellBox messageId={messageId} ownVersion={ownVersion}>
            <CitedBody text={text} sources={sources} streaming={false} />
          </RetellBox>
        ) : (
          <CitedBody text={text} sources={sources} streaming={streaming} />
        )}
      </div>

      {finalAnswer !== "" && !streaming && (
        <p className="mt-4 rounded-lg bg-sunken px-4 py-3 text-base">
          <span className="font-semibold">{t("result.finalAnswer")}: </span>
          <span className="font-mono">{finalAnswer}</span>
        </p>
      )}

      {messageId && !streaming && (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <followUp.Form method="post">
            <input type="hidden" name="intent" value="note" />
            <input type="hidden" name="messageId" value={messageId} />
            <Button type="submit" variant="outline" disabled={pending}>
              {t("result.saveNote")}
            </Button>
          </followUp.Form>
          <followUp.Form method="post">
            <input type="hidden" name="intent" value="question" />
            <input type="hidden" name="messageId" value={messageId} />
            <Button type="submit" variant="outline" disabled={pending}>
              {t("result.toQuestion")}
            </Button>
          </followUp.Form>
          {sessionId && (
            <Link to={`/chat/${sessionId}`} className="text-sm font-medium text-primary hover:underline">
              {t("result.openChat")}
            </Link>
          )}
        </div>
      )}
      {messageId && !streaming && <DrawIt messageId={messageId} inline />}

      {followUp.data && (
        <p
          role={followUp.data.ok ? "status" : "alert"}
          className={
            "mt-3 text-sm leading-6 " + (followUp.data.ok ? "text-muted-foreground" : "text-destructive")
          }
        >
          {followUp.data.ok
            ? followUp.data.saved === "note"
              ? t("result.noteSaved")
              : t("result.questionSaved")
            : followUp.data.error}
          {followUp.data.ok && followUp.data.saved === "question" && (
            <>
              {" "}
              <Link to="/quiz/bank" className="text-primary underline underline-offset-4">
                {t("result.openBank")}
              </Link>
            </>
          )}
        </p>
      )}
    </DocSection>
  );
}
