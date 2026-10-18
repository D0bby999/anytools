/**
 * state-lists.tsx
 * What hangs off a learning state: the hypotheses its reviews wrote back, its
 * cycle, its evidence chains and its AI briefs, each with a one-field "new".
 */
import { Form, Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { StateDetail } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";

const input = "min-h-11 flex-1 rounded-md border border-control-border bg-card px-3 text-sm";
const row = "flex min-h-11 items-baseline justify-between gap-x-4 py-3 transition-colors hover:bg-primary-soft";

function NewForm({ intent, name, label, submit, busy }: {
  intent: string; name: string; label: string; submit: string; busy: boolean;
}) {
  return (
    <Form method="post" className="mt-3 flex flex-wrap gap-2">
      <input type="hidden" name="intent" value={intent} />
      <input name={name} required aria-label={label} placeholder={label} maxLength={1000} className={input} />
      <Button type="submit" variant="outline" disabled={busy}>
        {submit}
      </Button>
    </Form>
  );
}

export function StateLists({ detail, busy }: { detail: StateDetail; busy: boolean }) {
  const { t } = useTranslation("loop");
  const { state, cycle, chains, briefs } = detail;
  return (
    <>
      <section aria-labelledby="lp-state-hyp" className="mt-10">
        <h2 id="lp-state-hyp" className="lp-section">
          {t("state.hypotheses")}
        </h2>
        {state.hypotheses.length === 0 ? (
          <p className="mt-3 lp-empty">{t("state.noHypotheses")}</p>
        ) : (
          <ul className="mt-3 border-t">
            {state.hypotheses.map((h, i) => (
              <li key={`${h.week ?? 0}-${i}`} className="border-b py-3 text-sm">
                <p className="font-medium">{h.claim}</p>
                {h.next_test ? <p className="mt-1 text-muted-foreground">{h.next_test}</p> : null}
                {h.stop_condition ? <p className="text-muted-foreground">{h.stop_condition}</p> : null}
              </li>
            ))}
          </ul>
        )}
        {cycle ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link to={`/loop/cycle/${cycle.id}`} className="text-sm text-primary underline underline-offset-4">
              {t("state.openCycle")}
            </Link>
            {cycle.phase === "deliver" ? (
              <Form method="post">
                <input type="hidden" name="intent" value="newCycle" />
                <Button type="submit" variant="outline" size="sm" disabled={busy}>
                  {t("state.newCycle")}
                </Button>
              </Form>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="lp-state-chains" className="mt-10">
        <h2 id="lp-state-chains" className="lp-section">
          {t("chain.title")}
        </h2>
        <ul className="mt-3 border-t">
          {chains.map((c) => (
            <li key={c.id} className="border-b">
              <Link to={`/loop/evidence/${c.id}`} className={row}>
                <span className="text-sm">{c.question}</span>
              </Link>
            </li>
          ))}
        </ul>
        <NewForm intent="newChain" name="question" label={t("chain.question")} submit={t("chain.new")} busy={busy} />
      </section>

      <section aria-labelledby="lp-state-briefs" className="mt-10">
        <h2 id="lp-state-briefs" className="lp-section">
          {t("brief.title")}
        </h2>
        <ul className="mt-3 border-t">
          {briefs.map((b) => (
            <li key={b.id} className="border-b">
              <Link to={`/loop/brief/${b.id}`} className={row}>
                <span className="text-sm">{b.task}</span>
              </Link>
            </li>
          ))}
        </ul>
        <NewForm intent="newBrief" name="task" label={t("brief.task")} submit={t("brief.new")} busy={busy} />
      </section>
    </>
  );
}
