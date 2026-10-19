import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { Readiness } from "~/lib/byok.types";
import { rowReason } from "~/lib/readiness-text";

/**
 * The readiness card on Home: what cannot run yet, in plain words, and one
 * button to fix it (plan 261019-1317, phase 3).
 *
 * It reports only the functions nothing else works without, because a user who
 * has not routed `rerank` is not blocked in any sense they would recognise, and
 * a card about something invisible teaches people to ignore it. WHICH functions
 * those are comes from the API (`core_functions`) rather than a list here.
 *
 * It says nothing when everything core is green: the full matrix, with its
 * statuses and chain order, lives in Settings → Routes beside the controls that
 * change it. Before this card, Home opened on "Readiness · BLOCKED", which read
 * as an error to someone who had simply not finished setting up.
 */
export function ReadinessCard({ readiness }: { readiness: Readiness | null }) {
  const { t } = useTranslation("common");

  if (!readiness) {
    // The API was unreachable. Saying so beats rendering nothing, which a
    // learner would read as "all is well".
    return (
      <section aria-labelledby="lp-readiness" className="mt-8 rounded-lg border bg-card p-5">
        <h2 id="lp-readiness" className="lp-section">
          {t("home.attention.unknownTitle")}
        </h2>
        <p className="mt-2 text-sm leading-prose text-muted-foreground">{t("settings.readiness.unavailable")}</p>
      </section>
    );
  }
  if (readiness.core === "green") return null;

  const rows = readiness.functions.filter(
    (row) => readiness.core_functions.includes(row.function) && row.status !== "green",
  );
  const blocked = readiness.core === "blocked";
  // A missing route is chosen on the Routes page; anything else (a rejected or
  // unverified key) is a connection's, on the first Settings page.
  const to = rows.some((r) => r.reason_code === "no_route") ? "/settings/routes" : "/settings";

  return (
    <section aria-labelledby="lp-readiness" className="mt-8 rounded-lg border bg-card p-5">
      <h2 id="lp-readiness" className="lp-section">
        {blocked ? t("home.attention.blockedTitle") : t("home.attention.warnTitle")}
      </h2>
      <p className="mt-2 text-sm leading-prose text-muted-foreground">
        {blocked ? t("home.attention.blockedBody") : t("home.attention.warnBody")}
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map((row) => (
          <li key={row.function} className="text-sm">
            <span className="font-sans font-medium text-foreground">
              {t(`settings.functions.${row.function}` as never, { defaultValue: row.function })}
            </span>
            <span className="block text-muted-foreground">{rowReason(t, row)}</span>
          </li>
        ))}
      </ul>
      <Button asChild size="sm" className="mt-4">
        <Link to={to}>{t("home.attention.go")}</Link>
      </Button>
    </section>
  );
}
