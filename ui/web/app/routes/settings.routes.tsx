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
import { data, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/settings.routes";
import { requireUser } from "~/lib/auth.server";
import {
  formErrorMessage,
  getReadiness,
  listConnections,
  listRoutes,
  setRoute,
} from "~/lib/byok.server";
import type { RouteEntry } from "~/lib/byok.types";
import { Alert } from "~/components/ui/alert";
import { ReadinessMatrix } from "~/components/settings/readiness-matrix";
import { RouteChainEditor } from "~/components/settings/route-chain-editor";

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const [routes, connections, readiness] = await Promise.all([
    listRoutes(user.id),
    listConnections(user.id),
    getReadiness(user.id),
  ]);
  return { routes, connections: connections.connections, readiness };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
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
    return data({ message: null as string | null });
  } catch (err) {
    return data({ message: formErrorMessage(err, "That chain could not be saved.") }, { status: 400 });
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

      <h2 className="lp-section mt-10">{t("settings.routes.editorsTitle")}</h2>

      {loaderData.connections.length === 0 ? (
        <p className="mt-4 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
          {t("settings.routes.noConnections")}
        </p>
      ) : (
        <div className="mt-6 border-t" aria-busy={navigation.state !== "idle"}>
          {loaderData.routes.functions.map((fn) => (
            <RouteChainEditor
              key={fn}
              fn={fn}
              entries={loaderData.routes.routes[fn] ?? []}
              connections={loaderData.connections}
              maxEntries={loaderData.routes.max_chain_entries}
            />
          ))}
        </div>
      )}
    </div>
  );
}
