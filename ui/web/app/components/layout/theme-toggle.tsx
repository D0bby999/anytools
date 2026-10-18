import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Moon, Sun } from "lucide-react";
import { Button } from "~/components/ui/button";

/** Same key the pre-paint script in root.tsx reads. */
const STORAGE_KEY = "anytools-theme";

/**
 * Light and dark are both real in this world, so there has to be a way to
 * reach the other one. It lives in the topbar rather than inside a settings
 * page: a theme is a room-lighting decision, made where the user is, not two
 * navigations away.
 *
 * The button renders its label only after mount. Before hydration the server
 * has no idea which theme the browser resolved (the choice lives in
 * localStorage and in a media query), and rendering a guess would either flash
 * the wrong icon or trip a hydration mismatch.
 */
export function ThemeToggle({ labels }: { labels?: { useLight: string; useDark: string } } = {}) {
  const { t } = useTranslation("common");
  const [isDark, setIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Safari in private mode throws on write. The theme still applies for
      // this page load; only the memory of it is lost.
    }
    setIsDark(next);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      // Omitted until mount: before it, the theme is genuinely unknown, and
      // aria-pressed={false} would assert light mode to a screen reader.
      aria-pressed={isDark ?? undefined}
      // The accessible name states the destination, not the current state:
      // "switch to dark" is actionable, "dark mode" is a riddle.
      // The public tool pages pass their own language's labels; the app is English.
      aria-label={isDark ? (labels?.useLight ?? t("actions.useLight")) : (labels?.useDark ?? t("actions.useDark"))}
    >
      {isDark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
    </Button>
  );
}
