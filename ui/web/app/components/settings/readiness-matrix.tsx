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
import { useTranslation } from "react-i18next";
import { entryNote, rowReason } from "~/lib/readiness-text";
import { Badge } from "~/components/doc/badge";
import { RefTable } from "~/components/doc/ref-table";
import type { FunctionReadiness, ReadinessStatus } from "~/lib/byok.types";
import { providerName } from "~/lib/provider-names";

/** A shape as well as a tint, so the state is legible without colour. */
const STATUS_MARK: Record<ReadinessStatus, string> = {
  green: "●",
  warn: "▲",
  blocked: "■",
};

export function StatusPill({ status, label }: { status: ReadinessStatus; label: string }) {
  return (
    <Badge type={status === "green" ? "tip" : status === "warn" ? "warning" : "danger"}>
      <span aria-hidden="true">{STATUS_MARK[status]}</span> {label}
    </Badge>
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
    <RefTable
      caption={t("settings.up.readiness")}
      columns={[t("settings.up.task"), t("settings.up.route"), t("settings.up.status")]}
      rows={functions.map((row) => [
        <>
          {t(`settings.functions.${row.function}` as never, { defaultValue: row.function })}
          {optional.includes(row.function) ? (
            <span className="ml-2 text-xs text-muted-foreground">{t("readinessExtra.optional")}</span>
          ) : null}
        </>,
        <>
          {row.reason ? <p>{rowReason(t, row)}</p> : null}
          <ol>
            {row.entries.map((entry) => (
              <li key={`${entry.provider}:${entry.connection_id}`}>
                <span>{entry.name || providerName(t, entry.provider)}</span> <span className="font-mono text-xs">{entry.model}</span>
                {entry.note ? <span> {entryNote(t, row, entry)}</span> : null}
              </li>
            ))}
          </ol>
        </>,
        <StatusPill status={row.status} label={statusLabel(row.status)} />,
      ])}
    />
  );
}
