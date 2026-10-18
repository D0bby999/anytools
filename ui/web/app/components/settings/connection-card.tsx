import { Form, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { StatusPill } from "~/components/settings/readiness-matrix";
import type { Connection, ReadinessStatus } from "~/lib/byok.types";
import { providerName } from "~/lib/provider-names";

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
export function connectionStatus(conn: Connection): ReadinessStatus {
  if (conn.needs_reconnect) return "blocked";
  if (conn.last_error) return "blocked";
  if (conn.cooldown_until && new Date(conn.cooldown_until) > new Date()) return "warn";
  if (!conn.verified_at) return "warn";
  return "green";
}

export function ConnectionCard({ connection }: { connection: Connection }) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const status = connectionStatus(connection);

  const statusLabel =
    status === "green"
      ? t("settings.readiness.ready")
      : status === "warn"
        ? t("settings.readiness.attention")
        : t("settings.readiness.blocked");

  return (
    <li className="border-b py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-sans text-base font-medium">{connection.name}</h3>
        <StatusPill status={status} label={statusLabel} />
      </div>

      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="lp-kicker">{t("settings.connections.provider")}</dt>
        <dd className="text-muted-foreground">{providerName(t, connection.provider)}</dd>

        {connection.api_base ? (
          <>
            <dt className="lp-kicker">{t("settings.connections.baseUrl")}</dt>
            {/* The base URL is long and arbitrary; it scrolls inside its own
                box rather than forcing the page to scroll sideways. */}
            <dd className="overflow-x-auto font-mono text-xs text-muted-foreground">
              {connection.api_base}
            </dd>
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

      {connection.last_error ? (
        <p className="mt-2 text-sm leading-prose text-destructive">{connection.last_error}</p>
      ) : null}
      {connection.needs_reconnect ? (
        <p className="mt-2 text-sm leading-prose text-destructive">
          {t("settings.connections.needsReconnect")}
        </p>
      ) : null}
      {!connection.verified_at && !connection.last_error ? (
        <p className="mt-2 text-sm leading-prose text-muted-foreground">
          {t("settings.connections.notVerified")}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Form method="post">
          <input type="hidden" name="intent" value="verify" />
          <input type="hidden" name="id" value={connection.id} />
          <Button type="submit" variant="outline" size="sm" disabled={busy}>
            {t("settings.connections.verify")}
          </Button>
        </Form>

        {/* Destructive and irreversible, so it asks. A native confirm is the
            honest minimum here: a modal would be a focus trap to build and
            this action removes a credential, not a draft. */}
        <Form
          method="post"
          onSubmit={(event) => {
            if (!window.confirm(t("settings.connections.confirmRemove"))) event.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="id" value={connection.id} />
          <Button type="submit" variant="ghost" size="sm" disabled={busy}>
            {t("settings.connections.remove")}
          </Button>
        </Form>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-muted-foreground">
          {t("settings.connections.replaceKey")}
        </summary>
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
              className="h-10 w-72 max-w-full rounded-md border bg-sunken px-3 font-mono text-sm"
            />
          </label>
          <Button type="submit" variant="outline" size="sm" disabled={busy}>
            {t("settings.connections.save")}
          </Button>
        </Form>
      </details>
    </li>
  );
}
