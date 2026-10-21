/**
 * loop.evidence.$id.tsx
 * One evidence chain: a single question followed through four timepoints,
 * with what was seen kept apart from what it is taken to mean.
 *
 * Laid out as up's Evidence Chain Template (plan 261020-2246 phase 12): the
 * question, the four timepoints as one table, the fact / interpretation /
 * hypothesis split as a three-column input table, and the chain as a block
 * to copy into a handover. The template's "Next step" is left out: a chain
 * has no field for it.
 */
import { Form, useNavigation } from "react-router";
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
import { BookMeta } from "~/components/doc/book-meta";
import { CodeBlock } from "~/components/doc/code-block";
import { NumberedSection } from "~/components/doc/numbered-section";
import { useTimepointLabels } from "~/components/loop/timepoint-select";
import { ScrollBox } from "~/components/doc/scroll-box";

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
  const tps = useTimepointLabels();
  const { chain, recent } = loaderData;
  const filled = chain.columns.filter((c) => c.refs.some((r) => r.status === "accepted")).length;
  // The chain as a block to paste into a handover: only accepted evidence counts.
  const summary = [
    `## ${chain.question}`,
    ...chain.columns.map((c) => {
      const kept = c.refs.filter((r) => r.status === "accepted").map((r) => r.target?.label ?? t("evidence.gone"));
      return `- ${tps[c.timepoint]}: ${kept.length ? kept.join("; ") : "—"}`;
    }),
    `- ${t("chainPage.fact")}: ${chain.split.fact || "—"}`,
    `- ${t("chainPage.interpretation")}: ${chain.split.interpretation || "—"}`,
    `- ${t("chainPage.hypothesis")}: ${chain.split.hypothesis || "—"}`,
  ].join("\n");

  return (
    <div>
      <PageHeader title={chain.question} className="mb-0" />
      <BookMeta label={t("up.chain.about")} items={[{ label: t("cycle.backToGoal"), to: `/loop/state/${chain.state_id}` }]} />
      <ActionError result={actionData} />

      <div className="lp-doc">
        <NumberedSection n={1} title={t("up.chain.question")} id="lp-chain-question">
          <p>{chain.question}</p>
          <Metric label={t("chainPage.filled")} value={`${filled}/4`} cannotProve={chain.cannot_prove} />
        </NumberedSection>

        <NumberedSection n={2} title={t("chainPage.timeline")} id="lp-chain-cols">
          <ChainColumns chain={chain} />
        </NumberedSection>

        <NumberedSection n={3} title={t("chainPage.add")} id="lp-chain-add">
          {recent.length === 0 ? (
            <p className="text-muted-foreground">{t("review.noSuggestions")}</p>
          ) : (
            <ul>
              {recent.map((c) => (
                <SuggestionRow key={`${c.kind}:${c.ref_id}`} item={c} />
              ))}
            </ul>
          )}
        </NumberedSection>

        <NumberedSection n={4} title={t("chainPage.split")} id="lp-chain-split">
          <Form method="post">
            <input type="hidden" name="intent" value="split" />
            <input type="hidden" name="question" value={chain.question} />
            <div className="lp-field-table">
              <ScrollBox>
                <table className="min-w-[36rem]">
                  <caption className="sr-only">{t("chainPage.split")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("chainPage.fact")}</th>
                      <th scope="col">{t("chainPage.interpretation")}</th>
                      <th scope="col">{t("chainPage.hypothesis")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <textarea name="fact" rows={4} aria-label={t("chainPage.fact")} defaultValue={chain.split.fact} />
                      </td>
                      <td>
                        <textarea
                          name="interpretation"
                          rows={4}
                          aria-label={t("chainPage.interpretation")}
                          defaultValue={chain.split.interpretation}
                        />
                      </td>
                      <td>
                        <textarea
                          name="hypothesis"
                          rows={4}
                          aria-label={t("chainPage.hypothesis")}
                          defaultValue={chain.split.hypothesis}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </ScrollBox>
            </div>
            <Button type="submit" variant="outline" disabled={busy}>
              {t("state.save")}
            </Button>
          </Form>
        </NumberedSection>

        <NumberedSection n={5} title={t("up.chain.handover")} id="lp-chain-handover">
          <p className="text-muted-foreground">{t("up.chain.handoverLead")}</p>
          <CodeBlock code={summary} lang="md" />
        </NumberedSection>
      </div>
    </div>
  );
}
