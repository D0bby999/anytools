/**
 * settings.routes.tsx
 * Which connection serves which capability, in what order.
 *
 * The page renders every function the API reports, including the ones with no
 * chain, so the list of capabilities comes from ONE Go constant list rather
 * than being restated here. That is the same reason the migration's CHECK is
 * pinned to that list by a test: a second copy of the enum is a copy that
 * drifts, and red-team RT-13 found exactly that drift in the plan.
 */
import { data, Form, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/settings.routes";
import { requireUser } from "~/lib/auth.server";
import {
  formErrorMessage,
  getReadiness,
  listCatalog,
  listConnections,
  listRoutes,
  setRoute,
  verifyConnection,
} from "~/lib/byok.server";
import type { RouteEntry } from "~/lib/byok.types";
import { Alert } from "~/components/ui/alert";
import { ReadinessMatrix } from "~/components/settings/readiness-matrix";
import { Button } from "~/components/ui/button";
import { StatusPill } from "~/components/settings/readiness-matrix";
import { RouteChainDialog } from "~/components/settings/route-chain-dialog";

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const [routes, connections, readiness, catalog] = await Promise.all([
    listRoutes(user.id),
    listConnections(user.id),
    getReadiness(user.id),
    listCatalog(user.id),
  ]);
  return { routes, connections: connections.connections, readiness, catalog: catalog.providers };
}

/** One line of Verify all: a connection and what its check proved. */
type Checked = { name: string; ok: boolean; message: string | null };

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();

  // Verify all (plan 261021-1100 phase 4): each connection once, on the first
  // function it serves, else chat, one after another so a provider's rate
  // limit is not hit by our own fan-out.
  if (form.get("intent") === "verify-all") {
    const [routes, payload] = await Promise.all([listRoutes(user.id), listConnections(user.id)]);
    const firstFunction = (id: string) =>
      routes.functions.find((fn) => (routes.routes[fn] ?? []).some((e) => e.connection_id === id)) ?? "chat";
    const checked: Checked[] = [];
    for (const c of payload.connections) {
      try {
        const result = await verifyConnection(user.id, c.id, firstFunction(c.id));
        checked.push({ name: c.name, ok: result.ok, message: result.ok ? null : (result.message ?? null) });
      } catch (err) {
        checked.push({ name: c.name, ok: false, message: formErrorMessage(err, "This one could not be checked.") });
      }
    }
    return data({ message: null as string | null, checked });
  }

  const fn = String(form.get("function") ?? "");

  // Every row is read in order and the blanks are SKIPPED rather than treated
  // as the end of the chain, so clearing the middle of three closes the gap
  // instead of silently discarding the third. There is no separate delete verb
  // to keep in sync with the ordering.
  const entries: RouteEntry[] = [];
  for (let i = 0; ; i += 1) {
    const raw = form.get(`connection_${i}`);
    if (raw === null) break;
    const connectionId = String(raw);
    if (!connectionId) continue;
    entries.push({ connection_id: connectionId, model: String(form.get(`model_${i}`) ?? "").trim() });
  }

  try {
    await setRoute(user.id, fn, entries);
    return data({ message: null as string | null, checked: null as Checked[] | null });
  } catch (err) {
    return data(
      { message: formErrorMessage(err, "That chain could not be saved."), checked: null as Checked[] | null },
      { status: 400 },
    );
  }
}

export default function Routes({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();

  return (
    <div>
      {actionData?.message ? (
        <Alert variant="destructive" className="mb-5">
          {actionData.message}
        </Alert>
      ) : null}

      <p className="max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
        {t("settings.routes.lead")}
      </p>

      {/* The matrix sits ABOVE the editors, not on a page of its own: the
          question "why is quiz blocked" and the control that answers it are the
          same screen, and splitting them means reading one and scrolling to the
          other. */}
      <section aria-labelledby="lp-readiness-matrix" className="mt-8">
        <h2 id="lp-readiness-matrix" className="lp-section">
          {t("settings.readiness.title")}
        </h2>
        <div className="mt-3">
          <ReadinessMatrix
            functions={loaderData.readiness.functions}
            optional={loaderData.readiness.optional_functions ?? []}
          />
        </div>
      </section>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="lp-section">{t("settings.routes.editorsTitle")}</h2>
        {loaderData.connections.length > 0 ? (
          <Form method="post">
            <input type="hidden" name="intent" value="verify-all" />
            <Button type="submit" variant="outline" size="sm" disabled={navigation.state !== "idle"}>
              {navigation.formData?.get("intent") === "verify-all"
                ? t("settings.routes.verifying")
                : t("settings.routes.verifyAll")}
            </Button>
          </Form>
        ) : null}
      </div>

      {actionData?.checked ? (
        <ul aria-label={t("settings.routes.verifyAll")} className="mt-4 grid list-none gap-2 p-0">
          {actionData.checked.map((c) => (
            <li key={c.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <StatusPill
                status={c.ok ? "green" : "blocked"}
                label={c.ok ? t("settings.readiness.ready") : t("settings.readiness.blocked")}
              />
              <span className="font-medium">{c.name}</span>
              {c.message ? <span className="text-muted-foreground">{c.message}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {loaderData.connections.length === 0 ? (
        <p className="mt-4 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
          {t("settings.routes.noConnections")}
        </p>
      ) : (
        <div className="mt-6 border-t" aria-busy={navigation.state !== "idle"}>
          {loaderData.routes.functions.map((fn) => (
            <RouteChainDialog
              // A saved chain comes back from the loader; remount so the
              // editor starts from it.
              key={`${fn}:${JSON.stringify(loaderData.routes.routes[fn] ?? [])}`}
              fn={fn}
              entries={loaderData.routes.routes[fn] ?? []}
              connections={loaderData.connections}
              catalog={loaderData.catalog}
              maxEntries={loaderData.routes.max_chain_entries}
            />
          ))}
        </div>
      )}
    </div>
  );
}
