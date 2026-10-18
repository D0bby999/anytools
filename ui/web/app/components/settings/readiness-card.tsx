import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { StatusPill } from "~/components/settings/readiness-matrix";
import type { Readiness } from "~/lib/byok.types";

/**
 * The readiness card on Home.
 *
 * It reports only the functions nothing else works without, because a user who
 * has not routed `rerank` is not blocked in any sense they would recognise, and
 * a card that says "blocked" about something invisible teaches people to ignore
 * it. WHICH functions those are comes from the API (`core_functions`) rather
 * than a list here: the Go side already has to know, and a second copy in the
 * client is a copy that drifts.
 *
 * It is a summary with a link, not a second copy of the matrix — that lives in
 * Settings → Routes, beside the controls that change it.
 */

export function ReadinessCard({ readiness }: { readiness: Readiness | null }) {
  const { t } = useTranslation("common");

  if (!readiness) {
    // The API was unreachable. Saying so beats rendering a green card built
    // from an absence of bad news.
    return (
      <section aria-labelledby="lp-readiness" className="mt-8 rounded-lg border bg-card p-5">
        <h2 id="lp-readiness" className="lp-section">
          {t("settings.readiness.title")}
        </h2>
        <p className="mt-2 text-sm leading-prose text-muted-foreground">
          {t("settings.readiness.unavailable")}
        </p>
      </section>
    );
  }

  const core = readiness.functions.filter((row) => readiness.core_functions.includes(row.function));
  const statusLabel =
    readiness.core === "green"
      ? t("settings.readiness.ready")
      : readiness.core === "warn"
        ? t("settings.readiness.attention")
        : t("settings.readiness.blocked");

  return (
    <section aria-labelledby="lp-readiness" className="mt-8 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="lp-readiness" className="lp-section">
          {t("settings.readiness.title")}
        </h2>
        <StatusPill status={readiness.core} label={statusLabel} />
      </div>

      <p className="mt-2 text-sm leading-prose text-muted-foreground">
        {readiness.core === "green"
          ? t("settings.readiness.allReady")
          : t("settings.readiness.notReady")}
      </p>

      <ul className="mt-3 space-y-1">
        {core.map((row) => (
          <li key={row.function} className="flex flex-wrap items-baseline gap-2 text-sm">
            <span className="w-32 shrink-0 font-sans font-medium text-foreground">
              {t(`settings.functions.${row.function}` as never, { defaultValue: row.function })}
            </span>
            <span className="text-muted-foreground">
              {row.status === "green" ? t("settings.readiness.ready") : row.reason}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-sm">
        <Link to="/settings" className="text-primary underline underline-offset-2">
          {t("settings.readiness.manage")}
        </Link>
      </p>
    </section>
  );
}
