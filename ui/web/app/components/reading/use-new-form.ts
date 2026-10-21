import { useCallback, useEffect, useRef } from "react";
import { useNavigation, useSearchParams } from "react-router";

/**
 * A "New …" form opened by a link (`?new`), as the quick-start's primary
 * action on the Knowledge and Notebooks lists: it works before hydration and
 * survives a reload.
 *
 * It closes once its POST has settled without an error, never from the
 * submit handler: dropping `?new` there is a second navigation, which would
 * interrupt the submission it races.
 */
export function useNewForm(failed: boolean) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const open = searchParams.has("new");
  const close = useCallback(
    () =>
      setSearchParams(
        (p) => {
          p.delete("new");
          return p;
        },
        { replace: true, preventScrollReset: true },
      ),
    [setSearchParams],
  );

  const submitted = useRef(false);
  useEffect(() => {
    if (navigation.formMethod === "POST") {
      submitted.current = true;
      return;
    }
    if (navigation.state !== "idle" || !submitted.current) return;
    submitted.current = false;
    if (!failed && open) close();
  }, [navigation.state, navigation.formMethod, failed, open, close]);

  return { open, close };
}
