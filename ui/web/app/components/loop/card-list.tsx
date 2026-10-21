/**
 * card-list.tsx
 * Skill evidence cards as up's dated list (P4) — on a goal's page, on the
 * Loop home — and the "Retests due" list, each line led by its due date. A kind's name comes
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
import { NOTE_JOIN } from "~/lib/sentence";

function useStatusLabels(): Record<string, string> {
  const { t } = useTranslation("loop");
  return { open: t("cards.status.open"), retest_due: t("cards.status.retest_due"), closed: t("cards.status.closed") };
}

type CardListProps = { cards: SkillCard[]; kinds: CardKind[]; diagnostic?: DiagnosticNeed };

export function CardList({ cards, kinds, diagnostic }: CardListProps) {
  const { t } = useTranslation("loop");
  const status = useStatusLabels();
  const names = new Map(kinds.map((k) => [k.kind, k.name]));
  if (cards.length === 0) return <p className="text-muted-foreground">{t("cards.none")}</p>;
  return (
    <>
      {diagnostic && needsDiagnostic(diagnostic, cards.map((c) => c.kind)) ? (
        <DiagnosticPrompt stateId={diagnostic.stateId} />
      ) : null}
      <ul className="lp-dated-list">
        {cards.map((c) => (
          <li key={c.id}>
            <Link to={`/loop/cards/${c.id}`}>{c.title}</Link>
            {NOTE_JOIN}
            <span>
              {names.get(c.kind) ?? c.kind} · {status[c.status] ?? c.status}
              {c.status === "retest_due" ? ` · ${t("cards.dueOn", { date: c.retest_due_on })}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function RetestsDueList({ retests, kinds }: { retests: RetestDue[]; kinds: CardKind[] }) {
  const { t } = useTranslation("loop");
  const names = new Map(kinds.map((k) => [k.kind, k.name]));
  if (retests.length === 0) return <p className="text-muted-foreground">{t("cards.retests.none")}</p>;
  return (
    <ul className="lp-dated-list">
      {retests.map((r) => (
        <li key={r.card_id}>
          <strong>{r.retest_due_on}</strong>
          {" · "}
          <Link to={`/loop/cards/${r.card_id}`} aria-label={`${t("cards.retests.open")}: ${r.title}`}>
            {r.title}
          </Link>
          {NOTE_JOIN}
          {names.get(r.kind) ?? r.kind}
        </li>
      ))}
    </ul>
  );
}
