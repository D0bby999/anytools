/**
 * state-lists.tsx
 * What hangs off a learning state: the hypotheses its reviews wrote back, its
 * cycle, its evidence chains and its AI briefs, each with a one-field "new".
 *
 * Each piece is placed by the state's page under its own heading (plan
 * 261020-2246 phase 12): the hypotheses as a table in the numbered parts,
 * the cycle, chains and briefs as plain lists after them.
 */
import { Form, Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { StateDetail } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/doc/field";
import { RefTable } from "~/components/doc/ref-table";

function NewForm({ intent, name, label, submit, busy }: {
  intent: string; name: string; label: string; submit: string; busy: boolean;
}) {
  return (
    <Form method="post" className="flex flex-wrap items-end gap-x-3">
      <input type="hidden" name="intent" value={intent} />
      <div className="min-w-60 grow">
        <Field label={label}>
          <input name={name} required maxLength={1000} />
        </Field>
      </div>
      <Button type="submit" variant="outline" disabled={busy} className="mb-4">
        {submit}
      </Button>
    </Form>
  );
}

/** The hypotheses the weekly reviews wrote back, as a table. */
export function Hypotheses({ state }: { state: StateDetail["state"] }) {
  const { t } = useTranslation("loop");
  if (state.hypotheses.length === 0) return <p className="text-muted-foreground">{t("state.noHypotheses")}</p>;
  return (
    <RefTable
      caption={t("state.hypotheses")}
      columns={[t("up.state.claim"), t("review.errNextTest"), t("review.errStop")]}
      rows={state.hypotheses.map((h) => [h.claim, h.next_test ?? "", h.stop_condition ?? ""])}
    />
  );
}

/** The state's cycle: a link to it, and a new cycle once this one delivers. */
export function CycleLinks({ cycle, busy }: { cycle: StateDetail["cycle"]; busy: boolean }) {
  const { t } = useTranslation("loop");
  if (!cycle) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Link to={`/loop/cycle/${cycle.id}`}>{t("state.openCycle")}</Link>
      {cycle.phase === "deliver" ? (
        <Form method="post">
          <input type="hidden" name="intent" value="newCycle" />
          <Button type="submit" variant="outline" size="sm" disabled={busy}>
            {t("state.newCycle")}
          </Button>
        </Form>
      ) : null}
    </div>
  );
}

export function ChainList({ chains, busy }: { chains: StateDetail["chains"]; busy: boolean }) {
  const { t } = useTranslation("loop");
  return (
    <>
      {chains.length > 0 ? (
        <ul>
          {chains.map((c) => (
            <li key={c.id}>
              <Link to={`/loop/evidence/${c.id}`}>{c.question}</Link>
            </li>
          ))}
        </ul>
      ) : null}
      <NewForm intent="newChain" name="question" label={t("chain.question")} submit={t("chain.new")} busy={busy} />
    </>
  );
}

export function BriefList({ briefs, busy }: { briefs: StateDetail["briefs"]; busy: boolean }) {
  const { t } = useTranslation("loop");
  return (
    <>
      {briefs.length > 0 ? (
        <ul>
          {briefs.map((b) => (
            <li key={b.id}>
              <Link to={`/loop/brief/${b.id}`}>{b.task}</Link>
            </li>
          ))}
        </ul>
      ) : null}
      <NewForm intent="newBrief" name="task" label={t("brief.task")} submit={t("brief.new")} busy={busy} />
    </>
  );
}
