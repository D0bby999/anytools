import { Form, Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Languages, LogOut, Settings } from "lucide-react";
import { useDisclosureMenu } from "~/components/tools-site/locale-switcher";
import { cn } from "~/lib/utils";

/** One or two letters for the avatar: the name's initials, else the email's first. */
export function initials(displayName: string, email: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (email.trim()[0] ?? "?").toUpperCase();
}

const ITEM =
  "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/**
 * The account, as one round button in the running head (plan 261019-1317,
 * phase 3): who is signed in, Settings, the interface language, and Sign out.
 * It replaces the name, email and outlined Sign out button that sat on every
 * page, the loudest thing in the running head after the page's own title.
 *
 * A `<details>`, like the site's language menu, so it opens and signs out
 * before hydration; useDisclosureMenu closes it on a click outside, on Escape
 * and after navigating.
 */
export function AccountMenu({ displayName, email }: { displayName: string; email: string }) {
  const { t } = useTranslation("common");
  const ref = useDisclosureMenu();
  const name = displayName || email;

  return (
    <details ref={ref} className="group relative">
      {/* The name is read as text, not aria-label: an aria-label that does not
          contain the visible initials fails WCAG 2.5.3 (axe). */}
      <summary
        className={cn(
          "flex size-11 cursor-pointer list-none items-center justify-center rounded-full select-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden",
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-9 items-center justify-center rounded-full border border-control-border bg-card font-sans text-sm font-semibold text-foreground transition-colors group-open:border-primary group-hover:border-primary"
        >
          {initials(displayName, email)}
        </span>
        <span className="sr-only">{t("account.menu", { name })}</span>
      </summary>
      <div className="absolute right-0 z-50 mt-1 w-64 rounded-lg border bg-card p-1 shadow-md">
        <div className="border-b px-3 pt-2 pb-3">
          <p className="truncate text-sm font-medium">{name}</p>
          {displayName ? <p className="truncate text-xs text-muted-foreground">{email}</p> : null}
        </div>
        <ul className="pt-1">
          <li>
            <Link to="/settings" className={ITEM}>
              <Settings aria-hidden="true" className="size-4" />
              {t("account.settings")}
            </Link>
          </li>
          <li>
            <Link to="/settings/account" className={ITEM}>
              <Languages aria-hidden="true" className="size-4" />
              {t("account.language")}
            </Link>
          </li>
          <li className="mt-1 border-t pt-1">
            {/* A POST, not a link: a GET logout can be fired by any third-party
                <img src="/auth/logout"> the user's browser happens to load. */}
            <Form method="post" action="/auth/logout">
              <button type="submit" className={ITEM}>
                <LogOut aria-hidden="true" className="size-4" />
                {t("actions.signOut")}
              </button>
            </Form>
          </li>
        </ul>
      </div>
    </details>
  );
}
