/**
 * timepoint-select.tsx
 * One select for the four timepoints, shared by the review and chain pages so
 * the labels cannot differ between them.
 */
import { useTranslation } from "react-i18next";
import { TIMEPOINTS, type Timepoint } from "~/lib/loop-types";

export function useTimepointLabels(): Record<Timepoint, string> {
  const { t } = useTranslation("loop");
  return {
    baseline: t("timepoint.baseline"),
    immediate: t("timepoint.immediate"),
    delayed: t("timepoint.delayed"),
    transfer: t("timepoint.transfer"),
  };
}

export function TimepointSelect({
  name,
  defaultValue,
  allowNone,
  label,
}: {
  name: string;
  defaultValue?: string;
  allowNone?: boolean;
  label: string;
}) {
  const { t } = useTranslation("loop");
  const labels = useTimepointLabels();
  return (
    <select
      name={name}
      aria-label={label}
      defaultValue={defaultValue ?? ""}
      className="min-h-11 rounded-md border border-control-border bg-card px-2 text-sm"
    >
      {allowNone ? <option value="">{t("timepoint.none")}</option> : null}
      {TIMEPOINTS.map((tp) => (
        <option key={tp} value={tp}>
          {labels[tp]}
        </option>
      ))}
    </select>
  );
}
