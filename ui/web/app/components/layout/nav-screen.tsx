import { useRef, useState, type RefObject } from "react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { AccountItems } from "~/components/layout/account-menu";
import { LanguageList } from "~/components/layout/language-menu";
import { useInertOutside, useModalFocus } from "~/components/layout/modal-layer";
import { AppearanceSwitch } from "~/components/layout/theme-toggle";
import { isTopActive, TOP_NAV } from "~/lib/nav-tree";
import { cn } from "~/lib/utils";

const ROW =
  "block border-b py-3 text-sm leading-6 font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/**
 * The phone's nav screen, VitePress's VPNavScreen: everything the 64px bar
 * cannot hold, full screen under the nav on the paper, in a 288 column. The
 * TOP_NAV links, the languages (a group that opens), the appearance row,
 * the AnyTools link and the account. Behind it the page is inert and does not
 * scroll; Escape closes it and focus goes back to the hamburger.
 */
export function NavScreen({
  open,
  onClose,
  returnTo,
  keep,
  displayName,
  email,
}: {
  open: boolean;
  onClose: () => void;
  returnTo: RefObject<HTMLButtonElement | null>;
  keep: RefObject<HTMLElement | null>;
  displayName: string;
  email: string;
}) {
  const { t } = useTranslation("common");
  const { pathname } = useLocation();
  const [languagesOpen, setLanguagesOpen] = useState(false);
  useInertOutside(open, keep);
  const first = useRef<HTMLAnchorElement>(null);
  // The trap holds the whole nav, not only the screen: the hamburger that
  // closes it stays reachable, as in VitePress.
  useModalFocus(open, keep, onClose, { returnTo, initial: first });

  if (!open) return null;
  return (
    <div
      id="lp-nav-screen"
      className={cn(
        "fixed inset-x-0 top-(--lp-topbar-h) bottom-0 overflow-y-auto bg-background md:hidden",
        "transition-[opacity,translate] duration-250 starting:-translate-y-2 starting:opacity-0 motion-reduce:transition-none",
      )}
    >
      <div className="mx-auto max-w-[288px] pt-6 pb-24">
        <nav aria-label={t("nav.mainNavigation")}>
          {TOP_NAV.map((item, i) => {
            const active = isTopActive(pathname, item.to);
            return (
              <Link
                key={item.to}
                ref={i === 0 ? first : undefined}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(ROW, active && "text-primary")}
              >
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>

        <div className="border-b">
          <button
            type="button"
            aria-expanded={languagesOpen}
            aria-controls="lp-nav-screen-languages"
            onClick={() => setLanguagesOpen((o) => !o)}
            className="flex w-full items-center justify-between py-3 text-left text-sm leading-6 font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t("nav.language")}
            <ChevronDown aria-hidden="true" className={cn("size-3.5 transition-transform", languagesOpen && "rotate-180")} />
          </button>
          <div id="lp-nav-screen-languages" hidden={!languagesOpen} className="pb-3">
            <LanguageList />
          </div>
        </div>

        <div className="mt-6 rounded-md bg-muted px-4 py-3">
          <AppearanceSwitch label={t("nav.appearance")} />
        </div>

        <a href="/tools" className={cn(ROW, "mt-4")}>
          AnyTools
        </a>

        <div className="mt-6">
          <AccountItems displayName={displayName} email={email} />
        </div>
      </div>
    </div>
  );
}
