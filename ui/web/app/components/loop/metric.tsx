/**
 * metric.tsx
 * The ONLY way the learning loop shows a number.
 *
 * A score, a gate tally or a reading is a claim, and the method this product
 * borrows is explicit that a claim travels with what it cannot show. So a
 * Metric cannot be rendered without its CannotProve note: the prop is
 * required by the type, and app/test/loop-cannot-prove.test.ts fails if a loop
 * file shows a number any other way, or passes an empty note.
 */
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";

export function CannotProve({ children, className }: { children: string; className?: string }) {
  const { t } = useTranslation("loop");
  return (
    <p className={cn("text-xs leading-snug text-muted-foreground", className)}>
      <span className="font-mono text-2xs font-semibold uppercase tracking-wide text-faint">
        {t("cannotProve.label")}
      </span>{" "}
      {children}
    </p>
  );
}

export function Metric({
  label,
  value,
  cannotProve,
  className,
}: {
  label: string;
  value: string;
  cannotProve: string;
  className?: string;
}) {
  return (
    <div className={cn("border-b py-3", className)} data-metric="">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm">{label}</span>
        <span className="font-mono text-sm font-semibold tabular-nums">{value}</span>
      </div>
      <CannotProve className="mt-1">{cannotProve}</CannotProve>
    </div>
  );
}
