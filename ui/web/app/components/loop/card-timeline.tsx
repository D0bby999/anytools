/**
 * card-timeline.tsx
 * A skill evidence card read top to bottom as the timeline it is: setup, the
 * unaided first attempt, practice, the retest, somewhere new, reflection.
 *
 * Everything the card asks — its setup fields and its prompts — comes from the
 * kind the API served (loop/cards.go), never from a copy here. What may be
 * written now comes from the server too (`allowed`): the page never decides
 * that a retest is due, and while one is pending the API does not send the
 * first attempt at all, so there is nothing here to hide.
 *
 * Each step is a numbered section (plan 261020-2246 phase 12) and its
 * entries up's dated list (P4): **date** · help — what was written.
 */
import { Form, Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { CardDetail, CardEntry, Timepoint } from "~/lib/loop-types";
import { CardEntryForm, type LinkChoice } from "~/components/loop/card-entry-form";
import { Button } from "~/components/ui/button";
import { DateText } from "~/components/ui/date-text";
import { NumberedSection } from "~/components/doc/numbered-section";
import { RefTable } from "~/components/doc/ref-table";
import { InputTable } from "~/components/loop/input-table";
import { NOTE_JOIN } from "~/lib/sentence";

function useStepLabels(): Record<Timepoint, string> {
  const { t } = useTranslation("loop");
  return {
    baseline: t("cards.step.baseline"),
    immediate: t("cards.step.immediate"),
    delayed: t("cards.step.delayed"),
    transfer: t("cards.step.transfer"),
  };
}

function useLevelLabels(): Record<string, string> {
  const { t } = useTranslation("loop");
  return { unaided: t("cards.level.unaided"), light_cue: t("cards.level.light_cue"), heavy_cue: t("cards.level.heavy_cue") };
}

function EntryItem({ entry }: { entry: CardEntry }) {
  const { t } = useTranslation("loop");
  const levels = useLevelLabels();
  const kinds: Record<string, string> = {
    note: t("cards.linkKind.note"),
    document: t("cards.linkKind.document"),
    quiz_attempt: t("cards.linkKind.quiz_attempt"),
  };
  if (entry.withheld) {
    return (
      <li>
        <span className="text-muted-foreground">{t("cards.hidden")}</span>
      </li>
    );
  }
  return (
    <li>
      <strong>
        <DateText iso={entry.created_at} />
      </strong>
      {" · "}
      <span>{t("cards.cueNote", { level: levels[entry.prompt_level] ?? entry.prompt_level })}</span>
      {NOTE_JOIN}
      {/* The learner's own text, shown as text: no markdown, no HTML. */}
      <span className="whitespace-pre-wrap">{entry.body}</span>
      {entry.links.length > 0 ? (
        <ul className="text-sm">
          {entry.links.map((l) => (
            <li key={`${l.kind}:${l.id}:${l.page ?? 0}`}>
              <span className="text-muted-foreground">{kinds[l.kind] ?? l.kind}: </span>
              {l.missing || !l.path ? (
                <span className="text-muted-foreground">{t("cards.linkMissing")}</span>
              ) : (
                <Link to={l.path}>
                  {l.label}
                  {l.page ? ` · ${t("cards.pageN", { page: l.page })}` : ""}
                </Link>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function CardTimeline({ detail, recent, busy }: { detail: CardDetail; recent: LinkChoice[]; busy: boolean }) {
  const { t } = useTranslation("loop");
  const steps = useStepLabels();
  const { card, kind, entries, allowed } = detail;
  const order: Timepoint[] = ["baseline", "immediate", "delayed", "transfer"];

  // What each step says above its entries, beyond the kind's own prompts.
  const note = (tp: Timepoint): string | null => {
    if (tp === "delayed" && card.status === "retest_due") {
      return detail.retest_open ? t("cards.retestOpen") : t("cards.retestOpensOn", { date: card.retest_due_on });
    }
    if (tp === "transfer" && card.status === "retest_due") return t("cards.transferWaits");
    return null;
  };

  return (
    <>
      <NumberedSection n={1} title={t("cards.setup")} id="lp-card-setup">
        <RefTable
          caption={t("cards.setup")}
          columns={[t("up.card.field"), t("up.card.value")]}
          rows={kind.setup
            .filter((f) => card.setup[f.key])
            .map((f) => [f.label, <span key="v" className="whitespace-pre-wrap">{card.setup[f.key]}</span>])}
        />
      </NumberedSection>

      {order.map((tp, i) => {
        const here = entries.filter((e) => e.timepoint === tp);
        const extra = note(tp);
        return (
          <NumberedSection key={tp} n={i + 2} title={steps[tp]} id={`lp-card-${tp}`}>
            {(kind.prompts[tp] ?? []).length > 0 ? (
              <ul className="text-muted-foreground">
                {(kind.prompts[tp] ?? []).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
            {extra ? <p>{extra}</p> : null}
            {here.length === 0 ? (
              <p className="text-muted-foreground">{t("cards.empty")}</p>
            ) : (
              <ul className="lp-dated-list">
                {here.map((e) => (
                  <EntryItem key={e.id} entry={e} />
                ))}
              </ul>
            )}
            {/* Keyed on the step's entry count: a saved entry remounts an empty
                form, so saved text is never left looking unsaved. */}
            {allowed.includes(tp) ? (
              <CardEntryForm key={`${tp}:${here.length}`} timepoint={tp} recent={recent} busy={busy} />
            ) : null}
          </NumberedSection>
        );
      })}

      <NumberedSection n={order.length + 2} title={t("cards.step.reflection")} id="lp-card-reflect">
        {card.status === "closed" ? (
          <RefTable
            caption={t("cards.step.reflection")}
            columns={[t("up.card.field"), t("up.card.value")]}
            rows={(
              [
                ["held", t("cards.reflect.held")],
                ["missed", t("cards.reflect.missed")],
                ["next", t("cards.reflect.next")],
              ] as const
            )
              .filter(([key]) => card.reflection[key])
              .map(([key, label]) => [label, <span key="v" className="whitespace-pre-wrap">{card.reflection[key]}</span>])}
          />
        ) : card.baseline_at ? (
          <Form method="post">
            <input type="hidden" name="intent" value="close" />
            <p className="text-muted-foreground">{t("cards.reflect.intro")}</p>
            <InputTable
              caption={t("cards.step.reflection")}
              rows={(
                [
                  ["held", t("cards.reflect.held")],
                  ["missed", t("cards.reflect.missed")],
                  ["next", t("cards.reflect.next")],
                ] as const
              ).map(([key, label]) => ({
                id: `lp-card-${key}`,
                label,
                control: <textarea id={`lp-card-${key}`} name={key} rows={2} maxLength={2000} />,
              }))}
            />
            <Button type="submit" variant="outline" disabled={busy}>
              {t("cards.reflect.close")}
            </Button>
          </Form>
        ) : (
          <p className="text-muted-foreground">{t("cards.empty")}</p>
        )}
      </NumberedSection>
    </>
  );
}
