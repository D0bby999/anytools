/**
 * toolkit-groups.tsx
 * /toolkit's body: the served kinds grouped as up groups them (language,
 * projects, life), each with the learner's worksheets of it and "New".
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { WorksheetGroup, WorksheetKind, WorksheetSummary } from "~/lib/worksheet-types";
import { WorksheetList } from "~/components/worksheet/worksheet-list";

/** Kinds by group, in up's order; a group with no kind is left out. */
export function groupKinds(kinds: WorksheetKind[]): { group: WorksheetGroup; kinds: WorksheetKind[] }[] {
  const order: WorksheetGroup[] = ["language", "projects", "life"];
  return order
    .map((group) => ({ group, kinds: kinds.filter((k) => k.group === group) }))
    .filter((g) => g.kinds.length > 0);
}

/**
 * The five steps that open up's life practice toolkit (life-practice-toolkit.md,
 * "How to Use It"; phase 9), written fresh.
 */
function LifeHowTo() {
  const { t } = useTranslation("toolkit");
  const steps = ["step1", "step2", "step3", "step4", "step5"] as const;
  return (
    <details className="mt-3">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-primary underline-offset-4 hover:underline">
        {t("life.howTo.title")}
      </summary>
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm leading-prose text-muted-foreground">
        {steps.map((s) => (
          <li key={s}>{t(`life.howTo.${s}`)}</li>
        ))}
      </ol>
    </details>
  );
}

export function ToolkitGroups({ kinds, list }: { kinds: WorksheetKind[]; list: WorksheetSummary[] }) {
  const { t } = useTranslation("toolkit");
  const groupTitle: Record<WorksheetGroup, string> = {
    language: t("groups.language"),
    projects: t("groups.projects"),
    life: t("groups.life"),
  };
  if (kinds.length === 0) return <p className="mt-6 text-sm text-muted-foreground">{t("index.noKinds")}</p>;
  return (
    <>
      {groupKinds(kinds).map(({ group, kinds: inGroup }) => (
        <section key={group} aria-labelledby={`tk-${group}`} className="mt-10">
          <h2 id={`tk-${group}`} className="lp-kicker">
            {groupTitle[group]}
          </h2>
          {group === "life" ? <LifeHowTo /> : null}
          <ul className="mt-3 border-t">
            {inGroup.map((k) => (
              <li key={k.kind} className="border-b py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="font-sans text-base font-medium">
                    {k.name}
                    {k.private ? (
                      <span className="ml-2 font-mono text-2xs uppercase tracking-wide text-faint">
                        {t("index.private")}
                      </span>
                    ) : null}
                  </h3>
                  <Link
                    to={`/toolkit/new?kind=${encodeURIComponent(k.kind)}`}
                    className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
                    aria-label={t("index.newOf", { name: k.name })}
                  >
                    {t("index.new")}
                  </Link>
                </div>
                <p className="mt-1 text-sm leading-prose text-muted-foreground">{k.summary}</p>
                <WorksheetList worksheets={list.filter((w) => w.kind === k.kind)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

