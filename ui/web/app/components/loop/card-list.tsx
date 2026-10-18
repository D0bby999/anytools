/**
 * card-list.tsx
 * Skill evidence cards as hairline rows — on a goal's page, on the Loop home —
 * and the "Retests due" list the Loop home puts first. A kind's name comes
 * from the served kinds table; a row whose kind is unknown shows the raw id
 * rather than a name made up here.
 *
 * A goal with language cards and no English diagnostic yet is pointed to
 * one (up methods, phase 1): up starts language work from that baseline.
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { CardKind, RetestDue, SkillCard } from "~/lib/loop-types";
import { DiagnosticPrompt, needsDiagnostic, type DiagnosticNeed } from "~/components/worksheet/diagnostic-prompt";

const row = "flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 py-3 transition-colors hover:bg-primary-soft";

function useStatusLabels(): Record<string, string> {
  const { t } = useTranslation("loop");
  return { open: t("cards.status.open"), retest_due: t("cards.status.retest_due"), closed: t("cards.status.closed") };
}

type CardListProps = { cards: SkillCard[]; kinds: CardKind[]; diagnostic?: DiagnosticNeed };

export function CardList({ cards, kinds, diagnostic }: CardListProps) {
  const { t } = useTranslation("loop");
  const status = useStatusLabels();
  const names = new Map(kinds.map((k) => [k.kind, k.name]));
  if (cards.length === 0) return <p className="mt-3 lp-empty">{t("cards.none")}</p>;
  return (
    <>
      {diagnostic && needsDiagnostic(diagnostic, cards.map((c) => c.kind)) ? (
        <DiagnosticPrompt stateId={diagnostic.stateId} />
      ) : null}
      <ul className="mt-3 border-t">
        {cards.map((c) => (
          <li key={c.id} className="border-b">
            <Link to={`/loop/cards/${c.id}`} className={row}>
              <span className="text-sm font-medium">{c.title}</span>
              <span className="text-xs font-semibold text-faint">
                {names.get(c.kind) ?? c.kind} · {status[c.status] ?? c.status}
                {c.status === "retest_due" ? ` · ${t("cards.dueOn", { date: c.retest_due_on })}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export function RetestsDueList({ retests, kinds }: { retests: RetestDue[]; kinds: CardKind[] }) {
  const { t } = useTranslation("loop");
  const names = new Map(kinds.map((k) => [k.kind, k.name]));
  if (retests.length === 0) return <p className="mt-3 lp-empty">{t("cards.retests.none")}</p>;
  return (
    <ul className="mt-3 border-t">
      {retests.map((r) => (
        <li key={r.card_id} className="border-b">
          <Link to={`/loop/cards/${r.card_id}`} className={row} aria-label={`${t("cards.retests.open")}: ${r.title}`}>
            <span className="text-sm font-medium">{r.title}</span>
            <span className="text-xs font-semibold text-faint">
              {names.get(r.kind) ?? r.kind} · {t("cards.dueOn", { date: r.retest_due_on })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
