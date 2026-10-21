import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { AlignLeft } from "lucide-react";

/**
 * VitePress's VPLocalNav: the 48px bar under the nav below 1280. On the left
 * the Menu button that opens the sidebar drawer (below 960 only); on the
 * right `children`, the "On this page" dropdown. From 960 the left part is
 * the sidebar's column, on its surface, so the column reads as one strip;
 * from 1280 the aside takes over and the bar is gone.
 */
export function LocalNav({
  drawerOpen,
  onMenu,
  menuRef,
  children,
}: {
  drawerOpen: boolean;
  onMenu: () => void;
  menuRef: RefObject<HTMLButtonElement | null>;
  children?: ReactNode;
}) {
  const { t } = useTranslation("common");
  return (
    <div className="relative z-(--lp-z-localnav) flex h-(--lp-localnav-h) shrink-0 xl:hidden">
      <div aria-hidden="true" className="hidden shrink-0 bg-muted min-[960px]:block min-[960px]:w-(--lp-shell-rail)" />
      <div className="flex min-w-0 flex-1 items-center justify-between border-b bg-background">
        <button
          ref={menuRef}
          type="button"
          aria-expanded={drawerOpen}
          aria-controls="lp-sidebar"
          onClick={onMenu}
          className="flex h-full items-center gap-2 px-6 pt-3 pb-[11px] text-xs leading-6 font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset md:px-8 md:py-0 min-[960px]:hidden"
        >
          <AlignLeft aria-hidden="true" className="size-3.5" />
          {t("nav.menu")}
        </button>
        <div className="ml-auto flex h-full items-center">{children}</div>
      </div>
    </div>
  );
}
