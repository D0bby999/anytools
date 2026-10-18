import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import type { Proposal } from "~/lib/study-types";
import { Button } from "~/components/ui/button";

/**
 * The learner's edit of the model's proposed plan, posted to the path's own
 * action as `intent=approve`.
 *
 * Plain fields rather than a JSON editor: a module is a name, an objective and
 * a list of knowledge points, and a list of points is most honestly edited as
 * lines. Each point's type (memory / concept / …) is carried through in a
 * hidden map keyed by name, so an unedited point keeps the type the model gave
 * it and a new one defaults to `concept` on the server.
 */
export function ProposalEditor({ pathId, proposal }: { pathId: string; proposal: Proposal }) {
  const { t } = useTranslation("study");
  const fetcher = useFetcher<{ errorKey?: string; errorDetail?: string }>();

  const types: Record<string, string> = {};
  for (const m of proposal.modules) for (const kp of m.knowledge_points) types[kp.name] = kp.type;

  if (proposal.modules.length === 0) {
    return (
      <p className="mt-4 text-sm leading-prose text-muted-foreground">
        {proposal.note || t("path.noProposal")}
      </p>
    );
  }

  return (
    <fetcher.Form method="post" action={`/mastery/${pathId}`} className="mt-4 space-y-4">
      <input type="hidden" name="intent" value="approve" />
      <input type="hidden" name="modules" value={proposal.modules.length} />
      <input type="hidden" name="types" value={JSON.stringify(types)} />
      {proposal.note ? <p className="text-sm leading-prose text-muted-foreground">{proposal.note}</p> : null}

      <ol className="space-y-4">
        {proposal.modules.map((m, i) => (
          <li key={i} className="rounded-lg border bg-card p-4">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name={`module-${i}-keep`} defaultChecked />
              {t("path.keepModule")}
            </label>
            <input type="hidden" name={`module-${i}-threshold`} value={m.pass_threshold} />
            <div className="mt-2 grid gap-3">
              <div>
                <label htmlFor={`lp-mod-${i}-name`} className="block text-sm font-medium">
                  {t("path.moduleName")}
                </label>
                <input
                  id={`lp-mod-${i}-name`}
                  name={`module-${i}-name`}
                  defaultValue={m.name}
                  maxLength={200}
                  className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor={`lp-mod-${i}-objective`} className="block text-sm font-medium">
                  {t("path.objective")}
                </label>
                <input
                  id={`lp-mod-${i}-objective`}
                  name={`module-${i}-objective`}
                  defaultValue={m.objective}
                  maxLength={1000}
                  className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor={`lp-mod-${i}-points`} className="block text-sm font-medium">
                  {t("path.points")}
                </label>
                <textarea
                  id={`lp-mod-${i}-points`}
                  name={`module-${i}-points`}
                  defaultValue={m.knowledge_points.map((kp) => kp.name).join("\n")}
                  rows={Math.max(3, m.knowledge_points.length)}
                  className="mt-1 w-full rounded-md border border-control-border bg-card px-3 py-2 text-sm leading-prose"
                />
                <p className="mt-1 text-xs text-muted-foreground">{t("path.pointsHint")}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <Button type="submit" disabled={fetcher.state !== "idle"}>
        {t("path.approve")}
      </Button>
      {fetcher.data?.errorKey ? (
        <p role="alert" className="text-sm leading-snug text-destructive">
          {t(fetcher.data.errorKey)}
          {fetcher.data.errorDetail ? ` ${fetcher.data.errorDetail}` : ""}
        </p>
      ) : null}
    </fetcher.Form>
  );
}
