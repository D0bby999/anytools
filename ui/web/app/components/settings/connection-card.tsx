/**
 * One connected credential.
 *
 * It shows what the key has PROVEN — verified, resting, rejected — rather than
 * merely that it exists, because "I pasted a key" and "this key answers" are
 * different states and only the second one makes the product work.
 *
 * There is no field anywhere in this component for the key itself. The API
 * never sends one back, so there is nothing to render; replacing a key is a
 * write-only input.
 */
import { Details } from "~/components/doc/details";
import { Flyout } from "~/components/doc/flyout";
import { Dialog } from "~/components/doc/dialog";
import { useRef, useState, type ReactNode } from "react";
import { Form, Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { StatusPill } from "~/components/settings/readiness-matrix";
import type { Connection, ReadinessStatus } from "~/lib/byok.types";
import { providerName } from "~/lib/provider-names";

export function connectionStatus(conn: Connection): ReadinessStatus {
  if (conn.needs_reconnect) return "blocked";
  if (conn.last_error) return "blocked";
  if (conn.cooldown_until && new Date(conn.cooldown_until) > new Date()) return "warn";
  if (!conn.verified_at) return "warn";
  return "green";
}

export function ConnectionCard({
  connection,
  children,
  linkProvider = true,
}: {
  connection: Connection;
  /** More about the connection, at the foot of the card (its models, on a provider's page). */
  children?: ReactNode;
  /** Name the provider as a link to its page; off on that page itself. */
  linkProvider?: boolean;
}) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const status = connectionStatus(connection);
  const [confirming, setConfirming] = useState(false);
  const card = useRef<HTMLLIElement>(null);
  const closeDialog = () => {
    setConfirming(false);
    // Opening the dialog folds the flyout; return to its visible trigger.
    requestAnimationFrame(() => card.current?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus());
  };

  const statusLabel =
    status === "green"
      ? t("settings.readiness.ready")
      : status === "warn"
        ? t("settings.readiness.attention")
        : t("settings.readiness.blocked");

  return (
    <li ref={card} className="lp-download-card min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-sans text-base font-medium">{connection.name}</h3>
        <StatusPill status={status} label={statusLabel} />
      </div>

      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="lp-kicker">{t("settings.connections.provider")}</dt>
        <dd className="text-muted-foreground">
          {linkProvider ? (
            <Link to={`/settings/providers/${connection.provider}`} className="text-primary underline underline-offset-2">
              {providerName(t, connection.provider)}
            </Link>
          ) : (
            providerName(t, connection.provider)
          )}
        </dd>

        {connection.api_base ? (
          <>
            <dt className="lp-kicker">{t("settings.connections.baseUrl")}</dt>
            {/* The base URL is long and arbitrary; it scrolls inside its own
                box rather than forcing the page to scroll sideways. */}
            <dd className="overflow-x-auto font-mono text-xs text-muted-foreground">{connection.api_base}</dd>
          </>
        ) : null}

        {connection.verified_model ? (
          <>
            <dt className="lp-kicker">{t("settings.connections.verifiedWith")}</dt>
            <dd className="font-mono text-xs text-muted-foreground">
              {connection.verified_model}
              {connection.dims ? ` · ${connection.dims}d` : ""}
            </dd>
          </>
        ) : null}
      </dl>

      {connection.last_error ? <p className="mt-2 text-sm leading-prose text-destructive">{connection.last_error}</p> : null}
      {connection.needs_reconnect ? (
        <p className="mt-2 text-sm leading-prose text-destructive">{t("settings.connections.needsReconnect")}</p>
      ) : null}
      {!connection.verified_at && !connection.last_error ? (
        <p className="mt-2 text-sm leading-prose text-muted-foreground">{t("settings.connections.notVerified")}</p>
      ) : null}

      <Flyout label={t("settings.up.manage")} buttonClassName="!h-10" menuClassName="!top-full !left-0 !right-auto">
        <Form method="post">
          <input type="hidden" name="intent" value="verify" />
          <input type="hidden" name="id" value={connection.id} />
          <Button type="submit" variant="outline" size="sm" disabled={busy}>
            {t("settings.connections.verify")}
          </Button>
        </Form>

        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
          {t("settings.connections.remove")}
        </Button>
        <Details summary={t("settings.connections.replaceKey")}>
          <Form method="post" className="mt-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="intent" value="replace-key" />
            <input type="hidden" name="id" value={connection.id} />
            <label className="flex flex-col gap-1 text-sm">
              <span className="lp-kicker">{t("settings.connections.newKey")}</span>
              <input
                type="password"
                name="secret"
                required
                autoComplete="off"
                className="h-10 w-72 max-w-full rounded-md border bg-card px-3 font-mono text-sm"
              />
            </label>
            <Button type="submit" variant="outline" size="sm" disabled={busy}>
              {t("settings.connections.save")}
            </Button>
          </Form>
        </Details>
      </Flyout>
      <Dialog
        open={confirming}
        onClose={closeDialog}
        title={t("settings.connections.remove")}
        description={t("settings.connections.confirmRemove")}
      >
        <Form method="post" className="mt-4 flex justify-end gap-2" onSubmit={() => setConfirming(false)}>
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="id" value={connection.id} />
          <Button type="button" variant="ghost" onClick={closeDialog}>
            {t("settings.up.cancel")}
          </Button>
          <Button type="submit" variant="destructive" disabled={busy}>
            {t("settings.connections.remove")}
          </Button>
        </Form>
      </Dialog>
      {children}
    </li>
  );
}
