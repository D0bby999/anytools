/**
 * loop.evidence.$id.tsx
 * One evidence chain: a single question followed through four timepoints,
 * with what was seen kept apart from what it is taken to mean.
 */
import { Form, Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/loop.evidence.$id";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import * as loop from "~/lib/loop.server";
import type { Candidate } from "~/lib/loop-types";
import { field, orNotFound } from "~/lib/loop-actions.server";
import { Button } from "~/components/ui/button";
import { ActionError } from "~/components/loop/action-error";
import { ChainColumns } from "~/components/loop/chain-columns";
import { Metric } from "~/components/loop/metric";
import { SuggestionRow } from "~/components/loop/suggestion-row";
import { PageHeader } from "~/components/ui/page-header";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Evidence chain", "Learning loop") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return orNotFound(async () => {
    const chain = await loop.getChain(user.id, params.id);
    const state = await loop.getState(user.id, chain.state_id);
    let recent: Candidate[] = [];
    if (state.cycle) recent = (await loop.suggest(user.id, state.cycle.id, 0)).suggestions;
    const onChain = new Set(chain.columns.flatMap((c) => c.refs.map((r) => `${r.kind}:${r.ref_id}`)));
    return { chain, recent: recent.filter((c) => !onChain.has(`${c.kind}:${c.ref_id}`)) };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  try {
    if (field(form, "intent") === "split") {
      await loop.patchChain(user.id, params.id, {
        question: field(form, "question"),
        split: { fact: field(form, "fact"), interpretation: field(form, "interpretation"), hypothesis: field(form, "hypothesis") },
      });
      return { ok: true };
    }
    if (field(form, "intent") === "addEvidence") {
      await loop.addChainEvidence(user.id, params.id, {
        kind: field(form, "kind"),
        ref_id: field(form, "ref_id"),
        timepoint: field(form, "timepoint"),
      });
      return { ok: true };
    }
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  return { error: "Unknown action." };
}

export default function LoopChain({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("loop");
  const busy = useNavigation().state === "submitting";
  const { chain, recent } = loaderData;
  const filled = chain.columns.filter((c) => c.refs.some((r) => r.status === "accepted")).length;
  const box = "mt-1 w-full rounded-md border border-control-border bg-card px-3 py-2 text-sm";

  return (
    <div>
      <div className="lp-measure">
        <PageHeader title={chain.question} />
        <Link to={`/loop/state/${chain.state_id}`} className="text-sm text-primary underline underline-offset-4">
          {t("cycle.backToGoal")}
        </Link>
        <ActionError result={actionData} />
        <Metric className="mt-6" label={t("chainPage.filled")} value={`${filled}/4`} cannotProve={chain.cannot_prove} />
      </div>

      <section aria-labelledby="lp-chain-cols" className="mt-8">
        <h2 id="lp-chain-cols" className="lp-section">
          {t("chainPage.timeline")}
        </h2>
        <ChainColumns chain={chain} />
      </section>

      <div className="lp-measure">
        <section aria-labelledby="lp-chain-add" className="mt-10">
          <h2 id="lp-chain-add" className="lp-section">
            {t("chainPage.add")}
          </h2>
          {recent.length === 0 ? <p className="mt-3 lp-empty">{t("review.noSuggestions")}</p> : null}
          <ul className="mt-3 border-t">
            {recent.map((c) => (
              <SuggestionRow key={`${c.kind}:${c.ref_id}`} item={c} />
            ))}
          </ul>
        </section>

        <section aria-labelledby="lp-chain-split" className="mt-10">
          <h2 id="lp-chain-split" className="lp-section">
            {t("chainPage.split")}
          </h2>
          <Form method="post" className="mt-3 space-y-3">
            <input type="hidden" name="intent" value="split" />
            <input type="hidden" name="question" value={chain.question} />
            <label className="block text-sm font-medium">
              {t("chainPage.fact")}
              <textarea name="fact" rows={2} defaultValue={chain.split.fact} className={box} />
            </label>
            <label className="block text-sm font-medium">
              {t("chainPage.interpretation")}
              <textarea name="interpretation" rows={2} defaultValue={chain.split.interpretation} className={box} />
            </label>
            <label className="block text-sm font-medium">
              {t("chainPage.hypothesis")}
              <textarea name="hypothesis" rows={2} defaultValue={chain.split.hypothesis} className={box} />
            </label>
            <Button type="submit" variant="outline" disabled={busy}>
              {t("state.save")}
            </Button>
          </Form>
        </section>
      </div>
    </div>
  );
}
