/**
 * loop.cards.$id.tsx
 * One skill evidence card, read as a timeline: setup, the unaided first
 * attempt, practice, the retest, somewhere new, reflection.
 *
 * The server decides everything that matters here — which step is open today
 * in the learner's zone, and that the first attempt is not sent while the
 * retest is pending — so this page renders what it is given and posts back.
 */
import { Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/loop.cards.$id";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import * as loop from "~/lib/loop.server";
import { parseCardLinks } from "~/lib/card-links";
import { field, orNotFound } from "~/lib/loop-actions.server";
import { ActionError } from "~/components/loop/action-error";
import { CardTimeline } from "~/components/loop/card-timeline";
import type { LinkChoice } from "~/components/loop/card-entry-form";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Evidence card · Learning loop · AnyTools" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return orNotFound(async () => {
    const detail = await loop.getCard(user.id, params.id);
    // What an entry may link to: this week's notes and quiz answers.
    let recent: LinkChoice[] = [];
    const state = await loop.getState(user.id, detail.card.state_id).catch(() => null);
    if (state?.cycle) {
      const { suggestions } = await loop.suggest(user.id, state.cycle.id, 0).catch(() => ({ suggestions: [] }));
      recent = suggestions
        .filter((c) => c.kind === "note" || c.kind === "question_attempt")
        .slice(0, 12)
        .map((c) => ({ kind: c.kind === "note" ? "note" : "quiz_attempt", id: c.ref_id, label: c.label }));
    }
    return { detail, recent };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  try {
    switch (field(form, "intent")) {
      case "entry": {
        const parsed = parseCardLinks(form);
        if ("error" in parsed) return { error: parsed.error };
        await loop.addCardEntry(user.id, params.id, {
          timepoint: field(form, "timepoint"),
          // The learner's text is kept exactly as written, spacing included.
          body: String(form.get("body") ?? ""),
          prompt_level: field(form, "prompt_level") || "unaided",
          links: parsed.links,
        });
        return { ok: true };
      }
      case "close":
        await loop.closeCard(user.id, params.id, {
          held: field(form, "held"),
          missed: field(form, "missed"),
          next: field(form, "next"),
        });
        return { ok: true };
    }
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  return { error: "Unknown action." };
}

export default function LoopCard({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("loop");
  const busy = useNavigation().state === "submitting";
  const { detail, recent } = loaderData;
  return (
    <div className="lp-measure">
      <p className="lp-kicker">{detail.kind.name}</p>
      <div className="lp-prose">
        <h1>{detail.card.title}</h1>
        <p>{detail.kind.summary}</p>
      </div>
      <Link to={`/loop/state/${detail.card.state_id}`} className="text-sm text-primary underline underline-offset-4">
        {t("cards.backToGoal")}
      </Link>
      <ActionError result={actionData} />
      {detail.baseline_hidden ? <p className="mt-4 text-sm text-muted-foreground">{t("cards.hidden")}</p> : null}
      <CardTimeline detail={detail} recent={recent} busy={busy} />
      <p className="mt-6 text-xs leading-prose text-muted-foreground">{t("cards.cannotProve")}</p>
    </div>
  );
}
