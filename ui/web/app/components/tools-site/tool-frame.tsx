import { Component, lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ToolLocaleProvider } from "~/components/tools-ui";
import type { PublicLng } from "~/lib/i18n";
import { isPorted, loadToolUi } from "~/tools/ui-registry";

// One lazy component per tool for the life of the page, so a re-render never
// starts a second import or remounts the tool and loses what was typed.
const LAZY = new Map<string, LazyExoticComponent<ComponentType>>();

function lazyTool(slug: string): LazyExoticComponent<ComponentType> {
  let c = LAZY.get(slug);
  if (!c) {
    c = lazy(() => loadToolUi(slug));
    LAZY.set(slug, c);
  }
  return c;
}

/**
 * A tool failed to load or threw while rendering. The article, FAQ and links
 * below still work, so the page keeps them and says what happened here only.
 */
class ToolBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * The tool itself. Its chunk loads on its own page only; the server renders
 * it too (Suspense waits on the server), so the first paint already holds the
 * tool and a crawler sees it. A tool whose UI is not ported yet says it is
 * coming back, and the rest of the page is unchanged.
 */
export function ToolFrame({ slug, locale }: { slug: string; locale: PublicLng }) {
  const { t } = useTranslation("tools");

  if (!isPorted(slug)) {
    return (
      <div role="status" className="rounded-lg border bg-muted px-5 py-6">
        <p className="font-medium">{t("tool.comingBackTitle")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("tool.comingBackBody")}</p>
      </div>
    );
  }

  const Tool = lazyTool(slug);
  const loading = (
    <p role="status" className="text-sm text-muted-foreground">
      {t("tool.loading")}
    </p>
  );
  const failed = (
    <p role="alert" className="rounded-lg border border-destructive bg-destructive-soft px-5 py-4 text-sm text-destructive-foreground">
      {t("tool.failed")}
    </p>
  );

  return (
    <ToolLocaleProvider locale={locale}>
      <ToolBoundary fallback={failed}>
        <Suspense fallback={loading}>
          <Tool />
        </Suspense>
      </ToolBoundary>
    </ToolLocaleProvider>
  );
}
