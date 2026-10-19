/**
 * loop.brief.$id.tsx
 * One AI task brief and the learning logs run against it, each with its
 * three-way table.
 */
import { Form, Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/loop.brief.$id";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import * as loop from "~/lib/loop.server";
import { LOG_METRICS, PRE_START_CHECKS } from "~/lib/loop-types";
import { field, orNotFound } from "~/lib/loop-actions.server";
import { Button } from "~/components/ui/button";
import { ActionError } from "~/components/loop/action-error";
import { BriefForm } from "~/components/loop/brief-form";
import { ThreeWayTable } from "~/components/loop/three-way-table";
import { PageHeader } from "~/components/ui/page-header";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "AI brief", "Learning loop") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return orNotFound(() => loop.getBrief(user.id, params.id));
}

const TEXT_FIELDS = [
  "task", "output_eval", "ai_scope", "human_gates", "cost_reversibility",
  "failure_rollback", "handover", "data_boundary_note",
] as const;

function cellValue(form: FormData, name: string): number | null {
  const raw = String(form.get(name) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function logBody(form: FormData) {
  const base: Record<string, { value: number | null; note: string }> = {};
  const assisted: typeof base = {};
  const delayed: typeof base = {};
  const metrics: Record<string, string> = {};
  for (const m of LOG_METRICS) {
    base[m] = { value: cellValue(form, `${m}_base`), note: "" };
    assisted[m] = { value: cellValue(form, `${m}_assisted`), note: "" };
    delayed[m] = { value: cellValue(form, `${m}_delayed`), note: "" };
    metrics[m] = field(form, `${m}_measure`);
  }
  return {
    baseline_noai: base,
    assisted,
    delayed_independent: delayed,
    metrics,
    next_cycle_decision: field(form, "next_cycle_decision"),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  try {
    switch (field(form, "intent")) {
      case "brief": {
        const body: Record<string, unknown> = {};
        for (const f of TEXT_FIELDS) body[f] = field(form, f);
        const ticked = new Set(form.getAll("check").map(String));
        body.pre_start_check = Object.fromEntries(PRE_START_CHECKS.map((k) => [k, ticked.has(k)]));
        await loop.patchBrief(user.id, params.id, body);
        return { ok: true };
      }
      case "newLog":
        await loop.createLog(user.id, params.id);
        return { ok: true };
      case "log":
        await loop.patchLog(user.id, field(form, "log_id"), logBody(form));
        return { ok: true };
    }
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  return { error: "Unknown action." };
}

export default function LoopBrief({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("loop");
  const busy = useNavigation().state === "submitting";
  const { brief, unchecked, logs } = loaderData;

  return (
    <div className="lp-measure">
      <PageHeader title={brief.task} />
      <Link to={`/loop/state/${brief.state_id}`} className="text-sm text-primary underline underline-offset-4">
        {t("cycle.backToGoal")}
      </Link>
      <ActionError result={actionData} />

      <section aria-labelledby="lp-brief-form" className="mt-8">
        <h2 id="lp-brief-form" className="lp-section">
          {t("brief.title")}
        </h2>
        {unchecked.length > 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("brief.notReady")}</p>
        ) : null}
        <BriefForm brief={brief} busy={busy} />
      </section>

      <section aria-labelledby="lp-brief-logs" className="mt-10">
        <h2 id="lp-brief-logs" className="lp-section">
          {t("log.title")}
        </h2>
        <p className="mt-2 text-sm leading-prose text-muted-foreground">{t("log.lead")}</p>
        {logs.map((l) => (
          <ThreeWayTable key={l.log.id} detail={l} busy={busy} />
        ))}
        <Form method="post" className="mt-4">
          <input type="hidden" name="intent" value="newLog" />
          <Button type="submit" variant="outline" disabled={busy}>
            {t("log.new")}
          </Button>
        </Form>
      </section>
    </div>
  );
}
