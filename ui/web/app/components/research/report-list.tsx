import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { PlateEmpty } from "~/components/ui/plate";
import { DateText } from "~/components/ui/date-text";
import { DocSection } from "~/components/research/doc-section";
import { kbOnlyReasonKey, type ReportSummary } from "~/lib/research-types";
import { NOTE_JOIN } from "~/lib/sentence";

/** A KB-only marker: the words, not just a tint, with the reason as its title. */
export function KBOnlyBadge({ reason }: { reason?: string }) {
  const { t } = useTranslation("research");
  return (
    // The Badge pattern's own markup (I6), because the reason rides on the
    // badge itself as its title and Badge takes no title.
    <span className="lp-badge" data-type="info" title={t(kbOnlyReasonKey(reason))}>
      {t("kbOnly.badge")}
    </span>
  );
}

/**
 * Earlier reports, newest first, as up's dated list (P4): **date** · the
 * question as a link — depth, how many sources, and KB-only when it was.
 */
export function ReportList({ reports }: { reports: ReportSummary[] }) {
  const { t } = useTranslation("research");

  return (
    <DocSection title={t("list.title")} id="lp-research-list">
      {reports.length === 0 ? (
        <PlateEmpty name="part-ask" className="mt-3">
          {t("list.empty")}
        </PlateEmpty>
      ) : (
        <ul className="lp-dated-list">
          {reports.map((r) => (
            <li key={r.id}>
              <strong>
                <DateText iso={r.created_at} />
              </strong>
              {" · "}
              <Link to={`/research/${r.id}`} className="font-medium text-primary hover:underline">
                {r.query}
              </Link>
              {NOTE_JOIN}
              <span className="text-muted-foreground">
                {t(`form.${r.mode}`)} · {r.sources} {t("list.sources")}
              </span>
              {r.kb_only ? (
                <>
                  {" "}
                  <KBOnlyBadge reason={r.kb_only_reason} />
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </DocSection>
  );
}
