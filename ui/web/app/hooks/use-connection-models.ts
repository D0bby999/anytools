import { useCallback, useEffect, useState } from "react";
import type { ModelsData } from "~/lib/byok.types";

/**
 * One connection's models, fetched when first asked for and shared by every
 * picker and panel on the page (each fetch asks the provider, which the API
 * budgets as a verify). `refresh` drops the copy after a model is added or
 * removed.
 */
const cache = new Map<string, Promise<ModelsData>>();

function load(connectionId: string): Promise<ModelsData> {
  let pending = cache.get(connectionId);
  if (!pending) {
    pending = fetch(`/app/api/byok-models?connection=${encodeURIComponent(connectionId)}`, {
      headers: { Accept: "application/json" },
    })
      .then((r) => r.json() as Promise<ModelsData>)
      .catch(() => ({ ok: false as const, error: "" }));
    cache.set(connectionId, pending);
  }
  return pending;
}

export function useConnectionModels(connectionId: string | null, enabled = true) {
  const [state, setState] = useState<{ id: string; data: ModelsData } | null>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!connectionId || !enabled) return;
    let alive = true;
    void load(connectionId).then((data) => alive && setState({ id: connectionId, data }));
    return () => {
      alive = false;
    };
  }, [connectionId, enabled, generation]);
  const refresh = useCallback(() => {
    if (connectionId) cache.delete(connectionId);
    setGeneration((g) => g + 1);
  }, [connectionId]);
  const data = state && state.id === connectionId ? state.data : null;
  return { data, loading: enabled && !!connectionId && data === null, refresh };
}

/** For tests: forget every fetched list. */
export function clearModelCache() {
  cache.clear();
}
