import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Source } from "~/hooks/use-turn-stream";
import { CitedBody } from "~/components/research/cited-body";
import { KBOnlyBadge } from "~/components/research/report-list";
import { kbOnlyReasonKey, type Verification } from "~/lib/research-types";

/**
 * The report as it streams, with the turn's own notes above it ("no web search
 * key is connected…") and, once it is stored, a link to the saved report.
 */
export function LiveReport({
  text,
  sources,
  streaming,
  observations,
  meta,
}: {
  text: string;
  sources: Source[];
  streaming: boolean;
  observations: string[];
  meta: Record<string, unknown> | null;
}) {
  const { t } = useTranslation("research");
  const reportId = typeof meta?.report_id === "string" ? meta.report_id : null;
  const kbOnly = meta?.kb_only === true;
  const reason = typeof meta?.kb_only_reason === "string" ? meta.kb_only_reason : "";
  const check = meta?.verification as Verification | undefined;

  return (
    <section aria-labelledby="lp-research-live" className="mt-10">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="lp-research-live" className="lp-section">
          {t("report.live")}
        </h2>
        {kbOnly && <KBOnlyBadge reason={reason} />}
      </div>

      {observations.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1" aria-live="polite">
          {observations.map((note, i) => (
            <li key={i} className="rounded-(--lp-radius-control) bg-sunken px-3 py-2 text-sm leading-snug">
              {note}
            </li>
          ))}
        </ul>
      )}
      {kbOnly && (
        <p className="mt-2 text-sm text-muted-foreground">{t(kbOnlyReasonKey(reason))}</p>
      )}

      {text !== "" && (
        <div className="mt-4">
          <CitedBody text={text} sources={sources} streaming={streaming} />
        </div>
      )}

      {reportId && !streaming && (
        <p className="mt-6 text-sm">
          {check?.status === "checked" && check.total > 0 && (
            <span className="mr-2">
              {check.supported === check.total
                ? t("check.allSupported")
                : t("check.summary", { supported: check.supported, total: check.total })}
            </span>
          )}
          <Link to={`/research/${reportId}`} className="text-primary underline underline-offset-4">
            {t("report.open")}
          </Link>
        </p>
      )}
    </section>
  );
}
