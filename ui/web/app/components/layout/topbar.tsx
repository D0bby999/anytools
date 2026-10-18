import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { ThemeToggle } from "~/components/layout/theme-toggle";

export function Topbar({ displayName, email }: { displayName: string; email: string }) {
  const { t } = useTranslation("common");

  return (
    <header className="flex h-(--lp-topbar-h) shrink-0 items-center gap-3 border-b bg-background px-4 lg:px-6">
      {/* The rail carries the wordmark from `lg` up; below that the rail is a
          bottom bar with no room for it, so the topbar holds it instead. */}
      <span translate="no" className="font-serif text-base font-semibold lg:hidden">
        {t("app.name")}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden min-w-0 text-right sm:block">
          <p className="truncate text-sm">{displayName || email}</p>
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
