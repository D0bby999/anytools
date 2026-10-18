import { Form, Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { ThemeToggle } from "~/components/layout/theme-toggle";
import { NAV_ITEMS } from "~/components/layout/sidebar";
import { PARTS, partOf } from "~/lib/parts";

/**
 * The running head: what a textbook prints at the top of every page. Which
 * part you are in (its tab) and which section, then the account. It replaces
 * a breadcrumb: the part is the one piece of wayfinding a deep page needs.
 */
export function Topbar({ displayName, email }: { displayName: string; email: string }) {
  const { t } = useTranslation("common");
  const { pathname } = useLocation();
  const part = PARTS.find((p) => p.id === partOf(pathname));
  const section = NAV_ITEMS.find((n) => pathname === n.to || pathname.startsWith(n.to + "/"));

  return (
    <header className="flex h-(--lp-topbar-h) shrink-0 items-center gap-3 border-b bg-background px-4 lg:px-8">
      {/* The rail carries the wordmark from `lg` up; below that the rail is a
          bottom bar with no room for it, so the running head holds it. */}
      <Link to="/home" translate="no" className="font-serif text-lg font-semibold lg:hidden">
        {t("app.name")}
      </Link>

      <p className="flex min-w-0 items-center gap-2 text-sm">
        {part ? (
          <span className="lp-tab">
            <span aria-hidden="true">{part.numeral}</span>
            <span className="sr-only">{t("parts.part", { numeral: part.numeral })}:</span>
            <span className="hidden sm:inline">{t(part.labelKey)}</span>
          </span>
        ) : null}
        {section ? <span className="hidden truncate font-medium lg:inline">{t(section.labelKey)}</span> : null}
      </p>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden min-w-0 text-right sm:block">
          <p className="truncate text-sm font-medium">{displayName || email}</p>
          {displayName && <p className="truncate text-xs text-muted-foreground">{email}</p>}
        </div>
        <ThemeToggle />
        {/* A POST, not a link: a GET logout can be fired by any third-party
            <img src="/auth/logout"> the user's browser happens to load. */}
        <Form method="post" action="/auth/logout">
          <Button type="submit" variant="ghost" size="sm">
            {t("actions.signOut")}
          </Button>
        </Form>
      </div>
    </header>
  );
}
