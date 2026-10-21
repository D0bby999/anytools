/**
 * settings.providers.tsx
 * Every provider a learner can connect, as a grid with a search and filters
 * (plan 261021-1100 phase 4, after postclaw's settings-providers). A card
 * opens the provider's own page, where the key is added and its models
 * listed.
 */
import type { Route } from "./+types/settings.providers";
import { useTranslation } from "react-i18next";
import { requireUser } from "~/lib/auth.server";
import { listCatalog, listConnections } from "~/lib/byok.server";
import { ProviderGrid } from "~/components/settings/provider-grid";

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const [catalog, payload] = await Promise.all([listCatalog(user.id), listConnections(user.id)]);
  const connected: Record<string, number> = {};
  for (const c of payload.connections) connected[c.provider] = (connected[c.provider] ?? 0) + 1;
  return { providers: catalog.providers, connected };
}

export default function Providers({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  return (
    <div>
      <p className="mb-6 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
        {t("settings.providers.lead")}
      </p>
      <ProviderGrid entries={loaderData.providers} connected={loaderData.connected} />
    </div>
  );
}
