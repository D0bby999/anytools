/**
 * use-chat-feedback.ts — Like / Dislike for a conversation's answers (after
 * postclaw's hooks/use-chat-feedback.ts).
 *
 * The ratings come with the conversation (its loader), so a rating made
 * earlier shows as soon as the page does; postclaw read them on the first
 * hover, which left an earlier rating unfilled until then. A rating shows at
 * once and rolls back, with an error under that answer, when the server
 * refuses it. Writes go through routes/app.api.chat-feedback.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatFeedback } from "~/lib/chat.server";
import type { FeedbackActionData } from "~/routes/app.api.chat-feedback";

export type Rating = "good" | "bad";

export type ChatFeedbackController = {
  ratingOf: (messageId: string) => Rating | undefined;
  failed: (messageId: string) => boolean;
  rate: (messageId: string, rating: Rating, details?: { category?: string; comment?: string }) => Promise<boolean>;
  retract: (messageId: string) => Promise<boolean>;
};

const ENDPOINT = "/app/api/chat-feedback";

function toMap(list: readonly ChatFeedback[]): Record<string, Rating> {
  return Object.fromEntries(list.map((f) => [f.message_id, f.rating]));
}

async function post(fields: Record<string, string>): Promise<boolean> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      body: new URLSearchParams(fields),
    });
    if (!res.ok) return false;
    return ((await res.json()) as FeedbackActionData).ok;
  } catch {
    return false;
  }
}

export function useChatFeedback(initial: readonly ChatFeedback[]): ChatFeedbackController {
  const [ratings, setRatings] = useState<Record<string, Rating>>(() => toMap(initial));
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  // The loader re-reads after every turn; the stored ratings come back the
  // same, and a rewound answer's rating is gone with it. Compared by content,
  // so a new array with the same ratings changes nothing.
  const stored = initial.map((f) => `${f.message_id}:${f.rating}`).join(",");
  const latest = useRef(initial);
  latest.current = initial;
  useEffect(() => setRatings(toMap(latest.current)), [stored]);

  const apply = useCallback(
    async (messageId: string, next: Rating | undefined, write: () => Promise<boolean>) => {
      const before = ratings[messageId];
      const set = (r: Rating | undefined) =>
        setRatings((now) => {
          const copy = { ...now };
          if (r) copy[messageId] = r;
          else delete copy[messageId];
          return copy;
        });
      set(next);
      setErrors((e) => ({ ...e, [messageId]: false }));
      const ok = await write();
      if (!ok) {
        set(before);
        setErrors((e) => ({ ...e, [messageId]: true }));
      }
      return ok;
    },
    [ratings],
  );

  const rate = useCallback(
    (messageId: string, rating: Rating, details: { category?: string; comment?: string } = {}) =>
      apply(messageId, rating, () =>
        post({
          intent: "put",
          messageId,
          rating,
          ...(details.category ? { category: details.category } : {}),
          ...(details.comment ? { comment: details.comment } : {}),
        }),
      ),
    [apply],
  );

  const retract = useCallback(
    (messageId: string) => apply(messageId, undefined, () => post({ intent: "delete", messageId })),
    [apply],
  );

  return useMemo(
    () => ({
      ratingOf: (id: string) => ratings[id],
      failed: (id: string) => errors[id] === true,
      rate,
      retract,
    }),
    [ratings, errors, rate, retract],
  );
}
