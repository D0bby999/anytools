/**
 * quiz.questions.$questionId.ts
 * Resource route (action only): answer a question, or override a verdict.
 *
 * One route rather than an action on each page that shows a question: the quiz
 * page, the bank and the mastery session all render the same QuestionCard,
 * and it posts here. Its own action calls requireUser, because a resource route
 * is not under app-layout's guard.
 */
import type { Route } from "./+types/quiz.questions.$questionId";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { attemptQuestion, overrideAttempt } from "~/lib/quiz.server";
import { ATTRIBUTIONS } from "~/lib/study-types";

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const attribution = String(form.get("self_attribution") ?? "");
  const answer = String(form.get("user_answer") ?? "");
  try {
    if (intent === "attempt") {
      const result = await attemptQuestion(user.id, params.questionId, {
        user_answer: answer,
        // Anything outside the list is dropped here rather than sent: the API
        // would refuse it with a 400 the learner cannot act on.
        self_attribution: (ATTRIBUTIONS as readonly string[]).includes(attribution) ? attribution : "",
        // A maths answer the checker cannot read comes back to the learner
        // (422 unreadable_math) instead of being marked; "Send as text"
        // posts again without it.
        ask_if_unreadable: form.get("ask_if_unreadable") === "1",
      });
      return { result };
    }
    if (intent === "override") {
      const attemptId = String(form.get("attemptId") ?? "");
      if (!attemptId) return { errorKey: "errors.attemptFailed", errorDetail: "" };
      const result = await overrideAttempt(user.id, attemptId, form.get("isCorrect") === "true");
      return { result };
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === "unreadable_math") {
      return { unreadable: { answer, attribution } };
    }
    return {
      errorKey: intent === "override" ? "errors.overrideFailed" : "errors.attemptFailed",
      errorDetail: error instanceof ApiError ? error.message : "",
    };
  }
  return { errorKey: "errors.attemptFailed", errorDetail: "" };
}
