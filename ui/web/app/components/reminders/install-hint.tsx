/**
 * install-hint.tsx
 * One line on Home for iPhone and iPad in Safari: AnyLearn's review reminder
 * needs it on the Home Screen first, and nothing in Safari says so. Shown
 * only there, and gone for good once dismissed (this browser's storage).
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { isIOS, isStandalone } from "~/lib/pwa";

export const INSTALL_HINT_KEY = "anylearn.installHint.dismissed";

export function InstallHint() {
  const { t } = useTranslation("common");
  const [show, setShow] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(INSTALL_HINT_KEY) === "1";
    } catch {
      // Storage refused (private mode): show it; dismissing then lasts the page.
    }
    setShow(isIOS() && !isStandalone() && !dismissed);
  }, []);

  if (!show) return null;

  function dismiss() {
    try {
      localStorage.setItem(INSTALL_HINT_KEY, "1");
    } catch {
      // See above.
    }
    setShow(false);
  }

  return (
    <aside aria-label={t("reminders.hint.label")} className="mb-8 rounded-lg border bg-muted px-4 py-3">
      <p className="text-sm leading-snug">{t("reminders.hint.body")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link to="/settings/reminders" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
          {t("reminders.hint.how")}
        </Link>
        <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
          {t("reminders.hint.dismiss")}
        </Button>
      </div>
    </aside>
  );
}
