/**
 * mastery.points.$pointId.ts
 * Resource route (action only) for the session's learn and explain-back
 * cards: teach a point, judge an explanation, or dispute a verdict.
 *
 * One route beside quiz/questions/:id for the same reason that one exists: the
 * cards post here from wherever they are rendered. Its action calls
 * requireUser, because a resource route is not under app-layout's guard.
 */
import type { Route } from "./+types/mastery.points.$pointId";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { explainBack, learnPoint, overrideExplainBack } from "~/lib/mastery.server";
import { EXPLANATION_VARIANTS } from "~/lib/study-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "learn") {
      const variant = Number(form.get("variant") ?? 0);
      return {
        explanation: await learnPoint(user.id, params.pointId, {
          // Anything outside the API's range is folded back into it here
          // rather than sent: a 400 is not something the learner can act on.
          variant: Number.isInteger(variant) ? Math.abs(variant) % EXPLANATION_VARIANTS : 0,
          refresh: form.get("refresh") === "true",
        }),
      };
    }
    if (intent === "explain") {
      const requestId = String(form.get("request_id") ?? "");
      if (!UUID.test(requestId)) return { errorKey: "explain.requestFailed", errorDetail: "" };
      return { verdict: await explainBack(user.id, params.pointId, String(form.get("text") ?? ""), requestId) };
    }
    if (intent === "override") {
      const attemptId = String(form.get("attemptId") ?? "");
      if (!UUID.test(attemptId)) return { errorKey: "explain.overrideFailed", errorDetail: "" };
      return { verdict: await overrideExplainBack(user.id, attemptId) };
    }
  } catch (error) {
    return {
      errorKey: intent === "learn" ? "learn.failed" : intent === "override" ? "explain.overrideFailed" : "explain.requestFailed",
      errorDetail: error instanceof ApiError ? error.message : "",
    };
  }
  return { errorKey: "explain.requestFailed", errorDetail: "" };
}
