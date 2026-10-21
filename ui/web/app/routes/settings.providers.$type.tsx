/**
 * settings.providers.$type.tsx
 * One provider's page (plan 261021-1100 phase 4, after postclaw's
 * settings-providers-detail): what it can do here, where its keys come from,
 * a form to connect a key, and the learner's connections to it, each with its
 * models.
 *
 * A key is checked once, when it is connected: the action verifies the new
 * connection straight away (with no model chosen, by reading its model list),
 * so the card says at once whether the key works. There is no scheduled
 * re-check (owner, validation session 1).
 *
 * Like the Connections page, every write is a form post to this route's
 * action, so a pasted key goes from the browser to this server and on to the
 * API, and nowhere else.
 */
import { data, Form, Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Route } from "./+types/settings.providers.$type";
import { requireUser } from "~/lib/auth.server";
import {
  addCustomModel,
  createConnection,
  deleteConnection,
  deleteCustomModel,
  formErrorMessage,
  listCatalog,
  listConnections,
  updateConnection,
  verifyConnection,
} from "~/lib/byok.server";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { ConnectionCard } from "~/components/settings/connection-card";
import { ConnectionModels } from "~/components/settings/connection-models";
import { ProviderTile } from "~/components/settings/provider-tile";
import { providerName } from "~/lib/provider-names";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const [catalog, payload] = await Promise.all([listCatalog(user.id), listConnections(user.id)]);
  const entry = catalog.providers.find((p) => p.type === params.type);
  if (!entry) throw data(null, { status: 404 });
  return { entry, connections: payload.connections.filter((c) => c.provider === entry.type) };
}

type ActionResult = { ok: boolean; message: string | null; intent: string };

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const str = (k: string) => String(form.get(k) ?? "");
  const done = (message: string | null = null, ok = true) => data<ActionResult>({ ok, message, intent });
  try {
    switch (intent) {
      case "create": {
        const conn = await createConnection(user.id, {
          provider: params.type,
          name: str("name").trim(),
          api_base: str("api_base").trim(),
          secret: str("secret"),
        });
        // Checked once, now: the card below then says whether the key works.
        const result = await verifyConnection(user.id, conn.id, "chat");
        return done(result.ok ? null : (result.message ?? null), result.ok);
      }
      case "verify": {
        const result = await verifyConnection(user.id, str("id"), "chat");
        return done(result.ok ? null : (result.message ?? null), result.ok);
      }
      case "replace-key":
        await updateConnection(user.id, str("id"), { secret: str("secret") });
        return done();
      case "delete":
        await deleteConnection(user.id, str("id"));
        return done();
      case "add-model":
        await addCustomModel(user.id, str("id"), str("model"));
        return done();
      case "delete-model":
        await deleteCustomModel(user.id, str("id"), str("model"));
        return done();
      default:
        return data<ActionResult>({ ok: false, message: "Unknown action.", intent }, { status: 400 });
    }
  } catch (err) {
    return data<ActionResult>(
      { ok: false, message: formErrorMessage(err, "That did not work. Try again."), intent },
      { status: 400 },
    );
  }
}

export default function ProviderPage({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const { entry, connections } = loaderData;
  const name = providerName(t, entry.type) || entry.label;
  const field = "h-10 w-full rounded-md border border-control-border bg-card px-3 text-sm";
  // Model add and remove go through a fetcher and report in their own panel.
  const message = actionData && !actionData.intent.endsWith("-model") ? actionData.message : null;

  return (
    <div>
      <Link to="/settings/providers" className="inline-flex min-h-8 items-center gap-2 text-sm text-primary">
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("settings.providers.all")}
      </Link>

      <div className="mt-4 flex items-start gap-4">
        <ProviderTile icon={entry.icon} hue={entry.hue} size="lg" />
        <div className="min-w-0">
          <h2 className="!mt-0 !mb-1">{name}</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {entry.serves.map((s) => t(`settings.providers.servesOptions.${s}`)).join(" · ")}
            {entry.free_tier ? ` · ${t("settings.providers.free")}` : ""}
          </p>
          {entry.key_url ? (
            <a
              href={entry.key_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex min-h-8 items-center gap-2 text-sm text-primary underline underline-offset-2"
            >
              {t("settings.providers.getKey", { provider: name })}
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
          ) : null}
        </div>
      </div>

      {entry.api_base ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {t("settings.providers.servedAt")} <span className="font-mono text-xs break-all">{entry.api_base}</span>
        </p>
      ) : null}
      {entry.needs_model ? (
        <p className="mt-2 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
          {t("settings.providers.needsModel")}
        </p>
      ) : null}

      {message ? (
        <Alert variant="destructive" className="mt-6">
          {message}
        </Alert>
      ) : null}

      {entry.auth === "sign_in" ? (
        <p className="mt-8 max-w-(--lp-measure-read) text-sm leading-prose">
          {t("settings.providers.signIn")}{" "}
          <Link to="/settings" className="text-primary underline underline-offset-2">
            {t("settings.nav.connections")}
          </Link>
        </p>
      ) : (
        <section aria-labelledby="lp-add-key" className="mt-8">
          <h2 id="lp-add-key" className="lp-section">
            {t("settings.providers.addTitle")}
          </h2>
          <Form method="post" className="mt-3 grid max-w-md gap-3">
            <input type="hidden" name="intent" value="create" />
            <label className="flex flex-col gap-1 text-sm">
              <span>{t("settings.connections.name")}</span>
              <input type="text" name="name" defaultValue={connections.length ? "" : name} required maxLength={60} className={field} />
            </label>
            {entry.auth === "custom" ? (
              <label className="flex flex-col gap-1 text-sm">
                <span>{t("settings.connections.baseUrl")}</span>
                <input type="url" name="api_base" required className={`${field} font-mono`} placeholder="https://…" />
                <span className="text-xs leading-prose text-muted-foreground">{t("settings.connections.baseUrlHelp")}</span>
              </label>
            ) : null}
            <label className="flex flex-col gap-1 text-sm">
              <span>{t("settings.connections.key")}</span>
              <input type="password" name="secret" required autoComplete="off" className={`${field} font-mono`} />
              <span className="text-xs leading-prose text-muted-foreground">{t("settings.connections.keyHelp")}</span>
            </label>
            <div>
              <Button type="submit" disabled={busy}>
                {t("settings.providers.connect")}
              </Button>
            </div>
          </Form>
        </section>
      )}

      <section aria-labelledby="lp-provider-connections" className="mt-10">
        <h2 id="lp-provider-connections" className="lp-section">
          {t("settings.connections.connectedTitle")}
        </h2>
        {connections.length === 0 ? (
          <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("settings.providers.noneYet")}</p>
        ) : (
          <ul className="mt-3 grid list-none gap-4 p-0">
            {connections.map((c) => (
              <ConnectionCard key={c.id} connection={c} linkProvider={false}>
                {c.kind === "api_key" ? <ConnectionModels connectionId={c.id} /> : null}
              </ConnectionCard>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
