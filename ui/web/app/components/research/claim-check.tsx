import { useTranslation } from "react-i18next";
import { StatusPill } from "~/components/settings/readiness-matrix";
import { CitationChip } from "~/components/chat/citation-chip";
import type { Source } from "~/hooks/use-turn-stream";
import type { Claim, Verification } from "~/lib/research-types";
import type { ReadinessStatus } from "~/lib/byok.types";

/**
 * The report's claim check: how many of its claims the cited sources support,
 * and — first, because they are what a learner must not study unchecked — the
 * ones that are only partly supported, not in their source, or uncited.
 *
 * The caveat is part of the component, not optional copy: the check is an AI
 * reading the cited text, so "supported" means "found in the source", never
 * "true". Verdicts use StatusPill, so they carry a word and a shape as well as
 * a tint.
 */
const VERDICT_STATUS: Record<Claim["verdict"], ReadinessStatus> = {
  supported: "green",
  partial: "warn",
  uncited: "warn",
  unsupported: "blocked",
};

export function ClaimCheck({ check, sources }: { check: Verification; sources: Source[] }) {
  const { t } = useTranslation("research");

  if (check.status !== "checked") {
    return (
      <section aria-labelledby="lp-claim-check" className="rounded-lg border bg-card p-4">
        <h2 id="lp-claim-check" className="lp-section">
          {t("check.title")}
        </h2>
        <p className="mt-2 text-sm leading-prose text-muted-foreground">{t("check.unavailable")}</p>
      </section>
    );
  }

  const flagged = check.claims.filter((c) => c.verdict !== "supported");
  const order = new Map(sources.map((s, i) => [`${s.kind}:${s.id}`, i + 1]));
  const byKey = new Map(sources.map((s) => [`${s.kind}:${s.id}`, s]));

  const row = (claim: Claim, i: number) => (
    <li key={i} className="border-t py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={VERDICT_STATUS[claim.verdict]} label={t(`check.verdict.${claim.verdict}`)} />
        {claim.cites.map((key) => {
          const source = byKey.get(key);
          return source ? <CitationChip key={key} source={source} index={order.get(key) ?? 0} /> : null;
        })}
      </div>
      <p className="mt-1.5 text-sm leading-prose">{claim.claim}</p>
      {claim.note ? <p className="mt-1 text-xs leading-prose text-muted-foreground">{claim.note}</p> : null}
    </li>
  );

  return (
    <section aria-labelledby="lp-claim-check" className="rounded-lg border bg-card p-4">
      <h2 id="lp-claim-check" className="lp-section">
        {t("check.title")}
      </h2>
      <p className="mt-2 text-sm font-medium">
        {flagged.length === 0
          ? t("check.allSupported")
          : t("check.summary", { supported: check.supported, total: check.total })}
      </p>
      <p className="mt-1 text-xs leading-prose text-muted-foreground">{t("check.caveat")}</p>

      {flagged.length > 0 && (
        <>
          <h3 className="mt-4 text-sm font-medium">{t("check.needsChecking")}</h3>
          <ul className="mt-1">{flagged.map(row)}</ul>
        </>
      )}

      {check.claims.length > flagged.length && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-primary underline-offset-4 hover:underline">
            {t("check.all", { count: check.total })}
          </summary>
          <ul className="mt-1">{check.claims.map(row)}</ul>
        </details>
      )}
    </section>
  );
}
