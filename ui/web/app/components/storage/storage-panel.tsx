/**
 * storage-panel.tsx
 * Settings → Storage (drive-user-storage phase 2): where the learner's own
 * files are kept, the space they take on each side, and the move of the
 * files from before.
 *
 * Every control is a form post, so the page works before hydration; what it
 * shows is the loader's, so it says what the API stored. While a move runs
 * the page revalidates every few seconds to show its progress.
 */
import { useEffect } from "react";
import { Form, Link, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { formatBytes, moveRunning, type FileStorage, type StorageStatus } from "~/lib/storage-types";

export type StorageActionData = {
  intent: "choose" | "move" | "cancel";
  ok?: boolean;
  nothing?: boolean;
  errorKey?: string;
};

/** How often a running move's progress is read again. */
export const MOVE_POLL_MS = 3000;

function driveBlocker(status: StorageStatus): string | null {
  if (!status.drive.configured) return "drive.unavailable";
  if (status.drive.reason === "drive_reconnect") return "drive.reconnect";
  if (!status.drive.ready) return "drive.notConnected";
  return null;
}

export function StoragePanel({
  status,
  pending,
  result,
}: {
  status: StorageStatus;
  pending: boolean;
  result?: StorageActionData;
}) {
  const { t } = useTranslation("storage");
  const revalidator = useRevalidator();
  const running = moveRunning(status.move);
  const blocker = driveBlocker(status);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, MOVE_POLL_MS);
    return () => clearInterval(timer);
  }, [running, revalidator]);

  const options: { value: FileStorage; label: string; hint: string; disabled: boolean }[] = [
    { value: "server", label: t("choice.server"), hint: t("choice.serverHint"), disabled: false },
    // A learner already on Drive can always move back to the server; only
    // turning Drive on needs a connection that works.
    { value: "drive", label: t("choice.drive"), hint: t("choice.driveHint"), disabled: blocker !== null && status.storage !== "drive" },
  ];

  return (
    <div className="mt-8 space-y-10">
      <section aria-labelledby="lp-storage-where">
        <h2 id="lp-storage-where" className="lp-section">
          {t("title")}
        </h2>
        <p className="mt-3 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">{t("lead")}</p>
        <p className="mt-3 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">{t("stays")}</p>

        <Form method="post" className="mt-5 space-y-4">
          <input type="hidden" name="intent" value="choose" />
          <fieldset disabled={pending || running}>
            <legend className="text-sm font-medium">{t("choice.legend")}</legend>
            <div className="mt-2 border-t">
              {options.map((o) => (
                <label
                  key={o.value}
                  className="flex min-h-11 cursor-pointer items-start gap-3 border-b py-3 has-disabled:cursor-not-allowed has-disabled:opacity-50"
                >
                  <input
                    type="radio"
                    name="storage"
                    value={o.value}
                    defaultChecked={status.storage === o.value}
                    disabled={o.disabled}
                    className="mt-1 size-4 accent-primary"
                  />
                  <span>
                    <span className="block text-sm font-medium">
                      {o.label}
                      {status.storage === o.value ? (
                        <span className="text-xs font-semibold ml-2 text-muted-foreground">{t("choice.current")}</span>
                      ) : null}
                    </span>
                    <span className="block text-sm text-muted-foreground">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {blocker ? (
            <p className="text-sm leading-snug text-muted-foreground">
              {t(blocker)}{" "}
              {status.drive.configured ? (
                <Link to="/settings" className="text-primary underline underline-offset-4">
                  {t("drive.connect")}
                </Link>
              ) : null}
            </p>
          ) : null}
          <Button type="submit" variant="outline" disabled={pending || running}>
            {t("choice.save")}
          </Button>
        </Form>
        {result?.intent === "choose" && result.ok ? (
          <p role="status" className="mt-3 text-sm leading-snug">
            {t("choice.saved")}
          </p>
        ) : null}
        {result?.intent === "choose" && result.errorKey ? (
          <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
            {t(result.errorKey)}
          </p>
        ) : null}
      </section>

      {status.drive.configured ? <Usage status={status} /> : null}
      {status.drive.configured ? <Move status={status} pending={pending} result={result} /> : null}
    </div>
  );
}

function Usage({ status }: { status: StorageStatus }) {
  const { t } = useTranslation("storage");
  const u = status.usage;
  return (
    <section aria-labelledby="lp-storage-usage" className="border-t pt-6">
      <h2 id="lp-storage-usage" className="lp-section">
        {t("usage.title")}
      </h2>
      <dl className="mt-3 border-t text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b py-3">
          <dt className="text-muted-foreground">{t("usage.server")}</dt>
          <dd className="font-mono tabular-nums">{t("usage.files", { count: u.server_files, size: formatBytes(u.server_bytes) })}</dd>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b py-3">
          <dt className="text-muted-foreground">{t("usage.drive")}</dt>
          <dd className="font-mono tabular-nums">{t("usage.files", { count: u.drive_files, size: formatBytes(u.drive_bytes) })}</dd>
        </div>
      </dl>
      {u.drive_missing > 0 ? (
        <p className="mt-3 text-sm leading-snug text-muted-foreground">{t("usage.missing", { count: u.drive_missing })}</p>
      ) : null}
    </section>
  );
}

function Move({ status, pending, result }: { status: StorageStatus; pending: boolean; result?: StorageActionData }) {
  const { t } = useTranslation("storage");
  const m = status.move;
  const running = moveRunning(m);
  const toDrive = status.storage === "drive";
  const waiting = toDrive ? status.usage.server_files : status.usage.drive_files;
  const canMove = !running && waiting > 0 && status.drive.ready;
  const percent = m && m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;

  return (
    <section aria-labelledby="lp-storage-move" className="border-t pt-6">
      <h2 id="lp-storage-move" className="lp-section">
        {t("move.title")}
      </h2>
      <p className="mt-3 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">{t("move.body")}</p>

      {m ? (
        <div className="mt-4 space-y-2">
          <p role="status" className="text-sm leading-snug">
            {m.status === "failed" ? t(m.error === "drive_full" || m.error === "drive_reconnect" ? `move.${m.error}` : "move.failed") : null}
            {m.status === "cancelled" ? t("move.cancelled") : null}
            {m.status === "done" ? t("move.done") : null}
            {m.status === "queued" ? t("move.queued") : null}
            {m.status === "running" ? t("move.running") : null}
          </p>
          <p className="font-mono text-sm tabular-nums">
            {t("move.progress", {
              done: m.done,
              total: m.total,
              doneSize: formatBytes(m.done_bytes),
              totalSize: formatBytes(m.total_bytes),
            })}
          </p>
          {running ? (
            <div
              role="progressbar"
              aria-label={t("move.running")}
              aria-valuemin={0}
              aria-valuemax={m.total}
              aria-valuenow={m.done}
              className="h-1.5 w-full max-w-sm overflow-hidden rounded-full border border-control-border bg-sunken"
            >
              <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
            </div>
          ) : null}
        </div>
      ) : null}

      {!running && waiting > 0 && m?.status !== undefined ? (
        <p className="mt-3 text-sm leading-snug text-muted-foreground">
          {toDrive ? t("move.leftOnServer", { count: waiting }) : t("move.leftInDrive", { count: waiting })}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {running ? (
          <Form method="post">
            <input type="hidden" name="intent" value="cancel" />
            <Button type="submit" variant="outline" disabled={pending}>
              {t("move.cancel")}
            </Button>
          </Form>
        ) : canMove ? (
          <Form method="post">
            <input type="hidden" name="intent" value="move" />
            <Button type="submit" disabled={pending}>
              {toDrive ? t("move.toDrive") : t("move.toServer")}
            </Button>
          </Form>
        ) : null}
      </div>
      {result?.intent === "move" && result.nothing ? (
        <p role="status" className="mt-3 text-sm leading-snug">
          {t("move.nothing")}
        </p>
      ) : null}
      {result?.intent === "cancel" && result.ok ? (
        <p role="status" className="mt-3 text-sm leading-snug">
          {t("move.stopping")}
        </p>
      ) : null}
      {(result?.intent === "move" || result?.intent === "cancel") && result.errorKey ? (
        <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
          {t(result.errorKey)}
        </p>
      ) : null}
    </section>
  );
}
