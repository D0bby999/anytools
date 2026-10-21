import { useTranslation } from "react-i18next";
import { CitationChip } from "~/components/chat/citation-chip";
import { Badge, type BadgeType } from "~/components/doc/badge";
import { RefTable } from "~/components/doc/ref-table";
import { DocSection } from "~/components/research/doc-section";
import type { Source } from "~/hooks/use-turn-stream";
import type { Claim, Verification } from "~/lib/research-types";

/**
 * The report's claim check: how many of its claims the cited sources support,
 * and — first, because they are what a learner must not study unchecked — the
 * ones that are only partly supported, not in their source, or uncited.
 *
 * The caveat is part of the component, not optional copy: the check is an AI
 * reading the cited text, so "supported" means "found in the source", never
 * "true". Since the up shell the claims are a reference table (P5): the claim,
 * its sources as numbered entries, and the verdict as a badge (I6), which
 * carries a word as well as a tint.
 */
const VERDICT_BADGE: Record<Claim["verdict"], BadgeType> = {
  supported: "tip",
  partial: "warning",
  uncited: "warning",
  unsupported: "danger",
};

export function ClaimCheck({ check, sources }: { check: Verification; sources: Source[] }) {
  const { t } = useTranslation("research");

  if (check.status !== "checked") {
    return (
      <DocSection title={t("check.title")} id="lp-claim-check">
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("check.unavailable")}</p>
      </DocSection>
    );
  }

  const flagged = check.claims.filter((c) => c.verdict !== "supported");
  const order = new Map(sources.map((s, i) => [`${s.kind}:${s.id}`, i + 1]));
  const byKey = new Map(sources.map((s) => [`${s.kind}:${s.id}`, s]));

  const table = (claims: Claim[], caption: string) => (
    <div className="my-4">
      <RefTable
        caption={caption}
        rowHeaders={false}
        columns={[t("check.columns.claim"), t("check.columns.source"), t("check.columns.verdict")]}
        rows={claims.map((claim) => [
          <>
            {claim.claim}
            {claim.note ? <span className="mt-1 block text-[13px] leading-5 text-muted-foreground">{claim.note}</span> : null}
          </>,
          <span className="flex flex-col gap-1">
            {claim.cites.map((key) => {
              const source = byKey.get(key);
              return source ? (
                <CitationChip key={key} source={source} index={order.get(key) ?? 0} variant="entry" />
              ) : null;
            })}
          </span>,
          <Badge type={VERDICT_BADGE[claim.verdict]}>{t(`check.verdict.${claim.verdict}`)}</Badge>,
        ])}
      />
    </div>
  );

  return (
    <DocSection title={t("check.title")} id="lp-claim-check">
      <p className="mt-4 text-sm leading-6 font-medium">
        {flagged.length === 0
          ? t("check.allSupported")
          : t("check.summary", { supported: check.supported, total: check.total })}
      </p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("check.caveat")}</p>

      {flagged.length > 0 && (
        <>
          <h3 className="mt-6 text-base leading-7 font-semibold">{t("check.needsChecking")}</h3>
          {table(flagged, `${t("check.title")}: ${t("check.needsChecking")}`)}
        </>
      )}

      {check.claims.length > flagged.length && (
        <details className="lp-details">
          <summary>{t("check.all", { count: check.total })}</summary>
          {table(check.claims, `${t("check.title")}: ${t("check.all", { count: check.total })}`)}
        </details>
      )}
    </DocSection>
  );
}
