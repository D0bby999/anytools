/**
 * settings.search.tsx
 * Web-search keys — the user's own Tavily or Brave key, or none.
 *
 * There is no platform search key, and the empty state says what happens
 * without one rather than pretending it is a requirement: research still runs,
 * against the user's own documents. That is the whole "free + BYOK, no platform
 * key of any kind" rule, stated where a user meets it.
 */
import { useState } from "react";
import { data, Form, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/settings.search";
import { requireUser } from "~/lib/auth.server";
import {
  deleteSearchConnection,
  formErrorMessage,
  listSearchConnections,
  saveSearchConnection,
  verifySearchConnection,
} from "~/lib/byok.server";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return listSearchConnections(user.id);
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    switch (intent) {
      case "save":
        await saveSearchConnection(
          user.id,
          String(form.get("provider") ?? ""),
          String(form.get("secret") ?? ""),
          String(form.get("zotero_user") ?? ""),
        );
        return data({ message: null as string | null });
      case "verify": {
        const result = await verifySearchConnection(user.id, String(form.get("id") ?? ""));
        return data({ message: result.ok ? null : (result.message ?? null) });
      }
      case "delete":
        await deleteSearchConnection(user.id, String(form.get("id") ?? ""));
        return data({ message: null });
      default:
        return data({ message: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    return data({ message: formErrorMessage(err, "That did not work. Try again.") }, { status: 400 });
  }
}

export default function SearchKeys({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [provider, setProvider] = useState(loaderData.providers[0] ?? "");

  return (
    <div>
      {actionData?.message ? (
        <Alert variant="destructive" className="mb-5">
          {actionData.message}
        </Alert>
      ) : null}

      <p className="max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
        {t("settings.search.lead")}
      </p>
      <p className="mt-2 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
        {t("githubToken.hint")}
      </p>
      <p className="mt-2 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
        {t("zoteroKey.hint")}
      </p>
      <p className="mt-2 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
        {t("youtubeDataKey.hint")}
      </p>

      <Form method="post" className="mt-5 grid gap-3 sm:max-w-md">
        <input type="hidden" name="intent" value="save" />
        <label className="flex flex-col gap-1 text-sm">
          <span className="lp-kicker">{t("settings.search.provider")}</span>
          <select
            name="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="h-10 w-full rounded-md border bg-sunken px-3 text-sm"
          >
            {loaderData.providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        {provider === "zotero" ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="lp-kicker">{t("zoteroKey.userLabel")}</span>
            <input
              name="zotero_user"
              required
              inputMode="numeric"
              pattern="[0-9]{1,12}"
              autoComplete="off"
              aria-describedby="lp-zotero-user-hint"
              className="h-10 w-full rounded-md border bg-sunken px-3 font-mono text-sm"
            />
            <span id="lp-zotero-user-hint" className="text-xs text-muted-foreground">
              {t("zoteroKey.userHint")}
            </span>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-sm">
          <span className="lp-kicker">{t("settings.search.key")}</span>
          <input
            type="password"
            name="secret"
            required
            autoComplete="off"
            className="h-10 w-full rounded-md border bg-sunken px-3 font-mono text-sm"
          />
        </label>
        <div>
          <Button type="submit" disabled={busy}>
            {t("settings.search.save")}
          </Button>
        </div>
      </Form>

      <section aria-labelledby="lp-search-keys" className="mt-10">
        <h2 id="lp-search-keys" className="lp-kicker">
          {t("settings.search.savedTitle")}
        </h2>

        {loaderData.search_connections.length === 0 ? (
          <p className="mt-3 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
            {t("settings.search.empty")}
          </p>
        ) : (
          <ul className="mt-3 border-t">
            {loaderData.search_connections.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-4">
                <div>
                  <span className="font-sans text-base font-medium">{row.provider}</span>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {row.last_error
                      ? row.last_error
                      : row.verified_at
                        ? t("settings.search.verified")
                        : t("settings.search.notVerified")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Form method="post">
                    <input type="hidden" name="intent" value="verify" />
                    <input type="hidden" name="id" value={row.id} />
                    <Button type="submit" variant="outline" size="sm" disabled={busy}>
                      {t("settings.connections.verify")}
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={row.id} />
                    <Button type="submit" variant="ghost" size="sm" disabled={busy}>
                      {t("settings.connections.remove")}
                    </Button>
                  </Form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
