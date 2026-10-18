/**
 * loop-actions.server.ts
 * The form intents several loop pages share, handled once.
 *
 * Every intent returns either a redirect or `{ error }` — the API's own
 * sentence, which for a shut gate or an unfinished review is the list of what
 * is missing. The pages show it verbatim rather than a generic failure.
 */
import { redirect } from "react-router";
import { ApiError } from "~/lib/api.server";
import * as loop from "~/lib/loop.server";

export type ActionResult = { error: string } | { ok: true } | Response;

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export async function handleLoopIntent(userId: string, form: FormData): Promise<ActionResult | null> {
  const intent = field(form, "intent");
  try {
    switch (intent) {
      case "start": {
        const { state } = await loop.startState(userId, {
          goal: field(form, "goal"),
          real_scenario: field(form, "real_scenario"),
          outcome_12w: field(form, "outcome_12w"),
          first_task: field(form, "first_task"),
        });
        return redirect(`/loop/state/${state.id}`);
      }
      case "advance":
        await loop.advance(userId, field(form, "cycle_id"));
        return { ok: true };
      case "openReview":
        return redirect(`/loop/review/${await openReview(userId, field(form, "cycle_id"))}`);
      case "evidence": {
        const body: Record<string, unknown> = { timepoint: field(form, "timepoint") };
        const status = field(form, "status");
        if (status) body.status = status;
        await loop.patchEvidence(userId, field(form, "id"), body);
        return { ok: true };
      }
      default:
        return null;
    }
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

/** Opens the current week's review, or finds it when it already exists. */
async function openReview(userId: string, cycleId: string): Promise<string> {
  try {
    return (await loop.createReview(userId, cycleId)).id;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    const detail = await loop.getCycle(userId, cycleId);
    const existing = detail.reviews.find((r) => r.week_no === detail.current_week);
    if (!existing) throw error;
    return existing.id;
  }
}

export { field };

/** Runs a loader body, turning the API's 404 into this server's 404. */
export async function orNotFound<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new Response("Not found", { status: 404 });
    }
    throw error;
  }
}

/** Splits a one-entry-per-line textarea into a list, dropping blank lines. */
export function lines(form: FormData, name: string): string[] {
  return String(form.get(name) ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}
