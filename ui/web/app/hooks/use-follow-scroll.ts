import { useCallback, useEffect, useState } from "react";

/** How far from the bottom still counts as "at the latest". */
const NEAR = 120;

function scroller(): HTMLElement | null {
  // The app's one scroll region (routes/app-layout.tsx).
  return document.querySelector<HTMLElement>("[data-lp-scroll]");
}

/**
 * Keeps a conversation at its latest line while it streams, unless the
 * learner has scrolled up to read; then it leaves them where they are and
 * offers a way back (postclaw's scroll-follow ownership, kept simple: whoever
 * scrolled last owns the position).
 *
 * `signal` is anything that changes when content is added.
 */
export function useFollowScroll(signal: unknown) {
  const [away, setAway] = useState(false);

  useEffect(() => {
    const el = scroller();
    if (!el) return;
    // A conversation opens at its end.
    el.scrollTop = el.scrollHeight;
    const onScroll = () => setAway(el.scrollHeight - el.scrollTop - el.clientHeight > NEAR);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = scroller();
    if (el && !away) el.scrollTop = el.scrollHeight;
  }, [signal, away]);

  const jump = useCallback(() => {
    const el = scroller();
    if (!el) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, []);

  return { away, jump };
}
