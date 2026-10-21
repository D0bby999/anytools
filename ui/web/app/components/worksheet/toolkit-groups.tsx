/**
 * toolkit-groups.tsx
 * /toolkit's body: the served kinds grouped as up groups them (language,
 * projects, life), each with the learner's worksheets of it and "New".
 */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { WorksheetGroup, WorksheetKind, WorksheetSummary } from "~/lib/worksheet-types";
import { WorksheetList } from "~/components/worksheet/worksheet-list";
import { Badge } from "~/components/doc/badge";
import { Details } from "~/components/doc/details";
import { NOTE_JOIN } from "~/lib/sentence";

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
    <Details summary={t("life.howTo.title")}>
      <ol>
        {steps.map((s) => (
          <li key={s}>{t(`life.howTo.${s}`)}</li>
        ))}
      </ol>
    </Details>
  );
}

/**
 * One kind: its name, "New", its summary and the learner's worksheets of it.
 * `start` replaces "New" where a kind cannot start here, such as a listening
 * audit, which starts from its video (the Languages page,
 * routes/languages.$lang.tsx). `newQuery` adds to "New"'s link, such as the
 * title a worksheet started from a language's page is given.
 */
export function KindRow({
  kind: k,
  list,
  start,
  newQuery = "",
}: {
  kind: WorksheetKind;
  list: WorksheetSummary[];
  start?: ReactNode;
  newQuery?: string;
}) {
  const { t } = useTranslation("toolkit");
  return (
    <li className="border-b py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-sans text-base font-medium">
          {k.name}
          {k.private ? <span className="text-xs font-semibold ml-2 text-faint">{t("index.private")}</span> : null}
        </h3>
        {start ?? (
          <Link
            to={`/toolkit/new?kind=${encodeURIComponent(k.kind)}${newQuery}`}
            className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
            aria-label={t("index.newOf", { name: k.name })}
          >
            {t("index.new")}
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm leading-prose text-muted-foreground">{k.summary}</p>
      <WorksheetList worksheets={list.filter((w) => w.kind === k.kind)} />
    </li>
  );
}

/** A group's title, as up names its toolkits. */
export function useGroupTitles(): Record<WorksheetGroup, string> {
  const { t } = useTranslation("toolkit");
  return { language: t("groups.language"), projects: t("groups.projects"), life: t("groups.life") };
}

/**
 * /toolkit's "All worksheets": a group per h3 and its kinds as a plain list
 * (up's toolkit index, P11): the name, "New", the summary, then the
 * learner's own worksheets of that kind.
 */
export function ToolkitGroups({ kinds, list }: { kinds: WorksheetKind[]; list: WorksheetSummary[] }) {
  const { t } = useTranslation("toolkit");
  const groupTitle = useGroupTitles();
  if (kinds.length === 0) return <p className="text-muted-foreground">{t("index.noKinds")}</p>;
  return (
    <>
      {groupKinds(kinds).map(({ group, kinds: inGroup }) => (
        <section key={group} aria-labelledby={`tk-${group}`}>
          <h3 id={`tk-${group}`}>{groupTitle[group]}</h3>
          {group === "life" ? <LifeHowTo /> : null}
          <ul>
            {inGroup.map((k) => (
              <li key={k.kind}>
                <strong>{k.name}</strong>
                {k.private ? (
                  <>
                    {" "}
                    <Badge>{t("index.private")}</Badge>
                  </>
                ) : null}
                {NOTE_JOIN}
                <Link to={`/toolkit/new?kind=${encodeURIComponent(k.kind)}`} aria-label={t("index.newOf", { name: k.name })}>
                  {t("index.new")}
                </Link>
                <span className="block text-muted-foreground">{k.summary}</span>
                <WorksheetList worksheets={list.filter((w) => w.kind === k.kind)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
