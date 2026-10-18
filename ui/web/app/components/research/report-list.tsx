import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { kbOnlyReasonKey, type ReportSummary } from "~/lib/research-types";

/** A KB-only marker: the words, not just a tint, with the reason as its title. */
export function KBOnlyBadge({ reason }: { reason?: string }) {
  const { t } = useTranslation("research");
  return (
    <span
      title={t(kbOnlyReasonKey(reason))}
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium text-muted-foreground"
    >
      {t("kbOnly.badge")}
    </span>
  );
}

/** Earlier reports, newest first. Each opens the stored report. */
export function ReportList({ reports }: { reports: ReportSummary[] }) {
  const { t } = useTranslation("research");

  return (
    <section aria-labelledby="lp-research-list" className="mt-12">
      <h2 id="lp-research-list" className="lp-section">
        {t("list.title")}
      </h2>
      {reports.length === 0 ? (
        <p className="mt-2 lp-empty">{t("list.empty")}</p>
      ) : (
        <ul className="mt-3 divide-y rounded-lg border bg-card">
          {reports.map((r) => (
            <li key={r.id}>
              <Link
                to={`/research/${r.id}`}
                className="flex min-h-11 flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 hover:bg-primary-soft"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.query}</span>
                <span className="text-xs text-muted-foreground">
                  {t(`form.${r.mode}`)} · {r.sources} {t("list.sources")}
                </span>
                {r.kb_only && <KBOnlyBadge reason={r.kb_only_reason} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
