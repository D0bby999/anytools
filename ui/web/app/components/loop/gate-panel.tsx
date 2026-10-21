/**
 * gate-panel.tsx
 * A cycle's three phases as a table (plan 261020-2246 phase 12), and the gate out of the
 * current one: what it needs, what is missing, and what even an open gate
 * would not prove. The advance button posts to the page's own action; the
 * server decides, and a shut gate answers with the same reasons shown here.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import { PHASES, type GateResult, type Phase } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/doc/badge";
import { RefTable } from "~/components/doc/ref-table";
import { CannotProve, Metric } from "~/components/loop/metric";

export function usePhaseLabels(): Record<Phase, string> {
  const { t } = useTranslation("loop");
  return { calibrate: t("phase.calibrate"), stack: t("phase.stack"), deliver: t("phase.deliver") };
}

export function GatePanel({
  cycleId,
  phase,
  gate,
  busy,
}: {
  cycleId: string;
  phase: Phase;
  gate: GateResult;
  busy?: boolean;
}) {
  const { t } = useTranslation("loop");
  const phaseLabel = usePhaseLabels();
  const reqLabel: Record<string, string> = {
    baseline: t("gate.req.baseline"),
    weekly_reviews: t("gate.req.weeklyReviews"),
    delayed: t("gate.req.delayed"),
    transfer: t("gate.req.transfer"),
  };
  const current = PHASES.indexOf(phase);

  return (
    <div>
      {/* The three phases as a table, as up's 90-day map draws them: each
          phase's gate open or shut, the current one marked "now". */}
      <RefTable
        caption={t("gate.timeline")}
        columns={[
          t("up.gate.phase"),
          ...PHASES.map((p, i) => (
            <span key={p} aria-current={i === current ? "step" : undefined}>
              {i + 1}. {phaseLabel[p]}
              {i === current ? <span className="font-normal text-muted-foreground"> · {t("up.gate.now")}</span> : null}
            </span>
          )),
        ]}
        rows={[
          [
            t("up.gate.gate"),
            ...PHASES.map((p, i) =>
              i < current ? (
                <Badge key={p} type="tip">{t("up.gate.open")}</Badge>
              ) : i === current && gate.final ? (
                <Badge key={p}>{t("up.gate.final")}</Badge>
              ) : i === current && gate.open ? (
                <Badge key={p} type="tip">{t("up.gate.open")}</Badge>
              ) : (
                <Badge key={p} type={i === current ? "warning" : "info"}>
                  {t("up.gate.shut")}
                </Badge>
              ),
            ),
          ],
        ]}
      />

      {gate.final ? (
        <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("gate.final")}</p>
      ) : (
        <div className="mt-3">
          {(gate.progress ?? []).map((p) => (
            <Metric
              key={p.requirement}
              label={reqLabel[p.requirement] ?? p.requirement}
              value={`${Math.min(p.have, p.need)}/${p.need}`}
              cannotProve={gate.cannot_prove[0] ?? t("cannotProve.fallback")}
            />
          ))}
        </div>
      )}

      {gate.missing.length > 0 && !gate.final ? (
        <div className="mt-3">
          <h3>{t("gate.missing")}</h3>
          <ul className="space-y-1">
            {gate.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {gate.final ? <CannotProve className="mt-2">{gate.cannot_prove[0] ?? ""}</CannotProve> : null}

      {!gate.final ? (
        <Form method="post" className="mt-4">
          <input type="hidden" name="intent" value="advance" />
          <input type="hidden" name="cycle_id" value={cycleId} />
          <Button type="submit" variant={gate.open ? "default" : "outline"} disabled={busy}>
            {gate.open ? t("gate.advance", { to: phaseLabel[gate.to as Phase] ?? gate.to }) : t("gate.tryAdvance")}
          </Button>
        </Form>
      ) : null}
    </div>
  );
}
