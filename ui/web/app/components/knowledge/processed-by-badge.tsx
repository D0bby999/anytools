import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import type { ProcessedBy } from "~/lib/kb-types";

/**
 * processed-by-badge.tsx
 *
 * Says which model actually read a document.
 *
 * This is not decoration. Red-team RT-14 found that a BYOK chain silently
 * re-sends a document to the next provider when the first one rate-limits, and
 * that the user is never told — their file went to an account they did not
 * choose. The badge is the place that is no longer true: the lane is named, and
 * a downgrade is marked with the world's "needs your attention" ink rather than
 * being folded into the same grey as everything else.
 */
export function ProcessedByBadge({ processedBy }: { processedBy?: ProcessedBy | null }) {
  const { t } = useTranslation("knowledge");

  const parser = processedBy?.parser;
  if (!parser) {
    return <span className="text-xs text-faint">{t("processedBy.none")}</span>;
  }

  const downgraded = processedBy?.downgraded === true;
  // A local lane is stated as such rather than dressed up as a model: "read by
  // the local text extractor" is the honest description of a document whose
  // tables were flattened, and the user needs it to explain a bad answer.
  const label = processedBy?.model ? `${parser} · ${processedBy.model}` : parser;

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 font-mono text-2xs",
          downgraded ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground",
        )}
      >
        {label}
      </span>
      {downgraded && (
        <span className="text-2xs text-warning" title={processedBy?.note ?? undefined}>
          {t("processedBy.downgraded")}
        </span>
      )}
    </span>
  );
}
