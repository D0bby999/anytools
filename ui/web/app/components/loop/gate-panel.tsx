/**
 * gate-panel.tsx
 * A cycle's three phases as one hairline timeline, and the gate out of the
 * current one: what it needs, what is missing, and what even an open gate
 * would not prove. The advance button posts to the page's own action; the
 * server decides, and a shut gate answers with the same reasons shown here.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import { PHASES, type GateResult, type Phase } from "~/lib/loop-types";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
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
      <ol className="grid grid-cols-3 border-t" aria-label={t("gate.timeline")}>
        {PHASES.map((p, i) => (
          <li
            key={p}
            aria-current={i === current ? "step" : undefined}
            className={cn(
              "border-b border-t-2 py-2 pr-2 text-sm",
              i < current && "border-t-border text-muted-foreground",
              i === current && "border-t-accent font-medium",
              i > current && "border-t-transparent text-faint",
            )}
          >
            <span className="font-mono text-2xs uppercase tracking-wide">{String(i + 1).padStart(2, "0")}</span>{" "}
            {phaseLabel[p]}
          </li>
        ))}
      </ol>

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
          <h3 className="text-sm font-medium">{t("gate.missing")}</h3>
          <ul className="mt-1 list-disc pl-5 text-sm leading-prose">
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
