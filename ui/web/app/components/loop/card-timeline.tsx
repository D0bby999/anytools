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
 */
import { Form, Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { CardDetail, CardEntry, Timepoint } from "~/lib/loop-types";
import { CardEntryForm, type LinkChoice } from "~/components/loop/card-entry-form";
import { Button } from "~/components/ui/button";

const box = "mt-1 w-full rounded-md border border-control-border bg-card px-3 py-2 text-sm";

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
      <li className="border-b py-3">
        <p className="text-sm text-muted-foreground">{t("cards.hidden")}</p>
      </li>
    );
  }
  return (
    <li className="border-b py-3">
      <p className="text-xs font-semibold text-faint">
        {new Date(entry.created_at).toLocaleDateString()} · {t("cards.cueNote", { level: levels[entry.prompt_level] ?? entry.prompt_level })}
      </p>
      {/* The learner's own text, shown as text: no markdown, no HTML. */}
      <p className="mt-1 whitespace-pre-wrap text-sm leading-prose">{entry.body}</p>
      {entry.links.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {entry.links.map((l) => (
            <li key={`${l.kind}:${l.id}:${l.page ?? 0}`} className="text-xs">
              <span className="text-faint">{kinds[l.kind] ?? l.kind}: </span>
              {l.missing || !l.path ? (
                <span className="text-muted-foreground">{t("cards.linkMissing")}</span>
              ) : (
                <Link to={l.path} className="text-primary underline underline-offset-4">
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
    <ol className="mt-6">
      <li>
        <section aria-labelledby="lp-card-setup" className="border-t py-4">
          <h2 id="lp-card-setup" className="lp-section">
            {t("cards.setup")}
          </h2>
          <dl className="mt-2 space-y-2">
            {kind.setup
              .filter((f) => card.setup[f.key])
              .map((f) => (
                <div key={f.key}>
                  <dt className="text-xs text-faint">{f.label}</dt>
                  <dd className="whitespace-pre-wrap text-sm">{card.setup[f.key]}</dd>
                </div>
              ))}
          </dl>
        </section>
      </li>

      {order.map((tp) => {
        const here = entries.filter((e) => e.timepoint === tp);
        const extra = note(tp);
        return (
          <li key={tp}>
            <section aria-labelledby={`lp-card-${tp}`} className="border-t py-4">
              <h2 id={`lp-card-${tp}`} className="lp-section">
                {steps[tp]}
              </h2>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {(kind.prompts[tp] ?? []).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {extra ? <p className="mt-2 text-sm">{extra}</p> : null}
              {here.length === 0 ? (
                <p className="mt-2 text-xs text-faint">{t("cards.empty")}</p>
              ) : (
                <ul className="mt-2 border-t">
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
            </section>
          </li>
        );
      })}

      <li>
        <section aria-labelledby="lp-card-reflect" className="border-t py-4">
          <h2 id="lp-card-reflect" className="lp-section">
            {t("cards.step.reflection")}
          </h2>
          {card.status === "closed" ? (
            <dl className="mt-2 space-y-2">
              {(
                [
                  ["held", t("cards.reflect.held")],
                  ["missed", t("cards.reflect.missed")],
                  ["next", t("cards.reflect.next")],
                ] as const
              ).map(([key, label]) =>
                card.reflection[key] ? (
                  <div key={key}>
                    <dt className="text-xs text-faint">{label}</dt>
                    <dd className="whitespace-pre-wrap text-sm">{card.reflection[key]}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          ) : card.baseline_at ? (
            <Form method="post" className="mt-2 space-y-3">
              <input type="hidden" name="intent" value="close" />
              <p className="text-sm text-muted-foreground">{t("cards.reflect.intro")}</p>
              <label className="block text-sm font-medium">
                {t("cards.reflect.held")}
                <textarea name="held" rows={2} maxLength={2000} className={box} />
              </label>
              <label className="block text-sm font-medium">
                {t("cards.reflect.missed")}
                <textarea name="missed" rows={2} maxLength={2000} className={box} />
              </label>
              <label className="block text-sm font-medium">
                {t("cards.reflect.next")}
                <textarea name="next" rows={2} maxLength={2000} className={box} />
              </label>
              <Button type="submit" variant="outline" disabled={busy}>
                {t("cards.reflect.close")}
              </Button>
            </Form>
          ) : (
            <p className="mt-2 text-xs text-faint">{t("cards.empty")}</p>
          )}
        </section>
      </li>
    </ol>
  );
}
