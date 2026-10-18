import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import type { FunctionReadiness, ReadinessStatus } from "~/lib/byok.types";
import { providerName } from "~/lib/provider-names";

/**
 * The readiness matrix: one row per capability, saying whether it will run and,
 * when it will not, the one sentence that fixes it.
 *
 * Status is never carried by colour alone. Each row has a word ("Ready",
 * "Needs attention", "Blocked") and a shape, so the matrix survives a
 * colour-blind read and a forced high-contrast mode — DESIGN.md's anti-pattern
 * list names colour-only meaning explicitly.
 *
 * Amber is `--lp-warning`, which had no consumer until this component: it is
 * "needs your attention" and deliberately not red, because a resting connection
 * is not a broken one.
 */

const STATUS_CLASS: Record<ReadinessStatus, string> = {
  green: "bg-primary-soft text-primary",
  warn: "bg-warning-soft text-warning",
  blocked: "bg-destructive-soft text-destructive",
};

/** A shape as well as a tint, so the state is legible without colour. */
const STATUS_MARK: Record<ReadinessStatus, string> = {
  green: "●",
  warn: "▲",
  blocked: "■",
};

export function StatusPill({ status, label }: { status: ReadinessStatus; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-2xs font-semibold uppercase tracking-label",
        STATUS_CLASS[status],
      )}
    >
      <span aria-hidden="true">{STATUS_MARK[status]}</span>
      {label}
    </span>
  );
}

export function ReadinessMatrix({
  functions,
  optional = [],
}: {
  functions: FunctionReadiness[];
  /** Functions that may stay unrouted; their row says so (up-methods phase 21). */
  optional?: string[];
}) {
  const { t } = useTranslation("common");

  const statusLabel = (status: ReadinessStatus) =>
    status === "green"
      ? t("settings.readiness.ready")
      : status === "warn"
        ? t("settings.readiness.attention")
        : t("settings.readiness.blocked");

  return (
    // Hairline rows, not a grid of cards: these are one list of one kind of
    // thing, and nine identical cards would read as nine products.
    <ul className="border-t">
      {functions.map((row) => (
        <li key={row.function} className="border-b py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-sans text-base font-medium">
              {t(`settings.functions.${row.function}` as never, { defaultValue: row.function })}
              {optional.includes(row.function) ? (
                <span className="ml-2 font-mono text-2xs font-semibold uppercase tracking-label text-faint">
                  {t("readinessExtra.optional")}
                </span>
              ) : null}
            </h3>
            <StatusPill status={row.status} label={statusLabel(row.status)} />
          </div>

          {row.reason ? (
            <p className="mt-1 text-sm leading-prose text-muted-foreground">{row.reason}</p>
          ) : null}

          {row.entries.length > 0 ? (
            <ol className="mt-2 space-y-1">
              {row.entries.map((entry, index) => (
                <li key={`${entry.provider}:${entry.connection_id}`} className="flex flex-wrap items-baseline gap-2 text-sm">
                  {/* The position is real information here: it is the order the
                      chain will try them in. */}
                  <span aria-hidden="true" className="font-mono text-2xs tabular-nums text-faint">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="text-foreground">{entry.name || providerName(t, entry.provider)}</span>
                  {entry.model ? (
                    <span className="font-mono text-xs text-faint">{entry.model}</span>
                  ) : null}
                  {entry.note ? (
                    <span className="text-muted-foreground">{entry.note}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
