/**
 * folds.tsx — which parts of a conversation the reader opened or closed.
 *
 * Kept by the conversation page rather than by each row, so that the
 * conversation's search can open the turn and the group holding a match, and
 * an answer's "Expand all" can open everything under it. Keys are the turn's id
 * and `<turn>:<group>`. Not persisted, like postclaw's: the defaults give the
 * same picture after a reload.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type Folds = {
  get: (key: string) => boolean | undefined;
  set: (key: string, open: boolean) => void;
  openAll: (keys: string[]) => void;
};

const FoldsContext = createContext<Folds | null>(null);

export function FoldsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Record<string, boolean>>({});
  const set = useCallback((key: string, open: boolean) => setState((s) => ({ ...s, [key]: open })), []);
  const openAll = useCallback(
    (keys: string[]) => setState((s) => ({ ...s, ...Object.fromEntries(keys.map((k) => [k, true])) })),
    [],
  );
  const value = useMemo<Folds>(() => ({ get: (key) => state[key], set, openAll }), [state, set, openAll]);
  return <FoldsContext.Provider value={value}>{children}</FoldsContext.Provider>;
}

/**
 * The page's folds, or a private set when a row is drawn outside a
 * conversation page (a test, a preview).
 */
export function useFolds(): Folds {
  const shared = useContext(FoldsContext);
  const [own, setOwn] = useState<Record<string, boolean>>({});
  const local = useMemo<Folds>(
    () => ({
      get: (key) => own[key],
      set: (key, open) => setOwn((s) => ({ ...s, [key]: open })),
      openAll: (keys) => setOwn((s) => ({ ...s, ...Object.fromEntries(keys.map((k) => [k, true])) })),
    }),
    [own],
  );
  return shared ?? local;
}
